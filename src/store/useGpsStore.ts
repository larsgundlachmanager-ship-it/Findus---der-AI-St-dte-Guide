import { create } from 'zustand';

/**
 * Isolated GPS stream — coordinate ticks must NOT notify the main Finnus UI store.
 * Map / nav diagnostics subscribe here; Audio / HUD / Actions never do.
 */
export type GpsStoreState = {
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  atMs: number | null;
  reportFix: (fix: {
    lat: number;
    lng: number;
    accuracy?: number | null;
  }) => void;
};

/** ~0.8 m at mid-latitudes — skip store notify for jitter. */
const EPS_DEG = 0.000008;

export const useGpsStore = create<GpsStoreState>((set, get) => ({
  lat: null,
  lng: null,
  accuracyM: null,
  atMs: null,
  reportFix: (fix) => {
    const prev = get();
    const samePos =
      prev.lat != null &&
      prev.lng != null &&
      Math.abs(prev.lat - fix.lat) < EPS_DEG &&
      Math.abs(prev.lng - fix.lng) < EPS_DEG;
    const nextAcc =
      typeof fix.accuracy === 'number' ? fix.accuracy : prev.accuracyM;
    if (samePos) {
      // Refresh staleness without notifying lat/lng subscribers.
      set({ atMs: Date.now(), accuracyM: nextAcc });
      return;
    }
    set({
      lat: fix.lat,
      lng: fix.lng,
      accuracyM: nextAcc,
      atMs: Date.now(),
    });
  },
}));
