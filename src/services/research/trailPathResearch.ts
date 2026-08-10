/**
 * Wanderwege & Fahrradwege — Vorschlag + Navigation zum Einstieg.
 * Auch ohne Zielname: Dauer („2 Stunden“) / Distanz („10 km“) → passender Ausflug.
 * Stadt-agnostisch: Pack-POIs zuerst, dann Live Places-Suche.
 * Nav = zum Einstieg / Wendepunkt (Punkt), nicht entlang einer GPX-Linie.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import type { Module2ActionButton } from '../../module2/types';
import { parseTagsJson } from '../geo/triggerPolicy';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import { searchPlacesExpanding } from '../navigation/expandingPlaceSearch';
import { searchPlacesByText } from '../navigation/googleMapsNav';
import type { DiscoveredPlace } from '../navigation/googleMapsNav';
import { getPlanBikeKmh, getPlanWalkKmh } from '../mobility/paceProfile';

export type TrailPathKind = 'hike' | 'bike';

export type OutdoorBudget = {
  /** Gesamte Aktivität (Hin+Zurück / Runde), Meter */
  totalDistanceM: number;
  /** Sinnvoller Wendepunkt / Hinweg, Meter */
  oneWayTargetM: number;
  /** Stunden falls genannt */
  hours: number | null;
  /** Explizit genannte km falls vorhanden */
  statedKm: number | null;
  source: 'distance' | 'duration' | 'mixed';
};

export type TrailPathHit = {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
  kind: TrailPathKind;
  source: 'pack' | 'maps';
  rating: number | null;
  websiteUri: string | null;
  /** Geschätzte Gesamtstrecke Hin+Zurück (2× Distanz zum Punkt) */
  roundTripM?: number;
  fitScore?: number;
};

export type TrailPathResearchResult = {
  kind: TrailPathKind;
  cityHint: string | null;
  budget: OutdoorBudget | null;
  trails: TrailPathHit[];
  /** Faktenblock für Synthese — nicht wörtlich vorlesen */
  promptBlock: string;
  buttons: Module2ActionButton[];
  bullets: string[];
  /** Sprechbarer Draft (keine Prompt-Meta) */
  spokenDraft: string;
};

const HIKE_RE =
  /\b(wander(?:weg|wege|ung|tour|gebiet)?|lehrpfad|uferweg|naturpfad|wandern|hiking|trail|spazier\w*|bummel\w*|laufen|joggen|rundgang)\b/iu;
const BIKE_RE =
  /\b(fahrradweg(?:e)?|radweg(?:e)?|radroute(?:n)?|radtour(?:en)?|fernradweg|veloroute|bike\s*path|cycle\s*path|radeln|fahrrad\s*tour|mit\s+dem\s+(?:fahrrad|rad)|e-?bike)\b/iu;

const OUTDOOR_MOTION_RE =
  /\b(unterwegs|raus|draußen|draussen|bewegung|tour|runde|ausflug|aktiv|luft\s*schnappen|frische\s*luft)\b/iu;

const WORD_HOURS: Record<string, number> = {
  ein: 1,
  eine: 1,
  '1': 1,
  zwei: 2,
  '2': 2,
  drei: 3,
  '3': 3,
  vier: 4,
  '4': 4,
  fünf: 5,
  fuenf: 5,
  '5': 5,
  sechs: 6,
  '6': 6,
  halbe: 0.5,
  halb: 0.5,
};

/** Fallback nur bis Pace-Profil hydratisiert — echte Werte aus paceProfile. */
const FALLBACK_PACE_KMH: Record<TrailPathKind, number> = {
  hike: 3.5,
  bike: 13,
};

function paceKmhForKind(kind: TrailPathKind): number {
  try {
    return kind === 'bike' ? getPlanBikeKmh() : getPlanWalkKmh();
  } catch {
    return FALLBACK_PACE_KMH[kind];
  }
}

function parseHoursFromText(t: string): number | null {
  const half = t.match(
    /\b(eine?\s+)?halbe\s*(?:stunde|std\.?|h)\b/i,
  );
  if (half) return 0.5;

  const word = t.match(
    /\b(ein(?:e)?|zwei|drei|vier|fünf|fuenf|sechs|halbe|halb|1|2|3|4|5|6)\s*(?:-|–)?\s*(?:stunden?|std\.?|h)\b/i,
  );
  if (word) {
    const key = word[1]!.toLowerCase();
    if (WORD_HOURS[key] != null) return WORD_HOURS[key]!;
  }
  const min = t.match(/\b(\d{2,3})\s*(?:min(?:uten)?)\b/i);
  if (min) {
    const m = Number(min[1]);
    if (Number.isFinite(m) && m > 0) return Math.max(0.25, m / 60);
  }
  const decimal = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:stunden?|std\.?|h)\b/i);
  if (decimal) {
    const h = Number(decimal[1]!.replace(',', '.'));
    if (Number.isFinite(h) && h > 0 && h <= 12) return h;
  }
  return null;
}

function parseKmFromText(t: string): number | null {
  const km = t.match(/\b(\d+(?:[.,]\d+)?)\s*km\b/i);
  if (km) {
    const v = Number(km[1]!.replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && v <= 120) return v;
  }
  const meters = t.match(/\b(\d{3,5})\s*m(?:eter)?\b/i);
  if (meters) {
    const m = Number(meters[1]);
    if (Number.isFinite(m) && m >= 500 && m <= 50_000) return m / 1000;
  }
  return null;
}

/**
 * Dauer/Distanz-Wunsch ohne festes Ziel:
 * „will 10 km unterwegs sein“, „2 Stunden wandern/radeln/spazieren“.
 */
export function parseOutdoorBudget(
  text: string,
  kind: TrailPathKind,
): OutdoorBudget | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const hours = parseHoursFromText(t);
  const statedKm = parseKmFromText(t);
  if (hours == null && statedKm == null) return null;

  const pace = paceKmhForKind(kind);
  let totalDistanceM: number;
  let source: OutdoorBudget['source'];

  if (statedKm != null && hours != null) {
    // Beide genannt → Distanz führt, Dauer als Kontext
    totalDistanceM = statedKm * 1000;
    source = 'mixed';
  } else if (statedKm != null) {
    totalDistanceM = statedKm * 1000;
    source = 'distance';
  } else {
    totalDistanceM = Math.round((hours as number) * pace * 1000);
    source = 'duration';
  }

  // Clamp sinnvolle Spanne
  const minM = kind === 'bike' ? 3_000 : 1_500;
  const maxM = kind === 'bike' ? 80_000 : 28_000;
  totalDistanceM = Math.max(minM, Math.min(maxM, totalDistanceM));

  return {
    totalDistanceM,
    oneWayTargetM: Math.round(totalDistanceM / 2),
    hours,
    statedKm,
    source,
  };
}

/** Reiner Outdoor-Budget-Wunsch (ohne zwingend „Wanderweg“-Wort). */
export function isOpenOutdoorBudgetQuery(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  const hours = parseHoursFromText(t);
  const km = parseKmFromText(t);
  if (hours == null && km == null) return false;

  // Kein Gastro/Hotel/Kino-Kapern
  if (
    /\b(restaurant|essen|hotel|zimmer|kino|film|flug|termin|meeting)\b/iu.test(t)
  ) {
    return false;
  }
  // Konkretes Ziel („10 km zum Bahnhof“) → mobility, kein freier Ausflug
  if (
    /\b(zum|zur|nach|Richtung)\s+\w+/iu.test(t) &&
    !/\b(wandern|radeln|spazier\w*|unterwegs|runde|tour)\b/iu.test(t)
  ) {
    return false;
  }

  if (HIKE_RE.test(t) || BIKE_RE.test(t) || OUTDOOR_MOTION_RE.test(t)) {
    return true;
  }
  // „will 10 km“ / „2 Stunden“ nur mit Outdoor-Kontext (nicht nackte Zahl)
  if (
    /\b(will|möcht|moecht|lust|brauch|suche|mach(?:en)?|geh(?:en)?|fahr(?:en)?)\b/iu.test(
      t,
    ) &&
    (hours != null || km != null) &&
    /\b(unterwegs|km|stunde|std|minuten|raus|draußen|draussen|runde|tour|ausflug)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** User will einen Weg / Ausflug vorgeschlagen / dahin navigiert bekommen. */
export function isTrailPathQuery(text: string): boolean {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (isOpenOutdoorBudgetQuery(t)) return true;

  if (BIKE_RE.test(t) || HIKE_RE.test(t)) {
    // Reine Infra-Frage ohne Vorschlagswunsch → kein Trail-Just-Do-It
    if (
      /\b(abstell|stellplatz|parken|schloss|reparatur|werkstatt|verleih|sharing)\b/iu.test(
        t,
      ) &&
      !/\b(weg|route|tour|pfad|wandern|radeln|unterwegs|km|stunde)\b/iu.test(t)
    ) {
      return false;
    }
    return true;
  }
  // „wo kann ich schön radeln / wandern“
  if (
    /\b(radeln|wandern|spazier\w*)\b/iu.test(t) &&
    /\b(wo|schön|schoen|gut|empfehl|vorschlag|nähe|naehe|hier|route|tour)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function detectTrailPathKind(text: string): TrailPathKind {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (BIKE_RE.test(t) && !HIKE_RE.test(t)) return 'bike';
  if (HIKE_RE.test(t) && !BIKE_RE.test(t)) return 'hike';
  if (BIKE_RE.test(t) && HIKE_RE.test(t)) {
    const bi = t.search(BIKE_RE);
    const hi = t.search(HIKE_RE);
    if (bi >= 0 && (hi < 0 || bi < hi)) return 'bike';
    return 'hike';
  }
  if (/\bradeln\b/iu.test(t)) return 'bike';

  // Nur km/Stunden: große Distanz eher Rad
  const km = parseKmFromText(t);
  if (km != null && km >= 15 && !HIKE_RE.test(t)) return 'bike';
  return 'hike';
}

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
}

function formatDurationHint(hours: number | null, totalM: number, kind: TrailPathKind): string {
  if (hours != null) {
    if (hours < 1) return `ca. ${Math.round(hours * 60)} Min`;
    if (Number.isInteger(hours)) return `ca. ${hours} Std`;
    return `ca. ${hours.toFixed(1).replace('.', ',')} Std`;
  }
  const pace = paceKmhForKind(kind);
  const h = totalM / 1000 / pace;
  if (h < 1) return `ca. ${Math.round(h * 60)} Min`;
  return `ca. ${h.toFixed(1).replace('.', ',')} Std`;
}

function shortTrailLabel(name: string): string {
  const t = name.replace(/\s+/g, ' ').trim();
  if (t.length <= 14) return t;
  return `${t.slice(0, 12).trim()}…`;
}

function isNoiseTrailName(name: string): boolean {
  return /\b(bahnhof|hauptbahnhof|parkplatz|parking|tankstelle|hotel|restaurant|pizzeria|mcdonald|supermarkt|apotheke)\b/i.test(
    name,
  );
}

function packLooksLikeTrail(
  category: string | null | undefined,
  name: string,
  tags: string[],
  kind: TrailPathKind,
): boolean {
  const blob = `${category ?? ''} ${name} ${tags.join(' ')}`.toLowerCase();
  if (kind === 'bike') {
    return (
      /\b(radweg|fahrradweg|radroute|radtour|veloroute|fernrad|bike\s*path|cycle|park|ufer|promenade|aussicht)\b/i.test(
        blob,
      ) ||
      category === 'radweg' ||
      tags.includes('radweg') ||
      tags.includes('fahrradweg')
    );
  }
  return (
    /\b(wanderung|wanderweg|lehrpfad|uferweg|naturpfad|wandern|trail|hopfenpfad|park|natur|aussicht|garten)\b/i.test(
      blob,
    ) ||
    category === 'wanderung' ||
    category === 'natur' ||
    category === 'park' ||
    category === 'aussicht' ||
    tags.includes('wanderung') ||
    tags.includes('wandern') ||
    tags.includes('wanderweg')
  );
}

function fitScoreForBudget(distanceM: number, oneWayTargetM: number): number {
  if (oneWayTargetM <= 0) return 0;
  const ratio = distanceM / oneWayTargetM;
  // Ideal: Wendepunkt bei ~50–110 % der Hinweg-Zielweite
  if (ratio >= 0.45 && ratio <= 1.15) return 100 - Math.abs(1 - ratio) * 40;
  if (ratio >= 0.3 && ratio <= 1.4) return 70 - Math.abs(1 - ratio) * 35;
  if (ratio >= 0.2 && ratio <= 1.8) return 40 - Math.abs(1 - ratio) * 20;
  return Math.max(0, 20 - Math.abs(distanceM - oneWayTargetM) / 500);
}

async function collectPackTrails(opts: {
  kind: TrailPathKind;
  lat: number;
  lng: number;
  boundM: number;
}): Promise<TrailPathHit[]> {
  let pois: Awaited<ReturnType<typeof getAllPois>> = [];
  try {
    pois = await getAllPois();
  } catch {
    return [];
  }
  const out: TrailPathHit[] = [];
  for (const p of pois) {
    if (p.kind === 'approach' || p.kind === 'sub') continue;
    if (isNoiseTrailName(p.name)) continue;
    const tags = parseTagsJson(p.tags_json);
    if (!packLooksLikeTrail(p.category, p.name, tags, opts.kind)) continue;
    const d = haversineMeters(opts.lat, opts.lng, p.lat, p.lng);
    if (d > opts.boundM) continue;
    out.push({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      distanceM: d,
      kind: opts.kind,
      source: 'pack',
      rating: null,
      websiteUri: null,
    });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out;
}

function pushMapsHit(
  hits: TrailPathHit[],
  seen: Set<string>,
  opts: { kind: TrailPathKind; lat: number; lng: number },
  h: Pick<
    DiscoveredPlace,
    'name' | 'lat' | 'lng' | 'rating' | 'websiteUri' | 'distanceM'
  >,
) {
  if (!h.name || isNoiseTrailName(h.name)) return;
  if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) return;
  const key = `${h.name.toLowerCase()}_${h.lat.toFixed(4)}_${h.lng.toFixed(4)}`;
  if (seen.has(key)) return;
  seen.add(key);
  hits.push({
    name: h.name,
    lat: h.lat,
    lng: h.lng,
    distanceM:
      typeof h.distanceM === 'number' && Number.isFinite(h.distanceM)
        ? h.distanceM
        : haversineMeters(opts.lat, opts.lng, h.lat, h.lng),
    kind: opts.kind,
    source: 'maps',
    rating: typeof h.rating === 'number' ? h.rating : null,
    websiteUri: h.websiteUri?.trim() || null,
  });
}

async function collectMapsTrails(opts: {
  kind: TrailPathKind;
  lat: number;
  lng: number;
  cityHint: string | null;
  budget: OutdoorBudget | null;
  signal?: AbortSignal;
}): Promise<TrailPathHit[]> {
  const city = (opts.cityHint || '').trim();
  const queries =
    opts.kind === 'bike'
      ? [
          city ? `Radweg Fahrradweg ${city}` : 'Radweg Fahrradweg',
          city ? `Radroute Fernradweg ${city}` : 'Radroute Veloroute',
          city ? `Aussichtspunkt Park ${city}` : 'Aussichtspunkt Park Ufer',
        ]
      : [
          city ? `Wanderweg Lehrpfad ${city}` : 'Wanderweg Lehrpfad',
          city ? `Uferweg Wandergebiet ${city}` : 'Uferweg Naturpfad',
          city ? `Park Aussichtspunkt ${city}` : 'Park Aussichtspunkt Spazierweg',
        ];

  const hits: TrailPathHit[] = [];
  const seen = new Set<string>();
  const ctx = { kind: opts.kind, lat: opts.lat, lng: opts.lng };
  const searchRadius = opts.budget
    ? Math.min(
        opts.kind === 'bike' ? 40_000 : 22_000,
        Math.max(opts.budget.oneWayTargetM * 1.6, 4_000),
      )
    : opts.kind === 'bike'
      ? 25_000
      : 18_000;

  try {
    const expanding = await searchPlacesExpanding({
      lat: opts.lat,
      lng: opts.lng,
      placeType: 'park',
      keyword: opts.kind === 'bike' ? 'Radweg' : 'Wanderweg',
      openNow: false,
      minResults: 2,
      rings: opts.budget
        ? [
            Math.max(1_500, Math.round(opts.budget.oneWayTargetM * 0.6)),
            Math.round(opts.budget.oneWayTargetM),
            Math.round(opts.budget.oneWayTargetM * 1.4),
            Math.min(searchRadius, Math.round(opts.budget.oneWayTargetM * 2)),
          ]
        : [3_000, 8_000, 15_000, 25_000],
    });
    for (const p of expanding.places) {
      pushMapsHit(hits, seen, ctx, p);
    }
  } catch {
    /* soft */
  }

  // Wendepunkt-Suche: Aussicht / Ufer / Park in Budget-Entfernung
  if (opts.budget) {
    try {
      const viewpoint = await searchPlacesExpanding({
        lat: opts.lat,
        lng: opts.lng,
        placeType: 'tourist_attraction',
        keyword: opts.kind === 'bike' ? 'Aussicht Radweg' : 'Aussicht Park Ufer',
        openNow: false,
        minResults: 2,
        rings: [
          Math.max(2_000, Math.round(opts.budget.oneWayTargetM * 0.7)),
          Math.round(opts.budget.oneWayTargetM * 1.1),
          Math.min(searchRadius, Math.round(opts.budget.oneWayTargetM * 1.6)),
        ],
      });
      for (const p of viewpoint.places) {
        pushMapsHit(hits, seen, ctx, p);
      }
    } catch {
      /* soft */
    }
  }

  for (const q of queries) {
    if (opts.signal?.aborted) break;
    try {
      const more = await searchPlacesByText({
        query: q,
        lat: opts.lat,
        lng: opts.lng,
        radiusM: searchRadius,
        includedType: null,
      });
      for (const h of more.slice(0, 8)) {
        pushMapsHit(hits, seen, ctx, h);
      }
    } catch {
      /* soft */
    }
    if (hits.length >= 6) break;
  }

  hits.sort((a, b) => {
    const ra = a.rating ?? 0;
    const rb = b.rating ?? 0;
    if (Math.abs(ra - rb) > 0.3) return rb - ra;
    return a.distanceM - b.distanceM;
  });
  return hits;
}

function mergeAndRankTrails(
  pack: TrailPathHit[],
  maps: TrailPathHit[],
  limit: number,
  budget: OutdoorBudget | null,
): TrailPathHit[] {
  const seen = new Set<string>();
  const out: TrailPathHit[] = [];
  const push = (t: TrailPathHit) => {
    const key = t.name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return;
    for (const e of out) {
      if (haversineMeters(e.lat, e.lng, t.lat, t.lng) < 120) return;
    }
    seen.add(key);
    const roundTripM = Math.round(t.distanceM * 2);
    const fit = budget
      ? fitScoreForBudget(t.distanceM, budget.oneWayTargetM)
      : 50;
    out.push({
      ...t,
      roundTripM,
      fitScore: fit + (t.source === 'pack' ? 8 : 0) + (t.rating ?? 0) * 2,
    });
  };
  for (const t of pack) push(t);
  for (const t of maps) push(t);

  if (budget) {
    out.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));
  } else {
    out.sort((a, b) => a.distanceM - b.distanceM);
  }
  return out.slice(0, limit);
}

export async function researchTrailPaths(opts: {
  userText: string;
  lat: number;
  lng: number;
  cityHint?: string | null;
  signal?: AbortSignal;
}): Promise<TrailPathResearchResult> {
  const kind = detectTrailPathKind(opts.userText);
  const cityHint = (opts.cityHint || '').trim() || null;
  const budget = parseOutdoorBudget(opts.userText, kind);
  const boundM = budget
    ? Math.min(
        kind === 'bike' ? 45_000 : 24_000,
        Math.max(budget.oneWayTargetM * 1.8, kind === 'bike' ? 8_000 : 5_000),
      )
    : kind === 'bike'
      ? 22_000
      : 16_000;

  const [pack, maps] = await Promise.all([
    collectPackTrails({
      kind,
      lat: opts.lat,
      lng: opts.lng,
      boundM,
    }),
    collectMapsTrails({
      kind,
      lat: opts.lat,
      lng: opts.lng,
      cityHint,
      budget,
      signal: opts.signal,
    }),
  ]);

  const trails = mergeAndRankTrails(pack, maps, budget ? 4 : 3, budget);
  const labelKind = kind === 'bike' ? 'Fahrradweg' : 'Wanderweg';
  const labelKindPl = kind === 'bike' ? 'Fahrradwege' : 'Wanderwege';
  const modeLabel = kind === 'bike' ? 'Rad' : 'Fuß';

  const bullets: string[] = [];
  if (budget) {
    bullets.push(
      `Budget ${formatDist(budget.totalDistanceM)} gesamt · ${formatDurationHint(budget.hours, budget.totalDistanceM, kind)}`,
    );
  }
  for (const t of trails.slice(0, budget ? 2 : 3)) {
    if (bullets.length >= 3) break;
    const rt =
      t.roundTripM != null
        ? ` · Runde ~${formatDist(t.roundTripM)}`
        : '';
    bullets.push(`${t.name} · hin ${formatDist(t.distanceM)}${rt}`);
  }
  if (!bullets.length) {
    bullets.push(`${labelKindPl} in der Umgebung werden geprüft`);
  }

  const buttons: Module2ActionButton[] = [];
  for (let i = 0; i < Math.min(2, trails.length); i++) {
    const t = trails[i]!;
    buttons.push({
      id: `trail_nav_${i}`,
      label: shortenActionLabel(`📍 ${shortTrailLabel(t.name)}`),
      payload: {
        kind: 'navigate',
        lat: t.lat,
        lng: t.lng,
        label: t.name,
        ...(kind === 'bike' ? { preferBike: true } : {}),
      },
    });
  }
  for (const t of trails.slice(0, 2)) {
    if (buttons.length >= 4) break;
    if (!t.websiteUri) continue;
    if (
      buttons.some(
        (b) =>
          b.payload.kind === 'deep_link' && b.payload.url === t.websiteUri,
      )
    ) {
      continue;
    }
    buttons.push({
      id: `trail_web_${t.name.slice(0, 12)}`,
      label: shortenActionLabel(`${shortTrailLabel(t.name)} → Web`),
      payload: { kind: 'deep_link', url: t.websiteUri, destName: t.name },
    });
  }

  const optionBits = trails.slice(0, 2).map((t) => {
    const rt =
      budget && t.roundTripM != null
        ? ` — Hin+Zurück ~${formatDist(t.roundTripM)}`
        : t.distanceM >= 8_000
          ? ` — ca. ${formatDist(t.distanceM)}`
          : ` (${formatDist(t.distanceM)})`;
    return `${t.name}${rt}`;
  });

  const spokenParts: string[] = [];
  if (budget && optionBits.length) {
    spokenParts.push(
      `Für ${formatDist(budget.totalDistanceM)} unterwegs (${modeLabel}, ${formatDurationHint(budget.hours, budget.totalDistanceM, kind)}) passt als Wendepunkt besonders ${optionBits.join(' und ')}.`,
    );
    spokenParts.push(
      'Route zum Wendepunkt liegt bereit — zurück kommt dieselbe Strecke ungefähr nochmal.',
    );
  } else if (optionBits.length) {
    spokenParts.push(
      kind === 'bike'
        ? `Fürs Radeln passt hier besonders ${optionBits.join(' und ')}.`
        : `Zum Wandern empfehle ich ${optionBits.join(' und ')}.`,
    );
    spokenParts.push(
      trails.length === 1
        ? 'Route zum Einstieg liegt bereit — tipp den Button, dann navigiere ich dich hin.'
        : 'Routen zu den Einstiegen liegen bereit — such dir einen aus, ich navigiere dich hin.',
    );
  } else {
    spokenParts.push(
      budget
        ? `Für ${formatDist(budget.totalDistanceM)} unterwegs finde ich gerade keinen belegten Wendepunkt — ich prüfe die Region weiter.`
        : `Einen klaren ${labelKind} in Reichweite hab ich gerade nicht belegt — ich prüfe die Region weiter.`,
    );
  }

  const budgetLines = budget
    ? [
        `Budget: ${formatDist(budget.totalDistanceM)} gesamt (Hin+Zurück/Runde)`,
        `Wendepunkt-Zielweite: ~${formatDist(budget.oneWayTargetM)}`,
        budget.hours != null ? `Genannte Dauer: ${budget.hours} h` : null,
        budget.statedKm != null ? `Genannte Distanz: ${budget.statedKm} km` : null,
        `Modus: ${modeLabel} (persönliches Tempo ${paceKmhForKind(kind).toFixed(1)} km/h)`,
      ].filter(Boolean)
    : [];

  const promptBlock = [
    `FAKTEN ${budget ? 'Outdoor-Ausflug' : labelKindPl} (nicht wörtlich vorlesen):`,
    `Art: ${kind === 'bike' ? 'Fahrrad / Radroute' : 'Zu Fuß / Wander-Spazier'}`,
    cityHint ? `Ort-Kontext: ${cityHint}` : 'Ort-Kontext: hier vor Ort',
    ...budgetLines,
    ...trails.slice(0, 3).map(
      (t, i) =>
        `${i + 1}. ${t.name} · hin ${formatDist(t.distanceM)}` +
        (t.roundTripM != null ? ` · Runde ~${formatDist(t.roundTripM)}` : '') +
        ` · Quelle=${t.source}` +
        (t.rating != null ? ` · Rating=${t.rating}` : '') +
        (t.fitScore != null ? ` · Fit=${Math.round(t.fitScore)}` : ''),
    ),
    budget
      ? 'FLOW: klare Antwort vorne (passt zu Dauer/km) → Wendepunkt nennen → Route-Button. Kein zweites Ziel erzwingen.'
      : 'FLOW: klare Empfehlung vorne → kurz warum (Nähe/Qualität wenn belegt) → Route-Button anbieten.',
    'Nav = zum Einstieg/Wendepunkt (Punkt). Hin+Zurück ≈ Budget — ehrlich sagen, keine erfundene Weglänge.',
    'Nichts erfinden zu Belag/Schwierigkeit — nur belegte Fakten.',
    FINDUS_TRAIL_FEW_SHOT,
  ].join('\n');

  return {
    kind,
    cityHint,
    budget,
    trails,
    promptBlock,
    buttons: buttons.slice(0, 4),
    bullets: bullets.slice(0, 3),
    spokenDraft: spokenParts.join(' ').slice(0, 1200),
  };
}

const FINDUS_TRAIL_FEW_SHOT =
  'Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an den aktuellen Kontext und die aktuelle Stadt an.';
