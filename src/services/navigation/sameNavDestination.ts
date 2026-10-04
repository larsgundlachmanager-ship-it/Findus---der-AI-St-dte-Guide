/**
 * Gleiches Nav-Ziel? — nie Stadt-Mitte / Dorfkern als „schon da“ für Venue-Ziele.
 * (Bug: live="Prisdorf…" + next="Tennis-Club Prisdorf…" → false nameHit via slice(0,10).)
 */

import { packPlaceNameScore } from './packPlaceNameScore';

const VENUE_TOKEN_RE =
  /\b(tennis|club|klub|halle|restaurant|caf[eé]|bistro|gasthof|museum|kirche|hotel|schule|kindergarten|arzt|apotheke|bahnhof|markt|sport|tsv|tcp)\b/iu;

const CITYISH_HEAD_RE =
  /^(prisdorf|priesdorf|hamburg|berlin|l[uü]beck|pinneberg|uetersen|tornesch|quickborn|elmshorn|laboe|wangerooge)\b/iu;

export function isLikelyCityOnlyNavLabel(name: string): boolean {
  const t = (name || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (VENUE_TOKEN_RE.test(t)) return false;
  const head = t.split(',')[0]?.trim() || t;
  if (CITYISH_HEAD_RE.test(head) && head.length <= 48) return true;
  // „Prisdorf, Schleswig-Holstein, Deutschland“
  if (
    CITYISH_HEAD_RE.test(head) &&
    /deutschland|germany|schleswig|holstein|kreis\s+/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function queryLooksLikeVenueNav(query: string): boolean {
  return VENUE_TOKEN_RE.test(query || '');
}

/**
 * true nur bei echtemselben Ziel — Stadt-Label blockiert kein Venue-Recalc.
 */
export function isSameNavDestination(opts: {
  liveName?: string | null;
  nextName?: string | null;
  liveLat?: number | null;
  liveLng?: number | null;
  nextLat?: number | null;
  nextLng?: number | null;
  /** ~10 m in Grad² (~1e-7) */
  nearEpsDeg2?: number;
}): boolean {
  const live = String(opts.liveName || '').replace(/\s+/g, ' ').trim();
  const next = String(opts.nextName || '').replace(/\s+/g, ' ').trim();

  let near = false;
  if (
    typeof opts.liveLat === 'number' &&
    typeof opts.liveLng === 'number' &&
    typeof opts.nextLat === 'number' &&
    typeof opts.nextLng === 'number' &&
    Number.isFinite(opts.liveLat) &&
    Number.isFinite(opts.nextLat)
  ) {
    const dLat = opts.liveLat - opts.nextLat;
    const dLng = opts.liveLng - opts.nextLng;
    const eps = opts.nearEpsDeg2 ?? 1e-7;
    near = dLat * dLat + dLng * dLng < eps;
  }

  if (near) {
    // Koordinaten gleich, aber Label Stadt vs. Venue → trotzdem neu (Pack-Korrektur)
    if (
      live &&
      next &&
      isLikelyCityOnlyNavLabel(live) &&
      queryLooksLikeVenueNav(next)
    ) {
      return false;
    }
    return true;
  }

  if (!live || !next) return false;

  // Stadt-Mitte darf Venue-Start nicht „schon aktiv“ halten
  if (isLikelyCityOnlyNavLabel(live) && queryLooksLikeVenueNav(next)) {
    return false;
  }
  if (isLikelyCityOnlyNavLabel(next) && queryLooksLikeVenueNav(live)) {
    return false;
  }

  const a = live.toLowerCase();
  const b = next.toLowerCase();
  if (a === b) return true;

  const score = Math.max(
    packPlaceNameScore(live, next),
    packPlaceNameScore(next, live),
  );
  return score >= 70;
}

/**
 * Geocode-Treffer verwerfen wenn Query ein Venue meint, Label aber nur die Stadt ist
 * (→ Route endet im Dorfkern / Pack-Mittelpunkt).
 */
export function shouldRejectCityGeocodeForVenueQuery(
  query: string,
  label: string | null | undefined,
): boolean {
  if (!queryLooksLikeVenueNav(query)) return false;
  const lab = String(label || '').trim();
  if (!lab) return false;
  if (VENUE_TOKEN_RE.test(lab)) return false;
  return isLikelyCityOnlyNavLabel(lab);
}
