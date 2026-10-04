/**
 * Must-Haves aus 5–6 alten Timelines / gespeicherten Reisen ableiten.
 * Stadt-agnostisch: nur Amenity-IDs & Struktur, keine Ortsnamen.
 */

import type { FuturePlanState, FuturePlanStop } from '../module2/timeline/futurePlanState';
import type { HistoricalEntry } from '../module2/timeline/historicalTimelineState';
import { entry } from './slotLedger';
import type { MustHaveId, ReiseLedger, ReiseTrip } from './types';

export const TIMELINE_PREF_MAX = 6;

/** Lodging/Trip-Shape/Wetter — nicht aus History als Must für die nächste Stadt übernehmen. */
const SKIP_AUTO: ReadonlySet<MustHaveId> = new Set([
  'hotel',
  'apartment',
  'ferienhaus',
  'camping',
  'warm',
  'cruise',
  'ferry',
  'river_cruise',
  'breakfast',
  'half_board',
  'rental_car',
  'short_transfer',
]);

/** Titel → MustHave (strukturell, kein Orts-Hardcode). */
const TITLE_HITS: Array<{ id: MustHaveId; re: RegExp }> = [
  { id: 'pool', re: /\b(pool|whirlpool|jacuzzi)\b/iu },
  { id: 'spa', re: /(?<![\p{L}\p{N}_])(?:spa|wellness|thermal|therme)(?![\p{L}\p{N}_])/iu },
  { id: 'sauna', re: /\bsauna\b/iu },
  { id: 'massage', re: /\bmassagen?\b/iu },
  { id: 'party', re: /\b(party|club|nightlife|bar\b|kneipe|feiern)\b/iu },
  { id: 'grill', re: /\b(grill|bbq|grillen)\b/iu },
  { id: 'padel', re: /\bpadel\b/iu },
  { id: 'tennis', re: /\btennis\b/iu },
  { id: 'spikeball', re: /\bspikeball\b/iu },
  { id: 'sand', re: /\b(sandstrand|beach|strand)\b/iu },
  { id: 'sea', re: /\b(meer|see\b|hafen|waterfront)\b/iu },
  { id: 'view', re: /\b(aussicht|viewpoint|panorama|meerblick|blick)\b/iu },
  { id: 'boat', re: /\b(boot|boat|kajak|kanu|ferry)\b/iu },
  { id: 'wine', re: /\b(wein|wine|winzer)\b/iu },
  { id: 'kids_club', re: /\b(kids\s*club|kinderclub|animation)\b/iu },
  { id: 'parking', re: /\b(parkplatz|parking)\b/iu },
  { id: 'vegan', re: /\bvegan\b/iu },
  { id: 'quiet', re: /\b(ruhe|quiet|entspann)\b/iu },
  { id: 'adult_only', re: /\badult\s*only\b/iu },
  { id: 'water_slide', re: /\b(wasserrutsche|water\s*park|wasserpark|rutsche)\b/iu },
  { id: 'culinary', re: /\b(kulinar|gourmet|street\s*food|markt)\b/iu },
  { id: 'teens_club', re: /\b(teens?(?:\s*club)?|jugend(?:liche|club))\b/iu },
  { id: 'running_track', re: /\b(laufbahn|jogging(?:strecke|track)?|running\s*track)\b/iu },
  { id: 'seniors', re: /\b(rentner|senior(?:en)?|ruhestand|best[\s-]?ager)\b/iu },
];

export type TimelinePrefSource = {
  /** Gespeicherte Reisebüro-Trips (neueste zuerst). */
  savedTrips?: ReiseTrip[];
  /** Future-Plan Tage. */
  futurePlans?: Record<string, FuturePlanState>;
  /** Ist-Besuche. */
  historical?: HistoricalEntry[];
  maxTimelines?: number;
};

export type DerivedTimelinePrefs = {
  /** Stark: in ≥2 Trips als Must oder sehr häufig. */
  mustHaves: MustHaveId[];
  /** Häufig in den letzten Timelines. */
  wishHaves: MustHaveId[];
  /** Schwächer / 2× gesehen. */
  niceHaves: MustHaveId[];
  /** Kurznotiz für Flipchart / Intent (kein Script). */
  note: string | null;
  /** Wie viele Timelines einbezogen. */
  timelineCount: number;
};

type Agg = { days: number; asMust: number };

function idsFromText(blob: string): MustHaveId[] {
  const out: MustHaveId[] = [];
  for (const h of TITLE_HITS) {
    if (h.re.test(blob)) out.push(h.id);
  }
  return [...new Set(out)].filter((id) => !SKIP_AUTO.has(id));
}

function idsFromLedger(ledger: ReiseLedger | null | undefined): {
  all: MustHaveId[];
  must: MustHaveId[];
} {
  if (!ledger) return { all: [], must: [] };
  const must = (ledger.mustHaves?.value ?? []).filter((id) => !SKIP_AUTO.has(id));
  const wish = (ledger.wishHaves?.value ?? []).filter((id) => !SKIP_AUTO.has(id));
  const nice = (ledger.niceHaves?.value ?? []).filter((id) => !SKIP_AUTO.has(id));
  return { all: [...new Set([...must, ...wish, ...nice])], must };
}

function idsFromStops(stops: FuturePlanStop[]): MustHaveId[] {
  const blob = stops
    .filter((s) => s.kind !== 'nav_leg')
    .map((s) => `${s.title || ''} ${s.notes || ''} ${s.emoji || ''}`)
    .join(' ');
  return idsFromText(blob);
}

function idsFromOptionDays(trip: ReiseTrip): MustHaveId[] {
  const opt =
    trip.options?.find((o) => o.id === trip.selectedOptionId) || trip.options?.[0];
  if (!opt) return [];
  const bits: string[] = [];
  for (const d of opt.days ?? []) {
    bits.push(d.title || '');
    for (const b of d.blocks ?? []) {
      bits.push(`${b.title || ''} ${b.detail || ''}`);
    }
  }
  for (const c of opt.wishChapters ?? []) {
    if (c.mustHaveId && !SKIP_AUTO.has(c.mustHaveId as MustHaveId)) {
      bits.push(String(c.mustHaveId));
    }
    bits.push(`${c.title || ''} ${c.blurb || ''}`);
  }
  return idsFromText(bits.join(' '));
}

function planDayLooksLikeTrip(plan: FuturePlanState): boolean {
  const real = (plan.stops ?? []).filter((s) => s.kind !== 'nav_leg');
  if (real.length >= 2) return true;
  if ((plan.stops ?? []).some((s) => s.transport === 'flight')) return true;
  if (/hotel|reise|trip|urlaub/i.test(plan.vibe || plan.base?.label || '')) return true;
  return real.length >= 1 && Boolean(plan.base?.kind === 'hotel');
}

/**
 * Pure: aus bis zu 6 Timelines Must/Wish/Nice ableiten.
 */
export function deriveMustHavesFromPastTimelines(
  src: TimelinePrefSource,
): DerivedTimelinePrefs {
  const max = Math.min(TIMELINE_PREF_MAX, Math.max(1, src.maxTimelines ?? TIMELINE_PREF_MAX));
  const timelines: Array<{ ids: MustHaveId[]; must: MustHaveId[] }> = [];

  for (const trip of src.savedTrips ?? []) {
    if (timelines.length >= max) break;
    const fromLed = idsFromLedger(trip.ledger);
    const fromDays = idsFromOptionDays(trip);
    const ids = [...new Set([...fromLed.all, ...fromDays])];
    if (!ids.length && !fromLed.must.length) continue;
    timelines.push({ ids, must: fromLed.must });
  }

  const planEntries = Object.entries(src.futurePlans ?? {})
    .filter(([, p]) => planDayLooksLikeTrip(p))
    .sort((a, b) => (b[1].updatedAtMs || 0) - (a[1].updatedAtMs || 0) || b[0].localeCompare(a[0]));

  for (const [, plan] of planEntries) {
    if (timelines.length >= max) break;
    const ids = idsFromStops(plan.stops ?? []);
    if (!ids.length) continue;
    timelines.push({ ids, must: [] });
  }

  if (timelines.length < max && (src.historical?.length ?? 0) > 0) {
    const byDay = new Map<string, HistoricalEntry[]>();
    for (const e of src.historical ?? []) {
      const k = e.dayKey || '';
      if (!k) continue;
      const arr = byDay.get(k) ?? [];
      arr.push(e);
      byDay.set(k, arr);
    }
    const days = [...byDay.entries()]
      .filter(([, es]) => es.length >= 2)
      .sort((a, b) => b[0].localeCompare(a[0]));
    for (const [, es] of days) {
      if (timelines.length >= max) break;
      const ids = idsFromText(es.map((e) => e.title || '').join(' '));
      if (!ids.length) continue;
      timelines.push({ ids, must: [] });
    }
  }

  const agg = new Map<MustHaveId, Agg>();
  for (const tl of timelines) {
    const seen = new Set(tl.ids);
    for (const id of seen) {
      const cur = agg.get(id) ?? { days: 0, asMust: 0 };
      cur.days += 1;
      agg.set(id, cur);
    }
    for (const id of new Set(tl.must)) {
      const cur = agg.get(id) ?? { days: 0, asMust: 0 };
      cur.asMust += 1;
      if (!seen.has(id)) cur.days += 1;
      agg.set(id, cur);
    }
  }

  const mustHaves: MustHaveId[] = [];
  const wishHaves: MustHaveId[] = [];
  const niceHaves: MustHaveId[] = [];

  for (const [id, a] of agg) {
    if (SKIP_AUTO.has(id)) continue;
    if (a.asMust >= 2 || a.days >= 4) mustHaves.push(id);
    else if (a.days >= 3 || (a.asMust >= 1 && a.days >= 2)) wishHaves.push(id);
    else if (a.days >= 2) niceHaves.push(id);
  }

  const rank = (id: MustHaveId) => agg.get(id)?.days ?? 0;
  mustHaves.sort((a, b) => rank(b) - rank(a));
  wishHaves.sort((a, b) => rank(b) - rank(a));
  niceHaves.sort((a, b) => rank(b) - rank(a));

  const top = [...mustHaves, ...wishHaves].slice(0, 4);
  const note =
    timelines.length >= 2 && top.length
      ? `Aus ${timelines.length} früheren Plänen: ${top.join(', ')}`
      : null;

  return {
    mustHaves: mustHaves.slice(0, 5),
    wishHaves: wishHaves.filter((id) => !mustHaves.includes(id)).slice(0, 6),
    niceHaves: niceHaves
      .filter((id) => !mustHaves.includes(id) && !wishHaves.includes(id))
      .slice(0, 6),
    note,
    timelineCount: timelines.length,
  };
}

function readLiveSources(savedTrips?: ReiseTrip[]): TimelinePrefSource {
  const src: TimelinePrefSource = { savedTrips: savedTrips ?? [] };
  try {
    const { useFuturePlanStore } = require('../module2/timeline/futurePlanState') as typeof import('../module2/timeline/futurePlanState');
    src.futurePlans = useFuturePlanStore.getState().plansByDay;
  } catch {
    /* Node smoke */
  }
  try {
    const { useHistoricalTimelineStore } = require('../module2/timeline/historicalTimelineState') as typeof import('../module2/timeline/historicalTimelineState');
    src.historical = useHistoricalTimelineStore.getState().entries;
  } catch {
    /* soft */
  }
  return src;
}

/**
 * Seed nur wenn der User noch keine Amenities gesetzt hat (neue Reise).
 * Source = profile (unter user, über inferred default).
 */
export function applyTimelineMustHavePrefs(
  ledger: ReiseLedger,
  opts?: { savedTrips?: ReiseTrip[] },
): ReiseLedger {
  const hasUserAmenity =
    (ledger.mustHaves?.source === 'user' && (ledger.mustHaves.value?.length ?? 0) > 0) ||
    (ledger.wishHaves?.source === 'user' && (ledger.wishHaves.value?.length ?? 0) > 0);
  if (hasUserAmenity) return ledger;

  const derived = deriveMustHavesFromPastTimelines(readLiveSources(opts?.savedTrips));
  if (!derived.timelineCount || (!derived.mustHaves.length && !derived.wishHaves.length && !derived.niceHaves.length)) {
    return ledger;
  }

  let next: ReiseLedger = { ...ledger };
  const mergeIds = (
    prev: ReiseLedger['mustHaves'],
    add: MustHaveId[],
    hardness: 'must' | 'wish' | 'optional',
  ): ReiseLedger['mustHaves'] => {
    if (!add.length) return prev;
    const ids = [...new Set([...(prev?.value ?? []), ...add])];
    return entry(ids, 'profile', hardness);
  };

  // Profile-vegan o.ä. behalten; Timeline-Prefs dazu
  if (derived.mustHaves.length) {
    next.mustHaves = mergeIds(next.mustHaves, derived.mustHaves, 'must');
  }
  if (derived.wishHaves.length) {
    next.wishHaves = mergeIds(next.wishHaves, derived.wishHaves, 'wish');
  }
  if (derived.niceHaves.length) {
    next.niceHaves = mergeIds(next.niceHaves, derived.niceHaves, 'optional');
  }
  if (derived.note) {
    const notes = [...(next.intentNotes?.value ?? [])];
    if (!notes.some((n) => /früheren Plänen/i.test(n))) {
      notes.push(derived.note);
      next.intentNotes = entry(notes.slice(-12), 'profile', 'wish');
    }
  }
  return next;
}
