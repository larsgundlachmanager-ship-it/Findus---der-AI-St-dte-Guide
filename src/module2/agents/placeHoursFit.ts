import { scoreSourceTrust } from '../../services/research/sourceTrust';
import { closingTimeAllowsStay } from '../../services/concierge/closingHours';
import type { DiscoveredPlace } from '../../services/navigation/googleMapsNav';

export type PlanVisitWindow = {
  arriveAtMs?: number;
  stayMin?: number;
  category?: string | null;
  title?: string | null;
  travelMin?: number;
};

export type PlaceHoursFields = Pick<
  DiscoveredPlace,
  'openNow' | 'opensAtMin' | 'closesAtMin'
> & {
  /** 0–1 Quellen-Vertrauen (Google live > OSM > unbekannt) */
  hoursTrust?: number | null;
};

/** Vertrauen für Place-Hours (gleiche Skala wie Events/Web). */
export function scorePlaceHoursTrust(place: PlaceHoursFields): number {
  const hasClock = place.opensAtMin != null || place.closesAtMin != null;
  return scoreSourceTrust({
    liveOpenNow: place.openNow,
    hasTime: hasClock,
    sourceHint: hasClock ? 'opening_hours maps/osm' : 'unknown',
    confidence:
      place.openNow != null && hasClock
        ? 'high'
        : place.openNow != null || hasClock
          ? 'medium'
          : 'low',
  });
}

function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** Minuten seit Mitternacht → "18:30". Overnight >1440 wrappt auf den Folgetag. */
export function formatClockFromMin(min: number): string {
  const m = ((Math.round(min) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, '0')}`;
}

/** Belegte Öffnungszeiten zum Vorlesen — nie Minuten-Rohwerte. */
export function hoursSpeechHint(place: PlaceHoursFields): string | null {
  const open =
    place.opensAtMin != null && Number.isFinite(place.opensAtMin)
      ? formatClockFromMin(place.opensAtMin)
      : null;
  const close =
    place.closesAtMin != null && Number.isFinite(place.closesAtMin)
      ? formatClockFromMin(place.closesAtMin)
      : null;
  if (place.opensAtMin == null && place.closesAtMin == null) {
    if (place.openNow === true) return 'gerade offen';
    if (place.openNow === false) return 'gerade zu';
    return null;
  }
  if (open && close) {
    if (place.openNow === false) return `heute ${open}–${close} Uhr, gerade zu`;
    return `heute ${open}–${close} Uhr`;
  }
  if (close) {
    return place.openNow === false
      ? `sonst bis ${close} Uhr, gerade zu`
      : `offen bis ca. ${close} Uhr`;
  }
  if (open) return `ab ca. ${open} Uhr`;
  return null;
}

/** Pitch: Öffnungszeiten nur wenn gerade zu oder schließt bald (~90 Min). */
export function hoursPitchHint(
  place: PlaceHoursFields,
  nowMs: number = Date.now(),
): string | null {
  if (place.openNow === false) return hoursSpeechHint(place);
  const close = place.closesAtMin;
  if (close == null || !Number.isFinite(close)) return null;
  const nowMin = minutesOfDay(nowMs);
  let until = close - nowMin;
  if (until < 0) until += 24 * 60;
  if (until <= 90) return hoursSpeechHint(place);
  return null;
}

function defaultStayMin(window?: PlanVisitWindow): number {
  const blob = `${window?.category ?? ''} ${window?.title ?? ''}`.toLowerCase();
  if (/frühstück|fruehstueck|brunch/i.test(blob)) return 60;
  if (/essen|dinner|restaurant|mittag/i.test(blob) || window?.category === 'meal') {
    return 90;
  }
  if (/museum|galerie|ausstellung/i.test(blob) || window?.category === 'culture') {
    return 120;
  }
  if (/einkauf|supermarkt|shop/i.test(blob) || window?.category === 'shop') {
    return 15;
  }
  return 45;
}

function clampStay(stayMin: number | undefined, window?: PlanVisitWindow): number {
  const fromCat = stayMin ?? defaultStayMin(window);
  return Math.max(10, Math.min(240, fromCat || 45));
}

export function effectiveArriveAtMs(window: PlanVisitWindow = {}): number {
  const now = Date.now();
  const travelPad = Math.max(0, window.travelMin ?? 0) * 60_000;
  const planned = window.arriveAtMs ?? now;
  if (planned - now >= 6 * 60 * 60_000) {
    return planned;
  }
  const earliest = now + travelPad;
  return Math.max(planned, earliest);
}

/** True wenn der Ort zur geplanten Besuchswindow passen kann. */
export function placeFitsPlanVisit(
  place: PlaceHoursFields,
  window: PlanVisitWindow = {},
): boolean {
  const stayMin = clampStay(window.stayMin, window);
  const arriveAtMs = effectiveArriveAtMs(window);
  const arrivalMin = minutesOfDay(arriveAtMs);
  const nearNow = Math.abs(arriveAtMs - Date.now()) < 25 * 60_000;

  const opens = place.opensAtMin;
  const closes = place.closesAtMin;

  if (opens != null && Number.isFinite(opens) && arrivalMin + 5 < opens) {
    return false;
  }

  if (closes != null && Number.isFinite(closes)) {
    if (!closingTimeAllowsStay(arrivalMin, closes, stayMin)) return false;
  }

  if (place.openNow === false && nearNow) {
    return false;
  }

  return true;
}
