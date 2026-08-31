import { create } from 'zustand';

/** High-frequency GPS + compass — map puck/camera only. */
export type SensorStoreState = {
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  headingDeg: number;
  headingAtMs: number;
  gpsAtMs: number | null;
  reportGps: (fix: {
    lat: number;
    lng: number;
    accuracy?: number | null;
  }) => void;
  reportHeading: (deg: number) => void;
};

const EPS_DEG = 0.000008;
const HEADING_MIN_DELTA = 0.5;

function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export const useSensorStore = create<SensorStoreState>((set, get) => ({
  lat: null,
  lng: null,
  accuracyM: null,
  headingDeg: 0,
  headingAtMs: 0,
  gpsAtMs: null,
  reportGps: (fix) => {
    const prev = get();
    const samePos =
      prev.lat != null &&
      prev.lng != null &&
      Math.abs(prev.lat - fix.lat) < EPS_DEG &&
      Math.abs(prev.lng - fix.lng) < EPS_DEG;
    const nextAcc =
      typeof fix.accuracy === 'number' ? fix.accuracy : prev.accuracyM;
    if (samePos) {
      set({ gpsAtMs: Date.now(), accuracyM: nextAcc });
      return;
    }
    set({
      lat: fix.lat,
      lng: fix.lng,
      accuracyM: nextAcc,
      gpsAtMs: Date.now(),
    });
  },
  reportHeading: (deg) => {
    if (!Number.isFinite(deg)) return;
    const prev = get().headingDeg;
    const next = normDeg(deg);
    let d = Math.abs(next - prev);
    if (d > 180) d = 360 - d;
    if (d < HEADING_MIN_DELTA) return;
    set({ headingDeg: next, headingAtMs: Date.now() });
  },
}));
