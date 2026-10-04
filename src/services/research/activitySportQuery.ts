/**
 * SUP/Aktivität: Erkennung + Places-Query (RN-frei).
 */

export type ActivityKind =
  | 'spikeball'
  | 'bouldering'
  | 'surf'
  | 'sup'
  | 'beach_ball'
  | 'generic_sport';

const ACTIVITY_RE =
  /\b(spikeball|bouldern|boulderhalle|bungee|surf(?:en|kurs)?|kitesurf|sup\b|stand[-\s]?up(?:[-\s]?paddle|[-\s]?pedal)?|paddle(?:n|board)?|paddeln|beachvolleyball|beach[-\s]?volley|inline|joggen|wandern|klettern|paragliding|rafting|tauchen|golf|tennis|paintball|skatepark|hochseil)\b/iu;

const WATER_BODY_RE =
  /\b(Alster|Elbe|Außenalster|Aussenalster|Binnenalster|Förde|Foerde|Ostsee|Nordsee|Spree|Rhein|Main)\b/iu;

/**
 * STT-Garbling → SUP (Centerpanel/Stellappell/Sub+Verleih).
 * Struktur bleibt; kein Dialog-Skript.
 */
export function normalizeActivityUtterance(text: string): string {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  t = t.replace(/\bcenter[\s-]*panel\b/giu, 'SUP');
  t = t.replace(/\bstell[\s-]*appell\b/giu, 'SUP');
  t = t.replace(/\bstand[\s-]*up[\s-]*pedal(?:n|ing)?\b/giu, 'Stand-up-Paddeln');
  // „Sub Verleih“ / „Sub auf der Alster“ — nicht U-Bahn
  if (
    /\bsub\b/iu.test(t) &&
    /\b(verleih|ausleihen|paddel|paddle|alster|elbe|wasser|board|fahren)\b/iu.test(
      t,
    )
  ) {
    t = t.replace(/\bsub\b/giu, 'SUP');
  }
  return t;
}

export function isActivitySportQuery(text: string): boolean {
  const t = normalizeActivityUtterance(text);
  if (ACTIVITY_RE.test(t)) return true;
  if (
    WATER_BODY_RE.test(t) &&
    /\b(fahren|verleih|ausleihen|mieten|wo\s+kann|darf\s+man|board)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

export function detectActivityKind(text: string): ActivityKind {
  const t = normalizeActivityUtterance(text).toLowerCase();
  if (/\bspikeball\b/u.test(t)) return 'spikeball';
  if (/\bbouldern|boulderhalle\b/u.test(t)) return 'bouldering';
  if (
    /\bkitesurf|surf(?:en|kurs)?\b/u.test(t) &&
    !/\bstand[-\s]?up|sup\b|paddle|paddel/u.test(t)
  ) {
    return 'surf';
  }
  if (
    /\bsup\b|stand[-\s]?up|paddle\s*board|paddeln|\bpaddle|\bpaddel/u.test(t)
  ) {
    return 'sup';
  }
  if (
    WATER_BODY_RE.test(t) &&
    /\b(fahren|verleih|ausleihen|mieten|wo\s+kann|darf\s+man|board)\b/u.test(t)
  ) {
    return 'sup';
  }
  if (/\bbeachvolleyball|beach[-\s]?volley\b/u.test(t)) return 'beach_ball';
  return 'generic_sport';
}

export function wantsFreeParking(text: string): boolean {
  return /\b(kostenlos(?:er)?\s+park|gratis\s+park|freier\s+parkplatz|ohne\s+parken\s+zu\s+zahlen)\b/iu.test(
    text,
  );
}

/** Genannter Ort (z. B. Laboe) — keine Scripts, nur Extraktion. */
export function extractNamedActivityPlace(text: string): string | null {
  const raw = normalizeActivityUtterance(text);
  const waterBare = raw.match(WATER_BODY_RE);
  if (waterBare?.[1]) return waterBare[1].trim().slice(0, 48);

  const water = raw.match(
    /\b(?:auf\s+der|an\s+der|an\s+die|zur|zum)\s+(Alster|Elbe|Außenalster|Aussenalster|Binnenalster|Förde|Foerde|Ostsee|Nordsee|Spree|Rhein|Main)\b/iu,
  );
  if (water?.[1]) return water[1].trim().slice(0, 48);

  const m = raw.match(
    /\b(?:in|nach|bei|Richtung|auf\s+der|an\s+der|an\s+die)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]{2,})?)/u,
  );
  if (!m?.[1]) return null;
  const name = m[1].trim();
  if (
    /^(Heute|Morgen|Abend|Strand|Park|Ostsee|Nordsee|Deutschland)$/i.test(name)
  ) {
    return null;
  }
  return name.slice(0, 48);
}

/** Wasser → Stadt für Places-Bias (Alster ≠ Heimat-GPS). */
export function cityBiasForNamed(
  named: string | null,
  cityHint: string | null,
): string | null {
  if (named && /\balster\b/iu.test(named)) return 'Hamburg';
  if (named && /\belbe\b/iu.test(named) && !cityHint) return 'Hamburg';
  if (named && /\b(förde|foerde)\b/iu.test(named) && !cityHint) return 'Kiel';
  return cityHint?.trim() || null;
}

export function scoreSupRentalHit(name: string): number {
  const n = (name || '').toLowerCase();
  let s = 0;
  if (/\b(verleih|vermiet|rental|hire|miete)\b/u.test(n)) s += 6;
  if (/\bsup\b|stand[\s-]?up|paddle|paddel/u.test(n)) s += 6;
  if (/\b(wassersport|surf|kanu|kajak|boot)\b/u.test(n)) s += 2;
  if (
    /\b(restaurant|café|cafe|bistro|hotel|pension|museum|kirche|feuerwehr|heimatverein)\b/u.test(
      n,
    )
  ) {
    s -= 5;
  }
  return s;
}

export function rankSupPlaces<T extends { name: string }>(places: T[]): T[] {
  return [...places].sort(
    (a, b) => scoreSupRentalHit(b.name) - scoreSupRentalHit(a.name),
  );
}

function queryForKind(
  kind: ActivityKind,
  named: string | null,
  cityHint: string | null,
): string {
  const bias = cityBiasForNamed(named, cityHint);
  const where = [
    named,
    bias && named && !new RegExp(bias, 'i').test(named)
      ? bias
      : !named
        ? bias
        : null,
  ]
    .filter(Boolean)
    .join(' ');
  switch (kind) {
    case 'spikeball':
    case 'beach_ball':
      return `Strand ${where || cityHint || ''}`.trim();
    case 'bouldering':
      return `Boulderhalle ${where || cityHint || ''}`.trim();
    case 'surf':
      return `Surfschule Strand ${where || cityHint || ''}`.trim();
    case 'sup':
      return `SUP Verleih ${where || bias || cityHint || ''}`
        .trim()
        .replace(/\s+/g, ' ');
    default:
      return `Sport ${where || cityHint || ''}`.trim();
  }
}

export function altQueryForKind(
  kind: ActivityKind,
  named: string | null,
  cityHint: string | null,
): string {
  const bias = cityBiasForNamed(named, cityHint);
  const where = [named, bias].filter(Boolean).join(' ') || cityHint || '';
  if (kind === 'sup') {
    return `Stand Up Paddle Verleih ${where}`.trim().replace(/\s+/g, ' ');
  }
  if (kind === 'spikeball' || kind === 'beach_ball' || kind === 'surf') {
    return `Strand Surfer ${where}`.trim();
  }
  if (kind === 'bouldering') return `Kletterhalle ${where}`.trim();
  return `Park Sportplatz ${where}`.trim();
}

/** Places-Query hart: „SUP Verleih …“ — nie nur Sport/Gewässer. */
export function buildActivityPlacesQuery(
  kind: ActivityKind,
  named: string | null,
  cityHint: string | null,
): string {
  return queryForKind(kind, named, cityHint);
}

export { queryForKind };
