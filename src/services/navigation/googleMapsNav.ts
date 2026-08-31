/**
 * Google Maps Anreicherung für freihändige Navigation:
 * Directions (Gehweg), Places Nearby (sichtbare Orte),
 * Street View Metadata (+ optional Bild für Gemini-Beschreibung).
 */



import * as ExpoLocation from 'expo-location';
import { env } from '../../config/env';
import type { NavWaypoint } from './navigationTypes';
import {
  getCachedGeocode,
  putCachedGeocode,
  queryCachedDiscoveriesNear,
  queryCachedLandmarksNear,
  upsertCachedLandmarks,
  LANDMARK_CACHE_QUERY_RADIUS_M,
} from './landmarkCache';
import {
  searchOsmLandmarksNear,
  searchOsmPlacesNearby,
} from './overpassService';
import {
  getCachedStreetView,
  putCachedStreetView,
} from './streetViewCache';
import { scheduleImmediateCommunityCachePush } from '../sync/nightlyCacheSync';
import { sanitizePlaceWebsiteUri } from './placeWebsiteUri';
import { parseGoogleRouteFare } from './googleRouteFare';



const PLACES_NEARBY =
  'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
const DIRECTIONS = 'https://maps.googleapis.com/maps/api/directions/json';
/**
 * project-osrm.org hat nur ein Auto-Graph — `/foot` und `/bike` liefern trotzdem
 * Driving-Geometrie (Straßen, keine Fußgängerbrücken). Nie als Fuß/Rad nutzen.
 */
const CAR_ONLY_OSRM_HOST = 'router.project-osrm.org';
void CAR_ONLY_OSRM_HOST;
/** FOSSGIS: Profil steckt im Host-Pfad; URL-Segment bleibt `driving`. */
const FOSSGIS_FOOT_OSRM_BASE =
  'https://routing.openstreetmap.de/routed-foot/route/v1';
const FOSSGIS_BIKE_OSRM_BASE =
  'https://routing.openstreetmap.de/routed-bike/route/v1';
const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';
const SV_META = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const SV_STATIC = 'https://maps.googleapis.com/maps/api/streetview';

/** Auto-Umweg-Heuristik: Fußroute >> Luftlinie → verwerfen. */
export function isImplausiblePedestrianDetour(
  routeDistanceM: number,
  airDistanceM: number,
  travelMode: PedestrianTravelMode = 'walking',
): boolean {
  if (travelMode === 'transit') return false;
  if (!Number.isFinite(routeDistanceM) || !Number.isFinite(airDistanceM)) {
    return false;
  }
  if (airDistanceM < 40) return false;
  const maxRatio = travelMode === 'bicycling' ? 2.8 : 2.0;
  const minExtraM = travelMode === 'bicycling' ? 550 : 280;
  return (
    routeDistanceM > airDistanceM * maxRatio &&
    routeDistanceM - airDistanceM > minExtraM
  );
}

function airDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}



const FETCH_MS = 6_000;



/** Visuell nützliche Place-Typen — Nearby filtert heuristisch über Score. */
const _LANDMARK_TYPE_HINT =
  'pharmacy|bakery|cafe|church|park|school|supermarket|store';
void _LANDMARK_TYPE_HINT;
export type PlaceLandmark = {
  name: string;
  types: string[];
  lat: number;
  lng: number;
  distanceM: number;
};



/** Open-now discovery hit (Places Nearby). */
export type DiscoveredPlace = {
  placeId: string;
  name: string;
  types: string[];
  lat: number;
  lng: number;
  distanceM: number;
  rating: number | null;
  /** Google userRatingCount — Sterne nur bei ≥20 erwähnen */
  ratingCount?: number | null;
  websiteUri?: string | null;
  phoneNumber?: string | null;
  openNow: boolean;
  /** Minuten seit Mitternacht — Öffnung am Besuchstag, wenn bekannt */
  opensAtMin?: number | null;
  /** Minuten seit Mitternacht — Schließung am Besuchstag, wenn bekannt (ggf. >1440 bei overnight) */
  closesAtMin?: number | null;
  /** Periods vorhanden, aber kein Slot am Besuchstag (z. B. Ruhetag / Pause) */
  closedOnVisitDay?: boolean | null;
};



/** Büro / Verwaltung / kein echter Laden — nie als Bäckerei-Ziel. */
export function looksLikeOfficeOnlyPlace(opts: {
  name: string;
  types?: string[] | null;
}): boolean {
  const name = (opts.name ?? '').toLowerCase();
  if (
    /\b(büro|buero|office|verwaltung|head\s*office|firmensitz|backoffice|geschäftsstelle|geschaeftsstelle)\b/i.test(
      name,
    )
  ) {
    return true;
  }
  // „… Backstube Büro“ / „Bäcker … Verwaltung“
  if (/\b(bäck|baeck|bakery|backstube).{0,40}\b(büro|buero|office)\b/i.test(name)) {
    return true;
  }
  if (/\b(büro|buero|office).{0,40}\b(bäck|baeck|bakery|backstube)\b/i.test(name)) {
    return true;
  }
  const types = (opts.types ?? []).map((t) => t.toLowerCase());
  const officeType = types.some((t) =>
    /accounting|finance|insurance_agency|real_estate|lawyer|electrician|plumber|general_contractor|travel_agency|storage/.test(
      t,
    ),
  );
  const retailFood = types.some((t) =>
    /bakery|cafe|restaurant|meal_takeaway|food|store|supermarket/.test(t),
  );
  return officeType && !retailFood;
}



function filterRetailOpenPlaces(
  places: DiscoveredPlace[],
  placeType: string,
): DiscoveredPlace[] {
  return places.filter((p) => {
    if (p.openNow === false) return false;
    if (
      (placeType === 'bakery' ||
        placeType === 'cafe' ||
        placeType === 'restaurant') &&
      looksLikeOfficeOnlyPlace({ name: p.name, types: p.types })
    ) {
      return false;
    }
    return true;
  });
}



export type DirectionsStep = {
  lat: number;
  lng: number;
  maneuver: string | null;
  /** Straßenname / Kurztext aus html_instructions (ohne Tags). */
  instruction: string;
  roadName: string | null;
  distanceM: number;
  /** Sekunden für diesen Step (Google/OSRM), wenn bekannt */
  durationSec?: number;
  travelMode?: 'WALKING' | 'TRANSIT' | 'BICYCLING' | string;
};



/**
 * Nur Fuß-/Rad-Abschnitte — Bahn/Bus zählen nicht (200 m + 30 km Zug + 300 m = 500 m).
 */
export function walkingDistanceFromSteps(steps: DirectionsStep[]): number {
  let total = 0;
  for (const s of steps) {
    const mode = (s.travelMode ?? 'WALKING').toUpperCase();
    if (mode === 'TRANSIT') continue;
    if (mode === 'WALKING' || mode === 'BICYCLING' || !s.travelMode) {
      total += Math.max(0, s.distanceM || 0);
    }
  }
  return Math.round(total);
}

/** Summe Step-Dauern (Fuß/Rad), Fallback null. */
export function walkingDurationSecFromSteps(steps: DirectionsStep[]): number | null {
  let total = 0;
  let any = false;
  for (const s of steps) {
    const mode = (s.travelMode ?? 'WALKING').toUpperCase();
    if (mode === 'TRANSIT') continue;
    if (mode === 'WALKING' || mode === 'BICYCLING' || !s.travelMode) {
      const d = s.durationSec;
      if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
        total += d;
        any = true;
      }
    }
  }
  return any ? Math.round(total) : null;
}



/** Haltestelle aus Google Directions transit_details. */
export type TransitStationStop = {
  lat: number;
  lng: number;
  name: string;
  /** departure | arrival | intermediate */
  role: 'departure' | 'arrival' | 'intermediate';
  line?: string | null;
  vehicleType?: string | null;
  numStopsInLeg?: number | null;
};



export type RouteDirectionsResult = {
  steps: DirectionsStep[];
  /** Nur echte ÖPNV-Halte (nicht jede Abbiegung). */
  stations: TransitStationStop[];
  travelMode: PedestrianTravelMode;
  /** Encoded overview polyline for dense spline sampling. */
  overviewPolyline: string | null;
  /** Fallback path: step endpoints (+ origin). */
  pathPoints: Array<{ lat: number; lng: number }>;
  /**
   * Provider-Gesamtdauer in Sekunden (Google Maps / OSRM).
   * Baseline für ETA bevor User-Pace greift.
   */
  durationSec?: number | null;
  /** google | osrm — wer die Dauer geliefert hat */
  durationSource?: 'google' | 'osrm' | null;
  /** Transit-Fahrpreis, nur wenn Google ihn belegt. */
  fareText?: string | null;
};

function mapsKey(): string {
  return (
    env.googleMapsApiKey?.() ||
    env.get('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ||
    (typeof process !== 'undefined'
      ? String(process.env.GOOGLE_MAPS_API_KEY ?? '').trim()
      : '') ||
    ''
  ).trim();
}



export function hasGoogleMapsNavKey(): boolean {
  const k = mapsKey();
  return k.length > 20 && !k.includes('your-');
}



async function fetchJson(
  url: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}



function stripHtml(html: string): string {
  return html
    .replace(/<div[^>]*>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}



function extractRoadName(instruction: string): string | null {
  const m = instruction.match(
    /\b(?:auf|in|onto|on)\s+(?:die\s+|den\s+|das\s+)?([A-ZÄÖÜ][\wÄÖÜäöüß.\-]+(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß.\-]+){0,3})/u,
  );
  if (m?.[1] && m[1].length >= 3) return m[1].trim();
  const street = instruction.match(
    /\b([A-ZÄÖÜ][\wÄÖÜäöüß.\-]*(?:straße|strasse|weg|allee|platz|gasse|damm))\b/iu,
  );
  return street?.[1]?.trim() ?? null;
}



function normalizeManeuver(
  raw: string | null | undefined,
  instruction: string,
): string | null {
  if (raw?.trim()) return raw.trim().toLowerCase();
  const t = instruction.toLowerCase();
  if (/scharf\s+links|sharp left/.test(t)) return 'turn-sharp-left';
  if (/scharf\s+rechts|sharp right/.test(t)) return 'turn-sharp-right';
  if (/leicht\s+links|slight left|halb links/.test(t)) return 'turn-slight-left';
  if (/leicht\s+rechts|slight right|halb rechts/.test(t))
    return 'turn-slight-right';
  if (/\blinks\b|turn left/.test(t)) return 'turn-left';
  if (/\brechts\b|turn right/.test(t)) return 'turn-right';
  if (/geradeaus|continue|weiter/.test(t)) return 'straight';
  if (/ziel|destination|ankunft/.test(t)) return 'arrive';
  return null;
}



/** Google Directions travel modes — niemals driving/Autoverkehr. */
export type PedestrianTravelMode = 'walking' | 'bicycling' | 'transit';



type RawStep = {
  html_instructions?: string;
  maneuver?: string;
  distance?: { value?: number };
  duration?: { value?: number };
  end_location?: { lat?: number; lng?: number };
  start_location?: { lat?: number; lng?: number };
  travel_mode?: string;
  transit_details?: {
    departure_stop?: {
      name?: string;
      location?: { lat?: number; lng?: number };
    };
    arrival_stop?: {
      name?: string;
      location?: { lat?: number; lng?: number };
    };
    num_stops?: number;
    headsign?: string;
    line?: {
      name?: string;
      short_name?: string;
      vehicle?: { name?: string; type?: string };
    };
  };
};



function parseDirectionsSteps(
  data: Record<string, unknown>,
): DirectionsStep[] | null {
  if (data.status !== 'OK') return null;
  const routes = data.routes as Array<{
    legs?: Array<{ steps?: RawStep[] }>;
  }>;
  const legs = routes?.[0]?.legs ?? [];
  const out: DirectionsStep[] = [];
  for (const leg of legs) {
    for (const s of leg.steps ?? []) {
      const lat = s.end_location?.lat;
      const lng = s.end_location?.lng;
      if (lat == null || lng == null) continue;
      const instruction = stripHtml(s.html_instructions ?? '');
      out.push({
        lat,
        lng,
        maneuver: normalizeManeuver(s.maneuver, instruction),
        instruction,
        roadName: extractRoadName(instruction),
        distanceM: Math.round(s.distance?.value ?? 0),
        durationSec:
          typeof s.duration?.value === 'number' && Number.isFinite(s.duration.value)
            ? Math.round(s.duration.value)
            : undefined,
        travelMode: (s.travel_mode as DirectionsStep['travelMode']) ?? undefined,
      });
    }
  }
  return out.length ? out : null;
}

/** Gesamtdauer aller Legs (Google Directions). */
function parseGoogleRouteDurationSec(data: Record<string, unknown>): number | null {
  if (data.status !== 'OK') return null;
  const routes = data.routes as Array<{
    legs?: Array<{ duration?: { value?: number } }>;
  }>;
  const legs = routes?.[0]?.legs ?? [];
  let total = 0;
  let any = false;
  for (const leg of legs) {
    const v = leg.duration?.value;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      total += v;
      any = true;
    }
  }
  return any ? Math.round(total) : null;
}



function parseOverviewPolyline(data: Record<string, unknown>): string | null {
  if (data.status !== 'OK') return null;
  const routes = data.routes as Array<{
    overview_polyline?: { points?: string };
  }>;
  const points = routes?.[0]?.overview_polyline?.points;
  return typeof points === 'string' && points.length > 4 ? points : null;
}



function pathPointsFromSteps(
  origin: { lat: number; lng: number },
  steps: DirectionsStep[],
  destination?: { lat: number; lng: number } | null,
): Array<{ lat: number; lng: number }> {
  const path: Array<{ lat: number; lng: number }> = [
    { lat: origin.lat, lng: origin.lng },
  ];
  for (const s of steps) {
    path.push({ lat: s.lat, lng: s.lng });
  }
  if (
    destination &&
    Number.isFinite(destination.lat) &&
    Number.isFinite(destination.lng)
  ) {
    const last = path[path.length - 1];
    const d =
      last != null
        ? airDistanceMeters(last, destination)
        : Number.POSITIVE_INFINITY;
    if (d > 8) {
      path.push({ lat: destination.lat, lng: destination.lng });
    }
  }
  return path;
}



/**
 * Baut eine Haltestellenkette aus transit_details.
 * Reihenfolge: Einstieg → (Zwischenhalte geschätzt) → Ausstieg je Transit-Leg.
 */
export function parseTransitStationChain(
  data: Record<string, unknown>,
): TransitStationStop[] {
  if (data.status !== 'OK') return [];
  const routes = data.routes as Array<{
    legs?: Array<{ steps?: RawStep[] }>;
  }>;
  const legs = routes?.[0]?.legs ?? [];
  const stations: TransitStationStop[] = [];
  const seen = new Set<string>();



  const push = (s: TransitStationStop) => {
    const key = `${s.name.toLowerCase()}|${s.lat.toFixed(4)}|${s.lng.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    stations.push(s);
  };



  for (const leg of legs) {
    for (const step of leg.steps ?? []) {
      if ((step.travel_mode ?? '').toUpperCase() !== 'TRANSIT') continue;
      const td = step.transit_details;
      if (!td) continue;
      const line =
        td.line?.short_name?.trim() ||
        td.line?.name?.trim() ||
        null;
      const vehicleType =
        td.line?.vehicle?.type?.trim() ||
        td.line?.vehicle?.name?.trim() ||
        null;
      const numStops = td.num_stops ?? null;



      const dep = td.departure_stop;
      if (
        dep?.location?.lat != null &&
        dep?.location?.lng != null &&
        dep.name
      ) {
        push({
          lat: dep.location.lat,
          lng: dep.location.lng,
          name: dep.name.trim(),
          role: 'departure',
          line,
          vehicleType,
          numStopsInLeg: numStops,
        });
      }



      // Zwischenhalte: Google liefert oft nur Start/Ende + num_stops.
      // Ohne Koordinaten interpolieren wir grob entlang der Leg-Linie.
      if (
        numStops != null &&
        numStops > 1 &&
        dep?.location?.lat != null &&
        dep?.location?.lng != null &&
        td.arrival_stop?.location?.lat != null &&
        td.arrival_stop?.location?.lng != null
      ) {
        const aLat = dep.location.lat;
        const aLng = dep.location.lng;
        const bLat = td.arrival_stop.location.lat;
        const bLng = td.arrival_stop.location.lng;
        // num_stops = Zwischenhalte zwischen Start und Ziel (Google-Semantik)
        for (let i = 1; i <= numStops; i++) {
          const t = i / (numStops + 1);
          push({
            lat: aLat + (bLat - aLat) * t,
            lng: aLng + (bLng - aLng) * t,
            name: line
              ? `Zwischenhalt ${i} (${line})`
              : `Zwischenhalt ${i}`,
            role: 'intermediate',
            line,
            vehicleType,
            numStopsInLeg: numStops,
          });
        }
      }



      const arr = td.arrival_stop;
      if (
        arr?.location?.lat != null &&
        arr?.location?.lng != null &&
        arr.name
      ) {
        push({
          lat: arr.location.lat,
          lng: arr.location.lng,
          name: arr.name.trim(),
          role: 'arrival',
          line,
          vehicleType,
          numStopsInLeg: numStops,
        });
      }
    }
  }



  return stations;
}



async function fetchDirectionsRaw(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  travelMode: PedestrianTravelMode,
  signal: AbortSignal,
  timeOpts?: { arriveByMs?: number; departAtMs?: number },
): Promise<Record<string, unknown> | null> {
  const u = new URL(DIRECTIONS);
  u.searchParams.set('origin', `${origin.lat},${origin.lng}`);
  u.searchParams.set('destination', `${destination.lat},${destination.lng}`);
  u.searchParams.set('mode', travelMode);
  u.searchParams.set('language', 'de');
  u.searchParams.set('units', 'metric');
  if (travelMode === 'transit') {
    u.searchParams.set('transit_mode', 'bus|rail|subway|tram|train');
    if (timeOpts?.arriveByMs && timeOpts.arriveByMs > Date.now() + 60_000) {
      u.searchParams.set(
        'arrival_time',
        String(Math.floor(timeOpts.arriveByMs / 1000)),
      );
    } else if (
      timeOpts?.departAtMs &&
      timeOpts.departAtMs > Date.now() + 60_000
    ) {
      u.searchParams.set(
        'departure_time',
        String(Math.floor(timeOpts.departAtMs / 1000)),
      );
    } else {
      u.searchParams.set('departure_time', 'now');
    }
  }
  u.searchParams.set('key', mapsKey());
  return fetchJson(u.toString(), signal);
}



async function fetchOsrmDirectionsRaw(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  travelMode: PedestrianTravelMode,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  // Fuß/Rad: immer FOSSGIS — Env darf nie wieder auf Auto-OSRM rutschen
  const wantBike = travelMode === 'bicycling';
  const base = wantBike ? FOSSGIS_BIKE_OSRM_BASE : FOSSGIS_FOOT_OSRM_BASE;
  const profileSegment = 'driving';
  const u = new URL(
    `${base}/${profileSegment}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`,
  );
  u.searchParams.set('overview', 'full');
  u.searchParams.set('geometries', 'polyline');
  u.searchParams.set('steps', 'true');
  // alternatives=true lastet öffentliche FOSSGIS-Server stark aus (oft +2–6 s).
  // Primärroute reicht; pickShortestOsrmRoute bleibt für den Fall >1 Route.
  u.searchParams.set('alternatives', 'false');
  u.searchParams.set('continue_straight', 'false');
  if (__DEV__) {
    console.log('[nav] OSRM', wantBike ? 'bike' : 'foot', u.origin + u.pathname);
  }
  return fetchJson(u.toString(), signal);
}



function pickShortestOsrmRoute(
  data: Record<string, unknown>,
): { geometry?: string; duration?: number; legs?: Array<{ steps?: any[]; duration?: number; distance?: number }>; distance?: number } | null {
  if (data.code !== 'Ok') return null;
  const routes = data.routes as Array<{
    geometry?: string;
    duration?: number;
    distance?: number;
    legs?: Array<{ steps?: any[]; duration?: number; distance?: number }>;
  }>;
  if (!Array.isArray(routes) || routes.length === 0) return null;
  let best = routes[0]!;
  let bestDist =
    typeof best.distance === 'number'
      ? best.distance
      : (best.legs?.[0]?.distance ?? Number.POSITIVE_INFINITY);
  for (let i = 1; i < routes.length; i++) {
    const r = routes[i]!;
    const d =
      typeof r.distance === 'number'
        ? r.distance
        : (r.legs?.[0]?.distance ?? Number.POSITIVE_INFINITY);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best;
}

function parseOsrmDirectionsSteps(data: Record<string, unknown>, travelMode: string): DirectionsStep[] | null {
  const route = pickShortestOsrmRoute(data);
  const leg = route?.legs?.[0];
  if (!leg?.steps) return null;



  const out: DirectionsStep[] = [];
  for (const s of leg.steps) {
    const lat = s.maneuver?.location?.[1];
    const lng = s.maneuver?.location?.[0];
    if (lat == null || lng == null) continue;



    let maneuver: string | null = null;
    const type = s.maneuver.type;
    const modifier = s.maneuver.modifier;

    

    const mod = (modifier || '').toLowerCase();
    const leftRight =
      mod === 'left'
        ? 'left'
        : mod === 'right'
          ? 'right'
          : mod === 'slight left'
            ? 'slight-left'
            : mod === 'slight right'
              ? 'slight-right'
              : mod === 'sharp left'
                ? 'sharp-left'
                : mod === 'sharp right'
                  ? 'sharp-right'
                  : mod === 'straight'
                    ? 'straight'
                    : mod.replace(/\s+/g, '-') || null;

    if (type === 'turn' || type === 'end of road' || type === 'continue') {
      if (leftRight === 'left') maneuver = 'turn-left';
      else if (leftRight === 'right') maneuver = 'turn-right';
      else if (leftRight === 'slight-left') maneuver = 'turn-slight-left';
      else if (leftRight === 'slight-right') maneuver = 'turn-slight-right';
      else if (leftRight === 'sharp-left') maneuver = 'turn-sharp-left';
      else if (leftRight === 'sharp-right') maneuver = 'turn-sharp-right';
      else if (leftRight === 'straight' || type === 'continue')
        maneuver = 'straight';
      else if (leftRight) maneuver = `turn-${leftRight}`;
    } else if (type === 'fork') {
      if (leftRight === 'left' || leftRight === 'slight-left')
        maneuver = 'fork-left';
      else if (leftRight === 'right' || leftRight === 'slight-right')
        maneuver = 'fork-right';
      else maneuver = 'fork';
    } else if (type === 'off ramp' || type === 'on ramp' || type === 'ramp') {
      if (leftRight?.includes('left')) maneuver = 'ramp-left';
      else if (leftRight?.includes('right')) maneuver = 'ramp-right';
      else maneuver = 'ramp';
    } else if (type === 'roundabout' || type === 'rotary') {
      maneuver = leftRight ? `roundabout-${leftRight}` : 'roundabout';
    } else if (type === 'new name') {
      maneuver = leftRight && leftRight !== 'straight' ? `turn-${leftRight}` : 'straight';
    } else if (type === 'arrive') {
      maneuver = 'arrive';
    }



    const roadName = s.name || null;
    let instruction = type;
    if (modifier) instruction += ' ' + modifier;
    if (roadName) instruction += ' auf ' + roadName;



    out.push({
      lat,
      lng,
      maneuver,
      instruction,
      roadName,
      distanceM: Math.round(s.distance || 0),
      durationSec:
        typeof s.duration === 'number' && Number.isFinite(s.duration)
          ? Math.round(s.duration)
          : undefined,
      travelMode: travelMode === 'bicycling' ? 'BICYCLING' : 'WALKING'
    });
  }
  return out.length ? out : null;
}

function parseOsrmRouteDurationSec(data: Record<string, unknown>): number | null {
  const route = pickShortestOsrmRoute(data);
  const d = route?.duration;
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) return Math.round(d);
  return null;
}

function parseOsrmOverviewPolyline(data: Record<string, unknown>): string | null {
  const route = pickShortestOsrmRoute(data);
  const points = route?.geometry;
  return typeof points === 'string' && points.length > 4 ? points : null;
}



/**
 * Google Directions — nur walking / bicycling / transit (nie driving).
 * Liefert Steps + echte Haltestellenkette bei Transit.
 * Fuß/Rad: immer kürzeste Geh-/Radroute (FOSSGIS + ggf. Google, Auto-Umwege verwerfen).
 */
export async function fetchRouteDirectionsResult(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: PedestrianTravelMode = 'walking',
  timeOpts?: { arriveByMs?: number; departAtMs?: number },
): Promise<RouteDirectionsResult | null> {
  const travelMode: PedestrianTravelMode =
    mode === 'bicycling' || mode === 'transit' ? mode : 'walking';
  const airM = airDistanceMeters(origin, destination);

  try {
    let steps: DirectionsStep[] | null = null;
    let stations: TransitStationStop[] = [];
    let overviewPolyline: string | null = null;
    let usedMode = travelMode;
    let durationSec: number | null = null;
    let durationSource: 'google' | 'osrm' | null = null;
    let fareText: string | null = null;

    type Candidate = {
      steps: DirectionsStep[];
      stations: TransitStationStop[];
      overviewPolyline: string | null;
      durationSec: number | null;
      durationSource: 'google' | 'osrm';
      distanceM: number;
      usedMode: PedestrianTravelMode;
      fareText?: string | null;
    };

    const acceptCandidate = (
      c: Candidate | null,
    ): Candidate | null => {
      if (!c?.steps?.length) return null;
      if (
        travelMode !== 'transit' &&
        isImplausiblePedestrianDetour(c.distanceM, airM, travelMode)
      ) {
        console.warn('[nav] reject car-like detour', {
          routeM: Math.round(c.distanceM),
          airM: Math.round(airM),
          source: c.durationSource,
        });
        return null;
      }
      return c;
    };

    const tryOsrm = async (): Promise<Candidate | null> => {
      if (travelMode === 'transit') return null;
      try {
        const osrmCtrl = new AbortController();
        const osrmTimer = setTimeout(() => osrmCtrl.abort(), 4_000);
        try {
          const osrmData = await fetchOsrmDirectionsRaw(
            origin,
            destination,
            travelMode,
            osrmCtrl.signal,
          );
          if (!osrmData) return null;
          const osrmSteps = parseOsrmDirectionsSteps(osrmData, travelMode);
          if (!osrmSteps?.length) return null;
          const distanceM =
            pickShortestOsrmRoute(osrmData)?.distance ??
            walkingDistanceFromSteps(osrmSteps);
          const dur =
            parseOsrmRouteDurationSec(osrmData) ??
            walkingDurationSecFromSteps(osrmSteps);
          return acceptCandidate({
            steps: osrmSteps,
            stations: [],
            overviewPolyline: parseOsrmOverviewPolyline(osrmData),
            durationSec: dur,
            durationSource: 'osrm',
            distanceM,
            usedMode: travelMode,
          });
        } finally {
          clearTimeout(osrmTimer);
        }
      } catch (err) {
        console.warn('[nav] OSRM routing failed', err);
        return null;
      }
    };

    const tryGoogle = async (): Promise<Candidate | null> => {
      if (!hasGoogleMapsNavKey()) return null;
      const gCtrl = new AbortController();
      const gTimer = setTimeout(() => gCtrl.abort(), FETCH_MS);
      try {
        let data = await fetchDirectionsRaw(
          origin,
          destination,
          travelMode,
          gCtrl.signal,
          timeOpts,
        );
        let gSteps = data ? parseDirectionsSteps(data) : null;
        let gStations =
          data && travelMode === 'transit' ? parseTransitStationChain(data) : [];
        let poly = data ? parseOverviewPolyline(data) : null;
        let dur =
          (data ? parseGoogleRouteDurationSec(data) : null) ??
          (gSteps ? walkingDurationSecFromSteps(gSteps) : null);
        let modeUsed = travelMode;

        if (!gSteps && travelMode !== 'walking') {
          data = await fetchDirectionsRaw(
            origin,
            destination,
            'walking',
            gCtrl.signal,
          );
          gSteps = data ? parseDirectionsSteps(data) : null;
          gStations = [];
          modeUsed = 'walking';
          poly = data ? parseOverviewPolyline(data) : null;
          dur =
            (data ? parseGoogleRouteDurationSec(data) : null) ??
            (gSteps ? walkingDurationSecFromSteps(gSteps) : null);
        }
        if (!gSteps?.length) return null;
        const fareText =
          travelMode === 'transit' && modeUsed === 'transit'
            ? parseGoogleRouteFare(data)
            : null;
        return acceptCandidate({
          steps: gSteps,
          stations: gStations,
          overviewPolyline: poly,
          durationSec: dur,
          durationSource: 'google',
          distanceM: walkingDistanceFromSteps(gSteps),
          usedMode: modeUsed,
          fareText,
        });
      } finally {
        clearTimeout(gTimer);
      }
    };

    const pickShortestCandidate = (
      a: Candidate | null,
      b: Candidate | null,
    ): Candidate | null => {
      if (a && b) return a.distanceM <= b.distanceM ? a : b;
      return a ?? b;
    };

    if (travelMode === 'transit') {
      const g = await tryGoogle();
      if (!g) return null;
      steps = g.steps;
      stations = g.stations;
      overviewPolyline = g.overviewPolyline;
      durationSec = g.durationSec;
      durationSource = g.durationSource;
      usedMode = g.usedMode;
      fareText = g.fareText ?? null;
    } else {
      const tryOfflineCity = async (): Promise<Candidate | null> => {
        try {
          const { routeOfflineOnCityGraph } = await import('./offlineCityRouter');
          const r = await routeOfflineOnCityGraph({
            originLat: origin.lat,
            originLng: origin.lng,
            destLat: destination.lat,
            destLng: destination.lng,
            travelMode,
          });
          if (!r || r.pathPoints.length < 2) return null;
          const localSteps: DirectionsStep[] = r.pathPoints
            .slice(1)
            .map((p, i) => {
              const prev = r.pathPoints[i]!;
              const d = airDistanceMeters(prev, p);
              return {
                lat: p.lat,
                lng: p.lng,
                maneuver: i === 0 ? 'depart' : null,
                instruction: '',
                roadName: null,
                distanceM: d,
                durationSec: Math.round(
                  d / (travelMode === 'bicycling' ? 3.7 : 1.33),
                ),
                travelMode:
                  travelMode === 'bicycling' ? 'BICYCLING' : 'WALKING',
              };
            });
          return acceptCandidate({
            steps: localSteps,
            stations: [],
            overviewPolyline: null,
            durationSec: r.durationSec,
            durationSource: 'osrm',
            distanceM: r.distanceM,
            usedMode: travelMode,
          });
        } catch {
          return null;
        }
      };

      let offline = false;
      try {
        const net = await import('./networkState');
        offline = await net.isDeviceOffline();
      } catch {
        offline = false;
      }

      let best: Candidate | null = null;
      if (offline) {
        best = await tryOfflineCity();
      } else {
        // OSRM zuerst (schnell). Offline-Graph nur Fallback —
        // parallel warten ließ den Stadt-Dijkstra die Linie ~30s blockieren.
        const osrmCand = await tryOsrm();
        if (osrmCand) {
          best = osrmCand;
        } else {
          const [offlineCand, googleCand] = await Promise.all([
            tryOfflineCity(),
            tryGoogle(),
          ]);
          best = pickShortestCandidate(offlineCand, googleCand);
          if (!best && airM > 12_000) best = googleCand;
        }
      }
      const resolved = best;
      if (!resolved) return null;
      steps = resolved.steps;
      stations = resolved.stations;
      overviewPolyline = resolved.overviewPolyline;
      durationSec = resolved.durationSec;
      durationSource = resolved.durationSource;
      usedMode = resolved.usedMode;
    }

    if (!steps) return null;
    if (durationSec == null) {
      durationSec = walkingDurationSecFromSteps(steps);
    }
    return {
      steps,
      stations,
      travelMode: usedMode,
      overviewPolyline,
      pathPoints: pathPointsFromSteps(origin, steps, destination),
      durationSec,
      durationSource,
      fareText,
    };
  } catch {
    return null;
  }
}



/**
 * Google Directions — nur walking / bicycling / transit (nie driving).
 */
export async function fetchRouteDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: PedestrianTravelMode = 'walking',
): Promise<DirectionsStep[] | null> {
  const result = await fetchRouteDirectionsResult(origin, destination, mode);
  return result?.steps ?? null;
}



/** Alias: Fußweg-Route (Default). */
export async function fetchWalkingDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<DirectionsStep[] | null> {
  return fetchRouteDirections(origin, destination, 'walking');
}



export type GeocodeResult = {
  lat: number;
  lng: number;
  label: string;
};



/**
 * Ort online auflösen: Google Geocode → Places Find → Nominatim → Expo.
 * Bias optional (aktueller Standort / Stadt).
 */
/**
 * Ort auflösen — immer €0 zuerst: Cache → Nominatim → Google nur als Fallback.
 * (Alias: gleiche Reihenfolge wie geocodePlaceNameOsmFirst.)
 */
export async function geocodePlaceName(
  query: string,
  opts?: {
    biasLat?: number;
    biasLng?: number;
    cityHint?: string | null;
  },
): Promise<GeocodeResult | null> {
  return geocodePlaceNameOsmFirst(query, opts);
}



/**
 * Ort auflösen — Masterbook Phase 6: OSM (Nominatim) vor Google.
 * Local cache → Nominatim → Google Geocode → Places Find → Expo.
 */
export async function geocodePlaceNameOsmFirst(
  query: string,
  opts?: {
    biasLat?: number;
    biasLng?: number;
    cityHint?: string | null;
    /** Prefer rooftop / street_address over establishment (address nav). */
    preferStreetAddress?: boolean;
  },
): Promise<GeocodeResult | null> {
  let q = query.replace(/\s+/g, ' ').trim();
  if (q.length < 2) return null;
  try {
    const { sanitizeNavDestQuery } = require('./streetAddressQuery') as {
      sanitizeNavDestQuery: (s: string) => string;
    };
    q = sanitizeNavDestQuery(q) || q;
  } catch {
    /* soft */
  }
  let biasLat = opts?.biasLat;
  let biasLng = opts?.biasLng;
  let cityHint = opts?.cityHint ?? null;
  try {
    const { geocodeBiasForSpokenCity } = require('./fuzzyCityResolve') as {
      geocodeBiasForSpokenCity: (s: string) => {
        cityHint: string;
        biasLat?: number;
        biasLng?: number;
      } | null;
    };
    const spoken = geocodeBiasForSpokenCity(q);
    if (spoken) {
      cityHint = spoken.cityHint;
      biasLat = spoken.biasLat;
      biasLng = spoken.biasLng;
    }
  } catch {
    /* soft */
  }
  const biasOpts = { biasLat, biasLng, cityHint };
  let withCity = q;
  try {
    const { composeGeocodeQuery } = require('./fuzzyCityResolve') as {
      composeGeocodeQuery: (query: string, hint?: string | null) => string;
    };
    withCity = composeGeocodeQuery(q, cityHint);
  } catch {
    if (cityHint && !q.toLowerCase().includes(cityHint.toLowerCase())) {
      withCity = `${q}, ${cityHint}`;
    }
  }



  const hitMatchesCity = (hit: GeocodeResult | null): GeocodeResult | null => {
    if (!hit) return null;
    try {
      const { geocodeHitMatchesSpokenCity } = require('./fuzzyCityResolve') as {
        geocodeHitMatchesSpokenCity: (
          h: { lat: number; lng: number; label?: string | null },
          query: string,
        ) => boolean;
      };
      if (!geocodeHitMatchesSpokenCity(hit, q)) return null;
    } catch {
      /* soft */
    }
    return hit;
  };

  try {
    const cached = await getCachedGeocode(withCity);
    const okCached = !opts?.preferStreetAddress ? hitMatchesCity(cached) : null;
    if (okCached) return okCached;
    const cachedQ = await getCachedGeocode(q);
    const okQ = !opts?.preferStreetAddress ? hitMatchesCity(cachedQ) : null;
    if (okQ) return okQ;
  } catch {
    // cache optional
  }



  const fromNominatim = hitMatchesCity(
    await geocodeViaNominatim(withCity, {
      biasLat: biasOpts.biasLat,
      biasLng: biasOpts.biasLng,
      preferStreetAddress: opts?.preferStreetAddress === true,
    }),
  );
  if (fromNominatim) {
    void putCachedGeocode(withCity, fromNominatim).catch(() => undefined);
    return fromNominatim;
  }



  const fromGoogle = hitMatchesCity(
    await geocodeViaGoogle(withCity, {
      biasLat: biasOpts.biasLat,
      biasLng: biasOpts.biasLng,
      preferStreetAddress: opts?.preferStreetAddress,
    }),
  );
  if (fromGoogle) {
    void putCachedGeocode(withCity, fromGoogle).catch(() => undefined);
    return fromGoogle;
  }



  // Straße+Nr.: Places Find überspringen (sonst Establishment statt Adresse)
  if (!opts?.preferStreetAddress) {
    const fromPlaces = hitMatchesCity(
      await findPlaceViaGoogle(withCity, {
        biasLat: biasOpts.biasLat,
        biasLng: biasOpts.biasLng,
      }),
    );
    if (fromPlaces) {
      void putCachedGeocode(withCity, fromPlaces).catch(() => undefined);
      return fromPlaces;
    }
  }



  try {
    const hits = await ExpoLocation.geocodeAsync(withCity);
    const first = hits?.[0];
    if (
      first &&
      Number.isFinite(first.latitude) &&
      Number.isFinite(first.longitude)
    ) {
      const result = hitMatchesCity({
        lat: first.latitude,
        lng: first.longitude,
        label: q,
      });
      if (result) {
        void putCachedGeocode(withCity, result).catch(() => undefined);
        return result;
      }
    }
  } catch {
    // Expo Geocode optional
  }

  // Lokaler Miss (z. B. „Holstentor, Prisdorf“) → ohne Stadt-Bias nochmal
  if (withCity !== q && !opts?.preferStreetAddress) {
    return geocodePlaceNameOsmFirst(q);
  }
  return null;
}



async function geocodeViaGoogle(
  address: string,
  opts?: {
    biasLat?: number;
    biasLng?: number;
    preferStreetAddress?: boolean;
  },
): Promise<GeocodeResult | null> {
  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(GEOCODE);
    u.searchParams.set('address', address);
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    if (opts?.preferStreetAddress) {
      u.searchParams.set('result_type', 'street_address|premise|subpremise');
    }
    if (
      opts?.biasLat != null &&
      opts?.biasLng != null &&
      Number.isFinite(opts.biasLat) &&
      Number.isFinite(opts.biasLng)
    ) {
      u.searchParams.set(
        'bounds',
        `${opts.biasLat - 0.35},${opts.biasLng - 0.35}|${opts.biasLat + 0.35},${opts.biasLng + 0.35}`,
      );
    }
    const data = await fetchJson(u.toString(), ctrl.signal);
    const results = (data?.results as Array<{
      formatted_address?: string;
      types?: string[];
      geometry?: { location?: { lat?: number; lng?: number } };
    }>) ?? [];
    const preferTypes = new Set([
      'street_address',
      'premise',
      'subpremise',
    ]);
    const hit =
      (opts?.preferStreetAddress
        ? results.find((r) =>
            (r.types ?? []).some((t) => preferTypes.has(t)),
          )
        : null) ?? results[0];
    const lat = hit?.geometry?.location?.lat;
    const lng = hit?.geometry?.location?.lng;
    if (lat == null || lng == null) {
      // Fallback ohne result_type-Filter, wenn street_address leer
      if (opts?.preferStreetAddress && results.length === 0) {
        return geocodeViaGoogle(address, {
          biasLat: opts.biasLat,
          biasLng: opts.biasLng,
          preferStreetAddress: false,
        });
      }
      return null;
    }
    return {
      lat,
      lng,
      label: (hit.formatted_address ?? address).trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}



async function findPlaceViaGoogle(
  input: string,
  opts?: { biasLat?: number; biasLng?: number },
): Promise<GeocodeResult | null> {
  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(
      'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
    );
    u.searchParams.set('input', input);
    u.searchParams.set('inputtype', 'textquery');
    u.searchParams.set('fields', 'geometry,name,formatted_address');
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    if (
      opts?.biasLat != null &&
      opts?.biasLng != null &&
      Number.isFinite(opts.biasLat) &&
      Number.isFinite(opts.biasLng)
    ) {
      u.searchParams.set(
        'locationbias',
        `circle:40000@${opts.biasLat},${opts.biasLng}`,
      );
    }
    const data = await fetchJson(u.toString(), ctrl.signal);
    const candidates = (data?.candidates as Array<{
      name?: string;
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>) ?? [];
    const hit = candidates[0];
    const lat = hit?.geometry?.location?.lat;
    const lng = hit?.geometry?.location?.lng;
    if (lat == null || lng == null) return null;
    return {
      lat,
      lng,
      label: (hit.name ?? hit.formatted_address ?? input).trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}



async function geocodeViaNominatim(
  query: string,
  opts?: {
    biasLat?: number;
    biasLng?: number;
    preferStreetAddress?: boolean;
  },
): Promise<GeocodeResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'json');
    const wantMany =
      opts?.preferStreetAddress === true ||
      (opts?.biasLat != null && opts?.biasLng != null);
    u.searchParams.set('limit', wantMany ? '5' : '1');
    u.searchParams.set('addressdetails', '1');
    if (
      opts?.biasLat != null &&
      Number.isFinite(opts.biasLat) &&
      opts?.biasLng != null &&
      Number.isFinite(opts.biasLng)
    ) {
      const d = 0.4;
      u.searchParams.set(
        'viewbox',
        `${opts.biasLng - d},${opts.biasLat + d},${opts.biasLng + d},${opts.biasLat - d}`,
      );
      u.searchParams.set('bounded', '0');
    }
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
    }>;
    const hits = (rows ?? [])
      .map((hit) => {
        const lat = hit?.lat != null ? Number(hit.lat) : NaN;
        const lng = hit?.lon != null ? Number(hit.lon) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          lat,
          lng,
          label: (hit.display_name ?? query).trim(),
        };
      })
      .filter((h): h is GeocodeResult => h != null);
    if (!hits.length) return null;
    let spokenCity: string | null = null;
    try {
      const { spokenCityFromQuery } = require('./fuzzyCityResolve') as {
        spokenCityFromQuery: (q: string) => string | null;
      };
      spokenCity = spokenCityFromQuery(query);
    } catch {
      spokenCity = null;
    }
    if (spokenCity) {
      const key = spokenCity.toLowerCase();
      const cityHit = hits.find((h) => h.label.toLowerCase().includes(key));
      if (cityHit) return cityHit;
      try {
        const {
          nearestCityName,
          loadNearbyCitiesFromIndex,
          citiesShareCore,
        } = require('./fuzzyCityResolve') as {
          nearestCityName: (
            lat: number,
            lng: number,
            cities: Array<{ name: string; lat: number; lng: number }>,
          ) => string | null;
          loadNearbyCitiesFromIndex: () => Array<{
            name: string;
            lat: number;
            lng: number;
          }>;
          citiesShareCore: (a: string, b: string) => boolean;
        };
        const cities = loadNearbyCitiesFromIndex();
        const nearHit = hits.find((h) => {
          const dc = nearestCityName(h.lat, h.lng, cities);
          return Boolean(dc && citiesShareCore(spokenCity!, dc));
        });
        if (nearHit) return nearHit;
      } catch {
        /* soft */
      }
      return null;
    }
    if (
      opts?.biasLat != null &&
      Number.isFinite(opts.biasLat) &&
      opts?.biasLng != null &&
      Number.isFinite(opts.biasLng)
    ) {
      let best = hits[0]!;
      let bestD = airDistanceMeters(
        { lat: opts.biasLat, lng: opts.biasLng },
        best,
      );
      for (const h of hits) {
        const d = airDistanceMeters(
          { lat: opts.biasLat, lng: opts.biasLng },
          h,
        );
        if (d < bestD) {
          best = h;
          bestD = d;
        }
      }
      return best;
    }
    return hits[0]!;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mehrere Nominatim-Treffer ohne GPS-Viewbox — damit Hamburg und Lübeck
 * beide auftauchen, nicht nur der nächste zum Standort.
 */
export async function geocodeNamedPlaceHits(
  query: string,
): Promise<GeocodeResult[]> {
  let q = query.replace(/\s+/g, ' ').trim();
  if (q.length < 2) return [];
  try {
    const { sanitizeNavDestQuery } = require('./streetAddressQuery') as {
      sanitizeNavDestQuery: (s: string) => string;
    };
    q = sanitizeNavDestQuery(q) || q;
  } catch {
    /* soft */
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'json');
    u.searchParams.set('limit', '5');
    u.searchParams.set('addressdetails', '1');
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
      },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
    }>;
    return (rows ?? [])
      .map((hit) => {
        const lat = hit?.lat != null ? Number(hit.lat) : NaN;
        const lng = hit?.lon != null ? Number(hit.lon) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          lat,
          lng,
          label: (hit.display_name ?? q).trim(),
        };
      })
      .filter((h): h is GeocodeResult => h != null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}



/**
 * Sichtbare Orte in der Nähe (Apotheke, Bäckerei, Park …).
 * Local SQLite → OSM Overpass (€0) → Google Places only if OSM empty.
 */
export async function fetchNearbyPlaceLandmarks(
  lat: number,
  lng: number,
  radiusM = 55,
): Promise<PlaceLandmark[]> {
  const queryRadius = Math.max(radiusM, Math.min(LANDMARK_CACHE_QUERY_RADIUS_M, 500));
  try {
    const cached = await queryCachedLandmarksNear(lat, lng, queryRadius, 'landmark');
    const inRadius = cached.filter((c) => c.distanceM <= radiusM + 15);
    if (inRadius.length >= 1) {
      return inRadius.slice(0, 4);
    }
  } catch {
    // cache miss / unavailable
  }



  // OSM-first (€0)
  try {
    const osm = await searchOsmLandmarksNear(lat, lng, radiusM);
    if (osm.length > 0) {
      const mapped: PlaceLandmark[] = osm.slice(0, 4).map((p) => ({
        name: p.name,
        types: p.types,
        lat: p.lat,
        lng: p.lng,
        distanceM: p.distanceM,
      }));
      void upsertCachedLandmarks(
        'landmark',
        mapped.map((p) => ({
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          types: p.types,
        })),
      ).catch(() => undefined);
      scheduleImmediateCommunityCachePush();
      return mapped;
    }
  } catch {
    // continue to Google
  }



  if (!hasGoogleMapsNavKey()) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(PLACES_NEARBY);
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('radius', String(Math.max(25, Math.min(radiusM, 90))));
    u.searchParams.set('type', 'point_of_interest');
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrl.signal);
    let results =
      (data?.results as Array<{
        name?: string;
        types?: string[];
        geometry?: { location?: { lat?: number; lng?: number } };
        business_status?: string;
      }>) ?? [];



    if (results.length < 2) {
      const u2 = new URL(PLACES_NEARBY);
      u2.searchParams.set('location', `${lat},${lng}`);
      u2.searchParams.set('radius', String(radiusM));
      u2.searchParams.set('keyword', 'geschäft laden café restaurant');
      u2.searchParams.set('language', 'de');
      u2.searchParams.set('key', mapsKey());
      const data2 = await fetchJson(u2.toString(), ctrl.signal);
      results = (data2?.results as typeof results) ?? results;
    }



    const out: PlaceLandmark[] = [];
    for (const r of results) {
      if (r.business_status === 'CLOSED_PERMANENTLY') continue;
      if (r.business_status === 'CLOSED_TEMPORARILY') continue;
      const plat = r.geometry?.location?.lat;
      const plng = r.geometry?.location?.lng;
      const name = (r.name ?? '').trim();
      if (!name || plat == null || plng == null) continue;
      const types = r.types ?? [];
      const distanceM = haversine(lat, lng, plat, plng);
      if (distanceM > radiusM + 15) continue;
      out.push({ name, types, lat: plat, lng: plng, distanceM });
    }
    out.sort((a, b) => {
      const as = landmarkScore(a.types);
      const bs = landmarkScore(b.types);
      if (as !== bs) return bs - as;
      return a.distanceM - b.distanceM;
    });
    const top = out.slice(0, 4);
    if (top.length) {
      void upsertCachedLandmarks(
        'landmark',
        top.map((p) => ({
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          types: p.types,
        })),
      ).catch(() => undefined);
      scheduleImmediateCommunityCachePush();
    }
    return top;
  } finally {
    clearTimeout(timer);
  }
}



function landmarkScore(types: string[]): number {
  let s = 0;
  const blob = types.join(' ');
  if (/pharmacy|drugstore|bakery|cafe|church|park|school|post_office/.test(blob))
    s += 5;
  if (/supermarket|convenience_store|restaurant|florist|hair_care/.test(blob))
    s += 3;
  if (/store|point_of_interest|establishment/.test(blob)) s += 1;
  if (/route|political|locality/.test(blob)) s -= 3;
  return s;
}



const PLACES_TEXT =
  'https://maps.googleapis.com/maps/api/place/textsearch/json';
const PLACES_NEW_TEXT = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_NEW_NEARBY = 'https://places.googleapis.com/v1/places:searchNearby';
/** Pro SKU — Discovery: Name/Ort/Types. Kein Rating/Telefon/Hours. */
const PLACES_NEW_FIELD_MASK_DISCOVERY =
  'places.id,places.displayName,places.location,places.types,places.businessStatus';
/**
 * Enterprise SKU — nur wenn openNow/Kontakt/Rating wirklich gebraucht wird
 * (ein Call, nicht bei jedem Expanding-Ring).
 */
const PLACES_NEW_FIELD_MASK_ENRICH =
  'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.types,places.businessStatus,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.currentOpeningHours.openNow,places.currentOpeningHours.periods,places.regularOpeningHours.periods';

/** Kurzzeit-Cache: gleiche Text-Query nicht doppelt bezahlen (Agents parallel). */
const TEXT_SEARCH_MEMO_TTL_MS = 8 * 60_000;
const textSearchMemo = new Map<
  string,
  { at: number; places: DiscoveredPlace[] }
>();

function textSearchMemoKey(
  query: string,
  lat: number,
  lng: number,
  radiusM: number,
  enrich: boolean,
): string {
  return `${enrich ? 'E' : 'D'}|${query.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}|${Math.round(radiusM / 500)}`;
}

function takeTextSearchMemo(key: string): DiscoveredPlace[] | null {
  const hit = textSearchMemo.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TEXT_SEARCH_MEMO_TTL_MS) {
    textSearchMemo.delete(key);
    return null;
  }
  return hit.places.map((p) => ({ ...p }));
}

function putTextSearchMemo(key: string, places: DiscoveredPlace[]): void {
  if (textSearchMemo.size > 80) {
    const oldest = [...textSearchMemo.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    )[0];
    if (oldest) textSearchMemo.delete(oldest[0]);
  }
  textSearchMemo.set(key, { at: Date.now(), places: places.map((p) => ({ ...p })) });
}


type PlacesNewHit = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  types?: string[];
  businessStatus?: string;
  currentOpeningHours?: {
    openNow?: boolean;
    periods?: Array<{
      open?: { day?: number; hour?: number; minute?: number };
      close?: { day?: number; hour?: number; minute?: number };
    }>;
  };
  regularOpeningHours?: {
    periods?: Array<{
      open?: { day?: number; hour?: number; minute?: number };
      close?: { day?: number; hour?: number; minute?: number };
    }>;
  };
};



type PlacePeriod = {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { day?: number; hour?: number; minute?: number };
};

/** Google Places day: 0=Sunday … 6=Saturday → open/close minutes am Besuchstag. */
function openCloseMinFromPeriods(
  periods: PlacePeriod[] | undefined,
  visitMs?: number | null,
): {
  opensAtMin: number | null;
  closesAtMin: number | null;
  closedThisDay: boolean;
} {
  if (!periods?.length) {
    return { opensAtMin: null, closesAtMin: null, closedThisDay: false };
  }
  const jsDay = new Date(visitMs ?? Date.now()).getDay(); // 0=Sun
  let opensAtMin: number | null = null;
  let closesAtMin: number | null = null;
  let matched = false;
  for (const p of periods) {
    const openDay = p.open?.day;
    const open = p.open;
    const close = p.close;
    if (openDay == null || open?.hour == null) continue;
    const openMin = open.hour * 60 + (open.minute ?? 0);
    if (openDay === jsDay) {
      matched = true;
      opensAtMin =
        opensAtMin == null ? openMin : Math.min(opensAtMin, openMin);
    }
    if (close?.day == null || close.hour == null) continue;
    const closeMin = close.hour * 60 + (close.minute ?? 0);
    // Overnight: close day after open day
    if (close.day !== openDay && openDay === jsDay) {
      closesAtMin =
        closesAtMin == null
          ? closeMin + 24 * 60
          : Math.max(closesAtMin, closeMin + 24 * 60);
      continue;
    }
    if (close.day === jsDay || openDay === jsDay) {
      closesAtMin =
        closesAtMin == null ? closeMin : Math.max(closesAtMin, closeMin);
    }
  }
  return {
    opensAtMin,
    closesAtMin,
    closedThisDay: !matched,
  };
}

function mapPlacesNewHits(
  places: PlacesNewHit[],
  origin: { lat: number; lng: number },
  forVisitMs?: number | null,
): DiscoveredPlace[] {
  const out: DiscoveredPlace[] = [];
  for (const r of places) {
    if (
      r.businessStatus === 'CLOSED_PERMANENTLY' ||
      r.businessStatus === 'CLOSED_TEMPORARILY'
    ) {
      continue;
    }
    const lat = r.location?.latitude;
    const lng = r.location?.longitude;
    const name = (r.displayName?.text ?? '').trim();
    if (!name || lat == null || lng == null) continue;
    const types = r.types ?? ['restaurant'];
    const foodish = types.some((t) =>
      /bakery|cafe|restaurant|meal_takeaway|food|supermarket|store/i.test(t),
    );
    const openRaw = r.currentOpeningHours?.openNow;
    // Discovery ohne Hours-Feld: unbekannt = true (nicht alle Gastro wegfiltern).
    // Enrich mit Hours: foodish + unknown → false (nicht als offen verkaufen).
    const hasHoursField = r.currentOpeningHours != null;
    const openNow =
      openRaw === true
        ? true
        : openRaw === false
          ? false
          : hasHoursField && foodish
            ? false
            : true;
    const phone =
      (r.internationalPhoneNumber || r.nationalPhoneNumber || '').trim() || null;
    const hours = openCloseMinFromPeriods(
      (r.currentOpeningHours?.periods?.length
        ? r.currentOpeningHours.periods
        : r.regularOpeningHours?.periods) as PlacePeriod[] | undefined,
      forVisitMs,
    );
    out.push({
      placeId: r.id ?? `new:${name}`,
      name,
      types,
      lat,
      lng,
      distanceM: Math.round(haversine(origin.lat, origin.lng, lat, lng)),
      rating: typeof r.rating === 'number' ? r.rating : null,
      ratingCount:
        typeof r.userRatingCount === 'number' ? r.userRatingCount : null,
      websiteUri: sanitizePlaceWebsiteUri(r.websiteUri),
      phoneNumber: phone,
      openNow,
      opensAtMin: hours.opensAtMin,
      closesAtMin: hours.closesAtMin,
      closedOnVisitDay: hours.closedThisDay,
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}



/** Places API (New) Text Search — Legacy Places ist oft REQUEST_DENIED. */
async function searchPlacesByTextNew(opts: {
  query: string;
  lat: number;
  lng: number;
  radiusM: number;
  signal?: AbortSignal;
  includedType?: string | null;
  /** Enterprise-Felder (Hours/Rating/Kontakt) — teurer, nur bei Bedarf. */
  enrich?: boolean;
  /** Besuchsmoment — Öffnungs-Perioden für diesen Wochentag */
  forVisitMs?: number | null;
}): Promise<{ places: DiscoveredPlace[]; hardError: boolean }> {
  if (!hasGoogleMapsNavKey()) return { places: [], hardError: false };
  const enrich = Boolean(opts.enrich);
  const memoKey = textSearchMemoKey(
    opts.query,
    opts.lat,
    opts.lng,
    opts.radiusM,
    enrich,
  );
  const memo = takeTextSearchMemo(memoKey);
  if (memo) return { places: memo, hardError: false };
  try {
    const body: Record<string, unknown> = {
      textQuery: opts.query,
      languageCode: 'de',
      maxResultCount: 12,
      locationBias: {
        circle: {
          center: { latitude: opts.lat, longitude: opts.lng },
          radius: Math.max(500, Math.min(opts.radiusM, 50_000)),
        },
      },
    };
    if (opts.includedType) body.includedType = opts.includedType;
    const res = await fetch(PLACES_NEW_TEXT, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsKey(),
        'X-Goog-FieldMask': enrich
          ? PLACES_NEW_FIELD_MASK_ENRICH
          : PLACES_NEW_FIELD_MASK_DISCOVERY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (__DEV__) {
        const errTxt = await res.text().catch(() => '');
        console.warn(
          '[places] new-text http',
          res.status,
          errTxt.slice(0, 160),
        );
      }
      return { places: [], hardError: res.status >= 400 };
    }
    const data = (await res.json()) as { places?: PlacesNewHit[] };
    const mapped = mapPlacesNewHits(
      data.places ?? [],
      {
        lat: opts.lat,
        lng: opts.lng,
      },
      opts.forVisitMs,
    );
    console.log('[places] new-text', opts.query.slice(0, 40), mapped.length);
    const places = mapped.slice(0, 12);
    putTextSearchMemo(memoKey, places);
    return { places, hardError: false };
  } catch (err) {
    console.warn(
      '[places] new-text fail',
      err instanceof Error ? err.message : err,
    );
    const aborted =
      (err instanceof Error && err.name === 'AbortError') ||
      (typeof err === 'object' &&
        err != null &&
        'name' in err &&
        (err as { name?: string }).name === 'AbortError');
    return { places: [], hardError: !aborted };
  }
}



async function searchPlacesNearbyNew(opts: {
  lat: number;
  lng: number;
  radiusM: number;
  includedType: string;
  signal?: AbortSignal;
  enrich?: boolean;
}): Promise<{ places: DiscoveredPlace[]; hardError: boolean }> {
  if (!hasGoogleMapsNavKey()) return { places: [], hardError: false };
  try {
    const enrich = Boolean(opts.enrich);
    const res = await fetch(PLACES_NEW_NEARBY, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsKey(),
        'X-Goog-FieldMask': enrich
          ? PLACES_NEW_FIELD_MASK_ENRICH
          : PLACES_NEW_FIELD_MASK_DISCOVERY,
      },
      body: JSON.stringify({
        includedTypes: [opts.includedType],
        maxResultCount: 12,
        languageCode: 'de',
        locationRestriction: {
          circle: {
            center: { latitude: opts.lat, longitude: opts.lng },
            radius: Math.max(100, Math.min(opts.radiusM, 50_000)),
          },
        },
      }),
    });
    if (!res.ok) {
      if (__DEV__) {
        const errTxt = await res.text().catch(() => '');
        console.warn(
          '[places] new-nearby http',
          res.status,
          errTxt.slice(0, 120),
        );
      }
      return { places: [], hardError: res.status >= 400 };
    }
    const data = (await res.json()) as { places?: PlacesNewHit[] };
    const mapped = mapPlacesNewHits(data.places ?? [], {
      lat: opts.lat,
      lng: opts.lng,
    });
    if (__DEV__) {
      console.log('[places] new-nearby', opts.includedType, mapped.length);
    }
    return { places: mapped.slice(0, 12), hardError: false };
  } catch (err) {
    if (__DEV__) console.warn('[places] new-nearby fail', err);
    const aborted =
      err instanceof Error && err.name === 'AbortError';
    return { places: [], hardError: !aborted };
  }
}



/**
 * Text Search — zuverlässig für Küche + Stadt („Burger Pinneberg“).
 * Primär Places API (New) Discovery; Legacy nur bei hartem API-Fehler.
 */
export async function searchPlacesByText(opts: {
  query: string;
  lat: number;
  lng: number;
  radiusM?: number;
  /** Override Auto-Detect (z. B. park für Spazierwünsche). */
  includedType?: string | null;
  /** Hours/Rating/Kontakt mitladen (Enterprise) — Default false. */
  enrich?: boolean;
  /** Besuchsmoment für Öffnungszeiten am richtigen Wochentag */
  forVisitMs?: number | null;
}): Promise<DiscoveredPlace[]> {
  if (!hasGoogleMapsNavKey()) return [];
  const q = opts.query.replace(/\s+/g, ' ').trim();
  if (q.length < 3) return [];
  const radius = Math.max(500, Math.min(opts.radiusM ?? 15_000, 50_000));
  const enrich = Boolean(opts.enrich);
  // Places API (New) mit eigenem Timeout — nicht mit Legacy-Abort teilen
  let hardError = false;
  try {
    const includedType =
      opts.includedType !== undefined
        ? opts.includedType
        : /\b(bakery|bäckerei|baeckerei)\b/i.test(q)
          ? 'bakery'
          : /\b(café|cafe|kaffee|coffee)\b/i.test(q) &&
              !/\b(restaurant|abendessen|mittag)\b/i.test(q)
            ? 'cafe'
            : /\b(frühstück|fruehstueck|breakfast|brunch)\b/i.test(q)
              ? 'cafe'
              : /\b(steak|grill|vegan|vegetar|sushi|pizza|pannfisch|pannenfisch|pfannfisch|fischrestaurant)\b/i.test(q)
                ? null
                : /\brestaurant|gastro|abendessen|mittag\b/i.test(q)
                ? 'restaurant'
                : /\b(packstation|parcel.?locker|paketautomat)\b/i.test(q)
                  ? 'parcel_lockers'
                  : null;
    const neuCtrl = new AbortController();
    const neuTimer = setTimeout(() => neuCtrl.abort(), 7_000);
    try {
      const neu = await searchPlacesByTextNew({
        query: q,
        lat: opts.lat,
        lng: opts.lng,
        radiusM: radius,
        signal: neuCtrl.signal,
        includedType,
        enrich,
        forVisitMs: opts.forVisitMs,
      });
      if (neu.places.length) return neu.places;
      hardError = neu.hardError;
      // Gastro-Textsuche: leere New-API darf Legacy versuchen (Maps findet oft Review-Treffer).
      const foodLive =
        /\b(restaurant|steak|grill|pizza|sushi|vegan|vegetar|gastro|essen|pannfisch|pannenfisch|pfannfisch|fischrestaurant|\bfisch\b)\b/i.test(
          q,
        );
      if (!hardError && !foodLive) return [];
    } finally {
      clearTimeout(neuTimer);
    }
  } catch {
    hardError = true;
  }

  if (!hardError) return [];
  // Packstation: kein Legacy-Namenssuche-Fallback (sonst DHL-Suche statt Locker).
  if (/\b(packstation|parcel.?locker|paketautomat)\b/i.test(q)) return [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(PLACES_TEXT);
    u.searchParams.set('query', q);
    u.searchParams.set('location', `${opts.lat},${opts.lng}`);
    u.searchParams.set('radius', String(radius));
    u.searchParams.set('language', 'de');
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrl.signal);
    const status = String(data?.status ?? 'NO_BODY');
    const results =
      (data?.results as Array<{
        place_id?: string;
        name?: string;
        types?: string[];
        geometry?: { location?: { lat?: number; lng?: number } };
        rating?: number;
        opening_hours?: { open_now?: boolean };
      }>) ?? [];
    if (__DEV__ && results.length === 0) {
      console.warn(
        '[places] text-legacy',
        status,
        q.slice(0, 48),
        data?.error_message ? String(data.error_message).slice(0, 80) : '',
      );
    }
    const out: DiscoveredPlace[] = [];
    for (const r of results) {
      const lat = r.geometry?.location?.lat;
      const lng = r.geometry?.location?.lng;
      if (lat == null || lng == null || !r.name?.trim()) continue;
      const distanceM = Math.round(haversine(opts.lat, opts.lng, lat, lng));
      out.push({
        placeId: r.place_id ?? `text:${r.name}`,
        name: r.name.trim(),
        types: r.types ?? [],
        lat,
        lng,
        distanceM,
        rating: typeof r.rating === 'number' ? r.rating : null,
        openNow: r.opening_hours?.open_now ?? true,
      });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, 12);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}



/**
 * Open-now Places Nearby by type (bakery, cafe, toilet, …).
 * Immer: Local cache → OSM (€0) → Google nur wenn zu wenig Treffer.
 */
export async function searchOpenPlacesAhead(opts: {
  lat: number;
  lng: number;
  placeType: string;
  radiusM?: number;
  openNow?: boolean;
  /** Optional Google Nearby keyword (cuisine expand, toilet, …) */
  keyword?: string | null;
}): Promise<DiscoveredPlace[]> {
  // Toilet etc. stay tight; expand-search may request up to Google Nearby max (~50 km).
  const requested = opts.radiusM ?? 800;
  const maxAllowed = requested > 5_000 ? 50_000 : 5_000;
  const radius = Math.max(80, Math.min(requested, maxAllowed));
  const cuisineKeyword = Boolean(opts.keyword?.trim());
  const foodishType =
    opts.placeType === 'bakery' ||
    opts.placeType === 'cafe' ||
    opts.placeType === 'restaurant' ||
    opts.placeType === 'fast_food';
  // openNow streng + Gastro → Enrich-Mask (Enterprise) nur für den Google-Fallback.
  const needEnrich = opts.openNow !== false && foodishType;

  // Local cache first (€0)
  try {
    const cached = await queryCachedDiscoveriesNear(
      opts.lat,
      opts.lng,
      opts.placeType,
      Math.min(radius, LANDMARK_CACHE_QUERY_RADIUS_M),
    );
    let filtered = filterRetailOpenPlaces(
      opts.openNow === false
        ? cached
        : cached.filter((c) => c.openNow !== false),
      opts.placeType,
    );
    if (cuisineKeyword) {
      const kw = opts.keyword!.trim().toLowerCase();
      filtered = filtered.filter((p) =>
        `${p.name} ${p.types.join(' ')}`.toLowerCase().includes(kw),
      );
    }
    if (filtered.length >= 2) {
      return filtered.slice(0, 8);
    }
  } catch {
    // continue to network
  }

  // OSM zuerst (€0) — auch Gastro/Keyword; Google nur als Lückenfüller.
  try {
    const osm = await searchOsmPlacesNearby({
      lat: opts.lat,
      lng: opts.lng,
      placeType: opts.placeType,
      radiusM: Math.min(radius, 30_000),
      keyword: opts.keyword,
    });
    if (osm.length > 0) {
      const mapped: DiscoveredPlace[] = osm.slice(0, 8).map((p) => ({
        placeId: p.placeId,
        name: p.name,
        types: p.types,
        lat: p.lat,
        lng: p.lng,
        distanceM: p.distanceM,
        rating: null,
        openNow: p.openNow,
      }));
      const top = filterRetailOpenPlaces(
        opts.openNow === false
          ? mapped
          : mapped.filter((p) => p.openNow !== false),
        opts.placeType,
      );
      if (top.length >= 1) {
        void upsertCachedLandmarks(
          'discovery',
          top.map((p) => ({
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            types: p.types,
            placeId: p.placeId,
            rating: p.rating,
            openNow: p.openNow,
          })),
          opts.placeType,
        ).catch(() => undefined);
        scheduleImmediateCommunityCachePush();
        // Bei strengem openNow+Food: OSM reicht für Liste; Google nur wenn 0 Treffer.
        if (top.length >= 2 || !needEnrich) {
          return top.slice(0, 8);
        }
      }
    }
  } catch {
    // OSM empty/fail → Google
  }

  if (!hasGoogleMapsNavKey()) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const googleType =
      opts.placeType === 'toilet'
        ? 'point_of_interest'
        : opts.placeType === 'wifi' ||
            opts.placeType === 'drinking_water' ||
            opts.placeType === 'phone_charge' ||
            opts.placeType === 'powerbank'
          ? 'point_of_interest'
          : opts.placeType === 'ice_cream'
            ? 'point_of_interest'
            : opts.placeType === 'outlet_cafe'
              ? 'cafe'
              : opts.placeType === 'hospital'
                ? 'hospital'
                : opts.placeType === 'fast_food'
                  ? 'restaurant'
                  : opts.placeType;

    // Places API (New) zuerst — Legacy Nearby nur bei hartem Fehler
    if (
      googleType === 'restaurant' ||
      googleType === 'cafe' ||
      googleType === 'bakery' ||
      googleType === 'meal_takeaway'
    ) {
      const neu = await searchPlacesNearbyNew({
        lat: opts.lat,
        lng: opts.lng,
        radiusM: radius,
        includedType: googleType === 'meal_takeaway' ? 'restaurant' : googleType,
        signal: ctrl.signal,
        enrich: needEnrich,
      });
      if (neu.places.length) {
        const filtered = filterRetailOpenPlaces(
          opts.openNow === false
            ? neu.places
            : neu.places.filter((p) => p.openNow !== false),
          opts.placeType,
        );
        if (filtered.length) {
          void upsertCachedLandmarks(
            'discovery',
            filtered.slice(0, 8).map((p) => ({
              name: p.name,
              lat: p.lat,
              lng: p.lng,
              types: p.types,
              placeId: p.placeId,
              rating: p.rating,
              openNow: p.openNow,
            })),
            opts.placeType,
          ).catch(() => undefined);
          return filtered.slice(0, 8);
        }
        // Keine offenen Retail-Treffer → leer (nicht geschlossene Büros zurückgeben)
        if (!neu.hardError) return [];
      }
      if (opts.keyword?.trim()) {
        const textNeu = await searchPlacesByTextNew({
          query: `${opts.keyword.trim()} Restaurant`,
          lat: opts.lat,
          lng: opts.lng,
          radiusM: radius,
          signal: ctrl.signal,
          includedType: 'restaurant',
          enrich: needEnrich,
        });
        if (textNeu.places.length) {
          return filterRetailOpenPlaces(textNeu.places, opts.placeType).slice(
            0,
            8,
          );
        }
        if (!textNeu.hardError && !neu.hardError) return [];
      } else if (!neu.hardError) {
        return [];
      }
    }

    const u = new URL(PLACES_NEARBY);
    u.searchParams.set('location', `${opts.lat},${opts.lng}`);
    u.searchParams.set('radius', String(radius));
    if (opts.keyword?.trim()) {
      u.searchParams.set('keyword', opts.keyword.trim());
      if (opts.placeType && opts.placeType !== 'point_of_interest') {
        u.searchParams.set('type', googleType);
      }
    } else if (opts.placeType === 'toilet') {
      u.searchParams.set('keyword', 'toilette wc restroom');
    } else if (opts.placeType === 'drugstore') {
      // Legacy Nearby Search has no reliable drugstore type — keyword finds DM/Rossmann.
      u.searchParams.set('keyword', 'dm rossmann drogerie chemist');
    } else if (opts.placeType === 'wifi') {
      u.searchParams.set('keyword', 'wlan wifi internet café');
    } else if (opts.placeType === 'drinking_water') {
      u.searchParams.set('keyword', 'trinkwasser trinkbrunnen drinking water');
    } else if (opts.placeType === 'ice_cream') {
      u.searchParams.set('keyword', 'eisdiele eis ice cream');
    } else if (opts.placeType === 'powerbank') {
      // Nie DE-„laden“ (Geschäft) — sonst Heimat-/Souvenirläden ohne Ladeoption.
      u.searchParams.set(
        'keyword',
        'powerbank voozaa cheetah batterybar rechargy chargery',
      );
    } else if (opts.placeType === 'phone_charge') {
      u.searchParams.set(
        'keyword',
        'powerbank charging station usb charger device charging station',
      );
    } else if (opts.placeType === 'outlet_cafe') {
      // type=cafe + openNow; keyword ohne „laden“ (DE = Shop).
      u.searchParams.set('keyword', 'usb steckdose');
      u.searchParams.set('type', 'cafe');
    } else {
      u.searchParams.set('type', googleType);
    }
    u.searchParams.set('language', 'de');
    if (opts.openNow !== false) {
      u.searchParams.set('opennow', 'true');
    }
    u.searchParams.set('key', mapsKey());

    const data = await fetchJson(u.toString(), ctrl.signal);
    const nearbyStatus = String(data?.status ?? 'NO_BODY');
    let results =
      (data?.results as Array<{
        place_id?: string;
        name?: string;
        types?: string[];
        geometry?: { location?: { lat?: number; lng?: number } };
        rating?: number;
        opening_hours?: { open_now?: boolean };
        business_status?: string;
      }>) ?? [];
    if (__DEV__ && results.length === 0) {
      console.warn(
        '[places] nearby-legacy',
        nearbyStatus,
        opts.placeType,
        opts.keyword ?? '',
        data?.error_message ? String(data.error_message).slice(0, 80) : '',
      );
    }

    // Toilet / sparse types: keyword fallback without opennow if empty
    if (results.length < 2 && opts.placeType === 'toilet') {
      const u2 = new URL(PLACES_NEARBY);
      u2.searchParams.set('location', `${opts.lat},${opts.lng}`);
      u2.searchParams.set('radius', String(radius));
      u2.searchParams.set('keyword', 'toilette');
      u2.searchParams.set('language', 'de');
      u2.searchParams.set('key', mapsKey());
      const data2 = await fetchJson(u2.toString(), ctrl.signal);
      results = (data2?.results as typeof results) ?? results;
    }

    const out: DiscoveredPlace[] = [];
    const foodishLegacy = foodishType;
    for (const r of results) {
      if (r.business_status === 'CLOSED_PERMANENTLY') continue;
      if (r.business_status === 'CLOSED_TEMPORARILY') continue;
      const plat = r.geometry?.location?.lat;
      const plng = r.geometry?.location?.lng;
      const name = (r.name ?? '').trim();
      if (!name || plat == null || plng == null) continue;
      const openNow =
        r.opening_hours?.open_now == null
          ? opts.openNow === false
            ? true
            : foodishLegacy
              ? false
              : true
          : Boolean(r.opening_hours.open_now);
      if (opts.openNow !== false && openNow === false) {
        continue;
      }
      out.push({
        placeId: r.place_id ?? `${plat.toFixed(5)},${plng.toFixed(5)}`,
        name,
        types: r.types ?? [],
        lat: plat,
        lng: plng,
        distanceM: Math.round(haversine(opts.lat, opts.lng, plat, plng)),
        rating: typeof r.rating === 'number' ? r.rating : null,
        openNow,
      });
    }
    out.sort((a, b) => a.distanceM - b.distanceM);
    const top = filterRetailOpenPlaces(out, opts.placeType).slice(0, 8);
    if (top.length) {
      void upsertCachedLandmarks(
        'discovery',
        top.map((p) => ({
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          types: p.types,
          placeId: p.placeId,
          rating: p.rating,
          openNow: p.openNow,
        })),
        opts.placeType,
      ).catch(() => undefined);
      scheduleImmediateCommunityCachePush();
    }
    return top;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}



function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}



export async function reverseGeocodeStreet(
  lat: number,
  lng: number,
): Promise<string | null> {
  // Nominatim reverse (€0) vor Google Geocode
  try {
    const ctrlN = new AbortController();
    const timerN = setTimeout(() => ctrlN.abort(), FETCH_MS);
    try {
      const u = new URL('https://nominatim.openstreetmap.org/reverse');
      u.searchParams.set('lat', String(lat));
      u.searchParams.set('lon', String(lng));
      u.searchParams.set('format', 'json');
      u.searchParams.set('addressdetails', '1');
      u.searchParams.set('zoom', '18');
      const res = await fetch(u.toString(), {
        signal: ctrlN.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
        },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          address?: {
            road?: string;
            pedestrian?: string;
            path?: string;
            residential?: string;
          };
          display_name?: string;
        };
        const road =
          data.address?.road ||
          data.address?.pedestrian ||
          data.address?.path ||
          data.address?.residential;
        if (road && road.trim().length >= 2) return road.trim();
        const first = data.display_name?.split(',')[0]?.trim();
        if (first && first.length >= 3) return first;
      }
    } finally {
      clearTimeout(timerN);
    }
  } catch {
    /* Nominatim optional → Google */
  }

  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(GEOCODE);
    u.searchParams.set('latlng', `${lat},${lng}`);
    u.searchParams.set('language', 'de');
    u.searchParams.set('result_type', 'route');
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrl.signal);
    const results = (data?.results as Array<{
      address_components?: Array<{ long_name?: string; types?: string[] }>;
      formatted_address?: string;
    }>) ?? [];
    for (const r of results) {
      const route = r.address_components?.find((c) =>
        c.types?.includes('route'),
      );
      if (route?.long_name) return route.long_name;
    }
    const first = results[0]?.formatted_address;
    if (first) {
      const part = first.split(',')[0]?.trim();
      if (part && part.length >= 3) return part;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}



export async function streetViewAvailable(
  lat: number,
  lng: number,
): Promise<boolean> {
  // Serve from local 6-month cache — never poll Google timestamps on hits
  try {
    const cached = await getCachedStreetView(lat, lng, 0);
    if (cached) return cached.available;
  } catch {
    /* miss */
  }



  if (!hasGoogleMapsNavKey()) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4_000);
  try {
    const u = new URL(SV_META);
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('key', mapsKey());
    const data = await fetchJson(u.toString(), ctrl.signal);
    const ok = data?.status === 'OK';
    // Negative + positive availability cached (no image yet)
    void putCachedStreetView({
      lat,
      lng,
      headingDeg: 0,
      base64: null,
      available: ok,
    }).catch(() => undefined);
    return ok;
  } finally {
    clearTimeout(timer);
  }
}



/** Street-View-Static als Base64 — local 6-month cache first, download once on miss. */
export async function fetchStreetViewImageBase64(
  lat: number,
  lng: number,
  headingDeg: number,
): Promise<string | null> {
  try {
    const cached = await getCachedStreetView(lat, lng, headingDeg);
    // Nur negativ cachen blockiert; available ohne Bild → weiter laden
    if (cached && !cached.available) return null;
    if (cached?.base64) return cached.base64;
  } catch {
    /* miss → network once */
  }



  if (!hasGoogleMapsNavKey()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const u = new URL(SV_STATIC);
    u.searchParams.set('size', '640x640');
    u.searchParams.set('location', `${lat},${lng}`);
    u.searchParams.set('heading', String(Math.round(headingDeg)));
    u.searchParams.set('pitch', '5');
    u.searchParams.set('fov', '85');
    u.searchParams.set('source', 'outdoor');
    u.searchParams.set('key', mapsKey());
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) {
      void putCachedStreetView({
        lat,
        lng,
        headingDeg,
        base64: null,
        available: false,
      }).catch(() => undefined);
      return null;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 800) {
      void putCachedStreetView({
        lat,
        lng,
        headingDeg,
        base64: null,
        available: false,
      }).catch(() => undefined);
      return null;
    }
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    // btoa available in RN hermes
    const b64 =
      typeof btoa === 'function' ? btoa(binary) : null;
    if (b64) {
      void putCachedStreetView({
        lat,
        lng,
        headingDeg,
        base64: b64,
        available: true,
      }).catch(() => undefined);
      scheduleImmediateCommunityCachePush();
    }
    return b64;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}



export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}



/**
 * Directions-Schritte → NavWaypoints mit Maneuver/Straßenname.
 */
export function directionsToWaypoints(steps: DirectionsStep[]): NavWaypoint[] {
  return steps.map((s) => ({
    lat: s.lat,
    lng: s.lng,
    maneuver: s.maneuver,
    roadName: s.roadName,
    instruction: s.instruction,
    cue: null,
    landmark: null,
    isStation: false,
  }));
}



/** Transit-Stops → NavWaypoints mit isStation. */
export function transitStopsToNavWaypoints(
  stops: TransitStationStop[],
): NavWaypoint[] {
  return stops.map((s) => ({
    lat: s.lat,
    lng: s.lng,
    maneuver: null,
    roadName: null,
    instruction: s.line ? `${s.name} · ${s.line}` : s.name,
    cue: null,
    landmark: s.name,
    isStation: true,
    stationName: s.name,
  }));
}
