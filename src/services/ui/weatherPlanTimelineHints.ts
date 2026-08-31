/**
 * Wetter × Timeline — SSOT futurePlanState, ohne RN/Store-Imports (Node-smoke-fähig).
 */

import { useFuturePlanStore, type FuturePlanStop } from '../../module2/timeline/futurePlanState';
import { todayDateKey } from '../../utils/dateKeys';
import { getCachedWeatherSnapshot, type WeatherChatSnap } from '../weatherService';

const OUTDOOR_RE =
  /\b(park|garten|strand|beach|wander|hike|aussicht|markt|platz|outdoor|terrasse|boot|rad|fahrrad|zoo|see|ufer|promenade|skyline|sonnenuntergang|picknick)\b/i;
const INDOOR_RE =
  /\b(museum|galerie|kirche|dom|restaurant|café|cafe|bistro|hotel|kino|theater|shopping|mall|ausstellung|indoor|bibliothek|therme|spa)\b/i;
const MEAL_RE =
  /\b(essen|restaurant|bistro|café|cafe|frühstück|fruehstueck|mittag|abendessen|dinner|lunch|brunch)\b/i;

function formatHm(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isOutdoorish(stop: FuturePlanStop): boolean {
  const blob = `${stop.title} ${stop.notes ?? ''} ${stop.emoji ?? ''}`;
  if (INDOOR_RE.test(blob)) return false;
  if (OUTDOOR_RE.test(blob)) return true;
  if (stop.transport === 'walk' || stop.transport === 'bike') return true;
  return false;
}

function todaysTimedStops(nowMs: number): FuturePlanStop[] {
  const dayKey = todayDateKey();
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  return plan.stops.filter((s) => {
    if (s.status === 'done') return false;
    if (s.kind === 'nav_leg' || s.kind === 'wish') return false;
    const start = s.plannedStartMs;
    if (start == null) return false;
    const end = s.plannedEndMs ?? start + 60 * 60_000;
    return end >= nowMs - 15 * 60_000;
  });
}

function rainThreat(nowMs: number): {
  heavy: boolean;
  soon: boolean;
  rainAtMs: number | null;
} {
  const snap = getCachedWeatherSnapshot();
  const heavy = !!snap?.isHeavyRain;
  const rainAtMs = snap?.nextRainAtMs ?? null;
  const soon =
    heavy ||
    (snap?.rainStartsInMin != null && snap.rainStartsInMin <= 90) ||
    (rainAtMs != null && rainAtMs - nowMs <= 3 * 60 * 60_000) ||
    (snap?.precipitationMm != null && snap.precipitationMm > 0.3);
  return { heavy, soon, rainAtMs };
}

export type WeatherPlanFit = {
  ok: boolean;
  reasons: string[];
  riskyStops: FuturePlanStop[];
};

export function evaluatePlanAgainstWeather(nowMs = Date.now()): WeatherPlanFit {
  const { heavy, soon, rainAtMs } = rainThreat(nowMs);
  if (!soon && !heavy) {
    return { ok: true, reasons: [], riskyStops: [] };
  }
  const stops = todaysTimedStops(nowMs);
  const risky = stops.filter((s) => {
    if (!isOutdoorish(s)) return false;
    const start = s.plannedStartMs ?? nowMs;
    const end = s.plannedEndMs ?? start + 60 * 60_000;
    if (heavy) return end >= nowMs;
    if (rainAtMs != null) {
      return start <= rainAtMs + 2 * 60 * 60_000 && end >= rainAtMs - 30 * 60_000;
    }
    return true;
  });
  const reasons: string[] = [];
  if (risky.length) {
    reasons.push(
      heavy
        ? `Bei dem Wetter wirken ${risky
            .slice(0, 2)
            .map((s) => s.title)
            .join(' und ')} eher ungemütlich draußen.`
        : `Regen könnte sich mit ${risky
            .slice(0, 2)
            .map((s) => s.title)
            .join(' und ')} beißen.`,
    );
  }
  return { ok: risky.length === 0, reasons, riskyStops: risky };
}

export function isOutdoorPlanStop(stop: FuturePlanStop): boolean {
  return isOutdoorish(stop);
}

/** Timeline-aware Wetter-Hinweise für Voice. */
export function formatWeatherTimelineHints(opts: {
  nowMs?: number;
  snap?: WeatherChatSnap | null;
}): string[] {
  const nowMs = opts.nowMs ?? Date.now();
  const snap = opts.snap ?? getCachedWeatherSnapshot();
  const stops = todaysTimedStops(nowMs).sort(
    (a, b) => (a.plannedStartMs ?? 0) - (b.plannedStartMs ?? 0),
  );
  if (!stops.length) return [];

  const hints: string[] = [];
  const fit = evaluatePlanAgainstWeather(nowMs);
  const rainAtMs = snap?.nextRainAtMs ?? null;
  const prob = snap?.nextRainProb ?? 0;
  const heavy = Boolean(snap?.isHeavyRain);
  const rainExpected = heavy || prob >= 40 || rainAtMs != null;

  if (rainExpected && rainAtMs != null && rainAtMs > nowMs + 20 * 60_000) {
    for (const stop of stops) {
      if (!stop.plannedStartMs || stop.plannedStartMs <= nowMs) continue;
      const blob = `${stop.title} ${stop.notes ?? ''}`;
      if (!MEAL_RE.test(blob) || isOutdoorish(stop)) continue;
      const mealEnd = stop.plannedEndMs ?? stop.plannedStartMs + 75 * 60_000;
      if (rainAtMs > mealEnd) {
        hints.push(
          `Bis ${stop.title} gegen ${formatHm(stop.plannedStartMs)} brauchst du keinen Schirm — danach würd ich aber was Regenfestes dabeihaben.`,
        );
        break;
      }
    }
  }

  for (const s of fit.riskyStops.slice(0, 2)) {
    const hm = s.plannedStartMs ? ` ab ${formatHm(s.plannedStartMs)}` : '';
    const label = /\bpicknick\b/i.test(s.title)
      ? `Picknick draußen${hm}`
      : `${s.title}${hm}`;
    hints.push(
      `${label} und Regen — das beißt sich. Sollen wir vorziehen oder lieber drinnen was suchen?`,
    );
  }

  if (!fit.riskyStops.length && rainExpected && stops.length) {
    const nextOutdoor = stops.find(
      (s) =>
        s.plannedStartMs != null &&
        s.plannedStartMs > nowMs &&
        isOutdoorish(s) &&
        !fit.riskyStops.includes(s),
    );
    if (
      nextOutdoor?.plannedStartMs &&
      rainAtMs != null &&
      nextOutdoor.plannedStartMs >= rainAtMs - 15 * 60_000
    ) {
      hints.push(
        `${nextOutdoor.title} gegen ${formatHm(nextOutdoor.plannedStartMs)} steht bei dir an — da sieht's nach Regen aus, vielleicht lieber früher oder indoor.`,
      );
    }
  }

  return hints.slice(0, 2);
}
