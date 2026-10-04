/**
 * Bridge-Pace Heuristik + Keys für Collective (Modul-2 Autonomy Reboot).
 * Budget = Ziel-Sprechzeit der Bridge (Sekunden), Wortlaut frei.
 */

export type PaceBucket = 'instant' | 'fast' | 'standard' | 'deep' | 'heavy';

export type PaceBrick =
  | 'trivia'
  | 'followup_fact'
  | 'place_options'
  | 'events_window'
  | 'rental_price'
  | 'dining_item_price'
  | 'flight_leaveby'
  | 'nav'
  | 'weather'
  | 'plan'
  | 'generic';

const BUCKET_BUDGET: Record<PaceBucket, { min: number; max: number; default: number }> = {
  instant: { min: 2, max: 4, default: 3 },
  fast: { min: 4, max: 7, default: 5 },
  standard: { min: 8, max: 12, default: 10 },
  deep: { min: 12, max: 18, default: 14 },
  heavy: { min: 15, max: 22, default: 18 },
};

/** Hard-Cap: max ms nach Bridge-Ende bis Call-2 Speech starten muss. */
export const BRIDGE_TO_CALL2_GAP_MAX_MS = 2000;

export function paceSignalKey(bucket: PaceBucket, brick: PaceBrick): string {
  return `pace::${bucket}::${brick}`;
}

/**
 * Grobe Brick-/Bucket-Schätzung aus User-Text + optional Call-1-Hints.
 * Stadt-agnostisch — keine Orts-Hardcodes.
 */
export function inferPaceBrick(opts: {
  userText: string;
  execution?: string | null;
  lane?: string | null;
  jobHint?: string | null;
}): { bucket: PaceBucket; brick: PaceBrick } {
  const t = (opts.userText || '').replace(/\s+/g, ' ').trim();
  const ex = String(opts.execution || '').toLowerCase();
  const lane = String(opts.lane || '').toLowerCase();
  const job = String(opts.jobHint || '').toLowerCase();

  if (ex === 'nav_execute' || lane === 'nav') {
    return { bucket: 'instant', brick: 'nav' };
  }
  if (
    /\b(wie\s+alt|wer\s+ist|was\s+ist|papst|hauptstadt|welche[rn]?\s+fluss)\b/iu.test(t) &&
    !/\b(restaurant|hotel|flug|event)\b/iu.test(t)
  ) {
    return { bucket: 'instant', brick: 'trivia' };
  }
  if (/\b(wetter|regen|sonne|temperatur|kalt|warm|outfit)\b/iu.test(t)) {
    return { bucket: 'instant', brick: 'weather' };
  }
  if (ex === 'flight_advisor' || job === 'flight_trip' || /\b(flug|abflug|leave.?by)\b/iu.test(t)) {
    return { bucket: 'heavy', brick: 'flight_leaveby' };
  }
  if (ex === 'plan_module' || ex === 'plan_walkthrough' || lane === 'plan') {
    return { bucket: 'deep', brick: 'plan' };
  }
  if (
    ex === 'events_research' ||
    /\b(was\s+geht|events?|veranstaltung|vom\s+\d|bis\s+\d|oktober|festival)\b/iu.test(t)
  ) {
    return { bucket: 'deep', brick: 'events_window' };
  }
  if (
    /\b(verleih|miete|leihen|sup\b|paddle|surfbrett|fahrradverleih)\b/iu.test(t) ||
    job.includes('activity')
  ) {
    return { bucket: 'deep', brick: 'rental_price' };
  }
  if (
    /\b(wie\s+teuer|preis|kostet|speisekarte|menü|menu)\b/iu.test(t) &&
    /\b(essen|restaurant|pizza|steak|burger|gericht)\b/iu.test(t)
  ) {
    return { bucket: 'standard', brick: 'dining_item_price' };
  }
  if (ex === 'pitch_module' || lane === 'pitch') {
    return { bucket: 'standard', brick: 'place_options' };
  }
  if (
    /\b(empfiehl|zwei\s+option|alternativ|restaurant|hotel|kino|wo\s+kann\s+ich)\b/iu.test(t)
  ) {
    return { bucket: 'standard', brick: 'place_options' };
  }
  if (/\b(ja|nee|nein|und\s+wie|wie\s+teuer|mehr\s+dazu|alternativ)\b/iu.test(t) && t.length < 80) {
    return { bucket: 'fast', brick: 'followup_fact' };
  }
  return { bucket: 'fast', brick: 'generic' };
}

export function bridgeBudgetSecFor(
  bucket: PaceBucket,
  collectiveSec?: number | null,
): number {
  const row = BUCKET_BUDGET[bucket];
  if (
    typeof collectiveSec === 'number' &&
    Number.isFinite(collectiveSec) &&
    collectiveSec > 0
  ) {
    return Math.max(row.min, Math.min(row.max, Math.round(collectiveSec)));
  }
  return row.default;
}

/** Merge Pace-Heuristik in researchBudgetSec (erhöht Cap auf 22 für heavy). */
export function resolvePaceAwareResearchBudgetSec(opts: {
  userText: string;
  execution?: string | null;
  lane?: string | null;
  jobHint?: string | null;
  llmSec?: number | null;
  codeFloorSec?: number;
}): number {
  const { bucket, brick } = inferPaceBrick(opts);
  void brick;
  let collective: number | null = null;
  try {
    const { getPaceBridgeBudgetSec } = require('../../../services/memory/paceBridgeLearning') as {
      getPaceBridgeBudgetSec: (bucket: PaceBucket, brick: PaceBrick) => number | null;
    };
    const inferred = inferPaceBrick(opts);
    collective = getPaceBridgeBudgetSec(inferred.bucket, inferred.brick);
  } catch {
    collective = null;
  }
  const heuristic = bridgeBudgetSecFor(bucket, collective);
  const floor = Math.max(opts.codeFloorSec ?? 0, 0);
  const llm =
    typeof opts.llmSec === 'number' && Number.isFinite(opts.llmSec)
      ? Math.round(opts.llmSec)
      : heuristic;
  // LLM ±3 um Heuristik, Hard-Cap 22
  const blended = Math.round((heuristic * 2 + llm + floor) / 4);
  return Math.max(1, Math.min(22, blended));
}
