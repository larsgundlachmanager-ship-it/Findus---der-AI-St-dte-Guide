/**
 * Karte + GPS während des Intros vorbereiten — nicht erst nach Splash-Ende.
 * Native-Pfad: nur Display-Extract + GPS (kein toter MapLibre-CDN-Warmup).
 */

import { hydrateLastKnownMapGps, seedMapCameraGps } from '../location/lastKnownMapGps';
import { getCachedUserProfile } from '../userProfileService';
import { env } from '../../config/env';
import {
  ensureMapLibreDiskCache,
  MAPLIBRE_CSS_URL,
  MAPLIBRE_JS_URL,
  peekMapLibreHtmlAssets,
} from './mapLibreDiskCache';
import {
  ensureCityMapExtract,
  hydrateDisplayExtract,
  peekDisplayExtract,
  prepareExtractForDisplay,
  rememberDisplayExtract,
} from './cityMapExtract';
import { HOME_MAP_VECTOR_STYLE } from './homeMapStyle';
import { noteSplashStarted } from './splashReadyGate';
import { useMapExtractStore } from '../../store/useMapExtractStore';
import { HOME_MAP_USE_NATIVE } from './homeMapNativeGate';
import {
  markHomeMapBoot,
  markHomeMapBootStart,
} from './homeMapBootMetrics';

let inflight: Promise<void> | null = null;
let cameraWarmUntilMs = 0;

export function noteSplashMapWarmup(ms = 8_000): void {
  cameraWarmUntilMs = Math.max(cameraWarmUntilMs, Date.now() + ms);
}

export function canWarmupMapCamera(): boolean {
  return Date.now() < cameraWarmUntilMs;
}

function prefetchHomeMapAssets(): void {
  if (peekMapLibreHtmlAssets()?.jsInline) return;
  for (const url of [MAPLIBRE_JS_URL, MAPLIBRE_CSS_URL, HOME_MAP_VECTOR_STYLE]) {
    void fetch(url, { method: 'GET', cache: 'force-cache' }).catch(
      () => undefined,
    );
  }
}

function pushSnapToMapStore(
  cityId: string,
  snap: { lat: number; lng: number; extract: NonNullable<ReturnType<typeof peekDisplayExtract>>['extract'] },
): void {
  useMapExtractStore.getState().setExtract(cityId, snap.extract, {
    lat: snap.lat,
    lng: snap.lng,
  });
}

async function warmupCityExtract(): Promise<void> {
  const cityId = (
    getCachedUserProfile()?.cityId ||
    env.cityId() ||
    ''
  ).toLowerCase();
  if (!cityId) return;
  await hydrateDisplayExtract(cityId);
  const existing = peekDisplayExtract(cityId);
  if (existing?.extract) {
    pushSnapToMapStore(cityId, existing);
    markHomeMapBoot('displayHydrate');
    // Kein Vollextract während des Intros — JSON.parse von 10–28 MB friert Dock/Mic ein.
    return;
  }
  const full = await ensureCityMapExtract(cityId);
  if (!full) return;
  const seed = seedMapCameraGps();
  const lat =
    seed?.lat ?? (full.bbox.south + full.bbox.north) / 2;
  const lng =
    seed?.lng ?? (full.bbox.west + full.bbox.east) / 2;
  const extract = prepareExtractForDisplay(full, lat, lng);
  rememberDisplayExtract({
    cityId,
    lat,
    lng,
    atMs: Date.now(),
    extract,
  });
  pushSnapToMapStore(cityId, { lat, lng, extract });
  markHomeMapBoot('displayHydrate');
}

export function warmupHomeMapDuringIntro(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    markHomeMapBootStart();
    noteSplashStarted();
    noteSplashMapWarmup(4_000);
    // Display-Snapshot sofort — Straßen sollen vor Places im RAM sein.
    const extractWarm = warmupCityExtract();
    void extractWarm;
    // Legacy WebView: CDN/Disk-Cache. Native: Skip — spart Splash-CPU/Netz.
    if (!HOME_MAP_USE_NATIVE) {
      prefetchHomeMapAssets();
    }
    // Nur Last-Known GPS blockiert kurz — Extract läuft parallel.
    await Promise.race([
      hydrateLastKnownMapGps(),
      new Promise((resolve) => setTimeout(resolve, 350)),
    ]);
    if (HOME_MAP_USE_NATIVE) {
      // Native: Extract bis 2 s ausholen — kritisches Pfadstück für ≤5 s.
      await Promise.race([
        extractWarm,
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    } else {
      void Promise.race([
        Promise.all([ensureMapLibreDiskCache(), extractWarm]),
        new Promise((resolve) => setTimeout(resolve, 1_200)),
      ]).catch(() => undefined);
    }
    try {
      const { warmupGpsDuringIntro } = await import('../locationService');
      void warmupGpsDuringIntro();
    } catch {
      /* Permission / GPS optional */
    }
  })();
  return inflight;
}
