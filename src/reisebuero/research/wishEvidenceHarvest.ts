/**
 * Magazin-Wish-Ernte: Nearby-POI Name/Distanz/Foto/Editorial (+ Plätze/Preis nur belegt).
 * Tour/Stadion/Sight wenn im Brief.
 */

import type { MustHaveId, ReiseLedger } from '../types';
import type { AmenityVerifyHit } from './stayMustVerify';
import { fetchWikiThumb } from './wikiThumb';
import { searchOsmPhotoNearby } from './osmPlacePhoto';
import { wishPhotoWikiTitles } from './wishBookLink';
import { SAME_CITY_WISH_POI_KM, kmBetween } from './sameCity';
import { parseCostRange } from './wishPrice';

export type WishEvidence = {
  mustHaveId: string;
  name?: string | null;
  distanceM?: number | null;
  /**
   * Nur bei `stay` km anzeigen („von der Unterkunft“).
   * `city` = Suche um Ortsmitte — Distanz nicht als Stay-Entfernung verkaufen.
   */
  distanceAnchor?: 'stay' | 'city' | null;
  photoUrl?: string | null;
  /** Places editorialSummary / generative — nur belegt. */
  editorial?: string | null;
  /** z. B. „8 Plätze“ — nur aus Treffer-Text. */
  courtHint?: string | null;
  /** z. B. „15€“ — nur wenn im Treffer belegt, nie erfunden. */
  costHint?: string | null;
  /** OSM-Website oder Ticket-Suche, wenn belegt. */
  bookUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  met: boolean;
  onProperty: boolean;
  detail?: string | null;
};

type NearbySpec = {
  id: MustHaveId;
  textQuery: string;
  placeType?: string;
  radiusM: number;
};

const NEARBY_MUSTS: NearbySpec[] = [
  { id: 'padel', textQuery: 'padel court', radiusM: 8000 },
  { id: 'tennis', textQuery: 'tennis court', placeType: 'athletic_field', radiusM: 8000 },
  { id: 'sand', textQuery: 'beach', radiusM: 12000 },
  { id: 'sea', textQuery: 'beach seaside', radiusM: 12000 },
  { id: 'boat', textQuery: 'boat rental marina', radiusM: 10000 },
  { id: 'spikeball', textQuery: 'beach volleyball', radiusM: 6000 },
];

/** Extra Magazin-POIs aus Highlight/Purpose (Tour, Stadion, Sight). */
export type BriefExtraNearby = {
  id: 'stadium' | 'tour' | 'sight' | 'club' | 'concert' | 'museum';
  textQuery: string;
  placeType?: string;
  radiusM: number;
  title: string;
};

function briefBlob(ledger: ReiseLedger): string {
  return [
    ledger.highlightWant?.value,
    ledger.extraWishes?.value,
    ledger.purpose?.value,
    ledger.ideaHook?.value,
    ledger.tripShape?.value,
    ...(ledger.mustActivities?.value ?? []),
    ...(ledger.intentNotes?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

/** Tour/Stadion/Sight nur wenn der Brief danach ruft. */
export function extraNearbyFromLedger(ledger: ReiseLedger): BriefExtraNearby[] {
  const blob = briefBlob(ledger);
  const out: BriefExtraNearby[] = [];
  if (
    /\bstadion|arena|fu[sß]ball(?:spiel)?|match|heimspiel|bundesliga\b/i.test(blob) ||
    (ledger.mustActivities?.value ?? []).some((a) => /\bstadion|arena|fu[sß]ball\b/i.test(a))
  ) {
    out.push({
      id: 'stadium',
      textQuery: 'stadium arena football',
      placeType: 'stadium',
      radiusM: 15000,
      title: 'Stadion',
    });
  }
  if (
    /\b(gef[uü]hrte\s+)?tour|bootsfahrt|guided|ausflug|kanutour|bootstour|stadtf[uü]hrung\b/i.test(
      blob,
    ) ||
    ledger.tripShape?.value === 'tour'
  ) {
    out.push({
      id: 'tour',
      textQuery: 'guided tour sightseeing boat tour',
      radiusM: 12000,
      title: 'Tour',
    });
  }
  if (
    /\bsehensw[uü]rdig|sightseeing|aussicht|wahrzeichen|kirche|schloss|altstadt|landmark\b/i.test(
      blob,
    )
  ) {
    out.push({
      id: 'sight',
      textQuery: 'sightseeing landmark viewpoint',
      placeType: 'tourist_attraction',
      radiusM: 12000,
      title: 'Sehenswürdigkeit',
    });
  }
  if (/\bmuseum|ausstellung|galerie\b/i.test(blob) || (ledger.mustActivities?.value ?? []).some((a) => /museum/i.test(a))) {
    out.push({
      id: 'museum',
      textQuery: 'museum exhibition gallery',
      placeType: 'museum',
      radiusM: 12000,
      title: 'Museum',
    });
  }
  const wantsParty =
    (ledger.mustHaves?.value ?? []).includes('party') ||
    (ledger.wishHaves?.value ?? []).includes('party') ||
    /\bparty|nightlife|feier|ausgehen\b/i.test(blob);
  const grain = ledger.partyGrain?.value;
  if (
    wantsParty ||
    /\b(night)?clubs?|disco|nachtclub|discothek\b/i.test(blob) ||
    grain === 'clubs' ||
    grain === 'bars' ||
    grain === 'egal' ||
    /club/i.test(String(ledger.partyStyle?.value || ''))
  ) {
    // Private-Haus-Party: keine Club-Suche
    if (grain !== 'private_house') {
      out.push({
        id: 'club',
        textQuery: 'nightclub disco club',
        placeType: 'night_club',
        radiusM: 8000,
        title: 'Club',
      });
    }
  }
  if (
    /\b(konzert|festival|hellfest|open\s*air|live\s*musik|gig)\b/i.test(blob) ||
    (ledger.mustActivities?.value ?? []).some((a) => /konzert|festival|hellfest/i.test(a))
  ) {
    out.push({
      id: 'concert',
      textQuery: 'concert festival live music venue',
      placeType: 'performing_arts_theater',
      radiusM: 20000,
      title: 'Konzert',
    });
  }
  return out.slice(0, 5);
}

const ON_PROPERTY: MustHaveId[] = [
  'pool',
  'grill',
  'spa',
  'sauna',
  'massage',
  'view',
  'quiet',
  'parking',
  'breakfast',
  'half_board',
];

function wishIds(ledger: ReiseLedger): MustHaveId[] {
  const seen = new Set<string>();
  const out: MustHaveId[] = [];
  for (const id of [
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function formatDist(m: number): string {
  if (m < 1000) return `${m} m`;
  const km = (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace(/\.0$/, '');
  return `${km.replace('.', ',')} km`;
}

/** Plätze/Courts aus Name/Detail — nur belegt. */
export function parseCourtHint(text: string): string | null {
  const m = text.match(
    /(\d{1,2})\s*(?:×\s*)?(?:padel[-\s]?)?(?:plätze|platze|courts?|felder|fields?|canchas?)\b/i,
  );
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!(n >= 1 && n <= 40)) return null;
  return `${n} Plätze`;
}

/** Preis nur wenn klar im Text (nie schätzen) — Spanne → „von … bis …“. */
export function parseCostHint(text: string): string | null {
  return parseCostRange(text).label;
}

function mapsKey(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { env } = require('../../config/env') as {
      env: { get: (k: string) => string };
    };
    return (
      env.get('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ||
      env.get('EXPO_PUBLIC_GOOGLE_API_KEY') ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

type PhotoHit = {
  placeId: string | null;
  name: string;
  distM: number;
  lat: number;
  lng: number;
  photoUrl: string | null;
  editorial: string | null;
  blob: string;
  website?: string | null;
};

const SAME_CITY_POI_M = SAME_CITY_WISH_POI_KM * 1000;

function keepNearbyHit(
  origin: { lat: number; lng: number },
  hit: PhotoHit | null,
  radiusM: number,
): PhotoHit | null {
  if (!hit) return null;
  const cap = Math.min(radiusM * 1.25, SAME_CITY_POI_M);
  if (hit.distM > cap) return null;
  if (kmBetween(origin, { lat: hit.lat, lng: hit.lng }) > SAME_CITY_WISH_POI_KM) return null;
  return hit;
}

function hitScore(h: PhotoHit): number {
  return (h.photoUrl ? 80_000 : 0) + (h.editorial ? 40_000 : 0) - h.distM;
}

function clipEditorial(text: string | null | undefined, max = 220): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 24) return null;
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

async function enrichPlaceDetails(
  placeId: string | null,
  key: string,
  base: PhotoHit,
): Promise<PhotoHit> {
  if (!placeId || !key) return base;
  const resource = placeId.startsWith('places/') ? placeId : `places/${placeId}`;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/${resource}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'id,displayName,editorialSummary,generativeSummary,reviews,photos',
        'Accept-Language': 'de',
      },
    });
    if (!res.ok) return base;
    const r = (await res.json()) as {
      editorialSummary?: { text?: string };
      generativeSummary?: { overview?: { text?: string } };
      reviews?: Array<{ text?: { text?: string } }>;
      photos?: Array<{ name?: string }>;
    };
    const reviewBits = (r.reviews ?? [])
      .map((x) => (x.text?.text || '').trim())
      .filter((t) => t.length > 20)
      .slice(0, 5)
      .join(' ');
    const editorial =
      clipEditorial(r.editorialSummary?.text) ||
      clipEditorial(r.generativeSummary?.overview?.text) ||
      base.editorial;
    const blob = `${base.blob} ${editorial || ''} ${reviewBits}`.replace(/\s+/g, ' ').trim();
    let photoUrl = base.photoUrl;
    if (!photoUrl && r.photos?.[0]?.name) {
      photoUrl = `https://places.googleapis.com/v1/${r.photos[0].name}/media?maxHeightPx=900&key=${encodeURIComponent(key)}`;
    }
    return { ...base, blob, photoUrl, editorial };
  } catch {
    return base;
  }
}

function osmKindForWish(id: string): string {
  const k = id.toLowerCase();
  if (k === 'club') return 'nightclub';
  if (k === 'sand' || k === 'sea') return 'beach';
  if (k === 'padel' || k === 'tennis') return k;
  if (k === 'stadium') return 'stadium';
  if (k === 'tour' || k === 'sight') return 'attraction';
  return 'attraction';
}

/** OSM zuerst (€0), Wiki/Web, Google Places nur wenn OSM leer. */
async function searchWishHit(opts: {
  lat: number;
  lng: number;
  query: string;
  radiusM: number;
  includedType?: string;
  kind: string;
  nameHint?: string | null;
}): Promise<PhotoHit | null> {
  try {
    const osm = await searchOsmPhotoNearby({
      lat: opts.lat,
      lng: opts.lng,
      kind: osmKindForWish(opts.kind),
      radiusM: opts.radiusM,
      nameHint: opts.nameHint || opts.query,
    });
    if (osm) {
      let photoUrl = osm.photoUrl;
      if (!photoUrl) {
        const titles = [osm.wikipedia, osm.name].filter(Boolean) as string[];
        if (titles[0]) photoUrl = await fetchWikiThumb(titles[0], titles.slice(1));
      }
      const kept = keepNearbyHit(
        { lat: opts.lat, lng: opts.lng },
        {
          placeId: null,
          name: osm.name,
          distM: osm.distM,
          lat: osm.lat,
          lng: osm.lng,
          photoUrl,
          editorial: null,
          blob: osm.name,
          website: osm.website,
        },
        opts.radiusM,
      );
      if (kept) return kept;
    }
  } catch {
    /* Maps zuletzt */
  }
  const maps = await searchNearbyPhotoHit({
    lat: opts.lat,
    lng: opts.lng,
    query: opts.query,
    radiusM: opts.radiusM,
    includedType: opts.includedType,
  });
  return keepNearbyHit({ lat: opts.lat, lng: opts.lng }, maps, opts.radiusM);
}
async function searchNearbyPhotoHit(opts: {
  lat: number;
  lng: number;
  query: string;
  radiusM: number;
  includedType?: string;
}): Promise<PhotoHit | null> {
  const key = mapsKey();
  if (!key) return null;
  try {
    const body: Record<string, unknown> = {
      textQuery: opts.query,
      maxResultCount: 8,
      languageCode: 'de',
      locationBias: {
        circle: {
          center: { latitude: opts.lat, longitude: opts.lng },
          radius: Math.min(opts.radiusM, 15000),
        },
      },
    };
    if (opts.includedType) body.includedType = opts.includedType;
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.location,places.photos,places.types,places.editorialSummary',
        'Accept-Language': 'de',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        location?: { latitude?: number; longitude?: number };
        photos?: Array<{ name?: string }>;
        types?: string[];
        editorialSummary?: { text?: string };
      }>;
    };
    let best: PhotoHit | null = null;
    for (const p of data.places ?? []) {
      const lat = p.location?.latitude;
      const lng = p.location?.longitude;
      if (lat == null || lng == null) continue;
      const distM = Math.round(haversineM({ lat: opts.lat, lng: opts.lng }, { lat, lng }));
      if (distM > SAME_CITY_POI_M) continue;
      const name = (p.displayName?.text || opts.query).trim();
      const photoName = p.photos?.[0]?.name;
      let photoUrl: string | null = null;
      if (photoName) {
        photoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=900&key=${encodeURIComponent(key)}`;
      }
      const editorial = clipEditorial(p.editorialSummary?.text);
      const blob = `${name} ${editorial || ''} ${(p.types ?? []).join(' ')}`;
      const cand: PhotoHit = {
        placeId: p.id || null,
        name,
        distM,
        lat,
        lng,
        photoUrl,
        editorial,
        blob,
      };
      if (!best || hitScore(cand) > hitScore(best)) best = cand;
    }
    if (!best) return null;
    if (
      !best.photoUrl ||
      !best.editorial ||
      !parseCourtHint(best.blob) ||
      !parseCostHint(best.blob)
    ) {
      return enrichPlaceDetails(best.placeId, key, best);
    }
    return best;
  } catch {
    return null;
  }
}

async function photoFallbacks(
  primary: string | null,
  poiNames: string[],
  kind: string,
): Promise<string | null> {
  if (primary) return primary;
  for (const n of poiNames) {
    const t = n.trim();
    if (t.length < 4) continue;
    const w = await fetchWikiThumb(t);
    if (w) return w;
  }
  const beats = wishPhotoWikiTitles(kind);
  if (!beats.length) return null;
  return fetchWikiThumb(beats[0]!, beats.slice(1));
}

function evidenceFromHit(
  mustHaveId: string,
  nearby: PhotoHit | null,
  photoUrl: string | null,
  radiusM: number,
  fallbackName?: string,
): WishEvidence {
  const blob = nearby ? `${nearby.name} ${nearby.blob}` : '';
  return {
    mustHaveId,
    name: nearby?.name ?? fallbackName ?? null,
    distanceM: nearby?.distM ?? null,
    lat: nearby?.lat ?? null,
    lng: nearby?.lng ?? null,
    photoUrl,
    editorial: nearby?.editorial ?? null,
    courtHint: nearby ? parseCourtHint(blob) : null,
    costHint: nearby ? parseCostHint(blob) : null,
    bookUrl: nearby?.website || null,
    met: Boolean(nearby && nearby.distM <= radiusM * 1.25),
    onProperty: false,
    detail: nearby
      ? [nearby.name, formatDist(nearby.distM), nearby.editorial?.slice(0, 80)]
          .filter(Boolean)
          .join(' · ')
      : fallbackName || 'kein Nearby-Treffer',
  };
}

export async function harvestWishEvidence(opts: {
  lat: number;
  lng: number;
  placeName: string;
  stayPhotoUrl?: string | null;
  stayAmenities?: string;
  /** Stay-Name — oft der einzige Pool-/Spa-Beleg wenn Amenities leer. */
  stayName?: string | null;
  ledger: ReiseLedger;
  amenityHits?: AmenityVerifyHit[];
  /** Default city — nur 'stay' wenn GPS der gewählten Unterkunft. */
  distanceAnchor?: 'stay' | 'city';
}): Promise<WishEvidence[]> {
  const ids = wishIds(opts.ledger);
  const extras = extraNearbyFromLedger(opts.ledger);
  const acts = (opts.ledger.mustActivities?.value ?? []).filter((a) => a.trim());
  if (!ids.length && !extras.length && !acts.length) return [];
  const distanceAnchor = opts.distanceAnchor === 'stay' ? 'stay' : 'city';

  const amenBy = new Map((opts.amenityHits ?? []).map((h) => [h.id, h]));
  const amenBlob = (opts.stayAmenities || '').toLowerCase();
  const out: WishEvidence[] = [];

  // Stay-Name oft der einzige Pool-Beleg (Hotellook-Amenities leer)
  const stayNameBlob = String(opts.stayName || '').toLowerCase();
  const amenOrName = `${amenBlob} ${stayNameBlob}`.trim();

  for (const id of ids) {
    if (!ON_PROPERTY.includes(id)) continue;
    const hit = amenBy.get(id);
    const met =
      hit?.status === 'perfect' ||
      hit?.status === 'near' ||
      (AMENITY_WORD[id] ? AMENITY_WORD[id]!.test(amenOrName) : false);
    out.push({
      mustHaveId: id,
      name: null,
      distanceM: null,
      photoUrl: opts.stayPhotoUrl || null,
      editorial: null,
      met,
      onProperty: true,
      detail: hit?.detail || (met ? 'am Stay' : null),
      courtHint: null,
      costHint: null,
    });
  }

  const nearbyIds = ids.filter((id) => NEARBY_MUSTS.some((s) => s.id === id));
  const nearbyHits = await Promise.all(
    nearbyIds.map(async (id) => {
      const spec = NEARBY_MUSTS.find((s) => s.id === id)!;
      const nearby = await searchWishHit({
        lat: opts.lat,
        lng: opts.lng,
        query: `${spec.textQuery} ${opts.placeName}`,
        radiusM: spec.radiusM,
        includedType: spec.placeType,
        kind: id,
        nameHint: spec.textQuery,
      });
      const photoUrl = await photoFallbacks(
        nearby?.photoUrl || null,
        [nearby?.name || ''].filter(Boolean),
        id,
      );
      return evidenceFromHit(id, nearby, photoUrl, spec.radiusM);
    }),
  );
  out.push(...nearbyHits);

  // Keine unmet-Stubs für Tag-/Vibe-Wünsche (party, warm, …):
  // die würden in buildWishChapters fact.met mit `false ?? …` totschlagen.
  // Nur echte Amenity-Hits als Evidence pushen.
  for (const id of ids) {
    if (ON_PROPERTY.includes(id)) continue;
    if (NEARBY_MUSTS.some((s) => s.id === id)) continue;
    if (amenBy.get(id)?.status === 'perfect') {
      out.push({
        mustHaveId: id,
        photoUrl: null,
        editorial: null,
        met: true,
        onProperty: false,
        detail: amenBy.get(id)?.detail || null,
      });
    }
  }

  const actHits = await Promise.all(
    acts.slice(0, 4).map(async (act) => {
      const t = act.trim();
      const nearby = await searchWishHit({
        lat: opts.lat,
        lng: opts.lng,
        query: `${t} ${opts.placeName}`,
        radiusM: 12000,
        kind: /club|disco|party/i.test(t) ? 'club' : 'activity',
        nameHint: t,
      });
      const photoUrl = await photoFallbacks(
        nearby?.photoUrl || null,
        nearby?.name ? [nearby.name] : [],
        /club|disco|party/i.test(t) ? 'club' : 'activity',
      );
      return evidenceFromHit('activity', nearby, photoUrl, 12000, t);
    }),
  );
  out.push(...actHits);

  const extraHits = await Promise.all(
    extras.map(async (extra) => {
      const nearby = await searchWishHit({
        lat: opts.lat,
        lng: opts.lng,
        query: `${extra.textQuery} ${opts.placeName}`,
        radiusM: extra.radiusM,
        includedType: extra.placeType,
        kind: extra.id,
        nameHint: extra.title,
      });
      const photoUrl = await photoFallbacks(
        nearby?.photoUrl || null,
        nearby?.name ? [nearby.name] : [],
        extra.id,
      );
      if (!nearby) {
        return {
          mustHaveId: extra.id,
          name: extra.title,
          distanceM: null,
          photoUrl,
          editorial: null,
          courtHint: null,
          costHint: null,
          bookUrl: null,
          met: false,
          onProperty: false as const,
          detail: `${extra.title} aus Brief — Nearby noch offen`,
        } satisfies WishEvidence;
      }
      return evidenceFromHit(extra.id, nearby, photoUrl, extra.radiusM, extra.title);
    }),
  );
  out.push(...extraHits);

  return out.map((e) =>
    e.onProperty
      ? e
      : {
          ...e,
          distanceAnchor,
        },
  );
}

const AMENITY_WORD: Partial<Record<MustHaveId, RegExp>> = {
  pool: /pool|schwimm/,
  grill: /grill|bbq|barbecue/,
  spa: /spa|wellness/,
  sauna: /sauna/,
  massage: /massage/,
  view: /view|ausblick|meerblickt|seaview/,
  quiet: /quiet|ruhig|peaceful/,
  parking: /parking|parkplatz/,
  breakfast: /breakfast|frühstück|fruehstueck/,
  half_board: /half\s*board|halbpension/,
};

export function formatWishDistanceHint(ev: WishEvidence): string | null {
  if (ev.onProperty) return 'an der Unterkunft';
  // km nur mit Unterkunft-Anker — sonst wirkt Stadtmitte wie Stay
  if (ev.distanceAnchor !== 'stay' || ev.distanceM == null) {
    return null;
  }
  // Nur Distanz — Name steht schon im Chapter-Titel (sonst 2× „Duplex“)
  return `${formatDist(ev.distanceM)} von der Unterkunft`;
}

/** Gleiche Venue (Duplex/Club) nicht als activity + club doppelt. */
export function sameWishVenueName(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normVenueKey(a);
  const nb = normVenueKey(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function normVenueKey(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function formatWishCostHint(ev: WishEvidence): string | null {
  const bits = [ev.courtHint, ev.costHint].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}

/** Editorial-Satz für Magazin-Blurb (gekürzt). */
export function formatWishEditorialBlurb(ev: WishEvidence, max = 160): string | null {
  return clipEditorial(ev.editorial, max);
}
