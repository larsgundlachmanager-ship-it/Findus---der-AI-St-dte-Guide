/**
 * Kurzer Turn-Hinweis für Kompass-HUD (kein voller Coach-Text).
 * Einfach: „In 150 m rechts“ / „Jetzt rechts“ — cachebar, keine schwachen POIs.
 * Unübersichtlich (Doppel-Abbiegung / Multi-Road): kurzer Extra-Hinweis.
 */

import {
  isWeakVisualLandmark,
  looksLikeStreetLandmark,
} from './visualLandmarkQuality';

function turnWordFromManeuver(maneuver: string | null | undefined): string {
  const m = (maneuver ?? '').toLowerCase();
  if (m.includes('sharp-left') || m.includes('sharp_left')) return 'scharf links';
  if (m.includes('sharp-right') || m.includes('sharp_right')) return 'scharf rechts';
  if (m.includes('slight-left') || m.includes('slight_left')) return 'leicht links';
  if (m.includes('slight-right') || m.includes('slight_right')) return 'leicht rechts';
  if (m.includes('left')) return 'links';
  if (m.includes('right')) return 'rechts';
  if (m.includes('uturn') || m.includes('u-turn')) return 'umdrehen';
  return 'geradeaus';
}

function turnWord(
  maneuver: string | null | undefined,
  bearingRelDeg?: number,
): string {
  const fromRoute = turnWordFromManeuver(maneuver);
  if (fromRoute.includes('links') || fromRoute.includes('rechts')) {
    return fromRoute;
  }
  if (typeof bearingRelDeg === 'number' && Number.isFinite(bearingRelDeg)) {
    if (bearingRelDeg > 55) return 'scharf rechts';
    if (bearingRelDeg > 25) return 'rechts';
    if (bearingRelDeg < -55) return 'scharf links';
    if (bearingRelDeg < -25) return 'links';
  }
  return fromRoute;
}

function formatDistance(m: number): string {
  if (m < 12) return 'jetzt';
  if (m < 1000) {
    if (m <= 20) return '10 m';
    if (m <= 40) return '30 m';
    if (m <= 75) return '50 m';
    if (m <= 125) return '100 m';
    if (m <= 200) return '150 m';
    return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  }
  return `${(m / 1000).toFixed(1)} km`;
}

function sanitizeLandmark(raw: string | null | undefined): string | null {
  const t = String(raw || '').trim();
  if (!t || isWeakVisualLandmark(t)) return null;
  return t;
}

/** Abbiegesatz, kein Ziel- oder Hinweis-Satz. */
export function isLiveTurnCue(hint: string | null | undefined): boolean {
  const t = String(hint || '').trim();
  if (!t || t.length > 80) return false;
  if (/damit|hinterher|cruise|schiff|beachten|leave-by|abfahrt/i.test(t)) return false;
  return /^(in\s+\d|gleich\s|jetzt\s|links|rechts|scharf|leicht|umdrehen)/i.test(t);
}

export function formatNavTurnHint(opts: {
  landmark?: string | null;
  maneuver?: string | null;
  distanceM?: number | null;
  bearingRelDeg?: number | null;
  isComplex?: boolean;
  roadName?: string | null;
}): string | null {
  const turn = turnWord(opts.maneuver, opts.bearingRelDeg ?? undefined);
  const landmark = sanitizeLandmark(opts.landmark);
  const road =
    opts.roadName?.trim() && looksLikeStreetLandmark(opts.roadName)
      ? opts.roadName.trim()
      : null;
  const complex = opts.isComplex === true;

  if (turn === 'geradeaus' && !complex) return null;

  const distLabel =
    opts.distanceM != null &&
    Number.isFinite(opts.distanceM) &&
    opts.distanceM > 0
      ? formatDistance(opts.distanceM)
      : null;

  if (!complex) {
    if (distLabel === 'jetzt' && turn !== 'geradeaus') {
      return `Gleich ${turn}`;
    }
    if (distLabel && turn !== 'geradeaus') {
      return `In ${distLabel} ${turn}`;
    }
    return turn !== 'geradeaus' ? `${turn} abbiegen` : null;
  }

  // Complex: nur Straßen-/Landmark-Tipp in HUD — nie „unübersichtlich“.
  const extra = road
    ? ` — in die ${road}`
    : landmark
      ? ` — an ${landmark}`
      : '';

  if (distLabel === 'jetzt' && turn !== 'geradeaus') {
    return `Jetzt ${turn}${extra}`;
  }
  if (distLabel && turn !== 'geradeaus') {
    return `In ${distLabel} ${turn}${extra}`;
  }
  if (turn !== 'geradeaus') {
    return `${turn}${extra}`;
  }
  return null;
}