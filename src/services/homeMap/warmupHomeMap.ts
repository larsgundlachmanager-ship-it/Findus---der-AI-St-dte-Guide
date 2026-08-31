/**
 * Native-only Homescreen-Karte — MapLibre Native (kein WebView-HTML mehr).
 * Warmup: Display-Extract + GPS. CDN/MapLibre-JS nur noch für Disk-Cache-Tools.
 */

import { hydrateLastKnownMapGps, seedMapCameraGps } from '../location/lastKnownMapGps';
import { getCachedUserProfile } from '../userProfileService';
import { env } from '../../config/env';
import {
  ensureCityMapExtract,
  hydrateDisplayExtract,
  peekDisplayExtract,
  prepareExtractForDisplay,
  rememberDisplayExtract,
} from './cityMapExtract';
import { noteSplashStarted } from './splashReadyGate';
import { useMapExtractStore } from '../../store/useMapExtractStore';
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

function pushSnapToMapStore(
  cityId: string,
  snap: {
    lat: number;
    lng: number;
    extract: NonNullable<ReturnType<typeof peekDisplayExtract>>['extract'];
  },
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
    // Nur Last-Known GPS blockiert kurz — Extract läuft parallel.
    await Promise.race([
      hydrateLastKnownMapGps(),
      new Promise((resolve) => setTimeout(resolve, 350)),
    ]);
    // Native: Extract bis 2 s ausholen — kritisches Pfadstück für ≤5 s.
    await Promise.race([
      extractWarm,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    try {
      const { warmupGpsDuringIntro } = await import('../locationService');
      void warmupGpsDuringIntro();
    } catch {
      /* Permission / GPS optional */
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
