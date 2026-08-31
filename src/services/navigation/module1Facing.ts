/**
 * Modul-1 Blickrichtung — Code berechnet lookPhrase, Gemini darf Seite nicht erfinden.
 *
 * Bänder: 0–20° vorne · 20–45° leicht L/R · 45–100° L/R · 100–150° weiter drehen · >150° skip.
 */

import {
  bearingDegrees,
  distanceMeters,
  relativeBearingDeg,
} from './bearing';
import {
  getGpsTrackFixes,
  getTrackMovementBearingDeg,
} from './gpsTrackBuffer';
import {
  FACING_MOVE_MIN_MS,
  resolveFacingBearingDeg,
  type FacingSource,
} from './facingReference';
import { getSmoothedSpeedMs } from './transportMode';
import { getLiveDeviceHeadingDeg } from './liveDeviceHeading';

export type Module1LookCue = {
  lookPhrase: string;
  facingSource: FacingSource;
  relDeg: number | null;
  distToHauptM: number | null;
  /** true → Trigger sollte skippen (Ort klar hinter dem User) */
  shouldSkipTrigger: boolean;
  pathHint: string | null;
  stableTrack: boolean;
};

const MIN_POINT_GAP_M = 1;
const MIN_PATH_M = 2.5;
const MIN_POINTS = 3;

/** Stabile Gehrichtung: ≥3 Fixes mit ≥1 m Abstand und ≥~2.5 m Pfad. */
export function getStableModule1MovementBearingDeg(): number | null {
  const raw = getGpsTrackFixes();
  if (raw.length < MIN_POINTS) {
    // Fallback: bestehender Track-Bearing wenn genug Weg
    return getTrackMovementBearingDeg();
  }
  const filtered: { lat: number; lng: number }[] = [];
  for (const f of raw) {
    const prev = filtered[filtered.length - 1];
    if (
      !prev ||
      distanceMeters(prev.lat, prev.lng, f.lat, f.lng) >= MIN_POINT_GAP_M
    ) {
      filtered.push({ lat: f.lat, lng: f.lng });
    }
  }
  if (filtered.length < MIN_POINTS) {
    return getTrackMovementBearingDeg();
  }
  const a = filtered[0]!;
  const b = filtered[filtered.length - 1]!;
  const path = distanceMeters(a.lat, a.lng, b.lat, b.lng);
  if (path < MIN_PATH_M) return getTrackMovementBearingDeg();
  return bearingDegrees(a.lat, a.lng, b.lat, b.lng);
}

/** Distanz für Speech: 12 m → „etwa 10 Meter“, 0.8 km → „etwa 800 Meter“. */
export function formatLookDistancePhrase(distM: number | null | undefined): string | null {
  if (typeof distM !== 'number' || !Number.isFinite(distM) || distM < 0) {
    return null;
  }
  if (distM < 8) return 'direkt vor dir';
  if (distM < 1000) {
    const rounded = distM < 30 ? Math.round(distM) : Math.round(distM / 5) * 5;
    return `etwa ${rounded} Meter`;
  }
  const km = (distM / 1000).toFixed(1).replace('.', ',');
  return `etwa ${km} Kilometer`;
}

/** lookPhrase + Distanz, z. B. „nach rechts, etwa 10 Meter“. */
export function formatLookCueSpeech(cue: Module1LookCue): string {
  const dist = formatLookDistancePhrase(cue.distToHauptM);
  if (dist && cue.lookPhrase) return `${cue.lookPhrase}, ${dist}`;
  return cue.lookPhrase;
}

/** Kompass + GPS → gesprochene Blickrichtung zum Ziel (Concierge / Pitch). */
export function lookCueSpeechToDest(opts: {
  userLat: number;
  userLng: number;
  destLat: number;
  destLng: number;
  deviceHeadingDeg?: number | null;
  speedMs?: number | null;
}): string {
  const heading =
    opts.deviceHeadingDeg ?? getLiveDeviceHeadingDeg();
  const cue = resolveModule1LookCue({
    userLat: opts.userLat,
    userLng: opts.userLng,
    hauptLat: opts.destLat,
    hauptLng: opts.destLng,
    speedMs: opts.speedMs,
    deviceHeadingDeg: heading,
  });
  return formatLookCueSpeech(cue);
}

function phraseFromRelDeg(relDeg: number): {
  lookPhrase: string;
  shouldSkipTrigger: boolean;
} {
  const abs = Math.abs(relDeg);
  const left = relDeg < 0;
  if (abs <= 20) {
    return { lookPhrase: 'geradeaus vor dir', shouldSkipTrigger: false };
  }
  if (abs <= 45) {
    return {
      lookPhrase: left ? 'leicht nach links' : 'leicht nach rechts',
      shouldSkipTrigger: false,
    };
  }
  if (abs <= 100) {
    return {
      lookPhrase: left ? 'nach links' : 'nach rechts',
      shouldSkipTrigger: false,
    };
  }
  if (abs <= 150) {
    return {
      lookPhrase: left
        ? 'weiter nach links drehen'
        : 'weiter nach rechts drehen',
      shouldSkipTrigger: false,
    };
  }
  return {
    lookPhrase: left ? 'hinter dir links' : 'hinter dir rechts',
    shouldSkipTrigger: true,
  };
}

/**
 * Blick-/Gehrichtung + Relativwinkel zum Hauptort → feste lookPhrase.
 */
export function resolveModule1LookCue(input: {
  userLat: number;
  userLng: number;
  hauptLat: number;
  hauptLng: number;
  speedMs?: number | null;
  deviceHeadingDeg?: number | null;
  pathHint?: string | null;
}): Module1LookCue {
  const distToHauptM = distanceMeters(
    input.userLat,
    input.userLng,
    input.hauptLat,
    input.hauptLng,
  );
  const toHaupt = bearingDegrees(
    input.userLat,
    input.userLng,
    input.hauptLat,
    input.hauptLng,
  );

  const speed =
    typeof input.speedMs === 'number' && Number.isFinite(input.speedMs)
      ? input.speedMs
      : getSmoothedSpeedMs();
  const stableMove = getStableModule1MovementBearingDeg();
  const heading =
    typeof input.deviceHeadingDeg === 'number' &&
    Number.isFinite(input.deviceHeadingDeg)
      ? input.deviceHeadingDeg
      : null;

  const facing = resolveFacingBearingDeg({
    speedMs: speed,
    movementBearingDeg: stableMove,
    deviceHeadingDeg: heading,
    minMoveMs: FACING_MOVE_MIN_MS,
  });

  if (facing.bearingDeg == null) {
    return {
      lookPhrase: 'vor dir',
      facingSource: 'unknown',
      relDeg: null,
      distToHauptM,
      shouldSkipTrigger: false,
      pathHint: input.pathHint?.trim() || null,
      stableTrack: Boolean(stableMove != null),
    };
  }

  const relDeg = relativeBearingDeg(facing.bearingDeg, toHaupt);
  const { lookPhrase, shouldSkipTrigger } = phraseFromRelDeg(relDeg);

  return {
    lookPhrase,
    facingSource: facing.source,
    relDeg: Math.round(relDeg * 10) / 10,
    distToHauptM: Math.round(distToHauptM),
    shouldSkipTrigger,
    pathHint: input.pathHint?.trim() || null,
    stableTrack: Boolean(stableMove != null && facing.source === 'gps_vector'),
  };
}

/** Prompt-Block für Gemini — Seite EISERN. */
export function formatModule1LookCueForPrompt(cue: Module1LookCue): string {
  const spoken = formatLookCueSpeech(cue);
  return [
    'RICHTUNG_CODE (EISERN — nicht spiegeln, nicht raten):',
    `lookPhrase: "${cue.lookPhrase}"`,
    `lookSpeech: "${spoken}"`,
    `facingSource: ${cue.facingSource}`,
    `relDeg: ${cue.relDeg ?? '—'}`,
    `distToHauptM: ${cue.distToHauptM ?? '—'}`,
    `pathHint: ${cue.pathHint ?? '—'}`,
    `stableTrack: ${cue.stableTrack ? 'ja' : 'nein'}`,
  ].join('\n');
}
