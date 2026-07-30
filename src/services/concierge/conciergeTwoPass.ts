/**
 * Modul 2 — Two-Pass Concierge.
 * Pass 1: Intent-Zerlegung + Research-Plan (JSON)
 * Pass 2: Antwort + Actions + Self-Check mit Research-Ergebnissen
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { isDeviceOffline } from '../navigation/networkState';
import { formatGpsTrackForPrompt } from '../navigation/gpsTrackBuffer';
import { formatUserMemoryForPrompt } from '../../store/useUserMemoryStore';
import { useOpenQuestionStore } from '../../store/useOpenQuestionStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile, isDataSaverActive } from '../userProfileService';
import type { ConciergeContext } from './conciergeContext';
import { askGeminiConciergeResponse } from '../geminiService';
import type { GeminiConciergeResponse } from '../../types/concierge';
import { wrapPlainAsConcierge } from './parseConciergeResponse';
import { researchTodaysEvents, isEventResearchQuery } from './eventResearchService';
import { runWebResearch, isWebResearchQuery } from '../research/webResearchService';
import { buildHeuristicAnalysis } from './questionAnalysisService';
import {
  isFlightDayReminderQuery,
  runFlightDayOrchestrator,
} from '../flights/flightDayOrchestrator';
import {
  isWhereAmIQuery,
  findNearbyPackPoi,
  researchAndDraftPoi,
  suggestNearbyUnvisited,
} from '../research/poiDiscoveryResearch';
import { prepareFlightFollowUp } from '../flights/flightAdvisor';
import { findAirportPoi } from '../flights/findAirportPoi';
import {
  isPreFlightSideTripQuery,
  runPreFlightSideTripFeasibility,
} from '../planning/preFlightSideTripFeasibility';
import {
  isEveningDiningOrchestratorQuery,
  runEveningDiningOrchestrator,
} from './eveningDiningOrchestrator';
import { isGenuineBlockerClarification } from './justDoItPolicy';
import {
  FINDUS_JUST_DO_IT_BLOCK,
  FINDUS_COMPOUND_PLAN_BLOCK,
  FINDUS_TOURIST_FRICTION_BLOCK,
  findusConstitutionBlock,
} from './findusResponsePolicy';
import { speakResearchAckFireAndForget } from './researchAck';
import { routeAgiLaws } from '../agi/ruleRouter';
import { runLawJudgePass } from '../agi/lawJudgePass';
import {
  isDayPlanOverviewQuery,
  rememberVoucherFromText,
  runDeparturePlanOverview,
} from '../planning/departurePlanOverview';

export type Pass1SubQuestion = {
  id: string;
  text: string;
  priority: number;
  answered: boolean;
};

export type Pass1ResearchTask = {
  type: 'web' | 'event' | 'flight' | 'food' | 'poi' | 'memory' | 'none';
  query: string;
  reason: string;
};

export type Pass1Analysis = {
  statedFacts: Array<{ key: string; value: string }>;
  subQuestions: Pass1SubQuestion[];
  userGoal: string;
  topicMode: 'new_topic' | 'follow_up' | 'clarification';
  relatesToPrior: boolean;
  needsClarification: string | null;
  deferParts: string[];
  researchTasks: Pass1ResearchTask[];
  sanityChecks: string[];
  anticipatedFollowUps: string[];
  memoryToStore: Array<{ key: string; value: string }>;
  promptBlock: string;
};

export type ResearchBundle = {
  blocks: string[];
  eventResearch: ConciergeContext['eventResearch'];
  webResearch: ConciergeContext['webResearch'];
  /** Vorgefertigte Concierge-Antwort (z. B. Flight-Day) — Pass 2 optional überspringen */
  prebuiltResponse?: GeminiConciergeResponse | null;
  nearbySuggestions?: Array<{ name: string; distanceM: number; poiId: number }>;
};

function extractJsonObject(raw: string): unknown | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function heuristicPass1(text: string): Pass1Analysis {
  const h = buildHeuristicAnalysis(text);
  return {
    statedFacts: h.statedFacts.map((f, i) => ({
      key: `fact_${i}`,
      value: f,
    })),
    subQuestions: h.subQuestions.map((q, i) => ({
      id: `sq-h-${i}`,
      text: q,
      priority: 60 - i * 5,
      answered: false,
    })),
    userGoal: h.userGoal,
    topicMode: h.topicMode,
    relatesToPrior: h.relatesToPrior,
    needsClarification: null,
    deferParts: [],
    researchTasks: h.researchTasks.map((q) => {
      const lower = q.toLowerCase();
      let type: Pass1ResearchTask['type'] = 'web';
      if (/flug|flight|leave-by|flugplatz|airport/i.test(lower)) type = 'flight';
      else if (/event|programm|heute\s+abend/i.test(lower)) type = 'event';
      else if (/gps|poi|friedhof|pack|blickrichtung/i.test(lower)) type = 'poi';
      else if (/essen|restaurant|speise/i.test(lower)) type = 'food';
      else if (/memory|hotel|checkout|frühstück/i.test(lower)) type = 'memory';
      return { type, query: q, reason: q };
    }),
    sanityChecks: h.sanityChecks,
    anticipatedFollowUps: h.anticipatedFollowUps,
    memoryToStore: [],
    promptBlock: h.promptBlock,
  };
}

function parsePass1(data: unknown, fallback: Pass1Analysis): Pass1Analysis {
  if (!data || typeof data !== 'object') return fallback;
  const o = data as Record<string, unknown>;

  const subQuestions: Pass1SubQuestion[] = [];
  if (Array.isArray(o.subQuestions)) {
    for (let i = 0; i < o.subQuestions.length; i++) {
      const row = o.subQuestions[i];
      if (typeof row === 'string') {
        subQuestions.push({
          id: `sq-${i}`,
          text: row,
          priority: 70 - i * 5,
          answered: false,
        });
      } else if (row && typeof row === 'object') {
        const r = row as Record<string, unknown>;
        subQuestions.push({
          id: String(r.id ?? `sq-${i}`),
          text: String(r.text ?? r.question ?? '').trim(),
          priority: Number(r.priority ?? 60 - i * 5),
          answered: Boolean(r.answered),
        });
      }
    }
  }

  const statedFacts: Array<{ key: string; value: string }> = [];
  if (Array.isArray(o.statedFacts)) {
    for (let i = 0; i < o.statedFacts.length; i++) {
      const row = o.statedFacts[i];
      if (typeof row === 'string') {
        statedFacts.push({ key: `fact_${i}`, value: row });
      } else if (row && typeof row === 'object') {
        const r = row as Record<string, unknown>;
        statedFacts.push({
          key: String(r.key ?? `fact_${i}`),
          value: String(r.value ?? r.text ?? '').trim(),
        });
      }
    }
  }

  const researchTasks: Pass1ResearchTask[] = [];
  if (Array.isArray(o.researchTasks)) {
    for (const row of o.researchTasks) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const type = String(r.type ?? 'web') as Pass1ResearchTask['type'];
      researchTasks.push({
        type:
          type === 'event' ||
          type === 'flight' ||
          type === 'food' ||
          type === 'poi' ||
          type === 'memory' ||
          type === 'none'
            ? type
            : 'web',
        query: String(r.query ?? r.topic ?? '').trim(),
        reason: String(r.reason ?? '').trim(),
      });
    }
  }

  const topicMode = o.topicMode;
  const mode =
    topicMode === 'follow_up' ||
    topicMode === 'clarification' ||
    topicMode === 'new_topic'
      ? topicMode
      : fallback.topicMode;

  const mergedStatedFacts = statedFacts.length ? statedFacts : fallback.statedFacts;
  const mergedSubQuestions = subQuestions.length ? subQuestions : fallback.subQuestions;
  const mergedResearchTasks = researchTasks.length ? researchTasks : fallback.researchTasks;
  const mergedSanityChecks = Array.isArray(o.sanityChecks)
    ? o.sanityChecks.map(String).slice(0, 8)
    : fallback.sanityChecks;
  const mergedAnticipated = Array.isArray(o.anticipatedFollowUps)
    ? o.anticipatedFollowUps.map(String).slice(0, 6)
    : fallback.anticipatedFollowUps;
  const mergedDeferParts = Array.isArray(o.deferParts)
    ? o.deferParts.map(String).slice(0, 4)
    : fallback.deferParts;
  const mergedUserGoal = String(o.userGoal ?? fallback.userGoal);
  const mergedClarification =
    typeof o.needsClarification === 'string' && o.needsClarification.trim()
      ? o.needsClarification.trim()
      : null;

  return {
    statedFacts: mergedStatedFacts,
    subQuestions: mergedSubQuestions,
    userGoal: mergedUserGoal,
    topicMode: mode,
    relatesToPrior: Boolean(o.relatesToPrior ?? fallback.relatesToPrior),
    needsClarification: mergedClarification,
    deferParts: mergedDeferParts,
    researchTasks: mergedResearchTasks,
    sanityChecks: mergedSanityChecks,
    anticipatedFollowUps: mergedAnticipated,
    memoryToStore: Array.isArray(o.memoryToStore)
      ? (o.memoryToStore as unknown[])
          .map((m, i) => {
            if (!m || typeof m !== 'object') return null;
            const r = m as Record<string, unknown>;
            return {
              key: String(r.key ?? `mem_${i}`),
              value: String(r.value ?? '').trim(),
            };
          })
          .filter((x): x is { key: string; value: string } =>
            Boolean(x?.value),
          )
      : [],
    promptBlock: buildPass1PromptBlock({
      statedFacts: mergedStatedFacts,
      subQuestions: mergedSubQuestions,
      userGoal: mergedUserGoal,
      topicMode: mode,
      needsClarification: mergedClarification,
      deferParts: mergedDeferParts,
      researchTasks: mergedResearchTasks,
      sanityChecks: mergedSanityChecks,
      anticipatedFollowUps: mergedAnticipated,
    }),
  };
}

function buildPass1PromptBlock(parts: {
  statedFacts: Array<{ key: string; value: string }>;
  subQuestions: Pass1SubQuestion[];
  userGoal: string;
  topicMode: string;
  needsClarification: string | null;
  deferParts: string[];
  researchTasks: Pass1ResearchTask[];
  sanityChecks: string[];
  anticipatedFollowUps: string[];
}): string {
  return [
    '=== PASS-1 ANALYSE (PFLICHT für Pass-2) ===',
    `Ziel: ${parts.userGoal}`,
    `Topic: ${parts.topicMode}`,
    parts.statedFacts.length
      ? `Fakten: ${parts.statedFacts.map((f) => `${f.key}=${f.value}`).join(' · ')}`
      : '',
    parts.subQuestions.length
      ? `Teilfragen (ALLE in Pass-2): ${parts.subQuestions.map((q, i) => `${i + 1}) ${q.text}`).join(' · ')}`
      : '',
    parts.needsClarification
      ? `Rückfrage nötig: ${parts.needsClarification}`
      : '',
    parts.deferParts.length
      ? `Zu viel — erst diese Teile: ${parts.deferParts.join(' · ')}`
      : '',
    parts.researchTasks.length
      ? `Research: ${parts.researchTasks.map((t) => t.type + ':' + t.query).join(' · ')}`
      : '',
    parts.sanityChecks.length ? `Prüfen: ${parts.sanityChecks.join(' · ')}` : '',
    parts.anticipatedFollowUps.length
      ? `Antizipieren: ${parts.anticipatedFollowUps.join(' · ')}`
      : '',
    '',
    'PASS-2 REGELN:',
    '- JEDE Teilfrage beantworten oder ehrlich defer mit Plan.',
    '- speechText kompakt, KEINE Adressen unless explizit gefragt.',
    '- quickActions = exakt gesprochene Orte/Links/Nummern.',
    findusConstitutionBlock(),
    FINDUS_JUST_DO_IT_BLOCK,
    FINDUS_COMPOUND_PLAN_BLOCK,
    FINDUS_TOURIST_FRICTION_BLOCK,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Pass 1 — Intent-Zerlegung + Research-Plan. */
export async function runConciergePass1(
  userText: string,
): Promise<Pass1Analysis> {
  const fallback = heuristicPass1(userText);
  await useOpenQuestionStore.getState().hydrate();

  const offline = await isDeviceOffline();
  if (offline || !hasGeminiApiKey()) return fallback;

  const store = useFinnusStore.getState();
  const profile = getCachedUserProfile();
  const openBlock = useOpenQuestionStore.getState().formatForPrompt();
  const history = store.chatHistory.slice(-6);

  const prompt = [
    'Du bist Findus Pass-1-Analyst. Zerlege die User-Eingabe vollständig — auch bei langen Texten (2+ Minuten).',
    'Antworte NUR JSON:',
    '{',
    '  "statedFacts": [{"key":"...","value":"..."}],',
    '  "subQuestions": [{"id":"sq1","text":"...","priority":80,"answered":false}],',
    '  "userGoal": "ein Satz",',
    '  "topicMode": "new_topic|follow_up|clarification",',
    '  "relatesToPrior": true|false,',
    '  "needsClarification": null ODER nur echte Blockade (nicht recherchierbar),',
    '  "deferParts": ["Teil der Frage für später"],',
    '  "researchTasks": [{"type":"web|event|flight|food|poi","query":"...","reason":"..."}],',
    '  "sanityChecks": ["Öffnungszeiten prüfen", ...],',
    '  "anticipatedFollowUps": ["Wie teuer?", ...],',
    '  "memoryToStore": [{"key":"flug_zeit","value":"10:15"}]',
    '}',
    '',
    'JUST-DO-IT: Wenn User Telefon, Party, Speisekarte, Öffnungszeiten, Locations will → researchTasks setzen, needsClarification = null.',
    'needsClarification NUR wenn ohne User-Antwort unmöglich (z.B. Personenanzahl ohne Default). Nie „Soll ich nachschauen?“.',
    '',
    formatGpsTrackForPrompt(),
    formatUserMemoryForPrompt().slice(0, 800),
    openBlock ? `\n${openBlock}` : '',
    profile?.cityName ? `Stadt: ${profile.cityName}` : '',
    store.currentLocationName ? `Ort: ${store.currentLocationName}` : '',
    history.length
      ? `Chat:\n${history.map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join('\n')}`
      : '',
    '',
    `User (vollständig):\n"""${userText.trim().slice(0, 4000)}"""`,
  ].join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      maxTokens: 1200,
      temperature: 0.15,
      useFindusSystem: false,
    });
    const parsed = extractJsonObject(raw);
    const result = parsePass1(parsed, fallback);

    useOpenQuestionStore.getState().mergeFromPass1({
      subQuestions: result.subQuestions,
      facts: [...result.statedFacts, ...result.memoryToStore],
      topicSummary: result.userGoal,
      anticipatedFollowUps: result.anticipatedFollowUps,
      sourceTurn: userText,
    });

    return result;
  } catch {
    return fallback;
  }
}

/** Research aus Pass-1-Plan — alle unabhängigen Quellen parallel (Promise.all). */
export async function executePass1Research(
  userText: string,
  pass1: Pass1Analysis,
  ctx: ConciergeContext | null,
): Promise<ResearchBundle> {
  const blocks: string[] = [];
  let eventResearch = ctx?.eventResearch ?? null;
  let webResearch = ctx?.webResearch ?? null;
  let prebuiltResponse: GeminiConciergeResponse | null = null;
  let nearbySuggestions: ResearchBundle['nearbySuggestions'];

  rememberVoucherFromText(userText);

  type Piece = {
    blocks?: string[];
    eventResearch?: ResearchBundle['eventResearch'];
    webResearch?: ResearchBundle['webResearch'];
    prebuiltResponse?: GeminiConciergeResponse | null;
    nearbySuggestions?: ResearchBundle['nearbySuggestions'];
  };

  const tasks: Array<Promise<Piece>> = [];

  // --- Orchestratoren / Domain-Research parallel ---
  if (isDayPlanOverviewQuery(userText)) {
    tasks.push(
      (async (): Promise<Piece> => {
        try {
          const plan = await runDeparturePlanOverview(userText);
          if (!plan) return {};
          return { blocks: [plan.promptBlock], prebuiltResponse: plan.response };
        } catch (err) {
          if (__DEV__) console.warn('[twoPass] day plan overview failed', err);
          return {};
        }
      })(),
    );
  }

  if (
    isEveningDiningOrchestratorQuery(userText) &&
    !isFlightDayReminderQuery(userText) &&
    !isPreFlightSideTripQuery(userText)
  ) {
    tasks.push(
      (async (): Promise<Piece> => {
        try {
          const dining = await runEveningDiningOrchestrator(userText, {
            eventResearch: eventResearch,
          });
          if (!dining) return {};
          return {
            blocks: [dining.promptBlock],
            prebuiltResponse: dining.response,
          };
        } catch (err) {
          if (__DEV__) console.warn('[twoPass] evening dining failed', err);
          return {};
        }
      })(),
    );
  }

  if (
    isPreFlightSideTripQuery(userText) &&
    !isFlightDayReminderQuery(userText)
  ) {
    tasks.push(
      (async (): Promise<Piece> => {
        try {
          const side = await runPreFlightSideTripFeasibility(userText);
          if (!side) return {};
          return { blocks: [side.promptBlock], prebuiltResponse: side.response };
        } catch (err) {
          if (__DEV__) console.warn('[twoPass] side-trip feasibility failed', err);
          return {};
        }
      })(),
    );
  }

  if (
    isFlightDayReminderQuery(userText) ||
    pass1.researchTasks.some((t) => t.type === 'flight')
  ) {
    tasks.push(
      (async (): Promise<Piece> => {
        try {
          const day = await runFlightDayOrchestrator(userText);
          if (day) {
            return {
              blocks: [day.plan.promptBlock],
              prebuiltResponse: day.response,
            };
          }
          const [airport, flight] = await Promise.all([
            findAirportPoi({
              lat: useFinnusStore.getState().lastGpsLat,
              lng: useFinnusStore.getState().lastGpsLng,
            }),
            prepareFlightFollowUp(userText),
          ]);
          const b: string[] = [];
          if (airport) {
            b.push(
              `=== FLUGPLATZ ===\n${airport.name} (${airport.source}${airport.distanceM != null ? `, ${airport.distanceM} m` : ''})`,
            );
          }
          if (flight?.reply) {
            b.push(`=== FLUG-ADVISOR ===\n${flight.reply}`);
          }
          return { blocks: b };
        } catch (err) {
          if (__DEV__) console.warn('[twoPass] flight research failed', err);
          return {};
        }
      })(),
    );
  }

  if (
    isWhereAmIQuery(userText) ||
    pass1.researchTasks.some((t) => t.type === 'poi')
  ) {
    tasks.push(
      (async (): Promise<Piece> => {
        try {
          const store = useFinnusStore.getState();
          const lat = store.lastGpsLat;
          const lng = store.lastGpsLng;
          if (lat == null || lng == null) return {};

          const [nearby, suggestions] = await Promise.all([
            findNearbyPackPoi(lat, lng, 120),
            suggestNearbyUnvisited(lat, lng, 3),
          ]);

          const b: string[] = [];
          if (suggestions.length) {
            b.push(
              `=== NÄCHSTE ORTE (unbesucht) ===\n${suggestions
                .map((n) => `· ${n.name} (${n.distanceM} m)`)
                .join('\n')}`,
            );
          }

          if (!nearby) {
            const draft = await researchAndDraftPoi({
              lat,
              lng,
              userText,
              hintName: store.currentLocationName,
            });
            if (draft?.promptBlock) b.push(draft.promptBlock);
          } else {
            b.push(
              `=== ORT IM PACK ===\n${nearby.name} (${nearby.distanceM} m) — Fakten aus DB nutzen, ggf. web nachberühmen.`,
            );
            if (/\b(friedhof|geschichte|wer\s+liegt|bekannt)\b/iu.test(userText)) {
              const draft = await researchAndDraftPoi({
                lat,
                lng,
                userText,
                hintName: nearby.name,
              });
              if (draft?.promptBlock) b.push(draft.promptBlock);
            }
          }
          return { blocks: b, nearbySuggestions: suggestions };
        } catch (err) {
          if (__DEV__) console.warn('[twoPass] poi research failed', err);
          return {};
        }
      })(),
    );
  }

  // Event + Web parallel (wenn kein Data-Saver)
  const wantEvent =
    !eventResearch &&
    (isEventResearchQuery(userText) ||
      pass1.researchTasks.some((t) => t.type === 'event'));
  const webTask = pass1.researchTasks.find(
    (t) =>
      (t.type === 'web' || t.type === 'food' || t.type === 'memory') &&
      t.query.trim() &&
      (isWebResearchQuery(userText) ||
        isWebResearchQuery(t.query) ||
        /check.?out|frühstück|fruehstueck|auscheck/i.test(t.query)),
  );
  const wantWeb =
    !webResearch && (Boolean(webTask) || isWebResearchQuery(userText));

  if (!isDataSaverActive()) {
    if (wantEvent) {
      tasks.push(
        researchTodaysEvents(userText)
          .then((eventRes): Piece =>
            eventRes
              ? {
                  eventResearch: eventRes,
                  blocks: eventRes.promptBlock ? [eventRes.promptBlock] : [],
                }
              : {},
          )
          .catch((err) => {
            if (__DEV__) console.warn('[twoPass] event research failed', err);
            return {};
          }),
      );
    }
    if (wantWeb) {
      tasks.push(
        runWebResearch(
          webTask && /check.?out|frühstück|fruehstueck/i.test(webTask.query)
            ? webTask.query
            : userText,
        )
          .then((webRes): Piece =>
            webRes
              ? {
                  webResearch: webRes,
                  blocks: webRes.promptBlock ? [webRes.promptBlock] : [],
                }
              : {},
          )
          .catch((err) => {
            if (__DEV__) console.warn('[twoPass] web research failed', err);
            return {};
          }),
      );
    }
  }

  const pieces = tasks.length ? await Promise.all(tasks) : [];

  for (const p of pieces) {
    if (p.blocks?.length) blocks.push(...p.blocks);
    if (p.eventResearch) eventResearch = p.eventResearch;
    if (p.webResearch) webResearch = p.webResearch;
    if (p.nearbySuggestions) nearbySuggestions = p.nearbySuggestions;
    // Erste deterministische Prebuilt gewinnt
    if (!prebuiltResponse && p.prebuiltResponse) {
      prebuiltResponse = p.prebuiltResponse;
    }
  }

  // Bei Prebuilt: schwere Live-Recherche-Blöcke behalten wir (liefen parallel schon),
  // aber Pass-2 wird übersprungen — ok.
  return {
    blocks,
    eventResearch,
    webResearch,
    prebuiltResponse,
    nearbySuggestions,
  };
}

const PASS2_SELF_CHECK = `
=== PASS-2 SELF-CHECK (vor JSON-Ausgabe) ===
1) Jede Teilfrage aus Pass-1 beantwortet? (Mehrteilig: einzeln prüfen, dann kombinieren)
2) User-Ziel erfüllt?
3) Sanity-Checks durchgeführt?
4) speechText kompakt — keine Adressen unless gefragt
5) quickActions = exakt gesprochene Orte/Links/Telefon (max 4 bei Events)
6) ${FINDUS_JUST_DO_IT_BLOCK.split('\n')[0]}
7) Zu viele Teile → defer: „Erst zu Punkt X — Rest gleich danach“
8) To-go + Sunset → Imbiss + echte Aussicht (nie Bahnhof)
`;

/** Pass 2 — finale Antwort mit Research + Self-Check + Kontext-Gesetze. */
export async function runConciergePass2(opts: {
  messages: Array<{ role: string; content: string }>;
  pass1: Pass1Analysis;
  research: ResearchBundle;
  maxTokens?: number;
  contextualLawsBlock?: string;
}): Promise<GeminiConciergeResponse> {
  const researchBlock = [
    opts.pass1.promptBlock,
    opts.contextualLawsBlock ?? '',
    ...opts.research.blocks,
    PASS2_SELF_CHECK,
  ]
    .filter(Boolean)
    .join('\n\n');

  const enriched = opts.messages.map((m) =>
    m.role === 'system'
      ? { ...m, content: `${m.content}\n\n${researchBlock}` }
      : m,
  );

  if (
    opts.pass1.needsClarification &&
    !opts.research.blocks.length &&
    isGenuineBlockerClarification(opts.pass1.needsClarification)
  ) {
    return wrapPlainAsConcierge(opts.pass1.needsClarification, {
      cardTitle: 'Kurze Rückfrage',
    });
  }

  return askGeminiConciergeResponse(enriched, {
    maxTokens: opts.maxTokens ?? 900,
  });
}

function heuristicPass1FromText(userText: string): Pass1Analysis {
  const h = buildHeuristicAnalysis(userText);
  const now = Date.now();
  return {
    statedFacts: h.statedFacts.map((v, i) => ({ key: `fact_${i}`, value: v })),
    subQuestions: h.subQuestions.map((text, i) => ({
      id: `hq-${now}-${i}`,
      text,
      priority: 50 + i,
      answered: false,
    })),
    userGoal: h.userGoal,
    topicMode: h.topicMode,
    relatesToPrior: h.relatesToPrior,
    needsClarification: null,
    deferParts: [],
    researchTasks: h.researchTasks.map((t) => ({
      type: (/\bflug|flight|leave-by|flugplatz/i.test(t)
        ? 'flight'
        : /\bevent|party|konzert/i.test(t)
          ? 'event'
          : /\bpoi|ort|friedhof|gps/i.test(t)
            ? 'poi'
            : /\bessen|food|restaurant|speise/i.test(t)
              ? 'food'
              : 'web') as Pass1ResearchTask['type'],
      query: t,
      reason: t,
    })),
    sanityChecks: h.sanityChecks,
    anticipatedFollowUps: h.anticipatedFollowUps,
    memoryToStore: [],
    promptBlock: h.promptBlock || `=== PASS-1 (heuristisch) ===\n${h.userGoal}`,
  };
}

/** Vollständiger Two-Pass-Lauf + AGI-Routing + Law-Judge. */
export async function runConciergeTwoPass(opts: {
  userText: string;
  messages: Array<{ role: string; content: string }>;
  conciergeCtx: ConciergeContext | null;
  maxTokens?: number;
}): Promise<{
  response: GeminiConciergeResponse;
  pass1: Pass1Analysis;
  research: ResearchBundle;
  agiModules?: string[];
}> {
  // Fast-path: bekannte Orchestratoren → heuristisches Pass-1 (kein Gemini-Wait)
  const canSkipPass1Gemini =
    isDayPlanOverviewQuery(opts.userText) ||
    isFlightDayReminderQuery(opts.userText) ||
    isPreFlightSideTripQuery(opts.userText) ||
    isEveningDiningOrchestratorQuery(opts.userText);

  const pass1 = canSkipPass1Gemini
    ? heuristicPass1FromText(opts.userText)
    : await runConciergePass1(opts.userText);

  // Sofort hörbar: User weiß, dass Recherche läuft (Satz-TTS läuft parallel)
  speakResearchAckFireAndForget(opts.userText);

  const routed = routeAgiLaws({
    userText: opts.userText,
    pass1,
    conciergeCtx: opts.conciergeCtx,
  });

  const research = await executePass1Research(
    opts.userText,
    pass1,
    opts.conciergeCtx,
  );

  if (opts.conciergeCtx) {
    if (research.eventResearch) {
      opts.conciergeCtx.eventResearch = research.eventResearch;
      opts.conciergeCtx.maxQuickActions = 4;
    }
    if (research.webResearch) {
      opts.conciergeCtx.webResearch = research.webResearch;
    }
  }

  // Deterministische Prebuilt-Antwort: Guardrails + optional Judge, kein Pass-2-LLM
  if (research.prebuiltResponse) {
    for (const sq of pass1.subQuestions) {
      if (
        research.prebuiltResponse.speechText
          .toLowerCase()
          .includes(sq.text.slice(0, 12).toLowerCase())
      ) {
        useOpenQuestionStore.getState().markAnswered(sq.id);
      }
    }
    const judged = await runLawJudgePass({
      response: research.prebuiltResponse,
      userText: opts.userText,
      judgeLaws: routed.judgeLaws,
      judgePromptBlock: routed.judgePromptBlock,
    });
    if (__DEV__) {
      console.log(
        '[twoPass] agi prebuilt',
        routed.categories.join('+'),
        judged.repaired ? 'repaired' : judged.skipped ? `skip:${judged.reason}` : 'ok',
        judged.actionNotes.filter((n) => n.action !== 'kept').length
          ? `buttons=${judged.actionNotes.filter((n) => n.action !== 'kept').map((n) => n.reason).join(',')}`
          : 'buttons=ok',
      );
    }
    return {
      response: judged.response,
      pass1,
      research,
      agiModules: routed.categories,
    };
  }

  const response = await runConciergePass2({
    messages: opts.messages,
    pass1,
    research,
    maxTokens: opts.maxTokens,
    contextualLawsBlock: routed.promptBlock,
  });

  // Markiere beantwortete SubQs wenn speech sie erwähnt
  for (const sq of pass1.subQuestions) {
    if (response.speechText.toLowerCase().includes(sq.text.slice(0, 12).toLowerCase())) {
      useOpenQuestionStore.getState().markAnswered(sq.id);
    }
  }

  // Law-Judge: prüft Verfassung-Kern + Kontext-Gesetze, repariert bei Verstoß
  const judged = await runLawJudgePass({
    response,
    userText: opts.userText,
    judgeLaws: routed.judgeLaws,
    judgePromptBlock: routed.judgePromptBlock,
  });

  if (__DEV__) {
    console.log(
      '[twoPass] agi',
      routed.categories.join('+'),
      `laws=${routed.contextualLaws.length}`,
      judged.repaired ? 'repaired' : judged.skipped ? `skip:${judged.reason}` : 'ok',
      judged.actionNotes.filter((n) => n.action !== 'kept').length
        ? `buttons=${judged.actionNotes.filter((n) => n.action !== 'kept').map((n) => `${n.action}:${n.reason}`).join(',')}`
        : 'buttons=ok',
    );
  }

  return {
    response: judged.response,
    pass1,
    research,
    agiModules: routed.categories,
  };
}
