/**
 * Standort-basierte ETA: bevorzugt echte Routenmeter (Directions/OSRM),
 * Fallback Luftlinie. Pace aus User-Profil (walk/bike).
 */

import { haversineMeters } from '../../db/database';
import { getCachedUserProfile } from '../userProfileService';
import { resolvePersonaEngine } from '../personaEngine';
import { env } from '../../config/env';
import {
  applyWalkEtaWeatherMultiplier,
  type WeatherRoutingAdjustment,
} from '../weather/weatherRouting';
import { getWeatherRoutingAdjustment } from '../weatherService';
import {
  getPlanBikeMPerMin,
  getPlanWalkMPerMin,
} from '../mobility/paceProfile';
import {
  fetchRouteDirectionsResult,
  walkingDistanceFromSteps,
} from './googleMapsNav';
import {
  formatObstacleBufferHint,
} from './routeObstaclePolicy';
import { scanRouteObstaclesWithFallback } from './routeObstacleScan';

/** Grobe Insel-Bounding-Box Wangerooge (ohne Harlesiel-Festland). */
const WANGEROOGE_BOX = {
  latMin: 53.772,
  latMax: 53.805,
  lngMin: 7.84,
  lngMax: 7.935,
};

/** Typische Zusatzzeiten: Überfahrt + Inselbahn Dorf. */
const FERRY_CROSSING_MIN = 55;
const INSELBAHN_MIN = 18;
const FERRY_BUFFER_MIN = 10;

/** 3340 → „3,3 km“, unter 1 km → „850 m“. */
export function formatDistanceKmOrM(distanceM: number): string {
  const m = Math.max(0, Math.round(distanceM));
  if (m >= 1000) {
    return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  }
  return `${m} m`;
}

export type TravelEta = {
  /** Distanz Route oder Fallback Luftlinie (m) */
  distanceM: number;
  /** true = Directions/OSRM, false = Luftlinie */
  routed: boolean;
  /** Reine Fuß-/Rad-Minuten aus Distanz (ohne Logistik) */
  directWalkMinutes: number;
  /** Rad-Minuten (User-Pace), parallel zur Fuß-ETA */
  bikeMinutes: number;
  /** Realistische Gesamtzeit inkl. Logistik (aktueller Modus) */
  totalMinutes: number;
  /** Kurzlabel für Spickzettel / Prompt */
  label: string;
  /** Prompt-Hinweis für das LLM */
  promptHint: string;
  needsFerryLogistics: boolean;
  /** Wetter-Multiplikator (1 = normal, ~1.12 bei Starkregen) */
  weatherWalkMultiplier: number;
  weatherVoiceAlert: string | null;
  /** Bahnübergang/Treppen-Puffer (Brücke = 0) */
  obstacleBufferMin: number;
  /** Kurztext für Prompt/Debug, leer wenn kein Puffer */
  obstacleHint: string | null;
};

function cityId(): string {
  return (
    getCachedUserProfile()?.cityId ||
    env.cityId?.() ||
    ''
  )
    .toString()
    .trim()
    .toLowerCase();
}

function walkMpm(): number {
  return getPlanWalkMPerMin();
}

function bikeMpm(): number {
  return getPlanBikeMPerMin();
}

export function walkMinutesForDistanceM(
  distanceM: number,
  weather?: WeatherRoutingAdjustment | null,
): number {
  const base = Math.max(1, Math.ceil(distanceM / walkMpm()));
  const adj = weather ?? getWeatherRoutingAdjustment();
  return applyWalkEtaWeatherMultiplier(base, adj.walkEtaMultiplier);
}

export function bikeMinutesForDistanceM(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / bikeMpm()));
}

export function isInsideWangeroogeIsland(lat: number, lng: number): boolean {
  return (
    lat >= WANGEROOGE_BOX.latMin &&
    lat <= WANGEROOGE_BOX.latMax &&
    lng >= WANGEROOGE_BOX.lngMin &&
    lng <= WANGEROOGE_BOX.lngMax
  );
}

function buildEtaFromDistance(opts: {
  distanceM: number;
  routed: boolean;
  destName?: string;
  userLat: number;
  userLng: number;
  destLat: number;
  destLng: number;
  obstacleBufferMin?: number;
  obstacleHint?: string | null;
}): TravelEta {
  const weather = getWeatherRoutingAdjustment(opts.destName);
  const distanceM = Math.round(opts.distanceM);
  const directWalkMinutes = walkMinutesForDistanceM(distanceM, weather);
  const bikeMinutes = bikeMinutesForDistanceM(distanceM);
  const obstacleBufferMin = Math.max(0, Math.round(opts.obstacleBufferMin ?? 0));
  const obstacleHint =
    (opts.obstacleHint ?? '').trim() ||
    (obstacleBufferMin > 0
      ? `Routen-Hindernisse: +${obstacleBufferMin} Min Puffer.`
      : null);
  const name = (opts.destName ?? 'Ziel').trim() || 'Ziel';
  const rainHint = weather.isHeavyRain
    ? ` WETTER: Starkregen — ETA bereits um ~${Math.round((weather.walkEtaMultiplier - 1) * 100)}% erhöht.` +
      (weather.voiceAlert ? ` Voice: „${weather.voiceAlert}"` : '')
    : '';
  const obstaclePrompt = obstacleHint ? ` ${obstacleHint}` : '';
  const distLabel = opts.routed
    ? `Route ${formatDistanceKmOrM(distanceM)}`
    : `Luftlinie ${formatDistanceKmOrM(distanceM)} (Route unklar)`;

  const onWangerooge = cityId() === 'wangerooge';
  const userOnIsland = isInsideWangeroogeIsland(opts.userLat, opts.userLng);
  const destOnIsland = isInsideWangeroogeIsland(opts.destLat, opts.destLng);

  if (onWangerooge && !userOnIsland && destOnIsland) {
    const islandWalk = Math.min(directWalkMinutes, 25);
    const totalMinutes =
      FERRY_BUFFER_MIN +
      FERRY_CROSSING_MIN +
      INSELBAHN_MIN +
      islandWalk +
      obstacleBufferMin;
    const label = `Fähre + Inselbahn, insgesamt circa ${totalMinutes} Minuten`;
    return {
      distanceM,
      routed: opts.routed,
      directWalkMinutes,
      bikeMinutes,
      totalMinutes,
      label,
      needsFerryLogistics: true,
      weatherWalkMultiplier: weather.walkEtaMultiplier,
      weatherVoiceAlert: weather.voiceAlert,
      obstacleBufferMin,
      obstacleHint,
      promptHint:
        `ETA PFLICHT (vom GPS, nicht erfinden): ${name} ist auf der Insel, Nutzer noch NICHT auf Wangerooge ` +
        `(${distLabel}). Sag ehrlich: erst Fähre (circa ${FERRY_CROSSING_MIN} Minuten), ` +
        `dann Inselbahn (circa ${INSELBAHN_MIN} Minuten), danach kurzer Fußweg — insgesamt circa ${totalMinutes} Minuten. ` +
        `NIEMALS „circa 5 Minuten Fußweg“ oder reine Fußweg-ETA ohne Fähre/Inselbahn.` +
        rainHint +
        obstaclePrompt,
    };
  }

  if (distanceM > 4_000) {
    const totalMinutes =
      Math.max(directWalkMinutes, 45) + obstacleBufferMin;
    const label =
      directWalkMinutes >= 60
        ? `eher ${Math.round(directWalkMinutes / 60)} Stunden unterwegs`
        : `circa ${totalMinutes} Minuten (nicht nur kurzer Fußweg)`;
    return {
      distanceM,
      routed: opts.routed,
      directWalkMinutes,
      bikeMinutes,
      totalMinutes,
      label,
      needsFerryLogistics: false,
      weatherWalkMultiplier: weather.walkEtaMultiplier,
      weatherVoiceAlert: weather.voiceAlert,
      obstacleBufferMin,
      obstacleHint,
      promptHint:
        `ETA vom aktuellen GPS (${distLabel}): circa ${directWalkMinutes} Min zu Fuß / ${bikeMinutes} Min Rad (User-Pace). ` +
        `Keine kürzere Zeit erfinden.` +
        rainHint +
        obstaclePrompt,
    };
  }

  const mobility = resolvePersonaEngine(getCachedUserProfile()).mobilityMode;
  const modeLabel = mobility === 'bike' ? 'Rad' : 'Fußweg';
  const baseMinutes = mobility === 'bike' ? bikeMinutes : directWalkMinutes;
  const totalMinutes = baseMinutes + obstacleBufferMin;
  const bufferLabel =
    obstacleBufferMin > 0 ? ` inkl. ${obstacleBufferMin} Min Puffer` : '';
  return {
    distanceM,
    routed: opts.routed,
    directWalkMinutes,
    bikeMinutes,
    totalMinutes,
    label: `${modeLabel} circa ${totalMinutes} Minuten${bufferLabel} · ${formatDistanceKmOrM(distanceM)} Route`,
    needsFerryLogistics: false,
    weatherWalkMultiplier: weather.walkEtaMultiplier,
    weatherVoiceAlert: weather.voiceAlert,
    obstacleBufferMin,
    obstacleHint,
    promptHint:
      `ETA vom aktuellen GPS zu „${name}“: ${distLabel} ≈ ${directWalkMinutes} Min Fuß / ${bikeMinutes} Min Rad (persönliches Tempo). ` +
      `Nur diese Zahlen nutzen — keine Fantasie-Minuten, keine Luftlinie als Route verkaufen.` +
      rainHint +
      obstaclePrompt,
  };
}

/**
 * Sync-Fallback: Luftlinie + User-Pace (nur wenn Route noch nicht da).
 */
export function estimateTravelEta(opts: {
  userLat: number;
  userLng: number;
  destLat: number;
  destLng: number;
  destName?: string;
}): TravelEta {
  const distanceM = Math.round(
    haversineMeters(opts.userLat, opts.userLng, opts.destLat, opts.destLng),
  );
  return buildEtaFromDistance({
    ...opts,
    distanceM,
    routed: false,
  });
}

/** In-Memory-Cache gegen OSRM/Directions-Bursts (Proposal + 3-Strike). */
const ROUTED_ETA_CACHE = new Map<string, { atMs: number; eta: TravelEta }>();
const ROUTED_ETA_TTL_MS = 12 * 60_000;
const ROUTED_ETA_CACHE_MAX = 80;

function routedEtaCacheKey(opts: {
  userLat: number;
  userLng: number;
  destLat: number;
  destLng: number;
  mode: string;
}): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(opts.userLat)},${r(opts.userLng)}>${r(opts.destLat)},${r(opts.destLng)}:${opts.mode}`;
}

/**
 * Echte Route (walking) → Meter + User-Pace. Fallback Luftlinie.
 * Cached pro Origin/Destination (TTL), damit 3-Strike nicht spamt.
 */
export async function estimateTravelEtaRouted(opts: {
  userLat: number;
  userLng: number;
  destLat: number;
  destLng: number;
  destName?: string;
  mode?: 'walking' | 'bicycling';
  /** ETA-Fragen: kein Obstacle-Scan → deutlich schneller */
  skipObstacles?: boolean;
}): Promise<TravelEta> {
  const mode = opts.mode ?? 'walking';
  const key = routedEtaCacheKey({ ...opts, mode });
  const hit = ROUTED_ETA_CACHE.get(key);
  if (hit && Date.now() - hit.atMs < ROUTED_ETA_TTL_MS) {
    return hit.eta;
  }

  let eta: TravelEta;
  try {
    const result = await fetchRouteDirectionsResult(
      { lat: opts.userLat, lng: opts.userLng },
      { lat: opts.destLat, lng: opts.destLng },
      mode,
    );
    if (result?.steps?.length) {
      const routedM = walkingDistanceFromSteps(result.steps);
      if (routedM > 20) {
        const points =
          result.pathPoints?.length >= 2
            ? result.pathPoints
            : [
                { lat: opts.userLat, lng: opts.userLng },
                { lat: opts.destLat, lng: opts.destLng },
              ];
        let obstacleBufferMin = 0;
        let obstacleHint: string | null = null;
        if (!opts.skipObstacles) {
          try {
            const obstacles = await scanRouteObstaclesWithFallback({
              points,
              instructions: result.steps.map((s) => s.instruction),
            });
            obstacleBufferMin = obstacles.bufferMin;
            obstacleHint = formatObstacleBufferHint(obstacles) || null;
          } catch {
            /* soft — ETA ohne Hindernis-Puffer */
          }
        }
        eta = buildEtaFromDistance({
          userLat: opts.userLat,
          userLng: opts.userLng,
          destLat: opts.destLat,
          destLng: opts.destLng,
          destName: opts.destName,
          distanceM: routedM,
          routed: true,
          obstacleBufferMin,
          obstacleHint,
        });
        if (ROUTED_ETA_CACHE.size >= ROUTED_ETA_CACHE_MAX) {
          const oldest = ROUTED_ETA_CACHE.keys().next().value;
          if (oldest) ROUTED_ETA_CACHE.delete(oldest);
        }
        ROUTED_ETA_CACHE.set(key, { atMs: Date.now(), eta });
        return eta;
      }
    }
  } catch {
    /* soft — no air-line for user ETA */
  }
  // Hands-free rule: never invent air-line minutes for the user.
  // Last resort flagged routed:false — speech must not read as precise ETA.
  eta = estimateTravelEta(opts);
  eta = {
    ...eta,
    label: 'Route wird berechnet…',
    promptHint:
      `ROUTE NOCH NICHT GELADEN — keine Minuten/km aus Luftlinie vorlesen. ` +
      (eta.promptHint ?? ''),
  };
  ROUTED_ETA_CACHE.set(key, { atMs: Date.now(), eta });
  return eta;
}

export function formatEtaBullet(eta: TravelEta): string {
  return eta.label;
}

/** Speech-Zeile: Fuß + Rad mit Routenmetern. */
export function formatWalkBikeEtaSpeech(eta: TravelEta): string {
  const km = formatDistanceKmOrM(eta.distanceM);
  return `Route ca. ${km} — zu Fuß etwa ${eta.directWalkMinutes} Minuten, mit dem Rad eher ${eta.bikeMinutes} Minuten`;
}

/** Speech-Lead nur Rad — für „wie lange mit dem Fahrrad“. */
export function formatBikeEtaSpeech(eta: TravelEta): string {
  const km = formatDistanceKmOrM(eta.distanceM);
  return `Mit dem Rad brauchst du etwa ${eta.bikeMinutes} Minuten (${km})`;
}

/** Speech-Lead nur Fuß. */
export function formatWalkEtaSpeech(eta: TravelEta): string {
  const km = formatDistanceKmOrM(eta.distanceM);
  return `Zu Fuß brauchst du etwa ${eta.directWalkMinutes} Minuten (${km})`;
}
