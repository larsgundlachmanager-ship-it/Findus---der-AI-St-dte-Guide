/**
 * Rückwärts-Pacing Abflug → Boarding → Puffer → Security → Check-in.
 * Reines Modul — ohne RN. Gate-Puffer kommt vom Profil, nicht hart 30 für alle.
 */

export const FLIGHT_GATE_BUFFER_MIN = 20;
export const FLIGHT_CHECKIN_MIN = 30;
export const FLIGHT_ARRIVE_TO_DESK_MIN = 5;

export function computeFlightPacing(opts: {
  depMs: number;
  boardingWindowMin: number;
  securityWaitMin: number;
  luggage: 'carry' | 'checked' | 'unknown';
  gateBufferMin?: number;
  checkinMin?: number;
  arriveToDeskMin?: number;
}): {
  boardMs: number;
  bufferMs: number;
  securityMs: number;
  checkinMs: number;
  airportMs: number;
  gateBufferMin: number;
} {
  const gateBufferMin = opts.gateBufferMin ?? FLIGHT_GATE_BUFFER_MIN;
  const bagCheckinMin =
    opts.luggage === 'checked' ? opts.checkinMin ?? FLIGHT_CHECKIN_MIN : 0;
  const arriveToDeskMin = opts.arriveToDeskMin ?? FLIGHT_ARRIVE_TO_DESK_MIN;
  const boardMs = opts.depMs - opts.boardingWindowMin * 60_000;
  const bufferMs = boardMs - gateBufferMin * 60_000;
  const securityMs = bufferMs - opts.securityWaitMin * 60_000;
  const deskMs = bagCheckinMin > 0 ? securityMs - bagCheckinMin * 60_000 : securityMs;
  const checkinMs =
    bagCheckinMin > 0
      ? deskMs
      : securityMs - Math.max(1, Math.floor(arriveToDeskMin / 2)) * 60_000;
  return {
    boardMs,
    bufferMs,
    securityMs,
    checkinMs,
    airportMs: deskMs - arriveToDeskMin * 60_000,
    gateBufferMin,
  };
}
