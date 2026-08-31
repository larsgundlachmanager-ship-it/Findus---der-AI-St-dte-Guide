/**
 * Am Bahnsteig / Halt stehen — nicht in der Tür ankommen.
 * Gilt für Einstieg und Umstieg.
 */
export const STATION_ARRIVE_BEFORE_MIN = 3;

export function stationArriveByMs(
  depMs: number,
  bufferMin: number = STATION_ARRIVE_BEFORE_MIN,
): number {
  return depMs - Math.max(0, bufferMin) * 60_000;
}
