/**
 * Map scene orchestration — writes map stores, no React.
 * Extract-Load: nur HomePresenceMap (queueViewportExtract) — hier kein Dual-Load.
 */

import { buildNavRouteMapPayload } from '../navigation/navRouteMapPayload';
import { useMapRouteStore } from '../../store/useMapRouteStore';
import { useSensorStore } from '../../store/useSensorStore';
import { useGpsStore } from '../../store/useGpsStore';
import { useMapExtractStore } from '../../store/useMapExtractStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  getMapDisplayHeadingDegSticky,
  subscribeMapHeading,
} from '../navigation/liveDeviceHeading';
import { reclipExtractIfNeeded } from './mapExtractLoader';
import {
  ensureRegionalFallback,
  prefetchRegionalFallbackForGps,
} from './regionalFallbackLoader';
import { prefetchRegionalFallbackAfterOnline } from './regionalFallbackPrefetch';
import { scheduleFogRecompute } from './fogTrackEngine';
import type { WalkTrackPoint } from '../discovery/walkTrackService';
import { HOME_MAP_REGIONAL_AFTER_MS } from './homeMapBootSchedule';

let started = false;
let unsubHeading: (() => void) | null = null;
let unsubGps: (() => void) | null = null;
let unsubNav: (() => void) | null = null;
let navSyncTimer: ReturnType<typeof setInterval> | null = null;
let regionalBootTimer: ReturnType<typeof setTimeout> | null = null;
let regionalBootAllowed = false;

let lastNavRouteJson = '';

function syncNavRouteOnce(): void {
  try {
    const payload = buildNavRouteMapPayload();
    const json = payload == null ? 'null' : JSON.stringify(payload);
    if (json === lastNavRouteJson) return;
    lastNavRouteJson = json;
    useMapRouteStore.getState().setRoute(payload);
  } catch {
    /* soft */
  }
}

function stopNavSyncTimer(): void {
  if (navSyncTimer) {
    clearInterval(navSyncTimer);
    navSyncTimer = null;
  }
}

function startNavSyncTimer(): void {
  if (navSyncTimer) return;
  syncNavRouteOnce();
  navSyncTimer = setInterval(syncNavRouteOnce, 800);
}

export function startMapSceneController(): void {
  if (started) return;
  started = true;
  regionalBootAllowed = false;

  const h0 = getMapDisplayHeadingDegSticky();
  if (h0 != null) useSensorStore.getState().reportHeading(h0);

  unsubHeading = subscribeMapHeading((deg) => {
    useSensorStore.getState().reportHeading(deg);
  });

  const gps0 = useGpsStore.getState();
  if (gps0.lat != null && gps0.lng != null) {
    useSensorStore.getState().reportGps({
      lat: gps0.lat,
      lng: gps0.lng,
      accuracy: gps0.accuracyM,
    });
  }

  unsubGps = useGpsStore.subscribe((s, prev) => {
    if (
      s.lat === prev.lat &&
      s.lng === prev.lng &&
      s.accuracyM === prev.accuracyM
    ) {
      return;
    }
    if (s.lat != null && s.lng != null) {
      useSensorStore.getState().reportGps({
        lat: s.lat,
        lng: s.lng,
        accuracy: s.accuracyM,
      });
    }
  });

  // Route-Sync nur während Navigation — idle Home kein 800-ms-Poll.
  if (useFinnusStore.getState().navActive) startNavSyncTimer();
  else syncNavRouteOnce();
  unsubNav = useFinnusStore.subscribe((s, prev) => {
    if (s.navActive === prev.navActive) return;
    if (s.navActive) startNavSyncTimer();
    else {
      stopNavSyncTimer();
      lastNavRouteJson = 'null';
      useMapRouteStore.getState().setRoute(null);
    }
  });

  // Regional nur ohne Stadt-Extract und erst nach Kern-Boot.
  if (regionalBootTimer) clearTimeout(regionalBootTimer);
  regionalBootTimer = setTimeout(() => {
    regionalBootTimer = null;
    regionalBootAllowed = true;
    if (useMapExtractStore.getState().extract) return;
    const gpsBoot = useGpsStore.getState();
    if (gpsBoot.lat != null && gpsBoot.lng != null) {
      void prefetchRegionalFallbackAfterOnline(gpsBoot.lat, gpsBoot.lng);
    } else {
      void syncRegionalFallbackIndexesOnly();
    }
  }, HOME_MAP_REGIONAL_AFTER_MS);
}

async function syncRegionalFallbackIndexesOnly(): Promise<void> {
  try {
    const { syncRegionalFallbackIndex } = await import('./regionalFallbackPrefetch');
    await syncRegionalFallbackIndex('de');
    await syncRegionalFallbackIndex('eu');
  } catch {
    /* soft */
  }
}

export function stopMapSceneController(): void {
  started = false;
  regionalBootAllowed = false;
  if (regionalBootTimer) {
    clearTimeout(regionalBootTimer);
    regionalBootTimer = null;
  }
  unsubHeading?.();
  unsubHeading = null;
  unsubGps?.();
  unsubGps = null;
  unsubNav?.();
  unsubNav = null;
  stopNavSyncTimer();
}

export function onMapViewport(
  lat: number,
  lng: number,
  zoom: number,
): void {
  // Extract-Load nur über HomePresenceMap.queueViewportExtract (kein Dual-Path).
  if (zoom < 7.2) {
    reclipExtractIfNeeded(lat, lng);
  }
  if (!regionalBootAllowed) return;
  if (useMapExtractStore.getState().extract) return;
  void ensureRegionalFallback(lat, lng);
}

export function onMapGpsFog(
  lat: number,
  lng: number,
  walkTrack: WalkTrackPoint[],
): void {
  scheduleFogRecompute(walkTrack, { lat, lng });
  if (!regionalBootAllowed) return;
  if (useMapExtractStore.getState().extract) return;
  void prefetchRegionalFallbackForGps(lat, lng);
}
