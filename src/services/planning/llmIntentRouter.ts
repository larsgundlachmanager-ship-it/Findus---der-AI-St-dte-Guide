/**
 * LLM Intent Router — EVERY user utterance goes to Gemini first (when online).
 * Returns plan + speech + bullets + live action buttons for Concierge UI.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import type { CompoundPlanParseResult } from '../../runtime/sessionPlanTypes';
import { activateCompoundSessionPlan } from './activateSessionPlan';
import { normalizePlaceTypes } from './activateSessionPlan';
import { clampBufferMinutes } from './timeBufferPolicy';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { resolveAndStartNavigation } from '../navigation/resolveNavTarget';
import { setRuntimeModule } from '../../runtime/orchestrator';
import { prepareFlightFollowUp } from '../flights/flightAdvisor';
import { rememberFlightPlanForAlarm } from '../alarms/wakeAlarmAdvisor';
import type {
  GeminiConciergeResponse,
  QuickAction,
  QuickActionType,
} from '../../types/concierge';
import { shortenActionLabel } from '../concierge/actionLabelShorten';

export type LlmRouterIntent =
  | 'multi_stop'
  | 'explore'
  | 'question'
  | 'nav'
  | 'shopping'
  | 'clarify'
  | 'flight_status'
  | 'task_completed';

export type LlmRouterDestination = {
  name: string;
  deadline: string | null;
  kind: 'fixed' | 'hotel' | 'dynamic';
};

export type LlmRouterPlan = {
  intent: LlmRouterIntent;
  destinations: LlmRouterDestination[];
  searchCategories: string[];
  items: string[];
  freeRoam: boolean;
  bufferMinutes: number;
  confirmSpeech: string;
  clarifySpeech: string | null;
  missingInfo: string | null;
  visualBullets: string[];
  quickActions: QuickAction[];
  cardTitle: string | null;
  /** Only when intent === flight_status — never from clock times */
  flightNumber: string | null;
};

export type LlmRouterDispatch = {
  handled: boolean;
  reply?: string;
  startedNav?: boolean;
  /** Fall through to concierge / Gemini Q&A */
  fallThroughQuestion?: boolean;
  /** Rich UI card — speech + bullets + buttons */
  concierge?: GeminiConciergeResponse;
};

const ALLOWED_ACTION_TYPES = new Set<QuickActionType>([
  'START_NAVIGATION',
  'SHOW_MORE',
  'DIAL_PHONE',
  'OPEN_URL',
  'COMPLETE_SHOPPING_TASK',
  'SNOOZE_SHOPPING_TASK',
  'SET_WAKE_ALARM',
  'SET_TIMER',
]);

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((s) => s.length >= 1);
}

function normalizeIntent(raw: string): LlmRouterIntent {
  const t = raw.toLowerCase().trim();
  if (t === 'multi_stop' || t === 'multistop' || t === 'compound') return 'multi_stop';
  if (t === 'explore' || t === 'free_roam' || t === 'roam') return 'explore';
  if (t === 'nav' || t === 'navigation' || t === 'navigate') return 'nav';
  if (t === 'shopping' || t === 'errand') return 'shopping';
  if (t === 'clarify' || t === 'clarification') return 'clarify';
  if (
    t === 'flight_status' ||
    t === 'flight' ||
    t === 'flug' ||
    t === 'flugstatus'
  ) {
    return 'flight_status';
  }
  if (t === 'task_completed' || t === 'status_update' || t === 'done') return 'task_completed';
  return 'question';
}

function parseQuickActions(raw: unknown): QuickAction[] {
  if (!Array.isArray(raw)) return [];
  const out: QuickAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const type = String(o.type ?? '') as QuickActionType;
    if (!ALLOWED_ACTION_TYPES.has(type)) continue;
    const label = String(o.label ?? '').trim();
    if (!label) continue;
    const payloadRaw =
      o.payload && typeof o.payload === 'object'
        ? (o.payload as Record<string, unknown>)
        : {};
    const payload: QuickAction['payload'] = {};
    if (payloadRaw.destName != null)
      payload.destName = String(payloadRaw.destName);
    if (payloadRaw.destination != null)
      payload.destination = String(payloadRaw.destination);
    if (payloadRaw.textPrompt != null)
      payload.textPrompt = String(payloadRaw.textPrompt);
    if (payloadRaw.url != null) payload.url = String(payloadRaw.url);
    if (payloadRaw.phoneNumber != null)
      payload.phoneNumber = String(payloadRaw.phoneNumber);
    if (typeof payloadRaw.destLat === 'number')
      payload.destLat = payloadRaw.destLat;
    if (typeof payloadRaw.destLng === 'number')
      payload.destLng = payloadRaw.destLng;
    out.push({ type, label: shortenActionLabel(label), payload });
    if (out.length >= 4) break;
  }
  return out;
}

/** Deterministic buttons from plan — if Gemini omitted actions. */
function buildFallbackActions(plan: LlmRouterPlan): QuickAction[] {
  const actions: QuickAction[] = [];
  const fixed = plan.destinations.find((d) => d.kind === 'fixed');
  const hotel = plan.destinations.find((d) => d.kind === 'hotel');
  const hasShop =
    plan.items.length > 0 ||
    plan.searchCategories.length > 0 ||
    plan.destinations.some((d) => d.kind === 'dynamic');

  if (hasShop) {
    actions.push({
      type: 'SHOW_MORE',
      label: 'Supermarkt finden',
      payload: {
        textPrompt:
          'Zeig mir den nächsten offenen Supermarkt oder Kiosk für meine Einkäufe.',
      },
    });
  }
  if (hotel) {
    actions.push({
      type: 'START_NAVIGATION',
      label: 'Zum Hotel',
      payload: { destName: hotel.name || 'Hotel' },
    });
  }
  if (fixed) {
    const when = fixed.deadline ? ` (${fixed.deadline})` : '';
    actions.push({
      type: 'START_NAVIGATION',
      label: shortenActionLabel(`📍 ${fixed.name}`),
      payload: { destName: fixed.name },
    });
    void when;
  }
  if (plan.freeRoam && actions.length < 4) {
    actions.push({
      type: 'SHOW_MORE',
      label: 'Weiter erkunden',
      payload: {
        textPrompt:
          'Ich will noch etwas rumlaufen — melde dich wenn etwas Passendes in der Nähe ist.',
      },
    });
  }
  return actions.slice(0, 4);
}

function buildFallbackBullets(plan: LlmRouterPlan): string[] {
  const bullets: string[] = [];
  for (const d of plan.destinations) {
    if (d.kind === 'fixed') {
      bullets.push(
        d.deadline
          ? `${d.name} bis ${d.deadline}`
          : `Ziel: ${d.name}`,
      );
    } else if (d.kind === 'hotel') {
      bullets.push(`Zwischenstopp: ${d.name || 'Hotel'}`);
    } else if (d.kind === 'dynamic') {
      bullets.push(
        plan.items.length
          ? `Einkauf: ${plan.items.slice(0, 4).join(', ')}`
          : 'Flexibler Einkaufs-Stop',
      );
    }
  }
  if (
    plan.items.length &&
    !bullets.some((b) => b.toLowerCase().includes('einkauf'))
  ) {
    bullets.push(`Einkauf: ${plan.items.slice(0, 4).join(', ')}`);
  }
  if (plan.freeRoam) bullets.push('Freies Erkunden — ich melde mich');
  if (plan.bufferMinutes) {
    bullets.push(`Zeitpuffer ~${plan.bufferMinutes} Min`);
  }
  return bullets.slice(0, 3);
}

function recentChatContext(maxTurns = 8): string {
  const msgs = useFinnusStore.getState().chatHistory ?? [];
  return msgs
    .slice(-maxTurns)
    .map((m) => `${m.role === 'user' ? 'User' : 'Findus'}: ${m.content}`)
    .join('\n')
    .slice(0, 2500);
}

export function buildRouterSystemPrompt(opts: {
  nowIso: string;
  placeHint?: string | null;
  chat: string;
  userText: string;
}): string {
  return [
    'Du bist das Gehirn der Findus-App (Reisebegleiter).',
    `Jetzt (ISO): ${opts.nowIso}.`,
    opts.placeHint ? `Ort-Kontext: ${opts.placeHint}.` : '',
    'Analysiere den User-Input UND den Chat-Kontext.',
    'Extrahiere ALLE Ziele, Deadlines, Zwischenstopps, Einkäufe, Free-Roam-Wünsche — nichts weglassen.',
    'Antworte NUR mit einem JSON-Objekt (kein Markdown):',
    '{',
    '  "intent": "multi_stop" | "explore" | "question" | "nav" | "shopping" | "clarify" | "flight_status" | "task_completed",',
    '  "destinations": [{ "name": string, "deadline": "HH:MM"|null, "kind": "fixed"|"hotel"|"dynamic" }],',
    '  "searchCategories": string[],',
    '  "items": string[],',
    '  "freeRoam": boolean,',
    '  "bufferMinutes": number,',
    '  "confirmSpeech": string,',
    '  "clarifySpeech": string|null,',
    '  "missingInfo": string|null,',
    '  "visualBullets": string[],',
    '  "quickActions": [{ "type": "START_NAVIGATION"|"SHOW_MORE", "label": string, "payload": { "destName"?: string, "textPrompt"?: string } }],',
    '  "cardTitle": string|null,',
    '  "flightNumber": string|null',
    '}',
    'Regeln:',
    '- task_completed: User meldet Abschluss einer Aufgabe (z.B. "Flug gebucht", "Bin da", "Tisch reserviert"). KEINE SUCHE mehr auslösen!',
    '- multi_stop: mehrere Ziele/Bedürfnisse (Termin + Hotel + Einkauf + Spaziergang o.ä.).',
    '- explore: nur freies Erkunden / Bescheid wenn passend in der Nähe.',
    '- shopping: nur Einkaufsliste ohne festen Termin.',
    '- nav: nur Navigation zu EINEM konkreten Ort.',
    '- question: reine Wissens-/Konversationsfrage.',
    '- Bei Ablauf-/Übersichtsfragen: intent=question, KEINE destinations, KEINE START_NAVIGATION.',
    '- clarify: Info fehlt — clarifySpeech fasst max. ZWEI wichtigste Lücken in EINER kurzen Nachfrage zusammen (Deutsch, du-Form). Nie Fragekatalog.',
    '- flight_status: NUR wenn der User wirklich einen Flugstatus / Flugnummer meint (z.B. LH400).',
    '- „um 19:00 Uhr“ / Uhrzeiten sind Deadlines, NIEMALS flightNumber (nicht UM19).',
    '- flightNumber: nur echte IATA-Codes (LH400) oder null.',
    '- searchCategories: generische POI-Typen (supermarket, convenience_store, drugstore, pharmacy, kiosk, …).',
    '- items: ALLE Produkte aus dem Text.',
    '- kind=hotel / fixed / dynamic wie beschrieben.',
    '- deadline: HH:MM (auch aus „achtzehn Uhr dreißig“ → „18:30“).',
    '- bufferMinutes: IMMER ≥5 Min. Normal ~8–12; wichtig (Sport/Tisch/Zug) 10–15; Insel-Flug ~15; Großflughafen mind. 70, mit Gepäckabgabe 90 — User nach mehr/weniger fragen.',
    '- confirmSpeech: 2–4 kurze Sätze Umgangssprache (du-Form), bestätigt den GANZEN Plan mit Zeiten — keine Aufzählungszeichen in der Speech.',
    '- Timing inkl. Puffer: Leave-by = Deadline − Weg − bufferMinutes (nie punktgenau).',
    '- Beispiel: Tennis 18:00, 30 Min vorher → arrive 17:30; Essen 2h vorher + 1h Dauer → Essen bis ~15:30, Start Essen ~14:30.',
    '- Sofort-Stopps (Strand jetzt) = destination ohne deadline, quickAction START_NAVIGATION zuerst.',
    '- Einkäufe (Zahnbürste) = dynamic + searchCategories drugstore/supermarket + items.',
    '- visualBullets: 3–6 kurze Stichpunkte fürs Display (Reihenfolge der Schritte).',
    '- quickActions: 2–4 Tip-Buttons (START_NAVIGATION mit destName, SHOW_MORE mit textPrompt, SET_DEPARTURE_REMINDER mit dateIso).',
    '- cardTitle: kurzer Kartentitel z.B. „Dein Plan“.',
    '- Folgefragen mit Chat-Kontext verbinden.',
    '- Produktnamen sind NIEMALS Hotel-Namen.',
    '- Self-Check: Habe ich ALLE Bedürfnisse (Termin, Einkauf, Essen, Strand, Erinnerung) abgedeckt?',
    opts.chat ? `Chat-Kontext:\n${opts.chat}` : 'Chat-Kontext: (leer)',
    `Aktueller User-Input: „${opts.userText.slice(0, 1200)}“`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseRouterJson(data: Record<string, unknown>): LlmRouterPlan {
  const destinationsRaw = Array.isArray(data.destinations)
    ? data.destinations
    : [];
  const destinations: LlmRouterDestination[] = destinationsRaw
    .map((d) => {
      if (!d || typeof d !== 'object') return null;
      const o = d as Record<string, unknown>;
      const kindRaw = String(o.kind ?? 'fixed');
      const kind =
        kindRaw === 'hotel' || kindRaw === 'dynamic' || kindRaw === 'fixed'
          ? kindRaw
          : 'fixed';
      const name = String(o.name ?? '').trim();
      if (!name && kind !== 'dynamic') return null;
      const deadline =
        o.deadline == null || o.deadline === ''
          ? null
          : String(o.deadline).trim();
      return {
        name: name || 'Einkauf',
        deadline,
        kind,
      };
    })
    .filter(Boolean) as LlmRouterDestination[];

  const confirmSpeech = String(data.confirmSpeech ?? '').trim();
  const clarifySpeech =
    data.clarifySpeech == null || data.clarifySpeech === ''
      ? null
      : String(data.clarifySpeech).trim();
  const missingInfo =
    data.missingInfo == null || data.missingInfo === ''
      ? null
      : String(data.missingInfo).trim();
  const cardTitle =
    data.cardTitle == null || data.cardTitle === ''
      ? null
      : String(data.cardTitle).trim();

  let flightNumber =
    data.flightNumber == null || data.flightNumber === ''
      ? null
      : String(data.flightNumber).replace(/\s+/g, '').toUpperCase();
  // Never accept clock fakes
  if (flightNumber && /^(UM|AM|IM|PM)\d+$/i.test(flightNumber)) {
    flightNumber = null;
  }

  const plan: LlmRouterPlan = {
    intent: normalizeIntent(String(data.intent ?? 'question')),
    destinations,
    searchCategories: asStringArray(data.searchCategories),
    items: asStringArray(data.items),
    freeRoam: data.freeRoam === true,
    bufferMinutes: clampBufferMinutes(Number(data.bufferMinutes) || 15, {
      text: confirmSpeech,
      kind: flightNumber ? 'flight_commercial' : undefined,
    }),
    confirmSpeech,
    clarifySpeech,
    missingInfo,
    visualBullets: asStringArray(data.visualBullets).slice(0, 3),
    quickActions: parseQuickActions(data.quickActions),
    cardTitle,
    flightNumber,
  };

  // Uhrzeit-Termine ohne Flugwort → nie flight_status
  if (
    plan.intent === 'flight_status' &&
    !plan.flightNumber &&
    plan.destinations.some((d) => d.deadline)
  ) {
    plan.intent = 'multi_stop';
  }

  if (!plan.visualBullets.length) {
    plan.visualBullets = buildFallbackBullets(plan);
  }
  if (!plan.quickActions.length) {
    plan.quickActions = buildFallbackActions(plan);
  }
  return plan;
}

/**
 * Parse utterance + chat context into a plan. Null only if offline / no key / parse fail.
 */
export async function parseUtteranceWithLlmRouter(
  userText: string,
  opts?: { placeHint?: string | null },
): Promise<LlmRouterPlan | null> {
  if (!hasGeminiApiKey()) return null;
  try {
    if (await isDeviceOffline()) return null;
  } catch {
    /* continue — try anyway */
  }

  const prompt = buildRouterSystemPrompt({
    nowIso: new Date().toISOString(),
    placeHint: opts?.placeHint,
    chat: recentChatContext(),
    userText,
  });

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'intent',
      responseJson: true,
      useFindusSystem: false,
      maxTokens: 1100,
      temperature: 0.2,
    });
    const data = extractJsonObject(raw);
    if (!data) return null;
    return parseRouterJson(data);
  } catch (err) {
    if (__DEV__) console.warn('[llm-router] parse failed:', err);
    return null;
  }
}

function planToCompound(plan: LlmRouterPlan): CompoundPlanParseResult {
  const stops: CompoundPlanParseResult['stops'] = [];

  for (const d of plan.destinations) {
    stops.push({
      kind: d.kind,
      label: d.name,
      arriveByLocal: d.deadline,
      placeTypes:
        d.kind === 'dynamic'
          ? plan.searchCategories.length
            ? plan.searchCategories
            : ['supermarket', 'convenience_store']
          : [],
      items: d.kind === 'dynamic' ? plan.items : [],
    });
  }

  if (
    (plan.items.length > 0 || plan.searchCategories.length > 0) &&
    !stops.some((s) => s.kind === 'dynamic')
  ) {
    stops.push({
      kind: 'dynamic',
      label: 'Einkauf',
      arriveByLocal: null,
      placeTypes: plan.searchCategories.length
        ? plan.searchCategories
        : ['supermarket', 'convenience_store'],
      items: plan.items,
    });
  }

  const isCompound =
    plan.intent === 'multi_stop' ||
    plan.intent === 'explore' ||
    stops.filter((s) => s.kind !== 'dynamic').length +
      (stops.some((s) => s.kind === 'dynamic') ? 1 : 0) >=
      2 ||
    (stops.some((s) => s.arriveByLocal) &&
      (plan.items.length > 0 || plan.freeRoam));

  return {
    isCompound,
    freeRoam: plan.freeRoam || plan.intent === 'explore',
    bufferMinutes: plan.bufferMinutes,
    confirmSpeech:
      plan.confirmSpeech.length >= 12
        ? plan.confirmSpeech
        : 'Alles klar — ich merke mir deine Stopps und passe auf die Zeit auf.',
    stops,
  };
}

function toConcierge(plan: LlmRouterPlan, speech: string): GeminiConciergeResponse {
  return {
    speechText: speech,
    visualBullets: plan.visualBullets.length
      ? plan.visualBullets
      : buildFallbackBullets(plan),
    quickActions: plan.quickActions.length
      ? plan.quickActions
      : buildFallbackActions(plan),
    cardTitle: plan.cardTitle || 'Dein Plan',
  };
}

/**
 * Dispatch a parsed plan into session/shopping/nav + concierge UI payload.
 */
export async function dispatchLlmRouterPlan(
  plan: LlmRouterPlan,
  userText?: string,
): Promise<LlmRouterDispatch> {
  if (plan.intent === 'clarify') {
    const speech =
      plan.clarifySpeech ||
      plan.confirmSpeech ||
      (plan.missingInfo
        ? `Kurz nachgefragt: ${plan.missingInfo}`
        : null);
    if (speech && speech.length >= 8) {
      return {
        handled: true,
        reply: speech,
        concierge: {
          speechText: speech,
          visualBullets: plan.missingInfo ? [plan.missingInfo] : [],
          quickActions: [],
          cardTitle: 'Kurze Rückfrage',
        },
      };
    }
    return { handled: false, fallThroughQuestion: true };
  }

  if (plan.intent === 'question') {
    return { handled: false, fallThroughQuestion: true };
  }

  if (plan.intent === 'task_completed') {
    let reminderActions: QuickAction[] = [];
    let reply = plan.confirmSpeech.length >= 8 ? plan.confirmSpeech : 'Verstanden. Aufgabe ist erledigt.';
    
    // Calculate Next-Best-Action for bookings if deadline is given
    const fixedDest = plan.destinations.find(d => d.deadline);
    if (fixedDest && fixedDest.deadline) {
       // Estimate departure time: Deadline - 15m travel - 10m buffer = -25m
       const hm = fixedDest.deadline.match(/^(\d{1,2})[:.](\d{2})$/);
       if (hm) {
          const h = Number(hm[1]);
          const min = Number(hm[2]);
          let totalMin = h * 60 + min - 25; // 25 min buffer/travel
          if (totalMin < 0) totalMin += 24 * 60;
          const startH = Math.floor(totalMin / 60);
          const startM = totalMin % 60;
          const startStr = `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`;
          
          reminderActions.push({
             type: 'SET_WAKE_ALARM',
             label: `Erinnerung für ${startStr} Uhr stellen`,
             payload: { destName: fixedDest.name }
          });
       }
    }
    
    return {
      handled: true,
      reply,
      concierge: {
        speechText: reply,
        visualBullets: ['Status aktualisiert', ...plan.visualBullets].slice(0, 3),
        quickActions: reminderActions.length ? reminderActions : plan.quickActions,
        cardTitle: 'Aufgabe erledigt',
      }
    };
  }

  if (plan.intent === 'flight_status') {
    // Prefer original utterance so Inselflieger / island context is preserved
    const utterance =
      (userText && userText.trim().length >= 4
        ? userText.trim()
        : null) ||
      (plan.flightNumber ? `Flug ${plan.flightNumber}` : null) ||
      plan.confirmSpeech ||
      'flugstatus';
    const flight = await prepareFlightFollowUp(utterance, {
      flightNumber: plan.flightNumber,
    });
    if (flight?.concierge) {
      return {
        handled: true,
        reply: flight.reply,
        concierge: flight.concierge,
      };
    }
    if (!flight) {
      const speech =
        plan.clarifySpeech ||
        plan.confirmSpeech ||
        'Meinst du den Inselflieger (ohne Flugnummer) oder einen Linienflug wie LH400?';
      useUserMemoryStore.getState().setAwaitingFlightDetails(true);
      return {
        handled: true,
        reply: speech,
        concierge: {
          speechText: speech,
          visualBullets: plan.missingInfo ? [plan.missingInfo] : [],
          quickActions: [],
          cardTitle: 'Flug',
        },
      };
    }
    if (flight.plan) rememberFlightPlanForAlarm(flight.plan);
    const reply =
      plan.confirmSpeech.length >= 12
        ? `${plan.confirmSpeech} ${flight.reply}`
        : flight.reply;
    return {
      handled: true,
      reply,
      concierge: {
        speechText: reply,
        visualBullets: plan.visualBullets.length
          ? plan.visualBullets
          : flight.plan
            ? [
                flight.plan.flight.ident,
                flight.plan.flight.departureGate
                  ? `Gate ${flight.plan.flight.departureGate}`
                  : 'Gate folgt',
              ]
            : [],
        quickActions: plan.quickActions,
        cardTitle: plan.cardTitle || 'Flugstatus',
      },
    };
  }

  if (
    plan.intent === 'shopping' ||
    plan.intent === 'multi_stop' ||
    plan.intent === 'explore'
  ) {
    const mem = useUserMemoryStore.getState();
    mem.setAwaitingHotelName(false);
    mem.setPendingHotelConfirm(null);
  }

  if (plan.intent === 'nav' && plan.destinations[0]) {
    // Named restaurant go-to → Concierge confirm + Route starten + Tisch/Speisekarte
    // (not silent auto-start without those buttons)
    const utterance = (userText ?? '').replace(/\s+/g, ' ').trim();
    try {
      const { extractNamedDestinationLabel } = await import(
        '../concierge/canonicalDestination'
      );
      const named = utterance
        ? extractNamedDestinationLabel(utterance)
        : plan.destinations[0].name;
      if (
        named &&
        (/\b(restaurant|café|cafe|bistro|imbiss|bar|essen|tisch)\b/iu.test(
          utterance,
        ) ||
          /\b(restaurant|café|cafe|bistro|imbiss|bar)\b/iu.test(named))
      ) {
        return { handled: false, fallThroughQuestion: true };
      }
    } catch {
      // continue with direct nav
    }
    const dest = plan.destinations[0];
    setRuntimeModule('navigation');
    const result = await resolveAndStartNavigation({ name: dest.name });
    const reply =
      plan.confirmSpeech.length >= 12
        ? plan.confirmSpeech
        : result.ok
          ? `Alles klar — ich bring dich zu ${result.name}.`
          : result.message || (await generateDynamicNavFail(dest.name));
    return {
      handled: true,
      startedNav: result.ok,
      reply,
      concierge: toConcierge(plan, reply),
    };
  }

  if (plan.intent === 'shopping') {
    const types = normalizePlaceTypes(
      plan.searchCategories.length
        ? plan.searchCategories
        : ['supermarket', 'convenience_store'],
    );
    const items = plan.items.length ? plan.items : ['Einkauf'];
    for (const item of items) {
      useShoppingTaskStore.getState().addTask({
        itemLabel: item,
        placeTypes: types,
        anchor: 'store',
        dueAtMs: null,
      });
    }
    setRuntimeModule('explore');
    const reply =
      plan.confirmSpeech.length >= 12
        ? plan.confirmSpeech
        : 'Alles klar — ich halte die Augen offen und melde mich, wenn etwas Passendes in der Nähe ist.';
    return {
      handled: true,
      reply,
      concierge: toConcierge(plan, reply),
    };
  }

  const compound = planToCompound(plan);
  if (compound.isCompound || compound.stops.length >= 1) {
    const activated = activateCompoundSessionPlan({
      ...compound,
      isCompound: true,
    });
    if (activated) {
      // Merge Multimodal-Time-Resolver actions if available
      let mergedActions =
        activated.actions && activated.actions.length > 0
          ? [...activated.actions]
          : [...toConcierge(plan, activated.reply).quickActions];

      // Leave-by Erinnerung-Button + Push
      if (activated.plan.leaveByMs != null) {
        const leaveByMs = activated.plan.leaveByMs;
        const hasReminder = mergedActions.some(
          (a) =>
            a.type === 'SET_DEPARTURE_REMINDER' || a.type === 'SET_WAKE_ALARM',
        );
        if (!hasReminder) {
          mergedActions = [
            {
              type: 'SET_DEPARTURE_REMINDER' as const,
              label: `⏰ Erinnerung ${new Date(leaveByMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
              payload: {
                dateIso: new Date(leaveByMs).toISOString(),
                destName:
                  activated.plan.stops.find((s) => s.kind === 'fixed')?.label ??
                  'Termin',
              },
            },
            ...mergedActions,
          ].slice(0, 4);
        }
        try {
          const { scheduleFlightDepartureReminder } = await import(
            '../notifications/notificationService'
          );
          const walkGuess = Math.max(10, activated.plan.bufferMinutes || 15);
          void scheduleFlightDepartureReminder({
            departureMs: leaveByMs + walkGuess * 60_000,
            walkEtaMinutes: walkGuess,
            flightLabel:
              activated.plan.stops.find((s) => s.kind === 'fixed')?.label ??
              'Termin',
            reminderKey: `session-${activated.plan.id}`,
          });
        } catch {
          /* soft */
        }
      }

      // Sofort-Nav: User will jetzt los (Strand zuerst) → Navigation starten + Rest in Tour
      let startedNav = false;
      const wantsImmediate =
        /\b(sofort|jetzt|gleich|lass\s+uns|bring\s+mich|geh(?:en)?\s+wir)\b/iu.test(
          userText ?? '',
        ) ||
        mergedActions.some(
          (a) =>
            a.type === 'START_NAVIGATION' &&
            /strand|beach|jetzt|sofort/i.test(a.label + (a.payload.destName ?? '')),
        );
      if (wantsImmediate) {
        const navAction = mergedActions.find((a) => a.type === 'START_NAVIGATION');
        const firstLabel =
          navAction?.payload.destName ||
          activated.plan.stops.find((s) => !s.arriveByMs || s.arriveByMs > Date.now() + 30 * 60_000)
            ?.label ||
          activated.plan.stops[0]?.label;
        if (firstLabel) {
          try {
            setRuntimeModule('navigation');
            const result = await resolveAndStartNavigation({
              name: firstLabel,
              lat: navAction?.payload.destLat,
              lng: navAction?.payload.destLng,
            });
            startedNav = result.ok;
            // Nachfolge-Stops in Multi-Stop-Tour einreihen
            if (result.ok) {
              try {
                const { insertTourStop } = await import(
                  '../navigation/multiStopTour'
                );
                for (const stop of activated.plan.stops) {
                  if (
                    stop.label &&
                    stop.label.toLowerCase() !== firstLabel.toLowerCase() &&
                    stop.kind === 'fixed' &&
                    stop.lat != null &&
                    stop.lng != null
                  ) {
                    await insertTourStop(
                      {
                        poiId: -1,
                        name: stop.label,
                        lat: stop.lat,
                        lng: stop.lng,
                        done: false,
                      },
                      { position: 'end', startNow: false },
                    );
                  }
                }
              } catch {
                /* soft */
              }
            }
          } catch {
            /* soft */
          }
        }
      }

      return {
        handled: true,
        startedNav,
        reply: activated.reply,
        concierge: {
          ...toConcierge(plan, activated.reply),
          speechText: activated.reply,
          quickActions: mergedActions,
        },
      };
    }
  }

  if (plan.confirmSpeech.length >= 12) {
    return {
      handled: true,
      reply: plan.confirmSpeech,
      concierge: toConcierge(plan, plan.confirmSpeech),
    };
  }

  return { handled: false, fallThroughQuestion: true };
}

async function generateDynamicNavFail(destName: string): Promise<string> {
  try {
    const line = await generateGeminiText(
      [
        'Du bist Findus. Navigation zum Ziel klappt gerade nicht.',
        `Ziel: ${destName}.`,
        'GENAU EIN kurzer deutscher Satz (du-Form), ehrlich, ohne Template-Floskeln.',
      ].join('\n'),
      {
        task: 'generic',
        useFindusSystem: false,
        maxTokens: 80,
        temperature: 0.5,
      },
    );
    const t = line.trim();
    if (t.length >= 10) return t;
  } catch {
    /* fall through */
  }
  return 'Die Route klappt gerade nicht — lass uns das Ziel nochmal klar machen.';
}

/**
 * Full entry: parse + dispatch. Returns null if LLM unavailable (caller may fall back).
 */
export async function routeUserUtteranceWithLlm(
  userText: string,
): Promise<LlmRouterDispatch | null> {
  const text = userText.replace(/\s+/g, ' ').trim();
  if (text.length < 2) return null;

  const store = useFinnusStore.getState();
  const plan = await parseUtteranceWithLlmRouter(text, {
    placeHint: store.currentLocationName ?? null,
  });
  if (!plan) return null;
  return dispatchLlmRouterPlan(plan, text);
}
