/**
 * Kurzer Turn-Hinweis für Kompass-HUD (kein voller Coach-Text).
 */

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
  if (typeof bearingRelDeg === 'number' && Number.isFinite(bearingRelDeg)) {
    if (bearingRelDeg > 55) return 'scharf rechts';
    if (bearingRelDeg > 25) return 'rechts';
    if (bearingRelDeg < -55) return 'scharf links';
    if (bearingRelDeg < -25) return 'links';
    const fromRoute = turnWordFromManeuver(maneuver);
    if (fromRoute.includes('links') || fromRoute.includes('rechts')) {
      return 'geradeaus';
    }
    return fromRoute;
  }
  return turnWordFromManeuver(maneuver);
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function formatNavTurnHint(opts: {
  landmark?: string | null;
  maneuver?: string | null;
  distanceM?: number | null;
  bearingRelDeg?: number | null;
}): string | null {
  const turn = turnWord(opts.maneuver, opts.bearingRelDeg ?? undefined);
  if (turn === 'geradeaus' && !opts.landmark?.trim()) return null;

  const landmark = opts.landmark?.trim();
  if (landmark && turn !== 'geradeaus') {
    return `An der ${landmark} ${turn}`;
  }

  if (
    opts.distanceM != null &&
    Number.isFinite(opts.distanceM) &&
    opts.distanceM > 0 &&
    turn !== 'geradeaus'
  ) {
    return `In ${formatDistance(opts.distanceM)} ${turn}`;
  }

  if (landmark && turn === 'geradeaus') {
    return `An der ${landmark} geradeaus`;
  }

  return turn !== 'geradeaus' ? turn : null;
}
