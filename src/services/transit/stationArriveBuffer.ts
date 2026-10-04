/**
 * Am Bahnsteig / Halt stehen — nicht in der Tür ankommen.
 * Gilt für Einstieg und Umstieg.
 *
 * Klein/mittel: 3 Min. Große Bahnhöfe (Hbf/ZOB/Flughafen): 7 Min.
 */
export const STATION_ARRIVE_BEFORE_MIN = 3;
export const STATION_ARRIVE_BEFORE_LARGE_MIN = 7;

const LARGE_STATION_RE =
  /\b(hbf|hauptbahnhof|zob|flughafen|airport|central\s*station|hauptbahnhof)\b/iu;

export function stationArriveBufferMin(opts?: {
  name?: string | null;
  mode?: string | null;
}): number {
  const blob = String(opts?.name ?? '').trim();
  if (!blob) return STATION_ARRIVE_BEFORE_MIN;
  if (LARGE_STATION_RE.test(blob)) return STATION_ARRIVE_BEFORE_LARGE_MIN;
  return STATION_ARRIVE_BEFORE_MIN;
}

export function stationArriveByMs(
  depMs: number,
  bufferMin: number = STATION_ARRIVE_BEFORE_MIN,
): number {
  return depMs - Math.max(0, bufferMin) * 60_000;
}
