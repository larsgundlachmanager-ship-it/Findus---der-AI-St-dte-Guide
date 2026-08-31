/**
 * HUD-Ankunft: ÖPNV-Timeline schlägt Fuß-ETA auf der Gesamtstrecke.
 * Kein RN — Header + Tests.
 */

export function pickNavHudEta(input: {
  lastStopEndMs?: number | null;
  rideStartMs?: number | null;
  navEtaMin?: number | null;
  remainingM?: number | null;
  walkFallbackMin?: number | null;
  nowMs: number;
}): { etaMin: number | null; arriveMs: number | null } {
  const end = input.lastStopEndMs;
  if (end != null && Number.isFinite(end) && end > input.nowMs - 30 * 60_000) {
    const rideStart = input.rideStartMs;
    const rideMin =
      rideStart != null &&
      Number.isFinite(rideStart) &&
      end > rideStart
        ? Math.max(1, Math.round((end - rideStart) / 60_000))
        : Math.max(0, Math.round((end - input.nowMs) / 60_000));
    return {
      etaMin: rideMin,
      arriveMs: end,
    };
  }
  const capMin = 16 * 60;
  if (
    input.navEtaMin != null &&
    input.navEtaMin > 0 &&
    input.navEtaMin <= capMin
  ) {
    return {
      etaMin: input.navEtaMin,
      arriveMs: input.nowMs + input.navEtaMin * 60_000,
    };
  }
  const walk = input.walkFallbackMin;
  const rem = input.remainingM;
  if (
    walk != null &&
    walk > 0 &&
    walk <= capMin &&
    (rem == null || rem < 40_000)
  ) {
    return {
      etaMin: walk,
      arriveMs: input.nowMs + walk * 60_000,
    };
  }
  return { etaMin: null, arriveMs: null };
}
