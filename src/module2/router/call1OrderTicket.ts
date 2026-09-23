/**
 * Call-1 Order-Ticket SSOT — Phase-1-Auftrag für Backend + Call-2.
 * Ein Schema für Nav/Wetter/Dining/Flug/… Soft-Fill gegen must verboten.
 * Härten: jobShape + needs — siehe docs/rfc/agent-harden-contract.md (kein Rewrite).
 */

import type { Call1JobShape } from './call1JobShape';
import {
  asCall1JobShape,
  inferCall1JobShape,
  reconcileWeatherJobShape,
} from './call1JobShape';

export type Call1SearchMode = 'hard' | 'normal';

export type Call1SearchStage =
  | 'pack'
  | 'neighbor'
  | 'metro'
  | 'web'
  | 'verify';

export type Call1OrderSearch = {
  mode: Call1SearchMode;
  stages: Call1SearchStage[];
  maxRadiusKm: number;
  forbidSoftFill: boolean;
};

export type Call1OrderNeed = {
  menuUrl?: boolean;
  prices?: boolean;
  openHours?: boolean;
  eta?: boolean;
  maps?: boolean;
  ticket?: boolean;
  bookingLink?: boolean;
  /** Meta/Dining: Gericht/Specialty verifizieren */
  dishVerify?: boolean;
  /** Weather outfit lane */
  weatherOutfit?: boolean;
  /** Provision/booking links (Kiwi etc.) */
  provisionLinks?: boolean;
};

export type Call1OrderUi = {
  openPitch?: boolean;
  startNav?: boolean;
  openTimeline?: boolean;
  openCalendar?: boolean;
  /** ms delay before UI action (optional) */
  delayMs?: number;
};

export type IntentAction = 'navigate' | 'timeline' | 'research' | 'pack';

export type IntentTopic =
  | 'cruise'
  | 'hotel'
  | 'train'
  | 'flight'
  | 'event'
  | 'pack'
  | 'place';

/** Sprachneutral: was tun, wohin, welches Thema. Kein Satz als Schalter. */
export type IntentAct = {
  actions: IntentAction[];
  place: string | null;
  topic: IntentTopic | null;
};

const INTENT_ACTIONS: IntentAction[] = [
  'navigate',
  'timeline',
  'research',
  'pack',
];

const INTENT_TOPICS: IntentTopic[] = [
  'cruise',
  'hotel',
  'train',
  'flight',
  'event',
  'pack',
  'place',
];

export function emptyIntentAct(): IntentAct {
  return { actions: [], place: null, topic: null };
}

export function parseIntentAct(
  parsed: Record<string, unknown> | null | undefined,
  ui?: { startNav?: boolean; openTimeline?: boolean },
): IntentAct {
  const raw =
    parsed?.order && typeof parsed.order === 'object'
      ? (parsed.order as Record<string, unknown>)
      : {};
  const bag = { ...raw, ...(parsed || {}) };
  const actions: IntentAction[] = [];
  const list = Array.isArray(bag.actions) ? bag.actions : [];
  for (const x of list) {
    const a = String(x || '')
      .trim()
      .toLowerCase() as IntentAction;
    if (INTENT_ACTIONS.includes(a) && !actions.includes(a)) actions.push(a);
  }
  if (!actions.length && ui?.startNav && ui?.openTimeline) {
    actions.push('navigate', 'timeline');
  }
  const placeRaw = bag.place ?? bag.destination;
  const place =
    typeof placeRaw === 'string' && placeRaw.trim().length >= 2
      ? placeRaw.trim().slice(0, 80)
      : null;
  const topicRaw = String(bag.topic || '')
    .trim()
    .toLowerCase() as IntentTopic;
  const topic = INTENT_TOPICS.includes(topicRaw) ? topicRaw : null;
  return { actions, place, topic };
}

export type Call1BulletBudget = {
  max: number;
  maxLines: number;
  maxChars: number;
};

/** Der Auftrag — Call 1 schreibt, Backend/Call-2 lesen. */
export type Call1OrderTicket = {
  must: string[];
  avoid: string[];
  search: Call1OrderSearch;
  need: Call1OrderNeed;
  ui: Call1OrderUi;
  bulletBudget: Call1BulletBudget;
  /** Intention → Engine (soft; Safety hinter Steal-Fixes) */
  jobShape: Call1JobShape;
  /** Was tun / wohin / Thema — sprachneutral, Call 1 füllt aus der Absicht. */
  act: IntentAct;
};

const STAGES: Call1SearchStage[] = [
  'pack',
  'neighbor',
  'metro',
  'web',
  'verify',
];

function uniq(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const k = String(x || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

function asStages(raw: unknown): Call1SearchStage[] {
  if (!Array.isArray(raw)) return ['pack', 'neighbor', 'metro', 'web'];
  const out: Call1SearchStage[] = [];
  for (const x of raw) {
    const s = String(x || '')
      .trim()
      .toLowerCase() as Call1SearchStage;
    if (STAGES.includes(s) && !out.includes(s)) out.push(s);
  }
  return out.length ? out : ['pack', 'neighbor', 'metro', 'web'];
}

export function defaultOrderTicket(
  partial?: Partial<Call1OrderTicket>,
): Call1OrderTicket {
  return {
    must: partial?.must ?? [],
    avoid: partial?.avoid ?? [],
    search: partial?.search ?? {
      mode: 'normal',
      stages: ['pack', 'neighbor', 'metro', 'web'],
      maxRadiusKm: 40,
      forbidSoftFill: false,
    },
    need: partial?.need ?? { maps: true },
    ui: partial?.ui ?? {},
    bulletBudget: partial?.bulletBudget ?? {
      max: 3,
      maxLines: 2,
      maxChars: 72,
    },
    jobShape: partial?.jobShape ?? 'unknown',
    act: partial?.act ?? emptyIntentAct(),
  };
}

/**
 * Parse must/avoid/search/need/ui/bulletBudget aus Call-1-JSON.
 * Legacy: mustHaves → must; negative criteria → avoid.
 */
export function parseCall1OrderTicket(
  parsed: Record<string, unknown> | null | undefined,
  opts?: {
    mustHaves?: string[] | null;
    criteria?: Array<{ key: string; role?: string }> | null;
    userText?: string | null;
  },
): Call1OrderTicket {
  const raw =
    parsed?.order && typeof parsed.order === 'object'
      ? (parsed.order as Record<string, unknown>)
      : parsed ?? {};

  let must = uniq([
    ...(Array.isArray(raw.must) ? raw.must.map(String) : []),
    ...(Array.isArray(parsed?.must) ? (parsed!.must as unknown[]).map(String) : []),
    ...(opts?.mustHaves ?? []),
  ]).slice(0, 8);

  let avoid = uniq([
    ...(Array.isArray(raw.avoid) ? raw.avoid.map(String) : []),
    ...(Array.isArray(parsed?.avoid) ? (parsed!.avoid as unknown[]).map(String) : []),
  ]).slice(0, 8);

  for (const c of opts?.criteria ?? []) {
    const k = String(c.key || '').trim();
    if (!k) continue;
    if (
      /avoid_|cuisine_not_|_not_|kein |ohne |not_/i.test(k) ||
      c.role === 'must' && /asian|asiatisch/i.test(k)
    ) {
      avoid = uniq([...avoid, k]).slice(0, 8);
    }
  }

  const searchRaw =
    raw.search && typeof raw.search === 'object'
      ? (raw.search as Record<string, unknown>)
      : {};
  const mode: Call1SearchMode =
    String(searchRaw.mode || raw.searchMode || '').toLowerCase() === 'hard' ||
    must.some((m) => /all_you_can_eat|ayce|hard/i.test(m))
      ? 'hard'
      : 'normal';

  const search: Call1OrderSearch = {
    mode,
    stages: asStages(searchRaw.stages),
    maxRadiusKm: Math.min(
      120,
      Math.max(
        5,
        Number(searchRaw.maxRadiusKm ?? (mode === 'hard' ? 100 : 40)) || 40,
      ),
    ),
    forbidSoftFill:
      searchRaw.forbidSoftFill === true ||
      mode === 'hard' ||
      must.length > 0,
  };

  const needRaw =
    raw.need && typeof raw.need === 'object'
      ? (raw.need as Record<string, unknown>)
      : {};
  const need: Call1OrderNeed = {
    menuUrl: needRaw.menuUrl === true,
    prices: needRaw.prices === true,
    openHours: needRaw.openHours === true,
    eta: needRaw.eta === true,
    maps: needRaw.maps !== false,
    ticket: needRaw.ticket === true,
    bookingLink: needRaw.bookingLink === true,
    dishVerify: needRaw.dishVerify === true,
    weatherOutfit: needRaw.weatherOutfit === true,
    provisionLinks: needRaw.provisionLinks === true,
  };

  const uiRaw =
    raw.ui && typeof raw.ui === 'object'
      ? (raw.ui as Record<string, unknown>)
      : {};
  const ui: Call1OrderUi = {
    openPitch: uiRaw.openPitch === true,
    startNav: uiRaw.startNav === true,
    openTimeline: uiRaw.openTimeline === true,
    openCalendar: uiRaw.openCalendar === true,
    delayMs:
      typeof uiRaw.delayMs === 'number' && Number.isFinite(uiRaw.delayMs)
        ? Math.min(15_000, Math.max(0, Math.round(uiRaw.delayMs)))
        : undefined,
  };

  const bbRaw =
    raw.bulletBudget && typeof raw.bulletBudget === 'object'
      ? (raw.bulletBudget as Record<string, unknown>)
      : parsed?.bulletBudget && typeof parsed.bulletBudget === 'object'
        ? (parsed.bulletBudget as Record<string, unknown>)
        : {};
  const bulletBudget: Call1BulletBudget = {
    max: Math.min(5, Math.max(1, Number(bbRaw.max ?? 3) || 3)),
    maxLines: Math.min(3, Math.max(1, Number(bbRaw.maxLines ?? 2) || 2)),
    maxChars: Math.min(120, Math.max(32, Number(bbRaw.maxChars ?? 72) || 72)),
  };

  const shapeRaw =
    raw.jobShape ??
    raw.job_shape ??
    parsed?.jobShape ??
    parsed?.job_shape;
  const parsedShape = asCall1JobShape(shapeRaw);
  const userText = String(opts?.userText || parsed?.userText || '').trim();
  let jobShape: Call1JobShape =
    parsedShape || (userText ? inferCall1JobShape(userText) : 'unknown');
  if (userText && (jobShape.startsWith('weather_') || parsedShape?.startsWith('weather_'))) {
    jobShape = reconcileWeatherJobShape(jobShape, userText);
  }

  // Need soft-defaults aus JobShape (Call-1 darf überschreiben)
  if (jobShape === 'place_dining') {
    if (need.menuUrl !== true && needRaw.menuUrl !== false) need.menuUrl = true;
    if (need.prices !== true && needRaw.prices !== false) need.prices = true;
    if (need.openHours !== true && needRaw.openHours !== false) need.openHours = true;
    try {
      const {
        looksLikeSpecialtyFoodAsk,
        extractCravingDishToken,
        queryNeedsLiveFoodResearch,
      } = require('../pitch/specializedFoodMatch') as {
        looksLikeSpecialtyFoodAsk: (s: string) => boolean;
        extractCravingDishToken: (s: string) => string | null;
        queryNeedsLiveFoodResearch: (s: string) => boolean;
      };
      if (
        need.dishVerify !== true &&
        needRaw.dishVerify !== false &&
        (looksLikeSpecialtyFoodAsk(userText) ||
          Boolean(extractCravingDishToken(userText)) ||
          queryNeedsLiveFoodResearch(userText))
      ) {
        need.dishVerify = true;
      }
    } catch {
      /* soft */
    }
  }
  if (jobShape === 'flight_only' && need.provisionLinks !== true) {
    need.provisionLinks = true;
    need.bookingLink = true;
  }
  if (jobShape === 'weather_outfit') need.weatherOutfit = true;

  const act = parseIntentAct(parsed, ui);
  if (
    !act.topic &&
    act.actions.includes('timeline') &&
    act.place &&
    /cruise|terminal|schiff|kreuzfahrt|harbor|harbour|port/i.test(act.place)
  ) {
    act.topic = 'cruise';
  }

  return { must, avoid, search, need, ui, bulletBudget, jobShape, act };
}

/** Must+Avoid als mustHaves-Strings für Pitch-Legacy. */
export function orderTicketToMustHaves(ticket: Call1OrderTicket): string[] {
  return uniq([...ticket.must, ...ticket.avoid]).slice(0, 8);
}

export function formatCall1OrderTicketForPrompt(
  ticket: Call1OrderTicket | null | undefined,
): string {
  if (!ticket) return '';
  return [
    '=== CALL1_ORDER (verbindlich — Backend + Call 2) ===',
    `jobShape: ${ticket.jobShape}`,
    `act: ${ticket.act.actions.join('+') || '—'} place=${ticket.act.place || '—'} topic=${ticket.act.topic || '—'}`,
    `must: ${ticket.must.join(', ') || '—'}`,
    `avoid: ${ticket.avoid.join(', ') || '—'}`,
    `search: mode=${ticket.search.mode} stages=${ticket.search.stages.join('→')} maxKm=${ticket.search.maxRadiusKm} forbidSoftFill=${ticket.search.forbidSoftFill}`,
    `need: ${Object.entries(ticket.need)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || '—'}`,
    `ui: ${Object.entries(ticket.ui)
      .filter(([, v]) => v === true || typeof v === 'number')
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '—'}`,
    `bullets: max ${ticket.bulletBudget.max} × ${ticket.bulletBudget.maxLines} Zeilen × ${ticket.bulletBudget.maxChars} Zeichen — Call 2 schreibt sie, nicht Backend.`,
    'Soft-Fill gegen must VERBOTEN. Leer nach Expand → ehrlich Empty.',
  ].join('\n');
}

/** Toolbox-Kapitel für Call-1-Prompt (kurz). */
export const FINDUS_CALL1_TOOLBOX_BLOCK = `
=== TOOLBOX (Call-1 komponiert work[] — kein Käfig) ===
Workers: dining|weather|nav|transit|taxi|flight|hotel|events|plan|reisebuero|pitch|chat|m1|memory|timer_alarm|deep_web|fact|tour
execution (EIN Backend): pitch_module|chat_lane|flight_advisor|nav_execute|plan_module|plan_walkthrough|events_research|reisebuero|task_fanout|memory|m1_poi|tour_module
jobShape (order.jobShape): flight_only|trip_package|fact_lookup|place_dining|logistics|logistics_multi|arrival_home|schedule_write|weather_info|weather_rain|weather_outfit|unknown
act (order): actions[]=navigate|timeline|research|pack, place=Zielname, topic=cruise|hotel|train|flight|event|pack|place
  — Absicht in jeder Sprache/jedem Akzent. Mehrere actions = alle ausführen. Kein fester Satz als Schalter.
  — flight_only→flight_advisor; trip_package→reisebuero; place_dining→pitch; arrival_home|logistics_multi→task_fanout+Compose; schedule_write→plan/timeline
search.stages: pack→neighbor→metro→web (Specialty/AYCE: maxRadiusKm bis 100, mode=hard, forbidSoftFill=true)
need: menuUrl|prices|openHours|eta|maps|ticket|bookingLink|dishVerify|weatherOutfit|provisionLinks — was Evidence liefern muss
ui: openPitch|startNav|openTimeline|openCalendar (+ optional delayMs)
Affiliate/Links: nur belegt (Speisekarte-URL, Stay22, Uber, Tickets, Kiwi) — nie erfinden
Follow-up: „ja/ok“ bei offener Assistant-Frage → session=continue, Bezug halten; neues Thema → session=new, turnsForCall2=0
Bridge: Wunsch menschlich spiegeln (flüssig). VERBOTEN: nur „Verstanden.“ / interne Wörter („belegte Orte“, „Hard-Match“). Keine Preise/Venues/Minuten in der Bridge.
`.trim();
