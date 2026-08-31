/**
 * Flug-Kontext für offene Hotel-/Mietwagen-Pläne (Ankunft → Spät-Check-in).
 * Keine Orts-Hardcodes — Slots aus Commit/Watch.
 */

import type { IngestOpenWish } from '../../module2/planning/planningTypes';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clockFromMs(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Ankunft + Puffer → frühestens sinnvolle Check-in-Untergrenze (Uhr). */
export function lateCheckInFloorHm(arrivalMs: number, transferMin = 65): string {
  return clockFromMs(arrivalMs + transferMin * 60_000);
}

export function flightArrivalMsForOpenPlan(): number | null {
  try {
    const { getFocusFlightWatch, listFlightWatches } = require('./flightWatchStore') as {
      getFocusFlightWatch: () => {
        lastFlight?: {
          estimatedArrival?: Date | null;
          scheduledArrival?: Date | null;
          actualArrival?: Date | null;
        };
      } | null;
      listFlightWatches: () => Array<{
        lastFlight?: {
          estimatedArrival?: Date | null;
          scheduledArrival?: Date | null;
          actualArrival?: Date | null;
        };
      }>;
    };
    const watches = [
      getFocusFlightWatch(),
      ...(listFlightWatches?.() ?? []),
    ].filter(Boolean);
    for (const w of watches) {
      const f = w!.lastFlight;
      if (!f) continue;
      const arr = f.actualArrival ?? f.estimatedArrival ?? f.scheduledArrival;
      if (arr && Number.isFinite(arr.getTime())) return arr.getTime();
    }
  } catch {
    /* soft */
  }
  return null;
}

export function flightDestCityForOpenPlan(): string | null {
  try {
    const { getLastFlightCommit } = require('./flightTripSession') as {
      getLastFlightCommit: () => { destCity?: string | null } | null;
    };
    const c = getLastFlightCommit()?.destCity?.trim();
    if (c) return c;
  } catch {
    /* soft */
  }
  try {
    const { getFocusFlightWatch } = require('./flightWatchStore') as {
      getFocusFlightWatch: () => { destLabel?: string | null } | null;
    };
    const label = getFocusFlightWatch()?.destLabel?.trim();
    if (label) return label;
  } catch {
    /* soft */
  }
  return null;
}

/**
 * Wish-Kontext aus Flug anreichern (Zielstadt, Ankunft, Spät-Check-in).
 * Wortlaut-frei — nur Slots für Research/Filter.
 */
export function enrichOpenWishFromFlight(
  wish: IngestOpenWish,
  kind: 'hotel' | 'car',
): IngestOpenWish {
  const city = flightDestCityForOpenPlan();
  const arrMs = flightArrivalMsForOpenPlan();
  const parts: string[] = [];
  if (wish.context?.trim()) parts.push(wish.context.trim());
  if (city) parts.push(`Ziel ${city}`);
  if (kind === 'hotel' && arrMs != null) {
    const arrHm = clockFromMs(arrMs);
    const checkHm = lateCheckInFloorHm(arrMs);
    parts.push(
      `Ankunft Flughafen ~${arrHm}; Transfer Flughafen zur Unterkunft; Spät-Check-in nötig (mind. bis ~${checkHm} Check-in möglich); late check-in 24h Rezeption`,
    );
  }
  if (kind === 'car' && city) {
    parts.push(`Mietwagen Pickup am Ziel-Flughafen ${city}`);
  }
  const title =
    kind === 'hotel'
      ? city
        ? `Hotel in ${city}`
        : /^hotel/i.test(wish.title)
          ? wish.title
          : 'Hotel'
      : city
        ? `Mietwagen ${city}`
        : /^mietwagen/i.test(wish.title)
          ? wish.title
          : 'Mietwagen';
  return {
    ...wish,
    title,
    context: parts.filter(Boolean).join(' · ') || wish.context,
  };
}
