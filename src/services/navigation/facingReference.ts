/**
 * Facing reference SSOT — Modul 1 (Explore) & Modul 3 (Nav).
 *
 * Moving → GPS movement vector (Gehrichtung).
 * Standing → device compass heading.
 *
 * Pattern: never mix sources mid-sentence; pick one ref, then left/right/front.
 */

import { relativeBearingDeg } from './bearing';
import {
  relateFromRelativeBearing,
  type SpatialRelation,
} from './spatialOrientation';
import { getSmoothedSpeedMs } from './transportMode';

/** Below this = "standing / looking around". */
export const FACING_MOVE_MIN_MS = 0.55;

export type FacingSource = 'gps_vector' | 'compass' | 'unknown';

export type FacingReference = {
  bearingDeg: number | null;
  source: FacingSource;
  moving: boolean;
};

/**
 * Resolve which absolute bearing Findus should treat as "voraus".
 */
export function resolveFacingBearingDeg(opts: {
  speedMs?: number | null;
  movementBearingDeg?: number | null;
  deviceHeadingDeg?: number | null;
  minMoveMs?: number;
}): FacingReference {
  const minMove = opts.minMoveMs ?? FACING_MOVE_MIN_MS;
  const speed =
    typeof opts.speedMs === 'number' && Number.isFinite(opts.speedMs)
      ? opts.speedMs
      : getSmoothedSpeedMs();
  const moving = speed >= minMove;

  if (
    moving &&
    typeof opts.movementBearingDeg === 'number' &&
    Number.isFinite(opts.movementBearingDeg)
  ) {
    return {
      bearingDeg: ((opts.movementBearingDeg % 360) + 360) % 360,
      source: 'gps_vector',
      moving: true,
    };
  }

  if (
    typeof opts.deviceHeadingDeg === 'number' &&
    Number.isFinite(opts.deviceHeadingDeg) &&
    opts.deviceHeadingDeg >= 0
  ) {
    return {
      bearingDeg: ((opts.deviceHeadingDeg % 360) + 360) % 360,
      source: 'compass',
      moving: false,
    };
  }

  // Fallback: still prefer GPS vector if we have one (slow crawl)
  if (
    typeof opts.movementBearingDeg === 'number' &&
    Number.isFinite(opts.movementBearingDeg)
  ) {
    return {
      bearingDeg: ((opts.movementBearingDeg % 360) + 360) % 360,
      source: 'gps_vector',
      moving: moving,
    };
  }

  return { bearingDeg: null, source: 'unknown', moving };
}

/** Spatial relation of a target absolute bearing vs facing. */
export function relateTargetToFacing(
  facing: FacingReference,
  targetBearingDeg: number,
): SpatialRelation | null {
  if (facing.bearingDeg == null) return null;
  return relateFromRelativeBearing(
    relativeBearingDeg(facing.bearingDeg, targetBearingDeg),
  );
}

/**
 * Gemini / prompt block — reusable for Modul 1 stories & Modul 3 cues.
 */
export function buildVisualDirectionalPromptRule(opts?: {
  lookSidePhrase?: string | null;
  facingSource?: FacingSource;
}): string {
  const side = opts?.lookSidePhrase?.trim();
  const sourceHint =
    opts?.facingSource === 'gps_vector'
      ? 'User bewegt sich — links/rechts relativ zur Gehrichtung (GPS-Vektor).'
      : opts?.facingSource === 'compass'
        ? 'User steht — links/rechts relativ zur Handy-Blickrichtung (Compass).'
        : 'Wenn Bewegung messbar: GPS-Gehrichtung; sonst Compass.';

  return [
    '## Visuelles Verankern (EISERN — Modul 1 & 3)',
    'Starte IMMER mit der Blickrichtung. Dann markante visuelle Details. Dann erst Name/Aktion.',
    sourceHint,
    side ? `Aktuelle Richtungsvorgabe: ${side}.` : '',
    'Gold-Muster: „Schau nach rechts. Siehst du das runde, weiße Gebäude, das dort oben thront? Da steht groß Café Pudding drauf.“',
    'Verboten: Ort zuerst benennen ohne Richtung. Keine Himmelsrichtungen. Kein Broschüren-Ton.',
  ]
    .filter(Boolean)
    .join('\n');
}
