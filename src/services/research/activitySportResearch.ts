/**
 * Sport-/Strand-Aktivitäten (Spikeball, Bouldern, SUP…) —
 * Fit prüfen, Alternativen (Platz/Parken), keine Ortskern-Falschziele.
 */

import type { Module2ActionButton } from '../../module2/types';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import { searchPlacesByText } from '../navigation/googleMapsNav';
import { distanceMeters } from '../navigation/bearing';
import {
  altQueryForKind,
  cityBiasForNamed,
  detectActivityKind,
  extractNamedActivityPlace,
  normalizeActivityUtterance,
  queryForKind,
  rankSupPlaces,
  scoreSupRentalHit,
  wantsFreeParking,
  type ActivityKind,
} from './activitySportQuery';

export type { ActivityKind } from './activitySportQuery';
export {
  buildActivityPlacesQuery,
  detectActivityKind,
  extractNamedActivityPlace,
  isActivitySportQuery,
  normalizeActivityUtterance,
} from './activitySportQuery';

export type ActivitySpotHit = {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  websiteUri: string | null;
  role: 'primary' | 'alternative' | 'parking';
  fitNotes: string[];
  /** Belegter Verleih-Preis aus Website, z. B. „20 € / 2 Std.“ */
  priceLabel?: string | null;
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
  /** Belegter Verleih-Preis in € (primary), sonst null */
  priceEur?: number | null;
};

function formatDist(m: number): string {
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
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
  /** Prefetch: Venues/Buttons ohne Website-Preis-Wait (Call-3 nachziehen). */
  skipPriceFetch?: boolean;
}): Promise<ActivitySportResearchResult> {
  const userText = normalizeActivityUtterance(opts.userText);
  const kind = detectActivityKind(userText);
  const named = extractNamedActivityPlace(userText);
  const freePark = wantsFreeParking(userText);
  const city = cityBiasForNamed(named, opts.cityHint?.trim() || null);

  const primaryQ = queryForKind(kind, named, city);
  const altQ = altQueryForKind(kind, named, city);

  // Landmark/Stadt zuerst geocoden — nie am Heimat-GPS kleben (Alster ≠ Prisdorf)
  let searchLat = opts.lat;
  let searchLng = opts.lng;
  const geoQuery =
    named && city
      ? `${named} ${city}`
      : named || (city && !/\bhier\b/i.test(city) ? city : null);
  if (geoQuery) {
    try {
      const { geocodePlaceName } = require('../navigation/googleMapsNav') as {
        geocodePlaceName: (
          q: string,
          o?: { cityHint?: string | null },
        ) => Promise<{ lat: number; lng: number } | null>;
      };
      const geo = await geocodePlaceName(geoQuery, {
        cityHint: city || named,
      });
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        searchLat = geo.lat;
        searchLng = geo.lng;
      }
    } catch {
      /* soft */
    }
  }

  let primaryPlaces = await searchPlacesByText({
    query: primaryQ,
    lat: searchLat,
    lng: searchLng,
    radiusM: named || city ? 40_000 : 25_000,
  });
  if (opts.signal?.aborted) {
    return emptyResult(kind, freePark, named);
  }

  // SUP: Treffer nach Verleih/SUP-Namen ranken; bei schwachen Hits nochmal exakt
  if (kind === 'sup') {
    primaryPlaces = rankSupPlaces(primaryPlaces);
    const best = primaryPlaces[0];
    if (!best || scoreSupRentalHit(best.name) < 4) {
      const exactQ = `SUP Verleih ${[named, city].filter(Boolean).join(' ')}`
        .trim()
        .replace(/\s+/g, ' ');
      if (exactQ !== primaryQ) {
        const retry = await searchPlacesByText({
          query: exactQ,
          lat: searchLat,
          lng: searchLng,
          radiusM: 40_000,
        });
        if (retry.length) {
          primaryPlaces = rankSupPlaces(retry);
        }
      }
    }
  }

  // Wenn User Ort nennt und Treffer weit weg: nochmal mit Ortsname schärfer
  if (named && primaryPlaces[0]) {
    const d0 = distanceMeters(
      searchLat,
      searchLng,
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
      if (tighter.length) {
        primaryPlaces =
          kind === 'sup' ? rankSupPlaces(tighter) : tighter;
      }
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
      distanceMeters(searchLat, searchLng, p.lat, p.lng),
    ),
    websiteUri: p.websiteUri ?? null,
    role,
    fitNotes: notes,
    priceLabel: null,
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

  // Alternative: Spikeball/Crowding/Free-Park ODER SUP immer zweite Verleih-Option
  const needAlt =
    freePark ||
    kind === 'sup' ||
    (primary &&
      (kind === 'spikeball' || kind === 'beach_ball') &&
      (crowdedBeachHint(primary.name) ||
        (named != null && crowdedBeachHint(named))));

  if (needAlt) {
    let altPlaces = await searchPlacesByText({
      query: altQ,
      lat: primary?.lat ?? searchLat,
      lng: primary?.lng ?? searchLng,
      radiusM: 20_000,
    });
    if (kind === 'sup') altPlaces = rankSupPlaces(altPlaces);
    const alt = altPlaces.find(
      (p) =>
        !primary ||
        (p.name.toLowerCase() !== primary.name.toLowerCase() &&
          distanceMeters(p.lat, p.lng, primary.lat, primary.lng) > 400),
    );
    if (alt) {
      alternative = toHit(alt, 'alternative', [
        freePark
          ? 'eher Platz + Parken möglich'
          : kind === 'sup'
            ? 'zweite Verleih-Option'
            : 'mehr Fläche / ruhiger',
      ]);
    }
  }

  // Verleih-/Aktivitäts-Preise von Websites — generisch aus Evidence-Needs
  let wantPrice =
    kind === 'sup' || kind === 'surf' || kind === 'bouldering';
  try {
    const { deriveEvidenceNeeds, needsKey } = await import(
      '../../module2/evidence/evidenceNeeds'
    );
    const ev = deriveEvidenceNeeds({
      userText,
      jobId: 'activity_sport',
    });
    wantPrice = needsKey(ev, 'item_price') || wantPrice;
  } catch {
    /* soft */
  }
  if (
    wantPrice &&
    !opts.skipPriceFetch &&
    (primary?.websiteUri || alternative?.websiteUri)
  ) {
    try {
      const { fetchRentalPriceFromWebsite } = await import(
        './rentalPriceFromWebsite'
      );
      const [pPrice, aPrice] = await Promise.all([
        primary?.websiteUri
          ? fetchRentalPriceFromWebsite({
              url: primary.websiteUri,
              signal: opts.signal,
            })
          : Promise.resolve(null),
        alternative?.websiteUri
          ? fetchRentalPriceFromWebsite({
              url: alternative.websiteUri,
              signal: opts.signal,
            })
          : Promise.resolve(null),
      ]);
      if (primary && pPrice?.label) primary = { ...primary, priceLabel: pPrice.label };
      if (alternative && aPrice?.label) {
        alternative = { ...alternative, priceLabel: aPrice.label };
      }
    } catch {
      /* soft — Preis optional */
    }
  }

  // Parken am Primärziel
  if (primary && (freePark || /\bpark/i.test(userText))) {
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
    bullets.push(
      primary.priceLabel
        ? `${primary.name} · ${formatDist(primary.distanceM)} · ${primary.priceLabel}`
        : `${primary.name} · ${formatDist(primary.distanceM)}`,
    );
  }
  if (alternative) {
    bullets.push(
      alternative.priceLabel
        ? `Alt: ${alternative.name} · ${alternative.priceLabel}`
        : `Alt: ${alternative.name} · ${formatDist(alternative.distanceM)}`,
    );
  }
  if (parking && bullets.length < 3) {
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
  if (primary?.websiteUri && buttons.length < 4) {
    buttons.push({
      id: 'act_web_primary',
      label: shortenActionLabel(
        primary.priceLabel ? `💶 ${primary.priceLabel}` : '🌐 Preise',
      ),
      payload: { kind: 'deep_link', url: primary.websiteUri },
    });
  }
  if (alternative?.websiteUri && buttons.length < 4) {
    buttons.push({
      id: 'act_web_alt',
      label: shortenActionLabel('🌐 Alt Preise'),
      payload: { kind: 'deep_link', url: alternative.websiteUri },
    });
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
    const priceBit = primary.priceLabel
      ? ` — belegt etwa ${primary.priceLabel}`
      : '';
    spokenParts.push(
      `Für ${kindLabel} würde ich ${primary.name} nehmen` +
        priceBit +
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
    const altPrice = alternative.priceLabel
      ? ` (${alternative.priceLabel})`
      : '';
    spokenParts.push(
      freePark
        ? `Wenn Parken gratis wichtiger ist: ${alternative.name}${altPrice} als Alternative — oft entspannter und eher Platz.`
        : kind === 'sup'
          ? `Zweite Option: ${alternative.name}${altPrice}. Was klingt besser?`
          : `Ruhigere Alternative mit mehr Fläche: ${alternative.name}${altPrice}.`,
    );
  }
  if (parking && !freePark) {
    spokenParts.push(`Parken in der Nähe: ${parking.name}.`);
  } else if (freePark && !alternative && parking) {
    spokenParts.push(
      `Kostenlos ist am Zentrum oft schwierig — nächste Parkoption die ich finde: ${parking.name} (Kosten bitte vor Ort prüfen).`,
    );
  }

  const priceEur =
    primary?.priceLabel?.match(/(\d+[.,]?\d*)/)?.[1] != null
      ? Number(String(primary.priceLabel.match(/(\d+[.,]?\d*)/)?.[1]).replace(',', '.'))
      : null;

  const promptBlock = [
    `ACTIVITY_SPORT kind=${kind} named=${named ?? '—'} freeParking=${freePark}`,
    primary
      ? `PRIMARY: ${primary.name} (${formatDist(primary.distanceM)}) price=${primary.priceLabel ?? '—'} notes=${primary.fitNotes.join('; ')}`
      : 'PRIMARY: none',
    alternative
      ? `ALT: ${alternative.name} (${formatDist(alternative.distanceM)}) price=${alternative.priceLabel ?? '—'}`
      : 'ALT: none',
    parking ? `PARKING: ${parking.name}` : 'PARKING: none',
    'FLOW: klare Empfehlung vorne → Preis nur belegt → Fit/Platz → Alternative → Buttons. Nichts erfinden zu Preisen.',
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
    priceEur:
      priceEur != null && Number.isFinite(priceEur) ? priceEur : null,
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
