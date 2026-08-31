/**
 * Zero-Latency Rucksack — lokaler Global State.
 * Pipeline: nur readSync(), nie Netzwerk beim Turn-Start.
 */

import { create } from 'zustand';
import type {
  ConnectivityState,
  GpsPoint,
  MotionVector,
  WeatherSnapshot,
} from '../types';
import {
  readFuturePlanSnapshot,
  type FuturePlanState,
} from '../timeline/futurePlanState';

/** Live-GPS bevorzugen — Rucksack-History kann noch Fallback sein. */
function liveGpsPoint(): GpsPoint | null {
  try {
    const { useGpsStore } = require('../../store/useGpsStore') as {
      useGpsStore: {
        getState: () => {
          lat: number | null;
          lng: number | null;
          atMs?: number | null;
          accuracyM?: number | null;
        };
      };
    };
    const g = useGpsStore.getState();
    if (
      g.lat == null ||
      g.lng == null ||
      !Number.isFinite(g.lat) ||
      !Number.isFinite(g.lng)
    ) {
      return null;
    }
    return {
      lat: g.lat,
      lng: g.lng,
      atMs: g.atMs ?? Date.now(),
      accuracyM: g.accuracyM ?? null,
    };
  } catch {
    return null;
  }
}

export type RucksackState = {
  gpsHistory: GpsPoint[];
  vector: MotionVector;
  weather: WeatherSnapshot | null;
  nowMs: number;
  isoTime: string;
  futurePlan: FuturePlanState;
  connectivity: ConnectivityState;
  /**
   * Live-Ortslabel (GPS-Nähe / Header) — NICHT die ausgewählte Pack-Stadt.
   * Modul 2 ist pack-unabhängig; dieses Feld ist nur soft Context.
   */
  cityHint: string | null;
};

type Store = {
  bag: RucksackState;
  /** Hintergrund: rohe GPS-Punkte (kein Reverse-Geocode) */
  pushGps: (point: GpsPoint) => void;
  setWeather: (w: WeatherSnapshot) => void;
  setConnectivity: (c: ConnectivityState) => void;
  setCityHint: (city: string | null) => void;
  /** Clock tick — nur Zeitfelder */
  tickClock: () => void;
  refreshPlanFromStore: () => void;
};

function bearingLabel(deg: number | null): MotionVector['label'] {
  if (deg == null || Number.isNaN(deg)) return 'unknown';
  const d = ((deg % 360) + 360) % 360;
  if (d >= 315 || d < 45) return 'north';
  if (d < 135) return 'east';
  if (d < 225) return 'south';
  return 'west';
}

function haversineM(a: GpsPoint, b: GpsPoint): number {
  const R = 6371000;
  const toR = (x: number) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const la1 = toR(a.lat);
  const la2 = toR(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function computeVector(history: GpsPoint[]): MotionVector {
  if (history.length < 2) {
    return { bearingDeg: null, speedMps: null, label: 'unknown' };
  }
  const a = history[history.length - 2]!;
  const b = history[history.length - 1]!;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearingDeg = (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
  const dt = Math.max(1, (b.atMs - a.atMs) / 1000);
  const speedMps = haversineM(a, b) / dt;
  return {
    bearingDeg,
    speedMps,
    label: bearingLabel(bearingDeg),
  };
}

function clockFields(): Pick<RucksackState, 'nowMs' | 'isoTime'> {
  const nowMs = Date.now();
  return { nowMs, isoTime: new Date(nowMs).toISOString() };
}

export const useRucksackStore = create<Store>((set, get) => ({
  bag: {
    // Leer bis echter Fix — kein Fake-Prisdorf als GPS (sonst ETA-Muell)
    gpsHistory: [],
    vector: { bearingDeg: null, speedMps: null, label: 'unknown' },
    weather: null,
    ...clockFields(),
    futurePlan: readFuturePlanSnapshot(),
    connectivity: { offline: false, checkedAtMs: Date.now() },
    cityHint: null,
  },
  pushGps: (point) => {
    const prev = get().bag.gpsHistory;
    const last = prev[prev.length - 1];
    if (
      last &&
      Math.abs(last.lat - point.lat) < 0.000008 &&
      Math.abs(last.lng - point.lng) < 0.000008
    ) {
      const gpsHistory = [...prev.slice(0, -1), { ...point, atMs: point.atMs }];
      set({
        bag: {
          ...get().bag,
          gpsHistory,
          vector: computeVector(gpsHistory),
        },
      });
      return;
    }
    const gpsHistory = [...prev, point].slice(-3);
    set({
      bag: {
        ...get().bag,
        gpsHistory,
        vector: computeVector(gpsHistory),
      },
    });
  },
  setWeather: (weather) => set({ bag: { ...get().bag, weather } }),
  setConnectivity: (connectivity) =>
    set({ bag: { ...get().bag, connectivity } }),
  setCityHint: (cityHint) => set({ bag: { ...get().bag, cityHint } }),
  tickClock: () => set({ bag: { ...get().bag, ...clockFields() } }),
  refreshPlanFromStore: () =>
    set({
      bag: { ...get().bag, futurePlan: readFuturePlanSnapshot() },
    }),
}));

/** Synchrone Snapshot-Kopie — 0 ms, kein Netzwerk */
export function readRucksackSync(): RucksackState {
  const s = useRucksackStore.getState();
  s.tickClock();
  s.refreshPlanFromStore();
  const bag = useRucksackStore.getState().bag;
  return {
    ...bag,
    gpsHistory: bag.gpsHistory.map((p) => ({ ...p })),
    vector: { ...bag.vector },
    weather: bag.weather ? { ...bag.weather } : null,
    futurePlan: {
      ...bag.futurePlan,
      stops: bag.futurePlan.stops.map((x) => ({ ...x })),
    },
    connectivity: { ...bag.connectivity },
  };
}

export function anchorCoords(bag: RucksackState): GpsPoint {
  const live = liveGpsPoint();
  if (live) return live;
  const last = bag.gpsHistory[bag.gpsHistory.length - 1];
  if (last && last.atMs > 0) return last;
  try {
    const { peekLastMapGps } = require('../../services/location/lastKnownMapGps') as {
      peekLastMapGps: () => {
        lat: number;
        lng: number;
        atMs: number;
        accuracyM: number | null;
      } | null;
    };
    const disk = peekLastMapGps();
    if (
      disk &&
      Number.isFinite(disk.lat) &&
      Number.isFinite(disk.lng)
    ) {
      return {
        lat: disk.lat,
        lng: disk.lng,
        atMs: disk.atMs,
        accuracyM: disk.accuracyM,
      };
    }
  } catch {
    /* soft */
  }
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          lastGpsLat: number | null;
          lastGpsLng: number | null;
          lastGpsAtMs: number | null;
          gpsAccuracyM: number | null;
        };
      };
    };
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
        atMs: st.lastGpsAtMs || 0,
        accuracyM: st.gpsAccuracyM,
      };
    }
  } catch {
    /* soft */
  }
  try {
    const { getCachedUserProfile } = require('../../services/userProfileService') as {
      getCachedUserProfile: () => { cityId?: string | null } | null;
    };
    const { resolveCityCoverageBoundsSync } = require('../../services/discovery/cityCoverageBounds') as {
      resolveCityCoverageBoundsSync: (id: string) => {
        latMin: number;
        latMax: number;
        lngMin: number;
        lngMax: number;
      } | null;
    };
    const id = (getCachedUserProfile()?.cityId || '').trim().toLowerCase();
    const b = id ? resolveCityCoverageBoundsSync(id) : null;
    if (b) {
      return {
        lat: (b.latMin + b.latMax) / 2,
        lng: (b.lngMin + b.lngMax) / 2,
        atMs: 0,
        accuracyM: null,
      };
    }
  } catch {
    /* soft */
  }
  return { lat: 0, lng: 0, atMs: 0, accuracyM: null };
}

/** True = kein echter Fix, nur Stadt-Fallback. */
export function isFallbackAnchor(point: GpsPoint): boolean {
  return !point.atMs || point.atMs <= 0;
}
