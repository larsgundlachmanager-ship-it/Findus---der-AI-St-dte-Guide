/**
 * Multistopp-Touren: Joggen, Erkunden, Frühstück/Essen + On-the-fly Stops.
 * Findus wählt passende POIs und führt stop für stop.
 */

import { getAllPois, haversineMeters } from '../../db/database';
import type { Poi } from '../../db/types';
import { useFinnusStore } from '../../store/useFinnusStore';
import { parseTagsJson } from '../geo/triggerPolicy';
import { startNavigation, startNavigationToCoords } from './navigationService';
import { markNavOpeningSpoken } from './landmarkNavCoach';
import { stopSpeaking } from '../ttsService';
import {
  fetchRouteDirectionsResult,
  walkingDistanceFromSteps,
} from './googleMapsNav';

export type TourKind = 'jog' | 'explore' | 'meal' | 'custom';

/** soft = Errand unterwegs; high = spontan jetzt; must = Termin / harte Deadline */
export type StopPriority = 'soft' | 'high' | 'must';

export type TourStop = {
  poiId: number;
  name: string;
  lat: number;
  lng: number;
  done: boolean;
  priority?: StopPriority;
  /** Minuten vorher erinnern — null/undefined = keine Reminder-Ansage */
  remindMinBefore?: number | null;
};

export type MultiStopTour = {
  kind: TourKind;
  title: string;
  /** Ziel-Länge der Tour (Joggen), sonst null. */
  targetDistanceM: number | null;
  /** Ziel-Dauer in Minuten (optional). */
  targetDurationMin: number | null;
  estimatedDistanceM: number;
  stops: TourStop[];
  currentIndex: number;
};

export type MultiStopIntent = {
  kind: TourKind;
  /** Nur bei Joggen. */
  distanceKm: number | null;
  /** Dauer in Minuten, falls genannt. */
  durationMin: number | null;
  mealHint: string | null;
  /** Parameter fehlen → proaktive Nachfrage. */
  needsParams: boolean;
};

/** Complex itinerary (>5 stops) → Gemini Pro via modelRouter. */
export function tourNeedsProLlm(stopCount: number): boolean {
  return stopCount > 5;
}

const JOG_RE =
  /\b(joggen|jogging|laufen\s+gehen|laufstrecke|runde\s+laufen|spazieren\s+\d|\d+[.,]?\d*\s*km\s*(joggen|laufen|runde)|ich\s+(möchte|will|würde)\s+.{0,40}\d+[.,]?\d*\s*km)\b/iu;

const EXPLORE_RE =
  /\b(erkunden|führ\s+mich\s+herum|fuehr\s+mich\s+herum|zeig\s+mir\s+(die\s+stadt|den\s+ort|was\s+es\s+gibt)|stadtführung|stadtfuehrung|rundgang|tour\s+(machen|planen)|beste\s+orte|was\s+sich\s+lohnt|herumnavig|führ\s+mich\s+durch|fuehr\s+mich\s+durch)\b/iu;

const MEAL_RE =
  /\b(frühstück|fruehstueck|breakfast|brunch|mittagessen|abendessen|was\s+essen|wo\s+essen|hunger|café|cafe|bäckerei|baeckerei|restaurant\s+route|essensroute)\b/iu;

const CIRCUIT_SOFT_RE =
  /\b(schöne\s+runde|einfach\s+(mal\s+)?(laufen|spazieren)|runde\s+drehen|etwas\s+bewegung)\b/iu;

export const CIRCUIT_PROMPT =
  'Möchtest du irgendwo einen Kaffee trinken, zu Abend essen oder einfach eine schöne Runde laufen?';

export function formatTourReply(tour: MultiStopTour): string {
  const km = (tour.estimatedDistanceM / 1000).toFixed(1);
  if (tour.kind === 'jog') {
    return `Jo, hab ich gemacht — etwa ${km} km. Laufschuhe an und los geht’s.`;
  }
  if (tour.kind === 'meal') {
    return `Passt — ${tour.title} steht. Los geht’s zum ersten Stop.`;
  }
  if (tour.kind === 'custom') {
    return `Alles klar — ${tour.stops.length} Stopps, wir starten.`;
  }
  return `Alles klar — kurze Runde mit ${tour.stops.length} Stopps. Wir starten.`;
}

function cleanName(name: string): string {
  return name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
}

function isAreaPoi(p: Poi): boolean {
  return p.kind === 'area' || p.kind === 'legacy' || !p.kind;
}

function scoreExplore(p: Poi): number {
  const tags = parseTagsJson(p.tags_json).join(' ').toLowerCase();
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name.toLowerCase();
  const blob = `${name} ${cat} ${tags}`;
  let s = 1;
  if (/denkmal|museum|kirche|schloss|rathaus|platz|markt|histor|wartehäuschen|bahnhof/.test(blob))
    s += 8;
  if (/park|natur|brücke|teich|see|aussicht/.test(blob)) s += 5;
  if (/sport|tennis|golf|schule|kindergarten|feuerwehr|gewerbe/.test(blob))
    s -= 2;
  if (p.kind === 'sub') s -= 4;
  return s;
}

function scoreMeal(p: Poi, hint: string | null): number {
  const tags = parseTagsJson(p.tags_json).join(' ').toLowerCase();
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name.toLowerCase();
  const blob = `${name} ${cat} ${tags}`;
  if (
    /spielstadt|spielplatz|indoor.?play|trampoline|bowling|kino|museum|kirche|denkmal|parkhaus|tankstelle|büro|buero|gewerbe/.test(
      blob,
    )
  ) {
    return 0;
  }
  let s = -5;
  if (/frühstück|fruehstueck|breakfast|brunch|café|cafe|bäck|baeck|bistro|restaurant|essen|food|imbiss|markt/.test(blob))
    s += 12;
  if (hint && blob.includes(hint.toLowerCase())) s += 8;
  if (/hotel|unterkunft/.test(blob)) s += 2;
  return s;
}

function pathLengthM(origin: { lat: number; lng: number }, stops: TourStop[]): number {
  let total = 0;
  let prev = origin;
  for (const s of stops) {
    total += haversineMeters(prev.lat, prev.lng, s.lat, s.lng);
    prev = s;
  }
  return Math.round(total);
}

/** Summe echter Fuß-Routen (Directions) — nicht Luftlinie. */
async function pathLengthRoutedM(
  origin: { lat: number; lng: number },
  stops: TourStop[],
): Promise<number> {
  let total = 0;
  let prev = origin;
  for (const s of stops) {
    let leg = 0;
    try {
      const result = await fetchRouteDirectionsResult(
        { lat: prev.lat, lng: prev.lng },
        { lat: s.lat, lng: s.lng },
        'walking',
      );
      if (result?.steps?.length) {
        leg = walkingDistanceFromSteps(result.steps);
      }
    } catch {
      /* air fallback */
    }
    if (leg < 20) {
      leg = haversineMeters(prev.lat, prev.lng, s.lat, s.lng);
    }
    total += leg;
    prev = s;
  }
  return Math.round(total);
}

function scheduleTourDistanceEnrich(tour: MultiStopTour): void {
  const store = useFinnusStore.getState();
  const origin = {
    lat: store.lastGpsLat ?? tour.stops[0]?.lat ?? 0,
    lng: store.lastGpsLng ?? tour.stops[0]?.lng ?? 0,
  };
  const upcoming = tour.stops.slice(tour.currentIndex).filter((s) => !s.done);
  void pathLengthRoutedM(origin, upcoming).then((m) => {
    if (m <= 0) return;
    const cur = useFinnusStore.getState().multiStopTour;
    if (!cur || cur.title !== tour.title) return;
    if (Math.abs((cur.estimatedDistanceM ?? 0) - m) < 25) return;
    useFinnusStore.getState().setMultiStopTour({
      ...cur,
      estimatedDistanceM: m,
    });
  });
}

function offsetMeters(
  lat: number,
  lng: number,
  northM: number,
  eastM: number,
): { lat: number; lng: number } {
  const dLat = northM / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = eastM / (111_320 * Math.max(0.2, cos));
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * Jogging-Runde ≈ targetM als geometrischer Kreis.
 * POIs nur snappen wenn sie nah am Idealpunkt liegen — sonst kollabiert
 * die Runde in kleinen Orten (Prisdorf) auf ~400 m trotz 9 Stopps.
 */
function buildJogLoopStops(
  origin: { lat: number; lng: number },
  targetM: number,
  pois: Poi[],
): TourStop[] {
  const nSeg = Math.max(6, Math.min(10, Math.round(targetM / 500)));
  let bestStops: TourStop[] = [];
  let bestDiff = Number.POSITIVE_INFINITY;

  const buildAtScale = (scale: number, allowSnap: boolean): TourStop[] => {
    const r = (targetM * scale) / (2 * Math.PI);
    const used = new Set<number>();
    const stops: TourStop[] = [];

    for (let i = 1; i <= nSeg; i++) {
      const angle = (2 * Math.PI * i) / nSeg - Math.PI / 2;
      const radiusFactor = i === nSeg ? 0.4 : 1;
      const ideal = offsetMeters(
        origin.lat,
        origin.lng,
        Math.cos(angle) * r * radiusFactor,
        Math.sin(angle) * r * radiusFactor,
      );

      let snapped: Poi | null = null;
      if (allowSnap) {
        let snapD = 120;
        for (const p of pois) {
          if (used.has(p.id)) continue;
          const d = haversineMeters(ideal.lat, ideal.lng, p.lat, p.lng);
          if (d < snapD) {
            snapD = d;
            snapped = p;
          }
        }
      }

      if (snapped) {
        used.add(snapped.id);
        stops.push({
          poiId: snapped.id,
          name: cleanName(snapped.name),
          lat: snapped.lat,
          lng: snapped.lng,
          done: false,
        });
      } else {
        stops.push({
          poiId: -3000 - i,
          name: `Wegpunkt ${i}`,
          lat: ideal.lat,
          lng: ideal.lng,
          done: false,
        });
      }
    }
    return stops;
  };

  for (const scale of [0.95, 1.0, 1.08, 1.18, 0.88]) {
    for (const allowSnap of [true, false]) {
      let stops = buildAtScale(scale, allowSnap);
      let len = pathLengthM(origin, stops);

      if (len < targetM * 0.8) {
        stops = buildAtScale(scale * (targetM / Math.max(len, 1)), false);
        len = pathLengthM(origin, stops);
      }
      if (len < targetM * 0.85) {
        const need = targetM - len;
        const extraR = Math.max(500, need / 3.5);
        const extra = [
          offsetMeters(origin.lat, origin.lng, extraR, 0),
          offsetMeters(origin.lat, origin.lng, extraR * 0.55, extraR * 0.85),
          offsetMeters(origin.lat, origin.lng, -extraR * 0.2, extraR),
        ];
        for (let j = 0; j < extra.length; j++) {
          const pt = extra[j];
          stops.push({
            poiId: -4000 - j,
            name: `Jog-Punkt ${stops.length + 1}`,
            lat: pt.lat,
            lng: pt.lng,
            done: false,
          });
        }
        len = pathLengthM(origin, stops);
      }

      const diff = Math.abs(len - targetM);
      if (diff < bestDiff && stops.length >= 3) {
        bestDiff = diff;
        bestStops = stops;
      }
    }
  }

  return bestStops;
}

function orderNearestNeighbor(
  origin: { lat: number; lng: number },
  candidates: Poi[],
  maxStops: number,
): TourStop[] {
  const remaining = [...candidates];
  const out: TourStop[] = [];
  let cur = origin;
  while (remaining.length && out.length < maxStops) {
    remaining.sort(
      (a, b) =>
        haversineMeters(cur.lat, cur.lng, a.lat, a.lng) -
        haversineMeters(cur.lat, cur.lng, b.lat, b.lng),
    );
    const next = remaining.shift()!;
    out.push({
      poiId: next.id,
      name: cleanName(next.name),
      lat: next.lat,
      lng: next.lng,
      done: false,
    });
    cur = { lat: next.lat, lng: next.lng };
  }
  return out;
}

function parseDurationMin(text: string): number | null {
  const m = text.match(/(\d+)\s*(min|minute|minuten)/iu);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.min(180, n) : null;
}

export function detectMultiStopIntent(text: string): MultiStopIntent | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const durationMin = parseDurationMin(t);

  if (
    JOG_RE.test(t) ||
    (/\b\d+[.,]?\d*\s*km\b/iu.test(t) && /\b(joggen|laufen|runde)\b/iu.test(t))
  ) {
    const m = t.match(/(\d+[.,]?\d*)\s*km/iu);
    const hasKm = Boolean(m);
    const km = m
      ? Number(m[1].replace(',', '.'))
      : durationMin
        ? Math.max(1, Math.round(((durationMin * 60 * 1.35) / 1000) * 10) / 10)
        : null;
    return {
      kind: 'jog',
      distanceKm:
        km != null && Number.isFinite(km) && km > 0
          ? Math.min(20, Math.max(1, km))
          : null,
      durationMin,
      mealHint: null,
      needsParams: !hasKm && durationMin == null,
    };
  }

  if (CIRCUIT_SOFT_RE.test(t) && !MEAL_RE.test(t)) {
    return {
      kind: 'jog',
      distanceKm: null,
      durationMin,
      mealHint: null,
      needsParams: true,
    };
  }

  if (MEAL_RE.test(t)) {
    let mealHint: string | null = null;
    if (/frühstück|fruehstueck|breakfast|brunch/i.test(t)) mealHint = 'frühstück';
    else if (/mittag/i.test(t)) mealHint = 'mittag';
    else if (/abend/i.test(t)) mealHint = 'abend';
    return {
      kind: 'meal',
      distanceKm: null,
      durationMin,
      mealHint,
      needsParams: false,
    };
  }

  if (EXPLORE_RE.test(t)) {
    return {
      kind: 'explore',
      distanceKm: null,
      durationMin,
      mealHint: null,
      needsParams: false,
    };
  }

  return null;
}

export async function planMultiStopTour(
  intent: MultiStopIntent,
  origin: { lat: number; lng: number },
): Promise<MultiStopTour | null> {
  if (intent.needsParams && intent.kind === 'jog' && intent.distanceKm == null) {
    return null;
  }

  const all = (await getAllPois()).filter(
    (p) =>
      isAreaPoi(p) &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      haversineMeters(origin.lat, origin.lng, p.lat, p.lng) < 12_000,
  );
  if (!all.length && intent.kind !== 'jog') return null;

  if (intent.kind === 'jog') {
    const targetM = Math.round((intent.distanceKm ?? 4) * 1000);
    const kmLabel = (intent.distanceKm ?? 4).toFixed(
      Number.isInteger(intent.distanceKm ?? 4) ? 0 : 1,
    );
    const stops = buildJogLoopStops(origin, targetM, all);
    if (!stops.length) return null;
    const estimatedDistanceM = pathLengthM(origin, stops);
    return {
      kind: 'jog',
      title: `Joggen · ~${kmLabel} km`,
      targetDistanceM: targetM,
      targetDurationMin: intent.durationMin,
      estimatedDistanceM,
      stops,
      currentIndex: 0,
    };
  }

  if (intent.kind === 'meal') {
    const ranked = all
      .map((p) => ({ p, s: scoreMeal(p, intent.mealHint) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        return (
          haversineMeters(origin.lat, origin.lng, a.p.lat, a.p.lng) -
          haversineMeters(origin.lat, origin.lng, b.p.lat, b.p.lng)
        );
      })
      .slice(0, 4)
      .map((x) => x.p);
    const picks =
      ranked.length > 0
        ? ranked
        : []; // Kein Fallback auf beliebige POIs (sonst Spielstadt o. Ä.)
    if (!picks.length) return null;
    const stops = orderNearestNeighbor(origin, picks, Math.min(3, picks.length));
    if (!stops.length) return null;
    const label =
      intent.mealHint === 'frühstück'
        ? 'Frühstücks-Route'
        : intent.mealHint === 'mittag'
          ? 'Mittagessen-Route'
          : intent.mealHint === 'abend'
            ? 'Abendessen-Route'
            : 'Essens-Route';
    return {
      kind: 'meal',
      title: label,
      targetDistanceM: null,
      targetDurationMin: intent.durationMin,
      estimatedDistanceM: pathLengthM(origin, stops),
      stops,
      currentIndex: 0,
    };
  }

  const ranked = all
    .map((p) => ({ p, s: scoreExplore(p) }))
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.p);
  const picks =
    ranked.length >= 3
      ? ranked
      : all.sort((a, b) => scoreExplore(b) - scoreExplore(a)).slice(0, 5);
  const stops = orderNearestNeighbor(origin, picks, Math.min(5, picks.length));
  if (!stops.length) return null;
  return {
    kind: 'explore',
    title: 'Erkunden',
    targetDistanceM: null,
    targetDurationMin: intent.durationMin,
    estimatedDistanceM: pathLengthM(origin, stops),
    stops,
    currentIndex: 0,
  };
}

async function navigateToTourStop(stop: TourStop): Promise<boolean> {
  if (stop.poiId >= 0) {
    const ok = await startNavigation(stop.poiId);
    if (ok) return true;
  }
  return startNavigationToCoords({
    name: stop.name,
    lat: stop.lat,
    lng: stop.lng,
    poiId: stop.poiId >= 0 ? stop.poiId : -1,
  });
}

function recomputeTourDistance(tour: MultiStopTour): number {
  const store = useFinnusStore.getState();
  const origin = {
    lat: store.lastGpsLat ?? tour.stops[0]?.lat ?? 0,
    lng: store.lastGpsLng ?? tour.stops[0]?.lng ?? 0,
  };
  const upcoming = tour.stops.slice(tour.currentIndex).filter((s) => !s.done);
  return pathLengthM(origin, upcoming);
}

export async function startMultiStopTour(
  tour: MultiStopTour,
): Promise<{ ok: boolean; reply: string }> {
  useFinnusStore.getState().setMultiStopTour(tour);
  scheduleTourDistanceEnrich(tour);
  const stop = tour.stops[tour.currentIndex];
  if (!stop) {
    useFinnusStore.getState().setMultiStopTour(null);
    return { ok: false, reply: 'Ich konnte keine sinnvolle Route finden.' };
  }
  const ok = await navigateToTourStop(stop);
  if (!ok) {
    useFinnusStore.getState().setMultiStopTour(null);
    return {
      ok: false,
      reply: 'Route steht, aber Navigation startet gerade nicht. Versuch’s nochmal.',
    };
  }
  markNavOpeningSpoken();
  return { ok: true, reply: formatTourReply(tour) };
}

export async function advanceMultiStopTour(): Promise<boolean> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour) return false;

  const stops = tour.stops.map((s, i) =>
    i === tour.currentIndex ? { ...s, done: true } : s,
  );
  const nextIndex = tour.currentIndex + 1;
  if (nextIndex >= stops.length) {
    store.setMultiStopTour({
      ...tour,
      stops,
      currentIndex: nextIndex,
    });
    setTimeout(() => {
      const cur = useFinnusStore.getState().multiStopTour;
      if (cur && cur.currentIndex >= cur.stops.length) {
        useFinnusStore.getState().setMultiStopTour(null);
      }
    }, 8_000);
    void stopSpeaking().catch(() => {});
    return false;
  }

  const next = stops[nextIndex];
  const nextTour = {
    ...tour,
    stops,
    currentIndex: nextIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex: nextIndex,
    }),
  };
  store.setMultiStopTour(nextTour);
  scheduleTourDistanceEnrich(nextTour);

  return navigateToTourStop(next);
}

export function clearMultiStopTour(): void {
  useFinnusStore.getState().setMultiStopTour(null);
}

export function formatTourStopsHeader(tour: MultiStopTour | null): string | null {
  if (!tour?.stops?.length) return null;
  const cur = Math.min(tour.currentIndex, tour.stops.length - 1);
  const parts = tour.stops.map((s, i) => {
    if (i < tour.currentIndex) return `✓${s.name}`;
    if (i === cur) return `→${s.name}`;
    return s.name;
  });
  return `${tour.title}: ${parts.join(' · ')}`;
}

export function ensureTourFromActiveNav(final: {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
}): MultiStopTour {
  const existing = useFinnusStore.getState().multiStopTour;
  if (existing?.stops?.length) return existing;

  const tour: MultiStopTour = {
    kind: 'custom',
    title: 'Route',
    targetDistanceM: null,
    targetDurationMin: null,
    estimatedDistanceM: 0,
    stops: [
      {
        poiId: final.poiId ?? -1,
        name: final.name,
        lat: final.lat,
        lng: final.lng,
        done: false,
      },
    ],
    currentIndex: 0,
  };
  useFinnusStore.getState().setMultiStopTour(tour);
  return tour;
}

export async function insertTourStop(
  stop: TourStop,
  opts?: { position?: 'front' | 'end'; startNow?: boolean },
): Promise<MultiStopTour | null> {
  const store = useFinnusStore.getState();
  let tour = store.multiStopTour;
  if (!tour) {
    tour = {
      kind: 'custom',
      title: 'Route',
      targetDistanceM: null,
      targetDurationMin: null,
      estimatedDistanceM: 0,
      stops: [],
      currentIndex: 0,
    };
  }

  const position = opts?.position ?? 'front';
  const stops = [...tour.stops];
  const currentIndex = tour.currentIndex;

  if (position === 'front') {
    stops.splice(currentIndex, 0, { ...stop, done: false });
  } else {
    stops.push({ ...stop, done: false });
  }

  const next: MultiStopTour = {
    ...tour,
    kind:
      tour.kind === 'jog' || tour.kind === 'explore' || tour.kind === 'meal'
        ? tour.kind
        : 'custom',
    stops,
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);

  if (opts?.startNow !== false && position === 'front') {
    await navigateToTourStop(stops[currentIndex]);
    markNavOpeningSpoken();
  }
  return next;
}

/** Max. Umweg, damit ein Tour-Stop „auf dem Weg“ zu Spontan-Ziel gilt. */
const ON_ROUTE_DETOUR_M = 140;
const ON_ROUTE_DETOUR_FRAC = 0.22;

function sameStop(a: TourStop, b: Pick<TourStop, 'name' | 'lat' | 'lng' | 'poiId'>): boolean {
  if (a.poiId >= 0 && b.poiId >= 0 && a.poiId === b.poiId) return true;
  const an = a.name.trim().toLowerCase();
  const bn = b.name.trim().toLowerCase();
  if (an && bn && an === bn) return true;
  return (
    haversineMeters(a.lat, a.lng, b.lat, b.lng) < 45 &&
    an.length > 0 &&
    (an.includes(bn) || bn.includes(an))
  );
}

function isOnWayTo(
  user: { lat: number; lng: number },
  via: TourStop,
  dest: { lat: number; lng: number },
): boolean {
  const direct = haversineMeters(user.lat, user.lng, dest.lat, dest.lng);
  const viaDist =
    haversineMeters(user.lat, user.lng, via.lat, via.lng) +
    haversineMeters(via.lat, via.lng, dest.lat, dest.lng);
  const detour = viaDist - direct;
  if (detour > Math.max(ON_ROUTE_DETOUR_M, direct * ON_ROUTE_DETOUR_FRAC)) {
    return false;
  }
  // Via sollte nicht klar hinter dem Spontan-Ziel liegen
  const toVia = haversineMeters(user.lat, user.lng, via.lat, via.lng);
  return toVia <= direct + 40;
}

/**
 * Spontan-Ziel (Aldi/Durst) in laufende Tour einweben — Rest bleibt.
 * On-route Stops vor dem Spontan-Ziel; sonst Spontan oben (high), dann bisherige Queue.
 */
export async function weaveSpontaneousStop(
  stop: TourStop,
  opts?: { startNow?: boolean },
): Promise<{ tour: MultiStopTour; speechHint: string } | null> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour?.stops?.length) return null;

  const userLat = store.lastGpsLat;
  const userLng = store.lastGpsLng;
  if (
    userLat == null ||
    userLng == null ||
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLng)
  ) {
    // Ohne GPS: klassisch vorne einschieben
    const inserted = await insertTourStop(
      { ...stop, priority: stop.priority ?? 'high', done: false },
      { position: 'front', startNow: opts?.startNow !== false },
    );
    if (!inserted) return null;
    return {
      tour: inserted,
      speechHint: `${stop.name} ist jetzt als Nächstes dran — die Tour bleibt.`,
    };
  }

  const user = { lat: userLat, lng: userLng };
  const donePart = tour.stops
    .slice(0, tour.currentIndex)
    .map((s) => ({ ...s, done: true as const }));
  const upcoming = tour.stops
    .slice(tour.currentIndex)
    .filter((s) => !s.done)
    .filter((s) => !sameStop(s, stop));

  const spontaneous: TourStop = {
    ...stop,
    done: false,
    priority: stop.priority ?? 'high',
    remindMinBefore:
      stop.remindMinBefore !== undefined
        ? stop.remindMinBefore
        : stop.priority === 'must'
          ? 5
          : null,
  };

  const onRoute = upcoming
    .filter((s) => isOnWayTo(user, s, spontaneous))
    .sort(
      (a, b) =>
        haversineMeters(user.lat, user.lng, a.lat, a.lng) -
        haversineMeters(user.lat, user.lng, b.lat, b.lng),
    );
  const onRouteKeys = new Set(onRoute.map((s) => `${s.poiId}|${s.name}|${s.lat}`));
  const rest = upcoming.filter(
    (s) => !onRouteKeys.has(`${s.poiId}|${s.name}|${s.lat}`),
  );

  const wovenUpcoming = [...onRoute, spontaneous, ...rest];
  const stops = [...donePart, ...wovenUpcoming];
  const currentIndex = donePart.length;

  const next: MultiStopTour = {
    ...tour,
    stops,
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);
  store.setStopQueueVisible(true);

  if (opts?.startNow !== false) {
    const focus = stops[currentIndex];
    if (focus) {
      await navigateToTourStop(focus);
      markNavOpeningSpoken();
    }
  }

  let speechHint: string;
  if (onRoute.length > 0) {
    const viaNames = onRoute.map((s) => s.name).slice(0, 2).join(' und ');
    speechHint =
      onRoute.length === 1
        ? `${viaNames} liegt auf dem Weg — den haken wir kurz ab, dann ${spontaneous.name}. Tour bleibt.`
        : `Auf dem Weg liegen noch ${viaNames} — danach ${spontaneous.name}. Der Rest der Tour bleibt.`;
  } else {
    const p = spontaneous.priority ?? 'high';
    speechHint =
      p === 'must'
        ? `${spontaneous.name} ist jetzt oben — ich erinner dich rechtzeitig. Die anderen Stopps bleiben in der Queue.`
        : `${spontaneous.name} ist jetzt als Nächstes dran. Die Tour mit ${rest.length} weiteren Stopps bleibt.`;
  }

  return { tour: next, speechHint };
}

/** Ob eine laufende Tour Spontan-Ziele einweben soll (statt alles zu löschen). */
export function hasActiveTourQueue(): boolean {
  const tour = useFinnusStore.getState().multiStopTour;
  if (!tour?.stops?.length) return false;
  return tour.stops.slice(tour.currentIndex).some((s) => !s.done);
}

/** Lockerer Reminder-Text wenn Stop bald dran / leave-by nah. */
export function softStopReminderLine(stop: TourStop): string | null {
  const mins = stop.remindMinBefore;
  if (mins == null || mins <= 0) return null;
  const p = stop.priority ?? 'soft';
  if (p === 'must') {
    return `In etwa ${mins} Minuten solltest du Richtung ${stop.name} — nur kurz Bescheid.`;
  }
  if (p === 'high') {
    return `Wenn’s passt: gleich wäre ${stop.name} dran.`;
  }
  return `Nebenbei: ${stop.name} kommt bald — kein Stress.`;
}

export function removeTourStopAt(index: number): MultiStopTour | null {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour || index < 0 || index >= tour.stops.length) return tour;

  const stops = tour.stops.filter((_, i) => i !== index);
  if (!stops.length) {
    store.setMultiStopTour(null);
    return null;
  }

  let currentIndex = tour.currentIndex;
  if (index < currentIndex) currentIndex -= 1;
  if (currentIndex >= stops.length) currentIndex = stops.length - 1;

  const next: MultiStopTour = {
    ...tour,
    stops,
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);
  return next;
}

export function reorderTourStops(
  fromIndex: number,
  toIndex: number,
): MultiStopTour | null {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour) return null;
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tour.stops.length ||
    toIndex >= tour.stops.length ||
    fromIndex === toIndex
  ) {
    return tour;
  }

  const stops = [...tour.stops];
  const [moved] = stops.splice(fromIndex, 1);
  stops.splice(toIndex, 0, moved);

  const wasActive = tour.stops[tour.currentIndex];
  let currentIndex = stops.findIndex(
    (s) =>
      s.name === wasActive?.name &&
      s.lat === wasActive?.lat &&
      s.lng === wasActive?.lng &&
      !s.done,
  );
  if (currentIndex < 0) {
    currentIndex = Math.min(tour.currentIndex, stops.length - 1);
  }

  const next: MultiStopTour = {
    ...tour,
    stops,
    currentIndex,
    estimatedDistanceM: recomputeTourDistance({
      ...tour,
      stops,
      currentIndex,
    }),
  };
  store.setMultiStopTour(next);
  return next;
}

export async function navigateToTourStopAt(index: number): Promise<boolean> {
  const store = useFinnusStore.getState();
  const tour = store.multiStopTour;
  if (!tour || index < 0 || index >= tour.stops.length) return false;
  const stop = tour.stops[index];
  if (stop.done) return false;
  store.setMultiStopTour({ ...tour, currentIndex: index });
  return navigateToTourStop(stop);
}
