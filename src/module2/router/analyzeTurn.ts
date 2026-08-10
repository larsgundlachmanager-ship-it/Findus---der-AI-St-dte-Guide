/**
 * Call-1 Manager — LLM versteht Frage, Bridge, Session, Tasks.
 * Kein Heuristik-Fallback für Bridge (Plan): bei LLM-Fail → null Bridge + classifyJob tasks.
 */

import { generateGeminiText, hasGeminiApiKey } from '../../services/geminiService';
import {
  formatThreadContextForPrompt,
  getForegroundThread,
  listResumableThreads,
} from '../../services/memory/conversationThreads';
import { getCachedUserProfile } from '../../services/userProfileService';
import { isLiveChatTurnActive } from '../../services/handsFree/liveChatTurnContext';
import { classifyJob } from '../jobs/classifyJob';
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
  if (nameAllowed) return bridge;
  const profile = getCachedUserProfile();
  const name = profile?.firstName?.trim();
  if (!name || name.length < 2) return bridge;
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
  else if (jobId === 'nav_route') route = 'm3_nav_query';
  else if (jobId === 'day_plan_budget') route = 'm5_plan';
  else if (jobId === 'tonight_live') {
    blueprintId = 'cinema';
    blueprintStage = 'cinema_orient';
  } else if (jobId.startsWith('dining')) {
    blueprintId = 'dining';
    blueprintStage = 'dining_choice';
  } else if (
    /\b(grill|grillen|bbq)\b/iu.test(userText)
  ) {
    blueprintId = 'compound_evening_goal';
    blueprintStage = 'grill';
  }

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

function buildManagerPrompt(opts: {
  userText: string;
  threadBlock: string;
  city: string | null;
  navActive: boolean;
  calendarOpen: boolean;
}): string {
  return [
    'Du bist der Findus-Manager (Call-1). Analysiere die User-Frage.',
    'Antworte NUR als JSON (kein Markdown).',
    '',
    'Felder:',
    '- intentSummary: 1 Satz intern',
    '- route: m1_poi | m3_nav_start | m3_nav_query | m5_plan | memory | blueprint | smalltalk',
    '- blueprintId / blueprintStage: z.B. cinema/cinema_orient, dining/dining_choice, compound_evening_goal/grill, live_events/today — oder null',
    '- session: new | continue | resume',
    '- threadMatchId: id wenn continue/resume sonst null',
    '- subject: kurzer Themenanker oder null',
    '- bridge: EIN kurzer Satz ODER null (bei continue/resume/live-chat IMMER null). Kein Name des Users. Kein „ich schau mal“.',
    '- lanePlan: fast_only | fast_plus_silent_slow | fast_then_spoken_slow',
    '- pace: instant | standard | cover (cover nur wenn viele Fast-Facts nötig)',
    '- bridgeMaxWords / fastDeadlineMs: optional, Code clampt',
    '- latencyHintSec: nur bei spoken_slow nötig, sonst null',
    '- tasks: Array max 20 {id,lane,brief,priority:fast|silent_slow|spoken_slow,thinkAhead?,affectsSpeech,filters?,searchHints?}',
    '- openLoops: andere Themen später (nicht Unteraufgaben des Hauptziels)',
    '- nameAllowed: immer false außer echte Begrüßung nach langer Pause',
    '- jobHint: legacy job id hint optional',
    '',
    'REGELN:',
    '- Fast-first: Pack/API-Lanes als fast; Speisekarte-URL ohne Preisfrage = silent_slow, affectsSpeech:false',
    '- Think-Ahead: Outdoor/Grillen → Wetter-Task auch ohne Frage; markiere thinkAhead:true',
    '- Ein Abendziel (Grillen) = blueprint compound_evening_goal, NICHT m5_plan',
    '- Mehrere Tages-Slots (Theater+Essen+Stadt) = m5_plan',
    '- „Was ist das Gebäude“ = m1_poi',
    '- Route starten / Ziel wechseln = m3_nav_start; nur Dauer/ETA = m3_nav_query',
    '- „Stopp Navigation“ allein = m3_nav_query (Bestätigung); Stopp + neues Ziel = m3_nav_start (alte Route ist schon geräumt)',
    '- Plan-Kalender offen: Tagesplan-Edits = m5_plan, Just-Do-It-Fragen (Kino/Essen/Nav) trotzdem blueprint/m3',
    '- spoken_slow nur wenn die STIMME Live braucht (heutiges Programm, expliziter Preis)',
    '',
    opts.navActive ? 'FLAG: Navigation läuft (oder lief gerade — Stop kann schon ausgeführt sein).' : '',
    opts.calendarOpen ? 'FLAG: Plan-Kalender offen — du bist trotzdem der Manager; bei Plan-Edits m5_plan.' : '',
    opts.city ? `Stadt-Hint: ${opts.city}` : '',
    opts.threadBlock ? `THREADS:\n${opts.threadBlock}` : 'THREADS: keine',
    '',
    `USER: ${opts.userText.slice(0, 600)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function analyzeManagerTurn(opts: {
  userText: string;
  cityHint?: string | null;
  navActive?: boolean;
  calendarOpen?: boolean;
  signal?: AbortSignal;
  /** Warmup: skip speaking constraints */
  speculative?: boolean;
}): Promise<ManagerAnalysis> {
  const userText = (opts.userText || '').trim();
  const live = (() => {
    try {
      return isLiveChatTurnActive();
    } catch {
      return false;
    }
  })();

  const fallback = (): ManagerAnalysis => {
    const h = heuristicTasksFromClassify(userText);
    const pace = resolvePaceBudget({ pace: 'standard' });
    return {
      intentSummary: userText.slice(0, 80),
      route: h.route,
      blueprintId: h.blueprintId,
      blueprintStage: h.blueprintStage,
      session: getForegroundThread() ? 'continue' : 'new',
      threadMatchId: getForegroundThread()?.id ?? null,
      subject: null,
      bridge: null, // Plan: no heuristic bridge
      lanePlan: 'fast_only',
      pace: pace.pace,
      bridgeMaxWords: pace.bridgeMaxWords,
      fastDeadlineMs: pace.fastDeadlineMs,
      latencyHintSec: null,
      tasks: h.tasks,
      openLoops: [],
      nameAllowed: false,
      jobHint: h.jobHint,
    };
  };

  if (!userText || !hasGeminiApiKey()) {
    return fallback();
  }

  let threadBlock = '';
  try {
    threadBlock = formatThreadContextForPrompt({ includeParkedIndex: true });
  } catch {
    threadBlock = '';
  }

  const prompt = buildManagerPrompt({
    userText,
    threadBlock: threadBlock.slice(0, 2200),
    city: opts.cityHint ?? null,
    navActive: Boolean(opts.navActive),
    calendarOpen: Boolean(opts.calendarOpen),
  });

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      tier: 'lite',
      maxTokens: 900,
      temperature: 0.35,
      responseJson: true,
      jsonMimeOnly: true,
      useFindusSystem: false,
      signal: opts.signal,
    });
    const parsed = parseJsonObject(raw || '');
    if (!parsed) return fallback();

    const pace = resolvePaceBudget({
      pace: parsed.pace,
      bridgeMaxWords: parsed.bridgeMaxWords,
      fastDeadlineMs: parsed.fastDeadlineMs,
    });

    let session = asSession(parsed.session);
    let bridge = typeof parsed.bridge === 'string' ? parsed.bridge.trim() : null;
    if (live || session === 'continue' || session === 'resume') {
      bridge = null;
    }
    bridge = stripNameSpam(bridge, false);
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

    const resumable = listResumableThreads();
    let threadMatchId =
      typeof parsed.threadMatchId === 'string' ? parsed.threadMatchId : null;
    if (session === 'resume' && threadMatchId) {
      if (!resumable.some((t) => t.id === threadMatchId)) {
        threadMatchId = null;
        session = 'new';
      }
    }

    return {
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
      fastDeadlineMs: pace.fastDeadlineMs,
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
    };
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
