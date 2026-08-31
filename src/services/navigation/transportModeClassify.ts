/**
 * Reine Speed+Cadence-Klassifikation (ohne Pedometer/RN).
 */

export type MotionTransportMode =
  | 'walk'
  | 'jog'
  | 'bicycle'
  | 'transit_bus'
  | 'transit_train';

/** ≈ 9 km/h — harte Fuß-Obergrenze */
export const SPEED_WALK_MAX_MS = 2.5;
/** ≈ 15 km/h — Jog-Obergrenze */
export const SPEED_JOG_MAX_MS = 4.2;
/** ≈ 22 km/h — Rad/ÖPNV-Grenze */
export const SPEED_BIKE_MAX_MS = 6.1;

export const JOG_MIN_STEPS_PER_MIN = 135;
export const LOW_STEP_SPM = 35;

export function rawModeFromSpeedAndCadence(
  speedMs: number,
  stepsPerMin: number | null,
): MotionTransportMode {
  const spm = stepsPerMin;
  const hasSpm = typeof spm === 'number' && Number.isFinite(spm);

  if (speedMs >= SPEED_BIKE_MAX_MS) {
    if (
      hasSpm &&
      spm! >= JOG_MIN_STEPS_PER_MIN &&
      speedMs < SPEED_JOG_MAX_MS + 0.5
    ) {
      return 'jog';
    }
    if (hasSpm && spm! < LOW_STEP_SPM) return 'transit_bus';
    if (speedMs >= 8.3) return 'transit_bus';
    return 'bicycle';
  }

  if (speedMs >= SPEED_WALK_MAX_MS) {
    if (
      hasSpm &&
      spm! >= JOG_MIN_STEPS_PER_MIN &&
      speedMs <= SPEED_JOG_MAX_MS
    ) {
      return 'jog';
    }
    if (hasSpm && spm! < LOW_STEP_SPM) return 'bicycle';
    return 'bicycle';
  }

  if (hasSpm && spm! >= JOG_MIN_STEPS_PER_MIN && speedMs >= 1.8) {
    return 'jog';
  }

  return 'walk';
}
