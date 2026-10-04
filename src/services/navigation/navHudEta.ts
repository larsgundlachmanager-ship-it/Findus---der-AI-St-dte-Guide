/**
 * HUD-Ankunft: ÖPNV-Timeline schlägt Fuß-ETA auf der Gesamtstrecke.
 * Kein RN — Header + Tests.
 *
 * Speech-ETA = dieselbe Zahl wie Live-HUD (eine Rundung).
 */

export function pickNavHudEta(input: {
  lastStopEndMs?: number | null;
  rideStartMs?: number | null;
  navEtaMin?: number | null;
  remainingM?: number | null;
  walkFallbackMin?: number | null;
  nowMs: number;
  /**
   * Am Halt wartend: Minuten bis Fahrzeug — nicht Ziel-ETA.
   * walk_to_stop / waiting.
   */
  waitingForVehicle?: boolean;
  vehicleDepartMs?: number | null;
}): { etaMin: number | null; arriveMs: number | null; waitMin?: number | null } {
  if (input.waitingForVehicle) {
    const dep = input.vehicleDepartMs ?? input.rideStartMs;
    if (dep != null && Number.isFinite(dep)) {
      const waitMin = Math.max(0, Math.round((dep - input.nowMs) / 60_000));
      return {
        etaMin: waitMin,
        arriveMs: dep,
        waitMin,
      };
    }
  }
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

/**
 * Eine ETA für Speech + HUD: store/phrase/HUD-Pick → einmal runden.
 * Preferenzen: phrase (committed route) → store navEtaMin → fallback.
 */
export function resolveNavSpeechEtaMin(opts?: {
  phraseEtaMin?: number | null;
  storeEtaMin?: number | null;
  lastStopEndMs?: number | null;
  rideStartMs?: number | null;
  remainingM?: number | null;
  walkFallbackMin?: number | null;
  nowMs?: number;
}): number | null {
  const nowMs = opts?.nowMs ?? Date.now();
  const phrase =
    opts?.phraseEtaMin != null && Number.isFinite(opts.phraseEtaMin)
      ? Math.max(1, Math.round(opts.phraseEtaMin))
      : null;
  const store =
    opts?.storeEtaMin != null && Number.isFinite(opts.storeEtaMin)
      ? Math.max(1, Math.round(opts.storeEtaMin))
      : null;
  const hud = pickNavHudEta({
    lastStopEndMs: opts?.lastStopEndMs,
    rideStartMs: opts?.rideStartMs,
    navEtaMin: store ?? phrase,
    remainingM: opts?.remainingM,
    walkFallbackMin: opts?.walkFallbackMin,
    nowMs,
  });
  if (hud.etaMin != null && Number.isFinite(hud.etaMin) && hud.etaMin > 0) {
    return Math.max(1, Math.round(hud.etaMin));
  }
  return phrase ?? store;
}
