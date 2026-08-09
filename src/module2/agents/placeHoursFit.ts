/**
 * Place opening-hours fit for dining/catalog (UI/agent shared, no planning engine).
 */

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
>;

function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
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
