/**
 * SSOT: Äußerung → Slots + Jobs + Think-Ahead.
 * Call-1 füllt nur Lücken und schreibt die Bridge.
 * day_plan webt — ersetzt Child-Jobs nicht.
 */

import {
  extractUtteranceSlots,
  type UtteranceSlotKind,
} from '../../planning/planUtteranceSlots';
import type { FindusJobId } from '../../jobs/types';

export type PipelineSlotKind =
  | UtteranceSlotKind
  | 'weather'
  | 'fact'
  | 'flight'
  | 'nav'
  | 'clock';

export type ThinkAheadId =
  | 'taxi_pref'
  | 'reverse_from_departure'
  | 'rain_vs_outdoor'
  | 'hotel_if_gap'
  | 'sunset_anchor'
  | 'evening_first_pitch'
  | 'two_options_own_vs_rent';

export type PipelineSlot = {
  kind: PipelineSlotKind;
  title: string;
  job: FindusJobId;
};

export type OrchestratedTurn = {
  slots: PipelineSlot[];
  jobs: FindusJobId[];
  thinkAhead: ThinkAheadId[];
  weaveDayPlan: boolean;
  clockJob: boolean;
  stealEarlyM5: boolean;
};

const CLOCK_ONLY_RE =
  /\b(wecker|weck\s+mich|wecke\s+mich|timer|stell(?:e)?\s+(?:mir\s+)?(?:einen\s+)?wecker)\b/iu;

const DEPARTURE_RE =
  /\b(los|abfahrt|aufbruch|um\s+\d{1,2}(?:[:.]\d{2})?\s*(?:uhr)?\s*(?:los|nach))\b/iu;

const WEATHER_RE = /\b(wetter|anziehen|outfit|jacke|regen|sonnenuntergang|sunset)\b/iu;

const FACT_RE =
  /\b(wie\s+(?:hoch|alt|teuer|breit|tief|viele)|was\s+ist\s+(?:das|der|die)|papst|eintritt|stufen|vollmond|mondphase)\b/iu;

const FLIGHT_RE = /\b(flug|flieger|flughafen|abflug|boarding|gate|check-?in)\b/iu;

const NAV_RE =
  /\b(bring\s+mich|navigier|führ\s+mich|fuehr\s+mich|wie\s+lange\s+(?:brauche|dauert)|wie\s+weit)\b/iu;

function uniqJobs(ids: FindusJobId[]): FindusJobId[] {
  const out: FindusJobId[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function fromPlanKind(kind: UtteranceSlotKind): PipelineSlotKind {
  return kind;
}

function jobForSlot(kind: PipelineSlotKind, title: string): FindusJobId {
  const t = title.toLowerCase();
  switch (kind) {
    case 'travel':
      return 'transit_live';
    case 'breakfast':
      return 'dining_open';
    case 'meal':
      return /\b(pann|fisch|steak|elbblick)\b/i.test(t)
        ? 'dining_hard_match'
        : 'dining_open';
    case 'hotel':
      return 'stay_search';
    case 'named':
      return /\b(michel|turm|kirche|museum)\b/i.test(t)
        ? 'poi_identify'
        : 'sight_recommend';
    case 'explore':
      return 'sight_recommend';
    case 'weather':
      return 'weather_outfit';
    case 'fact':
      return 'fact_number';
    case 'flight':
    case 'nav':
      return 'nav_route';
    case 'clock':
      return 'smalltalk_general';
    default:
      return 'smalltalk_general';
  }
}

export function isClockOnlyUtterance(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (!CLOCK_ONLY_RE.test(t)) return false;
  if (DEPARTURE_RE.test(t) && /\b(nach|bahn|zug|hamburg|stadt)\b/i.test(t)) {
    return false;
  }
  return true;
}

export function orchestrateUtterance(text: string): OrchestratedTurn {
  const raw = (text || '').replace(/\s+/g, ' ').trim();
  const slots: PipelineSlot[] = [];
  const push = (kind: PipelineSlotKind, title: string) => {
    slots.push({ kind, title, job: jobForSlot(kind, title) });
  };

  for (const s of extractUtteranceSlots(raw)) {
    push(fromPlanKind(s.kind), s.title);
  }

  if (WEATHER_RE.test(raw) && !slots.some((s) => s.kind === 'weather')) {
    push('weather', 'Wetter');
  }
  if (FACT_RE.test(raw) && !slots.some((s) => s.kind === 'fact')) {
    push('fact', 'Fakt');
  }
  if (FLIGHT_RE.test(raw) && !slots.some((s) => s.kind === 'flight')) {
    push('flight', 'Flug');
  }
  if (NAV_RE.test(raw) && !slots.some((s) => s.kind === 'nav' || s.kind === 'travel')) {
    push('nav', 'Route');
  }

  const clockJob = isClockOnlyUtterance(raw);
  if (clockJob) push('clock', 'Wecker');

  const jobs = uniqJobs(slots.map((s) => s.job));

  const weaveDayPlan =
    slots.some((s) => s.kind === 'travel') &&
    slots.some((s) =>
      s.kind === 'breakfast' ||
      s.kind === 'meal' ||
      s.kind === 'named' ||
      s.kind === 'explore',
    );

  if (weaveDayPlan && !jobs.includes('day_plan_budget')) {
    jobs.push('day_plan_budget');
  }
  if (/\b(pann(?:en)?fisch|steak|elbblick|(?:black\s+)?angus|wagyu|zugrestaurant|speisewagen)\b/i.test(raw) && !jobs.includes('dining_hard_match')) {
    jobs.push('dining_hard_match');
  }
  if (/\bmichel\b/i.test(raw) && !jobs.includes('poi_identify')) {
    jobs.push('poi_identify');
  }
  if (/\b(hunger|steak|essen\s+gehen)\b/i.test(raw) && !jobs.some((j) => j.startsWith('dining'))) {
    jobs.push('dining_open');
  }
  if (/\b(sup|stand[\s-]?up[\s-]?paddle)\b/i.test(raw) && !jobs.includes('activity_sport')) {
    jobs.push('activity_sport');
  }
  if (
    /\b(tour|rundgang|must[\s-]?haves?|musthave)\b/i.test(raw) &&
    !jobs.includes('sight_recommend')
  ) {
    jobs.push('sight_recommend');
  }
  if (/\b(uber|taxi|bolt)\b/i.test(raw) && !jobs.includes('taxi_rideshare')) {
    jobs.push('taxi_rideshare');
  }
  if (
    /\b(terrasse|restaurant|abendessen|essen\s+gehen)\b/i.test(raw) &&
    !jobs.some((j) => j.startsWith('dining'))
  ) {
    jobs.push('dining_open');
  }

  const childJobs = jobs.filter((j) => j !== 'day_plan_budget');
  const thinkAhead: ThinkAheadId[] = [];
  if (/\b(taxi|uber)\b/i.test(raw)) thinkAhead.push('taxi_pref');
  if (slots.some((s) => s.kind === 'travel')) thinkAhead.push('reverse_from_departure');
  if (/\b(terrasse|draußen|draussen|outdoor|picknick)\b/i.test(raw)) {
    thinkAhead.push('rain_vs_outdoor');
  }
  if (/\b(sonnenuntergang|sunset|elbblick)\b/i.test(raw)) {
    thinkAhead.push('sunset_anchor');
    thinkAhead.push('evening_first_pitch');
  }
  if (/\b(sup|verleih|eigenes\s+board)\b/i.test(raw)) {
    thinkAhead.push('two_options_own_vs_rent');
  }
  if (/\b(übernacht|uebernacht|hotel)\b/i.test(raw)) thinkAhead.push('hotel_if_gap');

  return {
    slots,
    jobs,
    thinkAhead,
    weaveDayPlan,
    clockJob,
    // Nie vor Call-1 stehlen — der Satz gehört immer dem Manager.
    stealEarlyM5: false,
  };
}

/** Tot: Call-1 sieht jeden Satz. Flag bleibt false (Smoke/Lock). */
export function shouldStealTurnBeforeCall1(_text: string): boolean {
  return false;
}
