/**
 * Welche Abbiegung Hands-Free gesprochen wird.
 * Reine Heuristik — kein GPS, kein React Native.
 */

export function isTurnManeuver(maneuver: string | null | undefined): boolean {
  const m = (maneuver ?? '').toLowerCase();
  if (!m) return false;
  if (/^(straight|arrive|continue)$/.test(m)) return false;
  return /left|right|uturn|u-turn|roundabout|fork|ramp|keep|end of road/.test(
    m,
  );
}

/** Kleine Gasse / Durchgang — visuell führen, nicht nur „links“. */
export function isAlleyRoadName(roadName: string | null | undefined): boolean {
  const n = (roadName ?? '').toLowerCase();
  if (n.length < 3) return false;
  return /\b(gasse|gässchen|gaesschen|pfad|steg|durchgang|passage|winkel|twiete|hof)\b/.test(
    n,
  );
}

/**
 * Ansage-würdig: echte Gabelung / Abbiegung / komplexe Kreuzung / Gasse.
 * Auch leicht links/rechts ansagen (OSRM tagged Forks oft als slight-*) —
 * sonst fehlt die Rechtsabbiegung an der Weggabelung.
 */
export function isHandsFreeSpeakTurn(opts: {
  maneuver: string | null | undefined;
  roadName?: string | null;
  turnComplexity?: 'simple' | 'complex' | 'unknown' | null;
}): boolean {
  if (!isTurnManeuver(opts.maneuver)) return false;
  const m = (opts.maneuver ?? '').toLowerCase();
  if (/fork|keep|end of road|roundabout|uturn|u-turn|sharp/.test(m)) return true;
  if (opts.turnComplexity === 'complex') return true;
  if (isAlleyRoadName(opts.roadName)) return true;
  // slight-left/right: sprechen (Google-Style), kein Dauerlaber-Filter mehr
  return /left|right/.test(m);
}
