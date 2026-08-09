/**
 * Sport-/Strand-Aktivitäten (Spikeball, Bouldern, SUP…) —
 * Fit prüfen, Alternativen (Platz/Parken), keine Ortskern-Falschziele.
 */

import type { Module2ActionButton } from '../../module2/types';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import { searchPlacesByText } from '../navigation/googleMapsNav';
import { distanceMeters } from '../navigation/bearing';

export type ActivityKind =
  | 'spikeball'
  | 'bouldering'
  | 'surf'
  | 'sup'
  | 'beach_ball'
  | 'generic_sport';

export type ActivitySpotHit = {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  websiteUri: string | null;
  role: 'primary' | 'alternative' | 'parking';
  fitNotes: string[];
};

export type ActivitySportResearchResult = {
  kind: ActivityKind;
  wantsFreeParking: boolean;
  namedPlace: string | null;
  primary: ActivitySpotHit | null;
  alternative: ActivitySpotHit | null;
  parking: ActivitySpotHit | null;
  spokenDraft: string;
  bullets: string[];
  buttons: Module2ActionButton[];
  promptBlock: string;
  activityFit: boolean;
  alternativeOffered: boolean;
};

const ACTIVITY_RE =
  /\b(spikeball|bouldern|boulderhalle|bungee|surf(?:en|kurs)?|kitesurf|sup\b|stand[-\s]?up|beachvolleyball|beach[-\s]?volley|inline|joggen|wandern|klettern|paragliding|rafting|tauchen|golf|tennis|paintball|skatepark|hochseil)\b/iu;

export function isActivitySportQuery(text: string): boolean {
  return ACTIVITY_RE.test(text);
}

export function detectActivityKind(text: string): ActivityKind {
  const t = text.toLowerCase();
  if (/\bspikeball\b/u.test(t)) return 'spikeball';
  if (/\bbouldern|boulderhalle\b/u.test(t)) return 'bouldering';
  if (/\bkitesurf|surf(?:en|kurs)?\b/u.test(t)) return 'surf';
  if (/\bsup\b|stand[-\s]?up\b/u.test(t)) return 'sup';
  if (/\bbeachvolleyball|beach[-\s]?volley\b/u.test(t)) return 'beach_ball';
  return 'generic_sport';
}

function wantsFreeParking(text: string): boolean {
  return /\b(kostenlos(?:er)?\s+park|gratis\s+park|freier\s+parkplatz|ohne\s+parken\s+zu\s+zahlen)\b/iu.test(
    text,
  );
}

/** Genannter Ort (z. B. Laboe) — keine Scripts, nur Extraktion. */
export function extractNamedActivityPlace(text: string): string | null {
  const m = text.match(
    /\b(?:in|nach|bei|Richtung)\s+([A-ZÄÖÜ][\wÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]{2,})?)/u,
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

function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function queryForKind(
  kind: ActivityKind,
  named: string | null,
  cityHint: string | null,
): string {
  const where = named || cityHint || '';
  switch (kind) {
    case 'spikeball':
    case 'beach_ball':
      return `Strand ${where}`.trim();
    case 'bouldering':
      return `Boulderhalle ${where}`.trim();
    case 'surf':
      return `Surfschule Strand ${where}`.trim();
    case 'sup':
      return `SUP Verleih ${where}`.trim();
    default:
      return `Sport ${where}`.trim();
  }
}

function altQueryForKind(
  kind: ActivityKind,
  named: string | null,
  cityHint: string | null,
): string {
  const where = cityHint || named || '';
  if (kind === 'spikeball' || kind === 'beach_ball' || kind === 'surf' || kind === 'sup') {
    return `Strand Surfer ${where}`.trim();
  }
  if (kind === 'bouldering') return `Kletterhalle ${where}`.trim();
  return `Park Sportplatz ${where}`.trim();
}

/** Touristenstrände oft eng mit Strandkörben — für Spikeball eher Alternative anbieten. */
function crowdedBeachHint(name: string): boolean {
  return /\b(laboe|scharbeutz|timmendorfer|travemünde|travemuende|sankt\s+peter|wenningstedt|kampen|hörnum|hoernum)\b/iu.test(
    name,
  );
}

function navButton(
  id: string,
  label: string,
  hit: ActivitySpotHit,
): Module2ActionButton {
  return {
    id,
    label: shortenActionLabel(label),
    payload: {
      kind: 'navigate',
      lat: hit.lat,
      lng: hit.lng,
      label: hit.name,
    },
  };
}

export async function researchActivitySport(opts: {
  userText: string;
  lat: number;
  lng: number;
  cityHint?: string | null;
  signal?: AbortSignal;
}): Promise<ActivitySportResearchResult> {
  const kind = detectActivityKind(opts.userText);
  const named = extractNamedActivityPlace(opts.userText);
  const freePark = wantsFreeParking(opts.userText);
  const city = opts.cityHint?.trim() || null;

  const primaryQ = queryForKind(kind, named, city);
  const altQ = altQueryForKind(kind, named, city);

  let primaryPlaces = await searchPlacesByText({
    query: primaryQ,
    lat: opts.lat,
    lng: opts.lng,
    radiusM: 25_000,
  });
  if (opts.signal?.aborted) {
    return emptyResult(kind, freePark, named);
  }

  // Wenn User Ort nennt und Treffer weit weg: nochmal mit Ortsname schärfer
  if (named && primaryPlaces[0]) {
    const d0 = distanceMeters(
      opts.lat,
      opts.lng,
      primaryPlaces[0].lat,
      primaryPlaces[0].lng,
    );
    if (d0 > 40_000) {
      const tighter = await searchPlacesByText({
        query: primaryQ,
        lat: primaryPlaces[0].lat,
        lng: primaryPlaces[0].lng,
        radiusM: 8_000,
      });
      if (tighter.length) primaryPlaces = tighter;
    }
  }

  const toHit = (
    p: (typeof primaryPlaces)[0],
    role: ActivitySpotHit['role'],
    notes: string[],
  ): ActivitySpotHit => ({
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    distanceM: Math.round(
      distanceMeters(opts.lat, opts.lng, p.lat, p.lng),
    ),
    websiteUri: p.websiteUri ?? null,
    role,
    fitNotes: notes,
  });

  let primary: ActivitySpotHit | null = null;
  let alternative: ActivitySpotHit | null = null;
  let parking: ActivitySpotHit | null = null;

  const p0 = primaryPlaces[0];
  if (p0) {
    const notes: string[] = [];
    if (kind === 'spikeball' || kind === 'beach_ball') {
      notes.push('Strandfläche für Spikeball prüfen');
      if (crowdedBeachHint(p0.name) || (named && crowdedBeachHint(named))) {
        notes.push('oft eng mit Strandkörben — Fläche unsicher');
      }
    }
    primary = toHit(p0, 'primary', notes);
  }

  // Alternative wenn Spikeball + Crowding oder Free-Parking-Wunsch
  const needAlt =
    freePark ||
    (primary &&
      (kind === 'spikeball' || kind === 'beach_ball') &&
      (crowdedBeachHint(primary.name) ||
        (named != null && crowdedBeachHint(named))));

  if (needAlt) {
    const altPlaces = await searchPlacesByText({
      query: altQ,
      lat: primary?.lat ?? opts.lat,
      lng: primary?.lng ?? opts.lng,
      radiusM: 20_000,
    });
    const alt = altPlaces.find(
      (p) =>
        !primary ||
        distanceMeters(p.lat, p.lng, primary.lat, primary.lng) > 800,
    );
    if (alt) {
      alternative = toHit(alt, 'alternative', [
        freePark ? 'eher Platz + Parken möglich' : 'mehr Fläche / ruhiger',
      ]);
    }
  }

  // Parken am Primärziel
  if (primary && (freePark || /\bpark/i.test(opts.userText))) {
    const parkQ = freePark
      ? `Parkplatz kostenlos Strand ${named || primary.name}`
      : `Parkplatz ${primary.name}`;
    const parks = await searchPlacesByText({
      query: parkQ,
      lat: primary.lat,
      lng: primary.lng,
      radiusM: 5_000,
    });
    if (parks[0]) {
      parking = toHit(parks[0], 'parking', [
        freePark ? 'Parkoption prüfen (Kosten nur belegt)' : 'Parken in Nähe',
      ]);
    }
  }

  const activityFit = Boolean(primary);
  const alternativeOffered = Boolean(alternative);

  const bullets: string[] = [];
  if (primary) {
    bullets.push(`${primary.name} · ${formatDist(primary.distanceM)}`);
  }
  if (alternative) {
    bullets.push(`Alt: ${alternative.name} · ${formatDist(alternative.distanceM)}`);
  }
  if (parking) {
    bullets.push(`Parken: ${parking.name}`);
  }
  if (!bullets.length) bullets.push('Aktivitäts-Spot wird gesucht');

  const buttons: Module2ActionButton[] = [];
  if (primary) {
    buttons.push(navButton('act_primary', `📍 ${primary.name}`, primary));
  }
  if (alternative && buttons.length < 4) {
    buttons.push(navButton('act_alt', `📍 Alt ${alternative.name}`, alternative));
  }
  if (parking && buttons.length < 4) {
    buttons.push(navButton('act_park', '🅿️ Parken', parking));
  }

  const kindLabel =
    kind === 'spikeball'
      ? 'Spikeball'
      : kind === 'bouldering'
        ? 'Bouldern'
        : kind === 'surf'
          ? 'Surfen'
          : kind === 'sup'
            ? 'SUP'
            : 'Sport';

  const spokenParts: string[] = [];
  if (primary) {
    spokenParts.push(
      `Für ${kindLabel} würde ich ${primary.name} nehmen` +
        (primary.fitNotes.some((n) => /strandkörben/i.test(n))
          ? ' — dort kann es eng mit Strandkörben werden'
          : '') +
        '.',
    );
  } else {
    spokenParts.push(
      `Gerade finde ich keinen klaren ${kindLabel}-Spot in der Nähe — ich erweitere die Suche.`,
    );
  }
  if (alternative) {
    spokenParts.push(
      freePark
        ? `Wenn Parken gratis wichtiger ist: ${alternative.name} als Alternative — oft entspannter und eher Platz.`
        : `Ruhigere Alternative mit mehr Fläche: ${alternative.name}.`,
    );
  }
  if (parking && !freePark) {
    spokenParts.push(`Parken in der Nähe: ${parking.name}.`);
  } else if (freePark && !alternative && parking) {
    spokenParts.push(
      `Kostenlos ist am Zentrum oft schwierig — nächste Parkoption die ich finde: ${parking.name} (Kosten bitte vor Ort prüfen).`,
    );
  }

  const promptBlock = [
    `ACTIVITY_SPORT kind=${kind} named=${named ?? '—'} freeParking=${freePark}`,
    primary
      ? `PRIMARY: ${primary.name} (${formatDist(primary.distanceM)}) notes=${primary.fitNotes.join('; ')}`
      : 'PRIMARY: none',
    alternative
      ? `ALT: ${alternative.name} (${formatDist(alternative.distanceM)})`
      : 'ALT: none',
    parking ? `PARKING: ${parking.name}` : 'PARKING: none',
    'FLOW: klare Empfehlung vorne → Fit/Platz → Parken/Alternative → Buttons. Nichts erfinden zu Preisen.',
  ].join('\n');

  return {
    kind,
    wantsFreeParking: freePark,
    namedPlace: named,
    primary,
    alternative,
    parking,
    spokenDraft: spokenParts.join(' ').slice(0, 900),
    bullets: bullets.slice(0, 3),
    buttons: buttons.slice(0, 4),
    promptBlock,
    activityFit,
    alternativeOffered,
  };
}

function emptyResult(
  kind: ActivityKind,
  freePark: boolean,
  named: string | null,
): ActivitySportResearchResult {
  return {
    kind,
    wantsFreeParking: freePark,
    namedPlace: named,
    primary: null,
    alternative: null,
    parking: null,
    spokenDraft: 'Aktivitäts-Spot kommt gleich — kurz Geduld.',
    bullets: ['Suche läuft'],
    buttons: [],
    promptBlock: 'ACTIVITY_SPORT empty',
    activityFit: false,
    alternativeOffered: false,
  };
}
