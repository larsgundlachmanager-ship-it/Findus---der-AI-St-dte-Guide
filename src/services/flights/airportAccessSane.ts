/**
 * ÖPNV zum Abflughafen: keine 26h-Schleifen, keine Past-arriveBy-Routen.
 * Reines Modul — ohne RN.
 */

export function isSaneAirportAccessTransit(
  transit: {
    durationSec: number;
    startTime?: Date | null;
    endTime?: Date | null;
  },
  opts: { arriveByMs: number; taxiMin: number; nowMs?: number },
): boolean {
  const now = opts.nowMs ?? Date.now();
  const durMin = Math.max(1, Math.round((transit.durationSec || 0) / 60));
  if (durMin > 180) return false;
  if (durMin > Math.max(90, opts.taxiMin * 5)) return false;
  const start = transit.startTime?.getTime();
  const end = transit.endTime?.getTime();
  if (start == null || end == null) return false;
  if (end < start) return false;
  if (end > opts.arriveByMs + 20 * 60_000) return false;
  if (start < opts.arriveByMs - 8 * 3600_000) return false;
  if (start < now - 2 * 60_000) return false;
  return true;
}
