/**
 * User-TTS-Lautstärke — Voice „lauter/leiser“ Just-Do-It.
 * Multiplier auf Cartesia generation_config.volume (0.5–2.0).
 */

const MIN = 0.55;
const MAX = 1.85;
const STEP = 0.18;

let userVolumeMul = 1;

export function getUserTtsVolumeMul(): number {
  return userVolumeMul;
}

export function setUserTtsVolumeMul(mul: number): number {
  userVolumeMul = Math.min(MAX, Math.max(MIN, mul));
  return userVolumeMul;
}

export function nudgeUserTtsVolume(
  dir: 'up' | 'down' | 'max' | 'min' | 'reset',
): number {
  if (dir === 'reset') return setUserTtsVolumeMul(1);
  if (dir === 'max') return setUserTtsVolumeMul(MAX);
  if (dir === 'min') return setUserTtsVolumeMul(MIN);
  if (dir === 'up') return setUserTtsVolumeMul(userVolumeMul + STEP);
  return setUserTtsVolumeMul(userVolumeMul - STEP);
}

/** Basis-Volume × User-Mul, geclampt. */
export function applyUserTtsVolume(base?: number | null): number {
  const b =
    typeof base === 'number' && Number.isFinite(base) ? base : 1.02;
  return Math.min(2, Math.max(0.5, b * userVolumeMul));
}

export function volumeLevelLabel(mul = userVolumeMul): string {
  if (mul <= 0.7) return 'leise';
  if (mul >= 1.55) return 'laut';
  if (mul >= 1.2) return 'etwas lauter';
  if (mul <= 0.85) return 'etwas leiser';
  return 'normal';
}
