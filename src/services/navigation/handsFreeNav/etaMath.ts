export const LIVE_PACE_MIN_SAMPLES = 4;
const LIVE_PACE_EMA_ALPHA = 0.28;

const LIVE_PACE_BOUNDS_MPS = {
  walk: { min: 0.7, max: 2.4 },
  bike: { min: 2.2, max: 8.3 },
} as const;

/** Spike guard used before a live GPS speed can affect ETA. */
export function clampLivePaceMps(
  speedMps: number,
  transport: 'walk' | 'bike',
): number {
  const bounds = LIVE_PACE_BOUNDS_MPS[transport];
  const speed = Number.isFinite(speedMps) ? speedMps : bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, speed));
}

/** Upstream speed is already smoothed; this EMA removes remaining ETA jitter. */
export function smoothLivePaceMps(
  previousMps: number | null,
  sampleMps: number,
  transport: 'walk' | 'bike',
  alpha = LIVE_PACE_EMA_ALPHA,
): number {
  const sample = clampLivePaceMps(sampleMps, transport);
  if (previousMps == null || !Number.isFinite(previousMps)) return sample;
  const a = Math.min(1, Math.max(0, alpha));
  return previousMps * (1 - a) + sample * a;
}

export function resolveEtaPaceMPerMin(opts: {
  profileMPerMin: number;
  livePaceMps: number | null;
  liveSampleCount: number;
  inDwell: boolean;
}): {
  mPerMin: number;
  source: 'profile' | 'user_cruise';
} {
  if (
    opts.liveSampleCount < LIVE_PACE_MIN_SAMPLES ||
    opts.livePaceMps == null ||
    !Number.isFinite(opts.livePaceMps) ||
    opts.inDwell
  ) {
    return { mPerMin: Math.max(20, opts.profileMPerMin), source: 'profile' };
  }
  return {
    mPerMin: Math.max(20, Math.round(opts.livePaceMps * 60)),
    source: 'user_cruise',
  };
}

/** Route-only ETA; distance and pace use the same route basis. */
export function etaMinutesForPace(opts: {
  remainingRouteM: number;
  mPerMin: number;
  lightBufferMin?: number;
  weatherMultiplier?: number;
}): number {
  const rem = Math.max(0, opts.remainingRouteM);
  const pace = Math.max(20, opts.mPerMin);
  const weather = Math.max(0.5, opts.weatherMultiplier ?? 1);
  const lights = Math.max(0, opts.lightBufferMin ?? 0);
  const base = rem > 0 ? rem / pace : 0;
  return Math.max(1, Math.ceil(base * weather + lights));
}
