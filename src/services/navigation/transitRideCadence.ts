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
 * Kurze dichte Takte: keine. Viele Halte: 5 und 3, ggf. Mitte.
 */
export function midRideStopMarks(input: RideCadenceInput): number[] {
  if (isLongHaulRide(input)) return [];
  if (isDenseLocalRide(input)) return [];
  const n = input.boardedStops ?? input.remainingStops ?? 0;
  const marks: number[] = [];
  if (n >= 12) marks.push(Math.max(6, Math.round(n / 2)));
  if (n >= 6) marks.push(5);
  if (n >= 4) marks.push(3);
  return [...new Set(marks)].filter((m) => m < n && m > 1).sort((a, b) => b - a);
}

export function shouldSpeakRemainingStop(
  remaining: number,
  input: RideCadenceInput,
): boolean {
  if (!Number.isFinite(remaining) || remaining < 1) return false;
  if (remaining === 1) return true;
  return midRideStopMarks(input).includes(remaining);
}

/** Vorlauf vor dem Ausstieg: ICE ~5 Min, S/Bus ~1 Min. */
export function alightLeadSec(input: RideCadenceInput): number {
  if (isLongHaulRide(input)) return 5 * 60;
  const min = input.rideMin;
  if (min != null && min <= 2) return 50;
  return 65;
}

/**
 * Zweite Ausstiegsansage (Zeit), nachdem „nächste Station“ schon kam:
 * nur wenn dazwischen genug Puffer war.
 */
export function shouldSpeakAlightSoon(opts: {
  remainingStops: number | null;
  etaSec: number | null;
  leadSec: number;
  nextStopSpokenAtMs: number | null;
  nowMs: number;
  boardedStops?: number | null;
}): boolean {
  if (opts.remainingStops == null || opts.remainingStops > 1) return false;
  const eta = opts.etaSec;
  if (eta == null || eta > opts.leadSec + 12) return false;
  if (eta < 8) return true;
  const spokenAt = opts.nextStopSpokenAtMs;
  if (spokenAt == null) return true;
  const since = opts.nowMs - spokenAt;
  // S-Bahn: nächste Station war schon die 1-Min-Ansage.
  if (since < 22_000) return false;
  if (opts.leadSec <= 70 && since < 50_000) return false;
  return true;
}
