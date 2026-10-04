/**
 * ÖPNV-Ansage-Takt — Struktur, kein Skript.
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe an Fahrzeug, Haltabstand und Restfahrt an.
 */

export type TransitVehicleKind = 'Bahn' | 'Bus' | 'ÖPNV';

export type RideCadenceInput = {
  line: string | null;
  vehicle: TransitVehicleKind;
  vehicleMode?: string | null;
  /** Rest-Halte jetzt (inkl. Ausstieg). */
  remainingStops: number | null;
  /** Restfahrt in Minuten, wenn bekannt. */
  rideMin: number | null;
  /** Live-ETA zum Ausstieg in Sekunden. */
  etaSec?: number | null;
  /** Halte beim Losfahren — für Mid-Marks. */
  boardedStops?: number | null;
};

const LONG_HAUL_LINE =
  /^(ICE|IC|EC|ECE|ECE\b|RJ|NJ|EN|TGV|ECE|FR|THA|EST)\s*\d*/i;

/** Ausstieg ~60 s vorher (Fern etwas länger). */
export const ALIGHT_LEAD_SEC = 60;
export const ALIGHT_LEAD_LONG_HAUL_SEC = 90;

export function isLongHaulRide(input: RideCadenceInput): boolean {
  const line = (input.line || '').trim();
  if (LONG_HAUL_LINE.test(line)) return true;
  const n = input.remainingStops ?? input.boardedStops;
  const min = input.rideMin;
  if (min != null && n != null && n <= 2 && min >= 12) return true;
  const hop = hopMinutes(input);
  return hop != null && hop >= 8;
}

function hopMinutes(input: RideCadenceInput): number | null {
  const n = input.boardedStops ?? input.remainingStops;
  const min = input.rideMin;
  if (min != null && n != null && n >= 1) {
    return min / Math.max(1, n);
  }
  return null;
}

function defaultHopMin(input: RideCadenceInput): number {
  if (isLongHaulRide(input)) return 15;
  const line = (input.line || '').trim();
  const vm = String(input.vehicleMode || '').toUpperCase();
  if (input.vehicle === 'Bus' || vm === 'BUS' || vm === 'TRAM' || vm === 'SUBWAY') {
    return 1.4;
  }
  if (/^[SU]\s*\d/i.test(line) || /^STR\b/i.test(line)) return 1.4;
  if (/^R[BE]\s*\d/i.test(line)) return 3;
  return 2;
}

export function isDenseLocalRide(input: RideCadenceInput): boolean {
  if (isLongHaulRide(input)) return false;
  const hop = hopMinutes(input) ?? defaultHopMin(input);
  const n = input.boardedStops ?? input.remainingStops ?? 0;
  const min = input.rideMin;
  if (n <= 2) return true;
  if (min != null && min <= 3 && n <= 4) return true;
  return hop < 1.2;
}

/**
 * Extra Halt-Ansagen nach dem Losfahren (ohne 1 = nächster Ausstieg).
 * Countdown nur einmal bei noch 3 Stationen.
 */
export function midRideStopMarks(input: RideCadenceInput): number[] {
  if (isLongHaulRide(input)) return [];
  if (isDenseLocalRide(input)) return [];
  const n = input.boardedStops ?? input.remainingStops ?? 0;
  if (n >= 4) return [3];
  return [];
}

export function shouldSpeakRemainingStop(
  remaining: number,
  input: RideCadenceInput,
): boolean {
  if (!Number.isFinite(remaining) || remaining < 1) return false;
  if (remaining === 1) return true;
  return midRideStopMarks(input).includes(remaining);
}

/**
 * Zeit-Vorlauf vor dem Ausstieg (nur wenn remainingStops ≤ 1).
 * Lokal/dicht: ~60 s · Fern: ~90 s.
 */
export function alightLeadSec(input: RideCadenceInput): number {
  if (isLongHaulRide(input)) return ALIGHT_LEAD_LONG_HAUL_SEC;
  return ALIGHT_LEAD_SEC;
}

/**
 * Kurzer Hop: 60-s-Vorlauf liegt noch vor dem letzten Halt →
 * „nächste Station“ + Ausstieg einmal zusammen sprechen.
 */
export function shouldMergeNextAndAlight(opts: {
  remainingStops: number | null;
  etaSec?: number | null;
  rideMin?: number | null;
  leadSec: number;
}): boolean {
  if (opts.remainingStops !== 1) return false;
  const lead = opts.leadSec;
  if (
    typeof opts.etaSec === 'number' &&
    Number.isFinite(opts.etaSec) &&
    opts.etaSec <= lead + 12
  ) {
    return true;
  }
  if (
    typeof opts.rideMin === 'number' &&
    Number.isFinite(opts.rideMin) &&
    opts.rideMin * 60 <= lead + 20
  ) {
    return true;
  }
  return false;
}

/**
 * Zweite Ausstiegsansage (Zeit), nachdem „nächste Station“ schon kam:
 * nur bei ≤1 Halt Rest — nie früher mitten in der Kette.
 * Bei Merge (kurzer Hop): warten bis nahe am Halt.
 */
export function shouldSpeakAlightSoon(opts: {
  remainingStops: number | null;
  etaSec: number | null;
  leadSec: number;
  nextStopSpokenAtMs: number | null;
  nowMs: number;
  boardedStops?: number | null;
  /** true = „nächste = Ausstieg“ schon zusammen gesprochen */
  mergedNextAlight?: boolean;
}): boolean {
  if (opts.remainingStops == null || opts.remainingStops > 1) return false;
  const eta = opts.etaSec;
  if (eta == null) return false;
  if (opts.mergedNextAlight) {
    // Nach Merge nur noch sehr nah (nicht nochmal 60 s vorher).
    return eta <= 25;
  }
  if (eta > opts.leadSec + 12) return false;
  if (eta < 8) return true;
  const spokenAt = opts.nextStopSpokenAtMs;
  if (spokenAt == null) return true;
  const since = opts.nowMs - spokenAt;
  // Nicht direkt auf „nächste Station“ stapeln.
  if (since < 22_000) return false;
  // 60-s-Vorlauf: genug Abstand zur Halt-Ansage.
  if (opts.leadSec <= 70 && since < 45_000) return false;
  return true;
}
