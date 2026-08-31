/**
 * Letzter Karten-GPS — überlebt Cold-Start, damit Kamera + Puck
 * nicht auf den Stadt-Mittelpunkt fallen.
 *
 * Puck nur wenn der Fix frisch genug ist (sonst wirkt er „falsch“).
 * Kamera darf älteres Last-Known nutzen, damit Tiles am richtigen Ort laden.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useGpsStore } from '../../store/useGpsStore';

const KEY = '@findus/last_map_gps_v1';

/** Standort-Punkt auf der Karte — älter wirkt wie ein falscher Fix. Nur Live. */
export const MAP_GPS_PUCK_MAX_AGE_MS = 90_000;
/** Kamera / Tile-Ausschnitt — 72 h Disk nach App-Kill. */
export const MAP_GPS_CAMERA_MAX_AGE_MS = 72 * 60 * 60_000;

export type LastMapGps = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  atMs: number;
  zoom?: number | null;
};

let mem: LastMapGps | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let hydratePromise: Promise<LastMapGps | null> | null = null;

export function isMapGpsPuckFresh(atMs: number | null | undefined): boolean {
  if (atMs == null || !Number.isFinite(atMs)) return false;
  const age = Date.now() - atMs;
  return age >= 0 && age <= MAP_GPS_PUCK_MAX_AGE_MS;
}

export function isMapGpsCameraFresh(atMs: number | null | undefined): boolean {
  if (atMs == null || !Number.isFinite(atMs)) return false;
  const age = Date.now() - atMs;
  return age >= 0 && age <= MAP_GPS_CAMERA_MAX_AGE_MS;
}

export function peekLastMapGps(): LastMapGps | null {
  return mem;
}

export function parseLastMapGps(raw: unknown): LastMapGps | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as {
    lat?: unknown;
    lng?: unknown;
    accuracyM?: unknown;
    atMs?: unknown;
    zoom?: unknown;
  };
  const lat = typeof o.lat === 'number' ? o.lat : Number(o.lat);
  const lng = typeof o.lng === 'number' ? o.lng : Number(o.lng);
  const atMs = typeof o.atMs === 'number' ? o.atMs : Number(o.atMs);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(atMs)) {
    return null;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const accuracyM =
    typeof o.accuracyM === 'number' && Number.isFinite(o.accuracyM)
      ? o.accuracyM
      : null;
  const zoomRaw = typeof o.zoom === 'number' ? o.zoom : Number(o.zoom);
  const zoom =
    Number.isFinite(zoomRaw) && zoomRaw >= 3 && zoomRaw <= 20 ? zoomRaw : null;
  return { lat, lng, accuracyM, atMs, zoom };
}

function applyToStores(fix: LastMapGps, puck: boolean): void {
  mem = fix;
  const st = useFinnusStore.getState();
  if (
    st.lastGpsLat == null ||
    st.lastGpsLng == null ||
    !st.lastGpsAtMs ||
    fix.atMs >= st.lastGpsAtMs
  ) {
    useFinnusStore.setState({
      lastGpsLat: fix.lat,
      lastGpsLng: fix.lng,
      lastGpsAtMs: fix.atMs,
      ...(puck
        ? {
            gpsStatus: 'fix' as const,
            gpsAccuracyM: fix.accuracyM,
          }
        : {}),
    });
  }
  if (puck) {
    useGpsStore.getState().reportFix({
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracyM,
    });
  }
}

export async function hydrateLastKnownMapGps(): Promise<LastMapGps | null> {
  if (mem && isMapGpsCameraFresh(mem.atMs)) return mem;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return mem;
      const parsed = parseLastMapGps(JSON.parse(raw));
      if (!parsed || !isMapGpsCameraFresh(parsed.atMs)) return mem;
      applyToStores(parsed, false);
      return parsed;
    } catch {
      return mem;
    }
  })();
  try {
    return await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

export function persistLastMapGpsSoon(fix: {
  lat: number;
  lng: number;
  accuracy?: number | null;
  zoom?: number | null;
}): void {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return;
  mem = {
    lat: fix.lat,
    lng: fix.lng,
    accuracyM:
      typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy)
        ? fix.accuracy
        : mem?.accuracyM ?? null,
    atMs: Date.now(),
    zoom:
      typeof fix.zoom === 'number' && Number.isFinite(fix.zoom)
        ? fix.zoom
        : mem?.zoom ?? null,
  };
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snap = mem;
    if (!snap) return;
    void AsyncStorage.setItem(KEY, JSON.stringify(snap)).catch(() => undefined);
  }, 8_000);
}

/** Kamera-Seed: Live, Puck-frisch, oder älteres Last-Known. */
export function seedMapCameraGps(): {
  lat: number;
  lng: number;
  puck: boolean;
  zoom?: number | null;
} | null {
  const live = useGpsStore.getState();
  if (
    live.lat != null &&
    live.lng != null &&
    Number.isFinite(live.lat) &&
    Number.isFinite(live.lng)
  ) {
    return {
      lat: live.lat,
      lng: live.lng,
      puck: isMapGpsPuckFresh(live.atMs),
      zoom: peekLastMapGps()?.zoom ?? null,
    };
  }
  const st = useFinnusStore.getState();
  if (
    st.lastGpsLat != null &&
    st.lastGpsLng != null &&
    Number.isFinite(st.lastGpsLat) &&
    Number.isFinite(st.lastGpsLng)
  ) {
    return {
      lat: st.lastGpsLat,
      lng: st.lastGpsLng,
      puck: false,
      zoom: peekLastMapGps()?.zoom ?? null,
    };
  }
  const cached = peekLastMapGps();
  if (
    cached &&
    isMapGpsCameraFresh(cached.atMs)
  ) {
    return {
      lat: cached.lat,
      lng: cached.lng,
      puck: false,
      zoom: cached.zoom ?? null,
    };
  }
  return null;
}
