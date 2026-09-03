/**
 * Call-1 Manager — LLM versteht Frage, Bridge, Session, Tasks.
 * Kein Heuristik-Fallback für Bridge (Plan): bei LLM-Fail → null Bridge + classifyJob tasks.
 */

import { generateGeminiText, generateGeminiJsonStream, hasAnyChatLlm } from '../../services/geminiService';
import {
  getForegroundThread,
  listResumableThreads,
} from '../../services/memory/conversationThreads';
import { getCachedUserProfile } from '../../services/userProfileService';
import {
  isLiveChatTurnActive,
  wantsExplicitDeepResearch,
} from '../../services/handsFree/liveChatTurnContext';
import { asCall1Execution, resolveCall1Execution } from './call1Dispatch';
import { classifyJob } from '../jobs/classifyJob';
import { buildCityChatRegelwerk } from '../context/cityChatRegelwerk';
import { resolveCityChatScope } from '../context/placeContext';
import {
  buildCompactBridgeVoiceHint,
  resolveEffectivePersonalityMatrix,
} from '../../services/persona/personalityMatrixPrompt';
import {
  clipBridgeToWordLimit,
  resolvePaceBudget,
} from './paceBudget';
import type {
  ManagerAnalysis,
  ManagerLanePlan,
  ManagerRoute,
  ManagerSession,
  ManagerTask,
  ManagerTaskLane,
  ManagerTaskPriority,
} from './types';
import { getBlueprintContract } from '../blueprints/registry';
import {
  sanitizeRouterDecision,
  laneFromLegacyRoute,
} from './routeAllowlist';
import { resolvePersonaVariant } from '../blueprints/personaVariants';
import {
  heuristicTurnFrame,
  mergeTurnFrame,
  parseTurnFrameFromLlm,
} from './turnFrame';
import { tryExtractBridgeField } from '../reboot/pipeline/streamJsonBridge';
import {
  applyResearchBudgetToPace,
  resolveResearchBudget,
} from '../reboot/pipeline/researchBudget';
import { parseTopicScope } from '../reboot/pipeline/topicScopeParse';

const MAX_TASKS = 20;

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw || '').trim();
  if (!t) return null;
  try {
    const p = JSON.parse(t);
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      return p as Record<string, unknown>;
    }
  } catch {
    /* try fence */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRoute(v: unknown): ManagerRoute {
  const s = String(v || '');
  const ok: ManagerRoute[] = [
    'm1_poi',
    'm3_nav_start',
    'm3_nav_query',
    'm5_plan',
    'memory',
    'blueprint',
    'smalltalk',
  ];
  return (ok.includes(s as ManagerRoute) ? s : 'blueprint') as ManagerRoute;
}

function asSession(v: unknown): ManagerSession {
  const s = String(v || '');
  if (s === 'continue' || s === 'resume') return s;
  return 'new';
}

function asLanePlan(v: unknown): ManagerLanePlan {
  const s = String(v || '');
  if (s === 'fast_plus_silent_slow' || s === 'fast_then_spoken_slow') return s;
  return 'fast_only';
}

function asPriority(v: unknown): ManagerTaskPriority {
  const s = String(v || '');
  if (s === 'silent_slow' || s === 'spoken_slow') return s;
  return 'fast';
}

function asLane(v: unknown): ManagerTaskLane {
  const s = String(v || 'other');
  const ok: ManagerTaskLane[] = [
    'weather',
    'pack',
    'places',
    'hours',
    'walk_eta',
    'web_events',
    'grocery_on_way',
    'dining',
    'cinema',
    'amenity',
    'parking',
    'combo',
    'knowledge',
    'instagram',
    'other',
  ];
  return (ok.includes(s as ManagerTaskLane) ? s : 'other') as ManagerTaskLane;
}

function stripNameSpam(bridge: string | null, nameAllowed: boolean): string | null {
  if (!bridge) return null;
  const profile = getCachedUserProfile();
  const name = profile?.firstName?.trim();
  if (!name || name.length < 2) return bridge;
  let timeOk = nameAllowed;
  try {
    const { canSayUserName, stripUserNameIfThrottled } = require('../../services/persona/userNameThrottle') as {
      canSayUserName: () => boolean;
      stripUserNameIfThrottled: (
        t: string | null,
        n: string | null,
      ) => string | null;
    };
    if (!nameAllowed || !canSayUserName()) {
      return stripUserNameIfThrottled(bridge, name);
    }
    timeOk = true;
  } catch {
    timeOk = nameAllowed;
  }
  if (timeOk && nameAllowed) return bridge;
  const re = new RegExp(
    `\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b[,!.\\s]*`,
    'giu',
  );
  return bridge.replace(re, '').replace(/\s{2,}/g, ' ').trim() || bridge;
}

function normalizeTasks(raw: unknown): ManagerTask[] {
  if (!Array.isArray(raw)) return [];
  const out: ManagerTask[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_TASKS)) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const brief = String(o.brief || '').trim();
    if (brief.length < 4) continue;
    const id = String(o.id || `t${out.length + 1}`).slice(0, 48);
    const key = `${asLane(o.lane)}:${brief.slice(0, 40).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const priority = asPriority(o.priority);
    const affectsSpeech =
      typeof o.affectsSpeech === 'boolean'
        ? o.affectsSpeech
        : priority !== 'silent_slow';
    out.push({
      id,
      lane: asLane(o.lane),
      brief: brief.slice(0, 280),
      priority,
      thinkAhead: Boolean(o.thinkAhead),
      affectsSpeech,
      filters:
        o.filters && typeof o.filters === 'object'
          ? (o.filters as Record<string, string | number | boolean>)
          : undefined,
      searchHints: Array.isArray(o.searchHints)
        ? o.searchHints.map((x) => String(x).slice(0, 80)).slice(0, 6)
        : undefined,
    });
  }
  return out;
}

function attachTurnFrame(
  analysis: ManagerAnalysis,
  userText: string,
  gpsCity: string | null,
  parsed?: Record<string, unknown> | null,
): ManagerAnalysis {
  const heuristic = heuristicTurnFrame(userText, gpsCity, {
    session: analysis.session,
    threadId: analysis.threadMatchId,
    subject: analysis.subject,
    bridge: analysis.bridge,
  });
  const llm = parseTurnFrameFromLlm(parsed ?? null, gpsCity);
  const frame = mergeTurnFrame(llm, heuristic);
  frame.session = analysis.session;
  frame.threadId = analysis.threadMatchId;
  frame.subject = analysis.subject;
  frame.bridge = analysis.bridge;
  const merged = { ...analysis, frame };
  return {
    ...merged,
    execution: merged.execution ?? resolveCall1Execution(merged),
  };
}

function heuristicTasksFromClassify(userText: string): {
  tasks: ManagerTask[];
  jobHint: string;
  route: ManagerRoute;
  blueprintId: string | null;
  blueprintStage: string | null;
} {
  const job = classifyJob(userText);
  const jobId = job.jobId;
  let route: ManagerRoute = 'blueprint';
  let blueprintId: string | null = null;
  let blueprintStage: string | null = null;

  if (jobId === 'poi_identify') route = 'm1_poi';
  else if (jobId === 'nav_route') {
    // Explizites „navigiere / bring mich / führ mich“ → Sofort-Start, nicht nur ETA
    try {
      const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
        isExplicitNavIntent: (t: string) => boolean;
      };
      const etaOnly =
        /\b(wie\s+lange|wieviel\s+zeit|dauer|brauch(?:e|st|en)?|minuten|eta)\b/i.test(
          userText,
        ) && !isExplicitNavIntent(userText);
      route =
        isExplicitNavIntent(userText) && !etaOnly
          ? 'm3_nav_start'
          : 'm3_nav_query';
    } catch {
      route = 'm3_nav_query';
    }
  } else if (jobId === 'taxi_rideshare') {
    route = 'm3_nav_query';
  } else if (jobId === 'day_plan_budget') route = 'm5_plan';
  else if (jobId === 'tonight_live') {
    blueprintId = 'cinema';
    blueprintStage = 'cinema_orient';
  } else if (jobId.startsWith('dining')) {
    blueprintId = 'dining';
    blueprintStage = 'dining_choice';
  } else if (jobId === 'smalltalk_general') {
    route = 'smalltalk';
    blueprintId = null;
    blueprintStage = null;
  } else if (
    /\b(grill|grillen|bbq)\b/iu.test(userText)
  ) {
    blueprintId = 'compound_evening_goal';
    blueprintStage = 'grill';
  }

  // Companion sticky / emotional → Smalltalk Fast-Lane, keine Research
  try {
    const {
      looksLikeSmalltalkCompanion,
      isSmalltalkCompanionActive,
      shouldAbortCompanionForTravel,
      markSmalltalkCompanion,
      clearSmalltalkCompanion,
    } = require('../../services/handsFree/smalltalkCompanionMode') as {
      looksLikeSmalltalkCompanion: (t: string) => boolean;
      isSmalltalkCompanionActive: () => boolean;
      shouldAbortCompanionForTravel: (t: string) => boolean;
      markSmalltalkCompanion: (r?: string) => void;
      clearSmalltalkCompanion: (r?: string) => void;
    };
    if (shouldAbortCompanionForTravel(userText) && isSmalltalkCompanionActive()) {
      clearSmalltalkCompanion('travel');
    } else if (
      looksLikeSmalltalkCompanion(userText) ||
      (isSmalltalkCompanionActive() && !shouldAbortCompanionForTravel(userText))
    ) {
      markSmalltalkCompanion('classify');
      route = 'smalltalk';
      blueprintId = null;
      blueprintStage = null;
    }
  } catch {
    /* soft */
  }

  // Plan-Hint nur im Call-1-Prompt (collectCall1DialogFlags), kein Keyword-Zwang auf m5_plan.

  const bp = blueprintId ? getBlueprintContract(blueprintId, blueprintStage) : null;
  const tasks: ManagerTask[] = (bp?.defaultTasks ?? []).map((t, i) => ({
    ...t,
    id: t.id || `bp_${i}`,
  }));
  if (!tasks.length) {
    tasks.push({
      id: 'primary',
      lane: 'knowledge',
      brief: `Beantworte: ${userText.slice(0, 160)}`,
      priority: 'fast',
      affectsSpeech: true,
    });
  }
  return { tasks, jobHint: jobId, route, blueprintId, blueprintStage };
}

/** Schema-Sanitisierung — kein userText-Keyword-Routing nach Call-1. */
function sanitizeCall1Schema(
  analysis: ManagerAnalysis,
  parsed?: Record<string, unknown> | null,
): ManagerAnalysis {
  const persona = resolvePersonaVariant();
  const sanitized = sanitizeRouterDecision({
    lane: parsed?.lane ?? analysis.chatLane,
    route: analysis.route,
    blueprintId: analysis.blueprintId,
    nearestBlueprint: parsed?.nearestBlueprint ?? analysis.nearestBlueprint,
    needsResearch: parsed?.needsResearch ?? analysis.needsResearch,
    personaVariant:
      parsed?.personaVariant ?? analysis.personaVariant ?? persona.variant,
    intents: parsed?.intents ?? analysis.intents,
  });

  let route = analysis.route;
  if (sanitized.lane === 'plan') {
    route = route === 'm5_plan' ? route : 'm5_plan';
  } else if (sanitized.lane === 'nav') {
    route =
      route === 'm3_nav_query' || route === 'm3_nav_start'
        ? route
        : 'm3_nav_start';
  } else if (sanitized.lane === 'm1') {
    route = 'm1_poi';
  } else if (sanitized.lane === 'pitch') {
    route = 'blueprint';
  } else if (sanitized.lane === 'chat') {
    if (
      route !== 'm3_nav_start' &&
      route !== 'm3_nav_query' &&
      route !== 'm1_poi' &&
      route !== 'm5_plan'
    ) {
      route = 'blueprint';
    }
  }

  const execution = asCall1Execution(parsed?.execution ?? analysis.execution);
  const call2Brief =
    typeof parsed?.call2Brief === 'string' && parsed.call2Brief.trim()
      ? parsed.call2Brief.trim().slice(0, 320)
      : analysis.call2Brief ?? null;
  const bridgeComplete =
    parsed?.bridgeComplete === true ||
    parsed?.bridge_complete === true ||
    analysis.bridgeComplete === true;
  const selectedGoldKeys = (() => {
    const raw = parsed?.selectedGoldKeys ?? parsed?.selected_gold_keys;
    if (!Array.isArray(raw)) return analysis.selectedGoldKeys;
    return raw
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .slice(0, 8);
  })();

  return {
    ...analysis,
    route,
    blueprintId: sanitized.blueprintId,
    chatLane: sanitized.lane,
    needsResearch: sanitized.needsResearch,
    personaVariant: sanitized.personaVariant,
    nearestBlueprint: sanitized.nearestBlueprint,
    execution: execution ?? analysis.execution,
    call2Brief,
    bridgeComplete: bridgeComplete || undefined,
    selectedGoldKeys: selectedGoldKeys?.length ? selectedGoldKeys : undefined,
    intents: sanitized.intents.map((i) => ({
      id: i.id,
      lane: i.lane,
      blueprintId: i.blueprintId,
      brief: i.brief,
      dependsOn: i.dependsOn,
    })),
  };
}

function buildManagerPrompt(opts: {
  userText: string;
  threadBlock: string;
  city: string | null;
  navActive: boolean;
  /** Reiche Nav-FLAG-Zeile (Mode + Ziel + Mode-Switch-Auftrag) */
  navContextFlag?: string | null;
  calendarOpen: boolean;
  liveChat?: boolean;
  dialogFlags?: string[];
  rucksackLine?: string | null;
}): string {
  const bridgeRule = opts.liveChat
    ? '- bridge: Beat 1 = Verstanden + Zuspruch/Zusagen (1–2 Sätze). Keine Fakten/Optionen. Kein „gleich fertig“/Warte-Meta. Ja/Nein/„los“: null. Trivia/Faktenfrage (wie alt/wer ist): kurze Bridge Pflicht (Würdigung), nie null, session=new.'
    : '- bridge: Beat 1 = „Ich habe dich verstanden“ + Idee würdigen oder klar zusagen was du tust (Nav starten / Eventkalender / Mittag am genannten Ort). NICHT schon Call-2 (keine Venue-Namen, Preise, Minuten). Kein „gleich fertig“ / „bin gleich soweit“ / Meta-Warte. Cover 2–3 Sätze bei Recherche. Trivia/Faktenfrage: immer kurze Bridge, session=new. Bei continue/resume IMMER null. Kein Name. Wortlaut nie als Script.';
  const bridgeVoiceHint = buildCompactBridgeVoiceHint(
    resolveEffectivePersonalityMatrix(getCachedUserProfile()),
  );
  return [
    'Du bist der Yorro-Planer (Call-1). Ein Durchgang = ausführbarer Auftrag. Keine Keyword-Weiche davor.',
    bridgeVoiceHint,
    require('./call1ThinkFrame').FINDUS_CALL1_THINK_FRAME as string,
    require('../reboot/pipeline/call1Frozen').CALL1_FROZEN_CONTRACT as string,
    'Antworte NUR als JSON (kein Markdown).',
    'JSON-REIHENFOLGE (Streaming): bridge ZUERST im Objekt, dann execution, session, lane — damit Beat 1 sofort gesprochen werden kann.',
    '',
    'MASTERPLAN = Auftrag schreiben, NICHT ausführen. Worker holen Fakten. Bridge = Verstanden/Zusagen (keine Orte/Preise/Minuten).',
    '- session: new | continue | resume (gleicher Faden nur bei klarem Bezug).',
    '- lane: chat | nav | m1 | plan | pitch — was der User JETZT braucht; intents[] bei Multi-Intent.',
    '- Immer Live versuchen. Offline kein Vorcheck.',
    '',
    'Felder:',
    '- intentSummary: 1 Satz intern',
    '- lane: chat | nav | m1 | plan | pitch  (PRIMÄR — chat = Default)',
    '- execution: chat_lane | pitch_module | flight_advisor | plan_module | plan_walkthrough | tour_module | events_research | nav_execute | m1_poi | memory | task_fanout | reisebuero — EIN Backend pro Turn; Code dispatcht nur danach.',
    '- call2Brief: 1–3 Sätze intern — Antwort-STRUKTUR für Call 2 (was zuerst, Top-2, Buttons) — kein Dialog-Script. null/leer wenn bridgeComplete=true (Bridge war die ganze Antwort / Klärfrage).',
    '- bridgeComplete: true wenn die Bridge die User-Antwort schon vollständig trägt — inkl. gezielter Klärfrage bei fehlendem Pflicht-Slot (Flug-Uhr, Taxi-Ziel, …), Nav-Stop, Mode-Switch, reine Bestätigung. Dann Call 2 / Recherche skippen. Wortlaut der Frage frei, kein Script.',
    '- selectedGoldKeys: 0–N Keys aus OWNER_GOLD_KATALOG die zu DIESEM Satz passen; bei unbekannter Frage [] und Auftrag selbst erfinden.',
    '- route: legacy m1_poi | m3_nav_start | m3_nav_query | m5_plan | memory | blueprint | smalltalk (an lane anpassen)',
    '- blueprintId / blueprintStage: cinema/cinema_orient, dining/dining_choice, hotel/hotel_choice, live_events/today, compound_evening_goal/grill — oder null wenn keiner passt (neu denken, nicht erzwingen)',
    '- nearestBlueprint: ähnliche Id oder null (Theater→cinema)',
    '- needsResearch: quick | pack | deep',
    '- personaVariant: default | family_kids | party_nightlife | solo_adult',
    '- intents: optional Array [{id,lane,blueprintId,brief,dependsOn}] für Multi-Intent',
    '- session: new | continue | resume',
    '- threadMatchId: id wenn continue/resume sonst null',
    '- subject: kurzer Themenanker oder null',
    bridgeRule,
    '- lanePlan: fast_only | fast_plus_silent_slow | fast_then_spoken_slow',
    '- pace: instant | standard | cover — cover wenn Recherche mehrere Sekunden dauert',
    '- bridgeMaxWords / fastDeadlineMs: optional; Cover ~36 Wörter / 8s Deadline',
    '- latencyHintSec: nur bei spoken_slow nötig, sonst null',
    '- destCity: genannte Zielstadt oder null. GPS-Hint ist NUR Start, nie Ziel wenn destCity gesetzt.',
    '- startIsGps: true wenn Anreise/Los vom aktuellen Standort.',
    '- when: Array {kind: now|clock|day, at:"HH:mm"|null, dateKey:"YYYY-MM-DD"|null, label}. User-Zeit verbindlich; Code zieht fehlende dateKey/clock aus dem Satz nach — nichts neu raten.',
    '- mustHaves: Hard-Filter aus DIESEM Satz (max 8) — keine erfundenen Orte',
    '- criteria: Array {key, role: must|nice|soft, weight: 1-30} — du setzt Prioritäten zur Frage. Keine Venue-Namen/Punkte. Shortlist Top-5 → Speak Top-2.',
    '- authorIntent: 1 Satz was der User JETZT will',
    '- thinkAhead: 0–3 grobe Hinweise. Nicht ausführen.',
    '- work: 1–4 Aufträge {id, worker: plan|dining|nav|transit|flight|hotel|pitch|chat|m1, brief, destCity, startIsGps, when, mustHaves, dependsOn} — erfinde was die Lücke schließt',
    '- tasks: optional legacy Array',
    '- openLoops: andere Themen später',
    '- nameAllowed: immer false außer echte Begrüßung nach langer Pause',
    '- jobHint: flight_trip nur bei klarem Flug/Thread — nie nur wegen Uhr+morgen',
    '- bridgeMeta: { researchBudgetSec: 0–12 }',
    '- topicScope: { mode: new|followup, turnsForCall2: 0–10, inheritLiveInventory?: bool }. HART: mode=new ⇒ turnsForCall2=0 + inheritLiveInventory=false (Code erzwingt 0 Historie). Follow-up: typisch turnsForCall2=3, max 10.',
    '- cityScope: { cityId, researchCity, packPolicy: use_local|require_download|live_bootstrap|none }',
    '- memoryPolicy: { shortTerm: bool, longTerm: bool }',
    '',
    'HART (Bug-Schutz — kurz):',
    '- HAUPTZIEL: Userfrage bestmöglich beantworten, User glücklich. Erfinde Teilfragen + work[] dafür.',
    '- Unbekannte Frage (Höhlentour, Malkurs, …) → Auftrag erfinden (execution/work/destCity/call2Brief/criteria), nie „fehlt in Gold → Laber“, nie Fakten erfinden, nie falsche Kategorie.',
    '- Nav-Stop („stopp Navigation“) → execution=nav_execute, bridge sagt Stopp zu, bridgeComplete=true — kein neuer Start.',
    '- Unbekannte Frage → Auftrag erfinden (execution/work/destCity/call2Brief), nie Fakten erfinden, nie falsche Kategorie (Nightlife statt Team).',
    '- HART: Genanntes Team/Act/Halle + Terminfrage → execution=events_research, destCity/cityScope.researchCity aus dem Satz (nicht GPS-Heimat). Call 2 sucht genau DAS — kein Club/Konzert-Ersatz.',
    '- Zuerst DIESE Äußerung. Resume nur bei klarem Bezug; sonst session=new + topicScope.mode=new + turnsForCall2=0. Isolation: toten Thread nicht weben — Code schickt dann KEINE alte Historie.',
    '- Nie aus zwei Wörtern (Uhrzeit, morgen) einen Flug ableiten. Ort+Uhr einplanen = plan. Flug/Flughafen/Leave-by = flight_advisor.',
    '- lane=chat erfindet keine Hotels, Event-Programme, Orts-Empfehlungen ohne Distanz.',
    '- Bridge: keine Fakten erfinden. Fehlt Blocker-Slot (Flug-Uhr, Taxi-Ziel ohne Thread-Anker) → Bridge = kurze Gegenfrage + bridgeComplete=true + work[] leer; Kontext/Thread darf Slots füllen — nicht bei jeder Lücke nerven.',
    '- Follow-up am offenen Auftrag: session=continue, topicScope followup + turnsForCall2 1–3. Klärfrage = continue. Neues Thema / Trivia / Wetter: session=new, turnsForCall2=0.',
    '- Multi-Intent: intents[]/work[] nicht weglassen.',
    '- Korrektur/„mag ich nicht“: session=continue, neue criteria — kein Themen-Sprung.',
    opts.liveChat
      ? '- LIVE-CHAT: pace=instant; needsResearch=quick außer explizit „recherchier/online“. Bridge kürzer.'
      : '',
    '',
    'GELÄNDER siehe DENKRAHMEN oben (Flug/Hotel/Kino/Events/Gastro/Plan/Notfall/Nav/Mode-Switch/Wetter/Reisebüro) — nur wenn’s passt. Unbekannte Frage = selber planen.',
    '',
    opts.navActive
      ? opts.navContextFlag || 'FLAG: Navigation läuft.'
      : '',
    opts.calendarOpen
      ? 'FLAG: Plan-Kalender offen — Plan-Edits = plan; Just-Do-It Wissen = chat. User kann rausspringen — passende Lane, Plan-Session bleibt.'
      : '',
    ...(opts.dialogFlags || []),
    opts.rucksackLine ? opts.rucksackLine : '',
    opts.city
      ? `GPS-START (wo der User steht, oft NICHT das Ziel): ${opts.city}`
      : '',
    opts.threadBlock
      ? `THREADS:\n${opts.threadBlock}`
      : '',
    '',
    `USER: ${opts.userText}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export async function analyzeManagerTurn(opts: {
  userText: string;
  cityHint?: string | null;
  cityKey?: string | null;
  navActive?: boolean;
  /** Optional vorgefertigte Nav-FLAG (sonst aus Live-Nav ableiten) */
  navContextFlag?: string | null;
  calendarOpen?: boolean;
  signal?: AbortSignal;
  /** Warmup: skip speaking constraints */
  speculative?: boolean;
  /** Bridge sofort aus JSON-Stream melden */
  onBridge?: (bridge: string | null) => void;
  rucksackLine?: string | null;
}): Promise<ManagerAnalysis> {
  const userText = (opts.userText || '').trim();
  const cityScope = resolveCityChatScope(userText);
  const cityHint = opts.cityHint?.trim() || cityScope.cityHint;
  const cityKey = opts.cityKey || cityScope.cityKey;
  const live = (() => {
    try {
      return isLiveChatTurnActive();
    } catch {
      return false;
    }
  })();

  const fallback = (): ManagerAnalysis => {
    const h = heuristicTasksFromClassify(userText);
    let navBoost = false;
    try {
      const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
        isExplicitNavIntent: (t: string) => boolean;
      };
      navBoost = isExplicitNavIntent(userText);
    } catch {
      navBoost = false;
    }
    const pace = resolvePaceBudget({
      pace: live
        ? 'instant'
        : (() => {
            try {
              const { resolveTurnBridgePace } = require('../kernel/turnKernel') as {
                resolveTurnBridgePace: (s: string) => { pace: 'instant' | 'standard' | 'cover' };
              };
              return resolveTurnBridgePace(userText).pace;
            } catch {
              return navBoost ? 'cover' : 'standard';
            }
          })(),
      bridgeMaxWords: live ? 8 : undefined,
      fastDeadlineMs: live ? 1500 : undefined,
    });
    return attachTurnFrame(
      sanitizeCall1Schema(
      {
        intentSummary: userText.slice(0, 80),
        route: h.route,
        blueprintId: h.blueprintId,
        blueprintStage: h.blueprintStage,
        session: 'new',
        threadMatchId: null,
        subject: null,
        bridge: null,
        lanePlan: 'fast_only',
        pace: pace.pace,
        bridgeMaxWords: pace.bridgeMaxWords,
        fastDeadlineMs: Math.max(pace.fastDeadlineMs, navBoost ? 6000 : 0),
        latencyHintSec: null,
        tasks: h.tasks,
        openLoops: [],
        nameAllowed: false,
        jobHint: h.jobHint,
        chatLane: laneFromLegacyRoute(h.route),
        topicScope: { mode: 'new', turnsForCall2: 0, inheritLiveInventory: false },
      },
      null,
    ),
      userText,
      cityHint ?? null,
    );
  };

  if (!userText || !hasAnyChatLlm()) {
    return fallback();
  }

  let threadBlock = '';
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    if (wantsTaxiRide(userText)) {
      threadBlock = '';
    } else {
      threadBlock = buildCityChatRegelwerk({
        userText,
        cityHint,
        cityKey,
        navActive: Boolean(opts.navActive),
        calendarOpen: Boolean(opts.calendarOpen),
        // Call 1 braucht genug Kontext zum Topic-Cut, aber nicht 10 Turns.
        maxRecentTurns: 3,
      });
    }
  } catch {
    try {
      threadBlock = buildCityChatRegelwerk({
        userText,
        cityHint,
        cityKey,
        navActive: Boolean(opts.navActive),
        calendarOpen: Boolean(opts.calendarOpen),
        maxRecentTurns: 3,
      });
    } catch {
      threadBlock = '';
    }
  }

  let dialogFlags: string[] = [];
  try {
    const { collectCall1DialogFlags } = require('./call1DialogContext') as {
      collectCall1DialogFlags: () => string[];
    };
    dialogFlags = collectCall1DialogFlags();
  } catch {
    dialogFlags = [];
  }

  const prompt = buildManagerPrompt({
    userText,
    threadBlock: threadBlock.slice(0, 2800),
    city: cityHint ?? null,
    navActive: Boolean(opts.navActive),
    navContextFlag: (() => {
      if (opts.navContextFlag) return opts.navContextFlag;
      if (!opts.navActive) return null;
      try {
        const {
          formatActiveNavCall1Flag,
        } = require('../../services/navigation/switchActiveNavTravelMode') as {
          formatActiveNavCall1Flag: () => string | null;
        };
        return formatActiveNavCall1Flag();
      } catch {
        return null;
      }
    })(),
    calendarOpen: Boolean(opts.calendarOpen),
    liveChat: live,
    dialogFlags,
    rucksackLine: opts.rucksackLine ?? null,
  });

  try {
    let bridgeStreamed = false;
    const raw = await generateGeminiJsonStream(prompt, {
      task: 'generic',
      tier: 'lite',
      maxTokens: 1200,
      temperature: 0.35,
      responseJson: true,
      jsonMimeOnly: true,
      useFindusSystem: false,
      signal: opts.signal,
      onPartialJson: (acc) => {
        if (bridgeStreamed || !opts.onBridge) return;
        const extracted = tryExtractBridgeField(acc);
        if (extracted?.complete) {
          bridgeStreamed = true;
          opts.onBridge(extracted.value);
        }
      },
    });
    const parsed = parseJsonObject(raw || '');
    if (!parsed) return fallback();

    let navBoost = false;
    try {
      const { isExplicitNavIntent } = require('../../services/intent/poiInfoVsNav') as {
        isExplicitNavIntent: (t: string) => boolean;
      };
      navBoost = isExplicitNavIntent(userText);
    } catch {
      navBoost = false;
    }
    const kernelPace = (() => {
      try {
        const { resolveTurnBridgePace } = require('../kernel/turnKernel') as {
          resolveTurnBridgePace: (s: string) => {
            pace: 'instant' | 'standard' | 'cover';
            bridgeMaxWords: number;
            fastDeadlineMs: number;
          };
        };
        return resolveTurnBridgePace(userText);
      } catch {
        return null;
      }
    })();
    const parsedLane = String(parsed.lane || '').toLowerCase();
    const parsedBp = String(parsed.blueprintId || '').toLowerCase();
    const liveDeep = live && wantsExplicitDeepResearch(userText);
    const wantCover =
      liveDeep ||
      (!live &&
        (kernelPace?.pace === 'cover' ||
          String(parsed.pace || '').toLowerCase() === 'cover' ||
          parsedLane === 'pitch' ||
          String(parsed.needsResearch || '').toLowerCase() === 'deep' ||
          /^(dining|hotel|cinema|live_events)/.test(parsedBp)));
    const bridgeMeta =
      parsed.bridgeMeta && typeof parsed.bridgeMeta === 'object'
        ? (parsed.bridgeMeta as Record<string, unknown>)
        : null;
    const researchBudget = resolveResearchBudget({
      lane: parsedLane,
      handoff: String(parsed.handoff || ''),
      needsResearch: String(parsed.needsResearch || ''),
      blueprintId: parsedBp,
      llmResearchBudgetSec:
        typeof bridgeMeta?.researchBudgetSec === 'number'
          ? bridgeMeta.researchBudgetSec
          : null,
    });
    const paceBase = resolvePaceBudget({
      pace: liveDeep
        ? 'cover'
        : live
          ? 'instant'
          : wantCover
            ? 'cover'
            : kernelPace?.pace || (navBoost ? 'cover' : parsed.pace),
      bridgeMaxWords: liveDeep
        ? 36
        : live
          ? 28
          : wantCover
            ? 36
            : kernelPace?.bridgeMaxWords ?? parsed.bridgeMaxWords,
      fastDeadlineMs: liveDeep
        ? 8000
        : live
          ? 1500
          : wantCover
            ? 8000
            : kernelPace?.fastDeadlineMs ?? parsed.fastDeadlineMs,
    });
    const paceMerged = applyResearchBudgetToPace(paceBase.pace, researchBudget);
    const pace = {
      pace: paceMerged.pace,
      bridgeMaxWords: Math.max(paceBase.bridgeMaxWords, paceMerged.bridgeMaxWords),
      fastDeadlineMs: Math.max(paceBase.fastDeadlineMs, paceMerged.fastDeadlineMs),
    };
    let topicScope = parseTopicScope(parsed.topicScope);
    const cityScopeRaw =
      parsed.cityScope && typeof parsed.cityScope === 'object'
        ? (parsed.cityScope as Record<string, unknown>)
        : null;
    const cityScope = cityScopeRaw
      ? {
          cityId:
            typeof cityScopeRaw.cityId === 'string' ? cityScopeRaw.cityId : null,
          researchCity:
            typeof cityScopeRaw.researchCity === 'string'
              ? cityScopeRaw.researchCity
              : cityHint ?? null,
          packPolicy: (() => {
            const p = String(cityScopeRaw.packPolicy || 'none');
            if (
              p === 'use_local' ||
              p === 'require_download' ||
              p === 'live_bootstrap'
            ) {
              return p as 'use_local' | 'require_download' | 'live_bootstrap';
            }
            return 'none' as const;
          })(),
        }
      : undefined;
    const memoryPolicyRaw =
      parsed.memoryPolicy && typeof parsed.memoryPolicy === 'object'
        ? (parsed.memoryPolicy as Record<string, unknown>)
        : null;
    const memoryPolicy = memoryPolicyRaw
      ? {
          shortTerm: memoryPolicyRaw.shortTerm !== false,
          longTerm: memoryPolicyRaw.longTerm === true,
        }
      : undefined;
    const handoff =
      typeof parsed.handoff === 'string' && parsed.handoff.trim()
        ? parsed.handoff.trim()
        : null;
    const festTypeHint =
      typeof parsed.festTypeHint === 'string' && parsed.festTypeHint.trim()
        ? parsed.festTypeHint.trim().slice(0, 80)
        : null;
    const bookingPlatformHint =
      typeof parsed.bookingPlatformHint === 'string' &&
      parsed.bookingPlatformHint.trim()
        ? parsed.bookingPlatformHint.trim().slice(0, 80)
        : null;
    const mustHaves = Array.isArray(parsed.mustHaves)
      ? parsed.mustHaves
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 6)
      : undefined;
    let criteria: ManagerAnalysis['criteria'];
    try {
      const { parseCall1Criteria, mergeCall1Criteria } = require('../pitch/call1Criteria') as {
        parseCall1Criteria: (raw: unknown) => NonNullable<ManagerAnalysis['criteria']>;
        mergeCall1Criteria: (o: {
          criteria?: ManagerAnalysis['criteria'];
          mustHaves?: string[] | null;
        }) => NonNullable<ManagerAnalysis['criteria']>;
      };
      const parsedCrit = parseCall1Criteria(parsed.criteria);
      const merged = mergeCall1Criteria({
        criteria: parsedCrit.length ? parsedCrit : null,
        mustHaves,
      });
      criteria = merged.length ? merged : undefined;
    } catch {
      criteria = undefined;
    }
    const needsBlockingChoice = parsed.needsBlockingChoice === true;
    const authorIntent =
      typeof parsed.authorIntent === 'string' && parsed.authorIntent.trim()
        ? parsed.authorIntent.trim().slice(0, 200)
        : null;

    let session = asSession(parsed.session);
    let threadMatchId =
      typeof parsed.threadMatchId === 'string' ? parsed.threadMatchId : null;
    // Compound / topicCut: neues Thema → keine Chat-Historie (Call1-Vertrag)
    try {
      const { getCall1AnswerContract } = require('../reboot/pipeline/call1AnswerContract') as {
        getCall1AnswerContract: (t: string) => { topicCut: boolean };
      };
      if (getCall1AnswerContract(userText).topicCut) {
        topicScope = {
          mode: 'new',
          turnsForCall2: 0,
          inheritLiveInventory: false,
        };
        session = 'new';
        threadMatchId = null;
      }
    } catch {
      /* soft */
    }
    // Call-1 LLM ist SSOT für session/topicScope — kein Keyword-Override danach.
    // Manager-LLM entscheidet session selbst — keine Heuristik-Überschreibung.
    let bridge = typeof parsed.bridge === 'string' ? parsed.bridge.trim() : null;
    // Außerhalb Live-Chat: continue/resume ohne Bridge
    if (!live && (session === 'continue' || session === 'resume')) {
      bridge = null;
    }
    // Live-Chat Follow-up: keine zweite Bridge. Sonst Beat 1 behalten — kein Slow-Check.
    if (live && (session === 'continue' || session === 'resume')) {
      bridge = null;
    }
    bridge = stripNameSpam(bridge, false);
    try {
      const { sanitizeBridgeText } = require('../chat/butlerOfferBus') as {
        sanitizeBridgeText: (t: string | null) => string | null;
      };
      bridge = sanitizeBridgeText(bridge);
    } catch {
      /* soft */
    }
    bridge = clipBridgeToWordLimit(bridge, pace.bridgeMaxWords);

    let tasks = normalizeTasks(parsed.tasks);
    if (!tasks.length) {
      tasks = heuristicTasksFromClassify(userText).tasks;
    }

    // Enforce silent_slow never requires latency hint
    let lanePlan = asLanePlan(parsed.lanePlan);
    const spokenSlow = tasks.some(
      (t) => t.priority === 'spoken_slow' && t.affectsSpeech,
    );
    if (!spokenSlow && lanePlan === 'fast_then_spoken_slow') {
      lanePlan = tasks.some((t) => t.priority === 'silent_slow')
        ? 'fast_plus_silent_slow'
        : 'fast_only';
    }

    const resumable = listResumableThreads(cityKey);
    if (session === 'resume' && threadMatchId) {
      if (!resumable.some((t) => t.id === threadMatchId)) {
        threadMatchId = null;
        session = 'new';
      }
    }
    return attachTurnFrame(
      sanitizeCall1Schema(
      {
        intentSummary: String(parsed.intentSummary || '').slice(0, 160),
        route: asRoute(parsed.route),
        blueprintId:
          typeof parsed.blueprintId === 'string' ? parsed.blueprintId : null,
        blueprintStage:
          typeof parsed.blueprintStage === 'string'
            ? parsed.blueprintStage
            : null,
        session,
        threadMatchId,
        subject:
          typeof parsed.subject === 'string'
            ? parsed.subject.slice(0, 80)
            : null,
        bridge,
        lanePlan,
        pace: pace.pace,
        bridgeMaxWords: pace.bridgeMaxWords,
        fastDeadlineMs: Math.max(pace.fastDeadlineMs, navBoost ? 6000 : 0),
        latencyHintSec:
          spokenSlow && typeof parsed.latencyHintSec === 'number'
            ? Math.min(30, Math.max(5, parsed.latencyHintSec))
            : spokenSlow
              ? 15
              : null,
        tasks,
        openLoops: Array.isArray(parsed.openLoops)
          ? parsed.openLoops.map((x) => String(x).slice(0, 120)).slice(0, 6)
          : [],
        nameAllowed: false,
        jobHint:
          typeof parsed.jobHint === 'string'
            ? parsed.jobHint
            : heuristicTasksFromClassify(userText).jobHint,
        bridgeSpokenEarly: bridgeStreamed,
        researchBudgetSec: researchBudget.finalSec,
        topicScope,
        cityScope,
        memoryPolicy,
        handoff,
        festTypeHint,
        bookingPlatformHint,
        mustHaves,
        criteria,
        needsBlockingChoice,
        authorIntent,
      },
      parsed,
    ),
      userText,
      cityHint ?? null,
      parsed,
    );
  } catch {
    return fallback();
  }
}

/** Apply blueprint defaults if manager omitted tasks. */
export function enrichAnalysisWithBlueprint(
  analysis: ManagerAnalysis,
): ManagerAnalysis {
  if (!analysis.blueprintId || analysis.tasks.length >= 3) return analysis;
  const bp = getBlueprintContract(
    analysis.blueprintId,
    analysis.blueprintStage,
  );
  if (!bp?.defaultTasks?.length) return analysis;
  const existing = new Set(analysis.tasks.map((t) => t.lane + t.brief.slice(0, 20)));
  const extra = bp.defaultTasks.filter(
    (t) => !existing.has(t.lane + t.brief.slice(0, 20)),
  );
  return {
    ...analysis,
    tasks: [...analysis.tasks, ...extra].slice(0, MAX_TASKS),
    blueprintStage: analysis.blueprintStage || bp.stage,
  };
}
