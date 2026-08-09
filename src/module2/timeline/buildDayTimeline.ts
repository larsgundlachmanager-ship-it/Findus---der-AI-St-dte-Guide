/**
 * Merged day view: Reality (Ist) + Future (Soll) + Now marker.
 */

import { dateKeyFromMs, todayDateKey } from '../../utils/dateKeys';
import {
  getVisitsForDate,
  listVisitDateKeys,
  type VisitLogEntry,
} from '../../services/timeline/visitLog';
import { qualifiesForZeitachse } from '../../services/timeline/zeitachseEligibility';
import { emojiForPlace } from '../../services/navigation/stampBullets';
import {
  useFuturePlanStore,
  type FuturePlanState,
  type FuturePlanStop,
  type FuturePlanStopStatus,
  type FuturePlanTransport,
} from './futurePlanState';
import {
  useHistoricalTimelineStore,
  type HistoricalEntry,
} from './historicalTimelineState';
import { isPastMs, isRealityLockedStop } from './planNowGuard';

export type TimelineTone = 'default' | 'change' | 'conflict' | 'trigger' | 'reality';

/** Nav-Rolle für UI-Farbe: nur reminder/trigger = grün; path = blau/rot. */
export type TimelineNavRole = 'reminder' | 'trigger' | 'path';

export type TimelineNode = {
  id: string;
  lane: 'reality' | 'future' | 'now';
  atMs: number | null;
  endMs: number | null;
  title: string;
  subtitle?: string;
  emoji: string;
  tone: TimelineTone;
  transport?: FuturePlanTransport;
  kind?: FuturePlanStop['kind'] | 'reality' | 'now';
  /** Offener Aufenthalt — UI zeigt „bis jetzt“ statt Enduhrzeit */
  untilNow?: boolean;
  /** Nav: Luftlinie (rot) bis OSRM nachzieht */
  routeEstimate?: 'fallback' | 'routed' | null;
  hardAnchor?: boolean;
  /** Nur nav_leg: Erinnerung / Trigger / reiner Weg */
  navRole?: TimelineNavRole | null;
  /** Proposal / Stop: Maps / Website / Reserve */
  mapsUrl?: string | null;
  menuUrl?: string | null;
  reserveUrl?: string | null;
  /** true = PROPOSAL_ITEM (blauer Rahmen, Pitch + Action Cards) */
  isProposal?: boolean;
  /** Offener Wunsch auf der Zeitachse (blaues Band, zeitlich einsortiert) */
  isOpenBand?: boolean;
  /** Oberhalb NOW / Visit — keine Auto-Verschiebung */
  realityLocked?: boolean;
};

/** SSOT: welche Nav-Zeile grün darf (Trigger + Erinnerung). */
export function resolveNavRole(s: FuturePlanStop): TimelineNavRole | null {
  if (s.kind !== 'nav_leg') return null;
  if (s.id.startsWith('nav_remind_') || /^Erinnerung\s*·/i.test(s.title)) {
    return 'reminder';
  }
  // Reine Wege nie Trigger — auch nicht zu Hard-Stops
  if (/^Weg nach\s+/i.test(s.title) || s.id.startsWith('nav_here_')) {
    return 'path';
  }
  // Hard-Aufbruch / Leave-By-Trigger (Prio 1–3, Los zu …)
  if (
    s.id.startsWith('leave_') ||
    s.id.startsWith('nav_fix_') ||
    (Boolean(s.hardAnchor) && /^(Los zu|Aufbruch)\b/i.test(s.title)) ||
    /Trigger\s*·/i.test(s.notes ?? '')
  ) {
    return 'trigger';
  }
  return 'path';
}

export type OpenPlanItem = {
  id: string;
  title: string;
  emoji: string;
  hardAnchor?: boolean;
  status?: FuturePlanStopStatus;
  planPriority?: 1 | 2 | 3 | 4 | 5 | 6 | null;
  /** Manuelle Reihenfolge (kleiner = weiter oben) */
  openOrder?: number | null;
};

const TRANSPORT_LABEL: Record<FuturePlanTransport, string> = {
  walk: 'zu Fuß',
  bike: 'Fahrrad',
  transit: 'ÖPNV',
  car: 'Auto',
  taxi: 'Taxi',
  flight: 'Flugzeug',
  unknown: '',
};

const TRANSPORT_EMOJI: Record<FuturePlanTransport, string> = {
  walk: '🚶',
  bike: '🚲',
  transit: '🚌',
  car: '🚗',
  taxi: '🚕',
  flight: '✈️',
  unknown: '➡️',
};

function toneFromStatus(status?: FuturePlanStopStatus): TimelineTone {
  if (status === 'pending_change') return 'change';
  if (status === 'conflict') return 'conflict';
  if (status === 'trigger_active') return 'trigger';
  return 'default';
}

function visitToNode(v: VisitLogEntry, nowMs: number): TimelineNode {
  const open = v.leftAtMs == null;
  const dwellLive = open
    ? Math.max(
        v.dwellMin ?? 0,
        Math.round((nowMs - v.arrivedAtMs) / 60_000),
      )
    : v.dwellMin;
  return {
    id: `visit_${v.id}`,
    lane: 'reality',
    atMs: v.arrivedAtMs,
    endMs: open ? null : v.leftAtMs,
    title: v.name,
    subtitle: open
      ? dwellLive != null && dwellLive > 0
        ? `Aufenthalt · seit ${dwellLive} Min`
        : 'Aufenthalt · bis jetzt'
      : v.source === 'dwell'
        ? 'Aufenthalt'
        : undefined,
    emoji: emojiForPlace({ name: v.name }),
    tone: 'reality',
    kind: 'reality',
    untilNow: open,
    realityLocked: true,
  };
}

function histToNode(h: HistoricalEntry): TimelineNode {
  return {
    id: `hist_${h.id}`,
    lane: 'reality',
    atMs: h.atMs,
    endMs: null,
    title: h.title,
    subtitle:
      h.source === 'module1'
        ? 'Vor Ort'
        : h.source === 'dwell'
          ? 'Aufenthalt'
          : undefined,
    emoji: h.emoji ?? emojiForPlace({ name: h.title }),
    tone: 'reality',
    kind: 'reality',
    realityLocked: true,
  };
}

function stopToNode(s: FuturePlanStop, nowMs: number): TimelineNode {
  let status = s.status ?? 'planned';
  const navRole = resolveNavRole(s);
  const locked = isRealityLockedStop(s, nowMs);
  // Stop-Karten: kurz vor Leave-By als Trigger markieren (nicht Nav-Wege)
  if (
    !locked &&
    s.kind !== 'nav_leg' &&
    status === 'planned' &&
    s.plannedStartMs != null &&
    s.bufferMin > 0
  ) {
    const leaveBy = s.plannedStartMs - s.bufferMin * 60_000;
    if (nowMs >= leaveBy - 5 * 60_000 && nowMs <= s.plannedStartMs) {
      status = 'trigger_active';
    }
  }
  // Nav: Tone nur für Reminder/Trigger grün spiegeln — Wege nie
  if (s.kind === 'nav_leg') {
    if (navRole === 'reminder' || navRole === 'trigger') {
      status = 'trigger_active';
    } else if (status === 'trigger_active') {
      status = s.status === 'pending_change' ? 'pending_change' : 'planned';
    }
  }
  const transportHint =
    s.kind === 'nav_leg'
      ? (s.notes?.trim() ||
        `${TRANSPORT_EMOJI[s.transport]} ${TRANSPORT_LABEL[s.transport]}`.trim())
      : undefined;
  // Vergangene Plan-Stops = Reality (oberhalb NOW), nicht editierbar
  const pastPlan =
    locked &&
    s.kind === 'stop' &&
    !s.id.startsWith('choice_') &&
    isPastMs(s.plannedEndMs ?? s.plannedStartMs, nowMs);
  return {
    id: `plan_${s.id}`,
    lane: pastPlan ? 'reality' : 'future',
    atMs: s.plannedStartMs ?? null,
    endMs: s.plannedEndMs ?? null,
    title: s.title,
    subtitle: transportHint || s.notes || undefined,
    emoji:
      s.emoji ??
      (s.kind === 'nav_leg'
        ? TRANSPORT_EMOJI[s.transport]
        : emojiForPlace({ name: s.title })),
    tone: pastPlan ? 'reality' : toneFromStatus(status),
    transport: s.transport,
    kind: pastPlan ? 'reality' : s.kind ?? 'stop',
    routeEstimate: s.kind === 'nav_leg' ? s.routeEstimate ?? null : null,
    hardAnchor: s.hardAnchor,
    navRole,
    mapsUrl: s.mapsUrl ?? null,
    menuUrl: s.menuUrl ?? null,
    reserveUrl: s.reserveUrl ?? null,
    realityLocked: locked || pastPlan,
    isProposal:
      !pastPlan &&
      s.status === 'pending_change' &&
      (s.id.startsWith('choice_') ||
        Boolean(s.choiceSide) ||
        /^[🥇🥈]/.test(s.title)),
    isOpenBand: !pastPlan && s.kind === 'wish',
  };
}

function dedupeReality(nodes: TimelineNode[]): TimelineNode[] {
  // Gleicher Ort in ~90 Min mergen (Visit + Hist oft 2–3×); Bar→Döner→Bar bleibt.
  const WINDOW_MS = 90 * 60_000;
  const sorted = [...nodes].sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  const out: TimelineNode[] = [];
  for (const n of sorted) {
    const key = n.title
      .replace(/^📍\s*/, '')
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, '')
      .slice(0, 48);
    const matchIdx = out.findIndex((prev) => {
      const prevKey = prev.title
        .replace(/^📍\s*/, '')
        .toLowerCase()
        .replace(/[^a-z0-9äöüß]+/gi, '')
        .slice(0, 48);
      const closeInTime =
        prev.atMs != null &&
        n.atMs != null &&
        Math.abs(prev.atMs - n.atMs) <= WINDOW_MS;
      const sameTitle =
        (key.length >= 3 && key === prevKey) ||
        prev.title.replace(/^📍\s*/, '').toLowerCase() ===
          n.title.replace(/^📍\s*/, '').toLowerCase();
      return sameTitle && (closeInTime || !prev.endMs || !n.atMs);
    });
    if (matchIdx >= 0) {
      const prev = out[matchIdx]!;
      // Prefer visit_* over hist_* (richer dwell)
      if (n.id.startsWith('visit_') && prev.id.startsWith('hist_')) {
        out[matchIdx] = {
          ...n,
          endMs: n.endMs ?? prev.endMs,
          subtitle: n.subtitle ?? prev.subtitle,
          untilNow: n.untilNow ?? prev.untilNow,
        };
      } else {
        if (!prev.endMs && n.endMs) prev.endMs = n.endMs;
        if (!prev.subtitle && n.subtitle) prev.subtitle = n.subtitle;
        if (n.untilNow) prev.untilNow = true;
      }
      continue;
    }
    out.push({ ...n });
  }
  return out;
}

export function buildDayTimeline(dateKey: string, nowMs = Date.now()): {
  nodes: TimelineNode[];
  openPlans: OpenPlanItem[];
  isToday: boolean;
} {
  const isToday = dateKey === todayDateKey();
  const visits = getVisitsForDate(dateKey).filter((v) =>
    qualifiesForZeitachse({
      onTimeline: v.onTimeline,
      dwellMin: v.dwellMin,
      source: v.source,
      keyFacts: null,
    }),
  );
  const hist = useHistoricalTimelineStore
    .getState()
    .entriesForDay(dateKey);
  const plan = useFuturePlanStore.getState().getPlanForDay(dateKey);

  const reality = dedupeReality([
    ...visits.map((v) => visitToNode(v, nowMs)),
    ...hist.map(histToNode),
  ]).sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));

  // Zeitachse: getimte Stops + Nav-Legs + getimte offene Wünsche (blaue Bänder)
  const futureOnAxis = plan.stops
    .filter((s) => {
      if (s.status === 'done') return false;
      if (s.kind === 'wish') {
        // Nur mit Zeit auf die Achse — sonst unten in Offene Pläne
        return s.plannedStartMs != null;
      }
      return true;
    })
    .filter((s) => {
      if (s.kind !== 'nav_leg') return true;
      const end = s.plannedEndMs ?? s.plannedStartMs;
      if (end == null) return true;
      return end >= nowMs - 5 * 60_000;
    })
    .map((s) => stopToNode(s, nowMs))
    .sort((a, b) => {
      if (a.atMs == null && b.atMs == null) return 0;
      if (a.atMs == null) return 1;
      if (b.atMs == null) return -1;
      return a.atMs - b.atMs;
    });

  // Unten nur noch ungetaktete Wünsche (ohne Zeit)
  const openFromStops: OpenPlanItem[] = plan.stops
    .filter(
      (s) =>
        s.status !== 'done' &&
        s.kind === 'wish' &&
        s.plannedStartMs == null,
    )
    .map((s) => ({
      id: s.id,
      title: s.title,
      emoji: s.emoji ?? emojiForPlace({ name: s.title }),
      hardAnchor: s.hardAnchor,
      status: s.status,
      planPriority: s.planPriority ?? null,
      openOrder: s.openOrder ?? null,
    }));

  const openPlans: OpenPlanItem[] = [...openFromStops];
  openPlans.sort((a, b) => {
    const ao = a.openOrder;
    const bo = b.openOrder;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (ao == null && bo != null) return 1;
    const pd = (a.planPriority ?? 6) - (b.planPriority ?? 6);
    if (pd !== 0) return pd;
    return a.title.localeCompare(b.title, 'de');
  });

  /** Früheste Uhrzeit oben, späteste unten — „Jetzt“ chronologisch eingefügt. */
  const byTimeAsc = (a: TimelineNode, b: TimelineNode) => {
    if (a.atMs == null && b.atMs == null) return 0;
    if (a.atMs == null) return 1;
    if (b.atMs == null) return -1;
    return a.atMs - b.atMs;
  };

  /** Hartes Chronology-Gate: timed Nodes strikt aufsteigend, nie T_spät vor T_früh. */
  const enforceChronologyGate = (list: TimelineNode[]): TimelineNode[] => {
    const timed = list.filter((n) => n.atMs != null).sort(byTimeAsc);
    const untimed = list.filter((n) => n.atMs == null);
    // Sanity: benachbarte timed Nodes dürfen nie absteigend sein
    for (let i = 1; i < timed.length; i++) {
      const prev = timed[i - 1]!.atMs!;
      const cur = timed[i]!.atMs!;
      if (cur < prev) {
        // Unmöglich nach sort — defensive Re-Sort
        return [...timed.sort(byTimeAsc), ...untimed];
      }
    }
    return [...timed, ...untimed];
  };

  const insertNowChronologically = (timed: TimelineNode[]): TimelineNode[] => {
    const nowNode: TimelineNode = {
      id: 'now',
      lane: 'now',
      atMs: nowMs,
      endMs: null,
      title: 'Jetzt',
      emoji: '●',
      tone: 'default',
      kind: 'now',
    };
    const out: TimelineNode[] = [];
    let placed = false;
    for (const n of timed) {
      if (!placed && (n.atMs ?? 0) > nowMs) {
        out.push(nowNode);
        placed = true;
      }
      out.push(n);
    }
    if (!placed) out.push(nowNode);
    return out;
  };

  const nodes: TimelineNode[] = [];
  if (isToday) {
    const merged = [...reality, ...futureOnAxis];
    const gated = enforceChronologyGate(merged);
    const timed = gated.filter((n) => n.atMs != null);
    const untimed = gated.filter((n) => n.atMs == null);
    nodes.push(...insertNowChronologically(timed));
    nodes.push(...untimed);
  } else if (dateKey < todayDateKey()) {
    nodes.push(...enforceChronologyGate([...reality]));
  } else {
    const merged = [...futureOnAxis, ...reality];
    nodes.push(...enforceChronologyGate(merged));
  }

  return { nodes, openPlans, isToday };
}

/**
 * Dieselbe Inhalts-Logik wie die Tages-Timeline — für Monatsfarben.
 * Monat ist nur Übersicht; Klick öffnet denselben Tag.
 */
export function collectMonthDayMarks(): {
  today: string;
  pastContent: Set<string>;
  futureContent: Set<string>;
  conflictDays: Set<string>;
} {
  const today = todayDateKey();
  const pastContent = new Set<string>();
  const futureContent = new Set<string>();
  const conflictDays = new Set<string>();

  const markContent = (dk: string) => {
    if (!dk) return;
    if (dk < today) pastContent.add(dk);
    else if (dk > today) futureContent.add(dk);
  };

  const dayHasPlanContent = (stops: FuturePlanStop[]): boolean =>
    stops.some(
      (s) => (s.kind ?? 'stop') !== 'nav_leg' && s.status !== 'done',
    );

  for (const dk of listVisitDateKeys()) {
    const has = getVisitsForDate(dk).some((v) =>
      qualifiesForZeitachse({
        onTimeline: v.onTimeline,
        dwellMin: v.dwellMin,
        source: v.source,
        keyFacts: null,
      }),
    );
    if (has) markContent(dk);
  }

  for (const e of useHistoricalTimelineStore.getState().entries) {
    markContent(e.dayKey);
  }

  const { plan, plansByDay } = useFuturePlanStore.getState();
  const allPlans: Record<string, FuturePlanState> = {
    ...plansByDay,
    [plan.dayKey]: plan,
  };
  for (const [k, p] of Object.entries(allPlans)) {
    const stops = p?.stops ?? [];
    if (dayHasPlanContent(stops)) markContent(k);
    if (k >= today && stops.some((s) => s.status === 'conflict')) {
      conflictDays.add(k);
    }
  }

  return { today, pastContent, futureContent, conflictDays };
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() + deltaDays);
  return dateKeyFromMs(dt.getTime());
}

export function monthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function daysInMonth(monthKey: string): string[] {
  const [y, m] = monthKey.split('-').map(Number);
  const count = new Date(y!, m!, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= count; d++) {
    out.push(`${monthKey}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const dt = new Date(y!, m! - 1 + deltaMonths, 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

/** Monate von oben (Vergangenheit) nach unten (Zukunft), Blöcke untereinander. */
export function listMonthKeysRange(opts?: {
  centerMonthKey?: string;
  monthsBefore?: number;
  monthsAfter?: number;
}): string[] {
  const center = opts?.centerMonthKey ?? monthKeyFromDateKey(todayDateKey());
  const before = opts?.monthsBefore ?? 26;
  const after = opts?.monthsAfter ?? 12;
  const out: string[] = [];
  for (let i = -before; i <= after; i++) {
    out.push(shiftMonthKey(center, i));
  }
  return out;
}

/** Mo=0 … So=6 für deutsches Kalendergitter. */
export function mondayIndexForMonth(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  const js = new Date(y!, m! - 1, 1).getDay(); // So=0
  return js === 0 ? 6 : js - 1;
}

export function formatMonthTitleDe(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const dt = new Date(y!, m! - 1, 1);
  return dt.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}
