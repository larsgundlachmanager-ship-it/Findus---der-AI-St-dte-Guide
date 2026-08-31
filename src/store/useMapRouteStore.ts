import { create } from 'zustand';
import type { NavRouteMapPayload } from '../services/navigation/navRouteMapPayload';

export type MapRouteState = {
  route: NavRouteMapPayload | null;
  dropPin: { lat: number; lng: number } | null;
  setRoute: (route: NavRouteMapPayload | null) => void;
  setDropPin: (dropPin: { lat: number; lng: number } | null) => void;
};

export const useMapRouteStore = create<MapRouteState>((set, get) => ({
  route: null,
  dropPin: null,
  setRoute: (route) => {
    if (route === get().route) return;
    set({ route });
  },
  setDropPin: (dropPin) => {
    const prev = get().dropPin;
    if (
      prev === dropPin ||
      (prev != null &&
        dropPin != null &&
        prev.lat === dropPin.lat &&
        prev.lng === dropPin.lng)
    ) {
      return;
    }
    set({ dropPin });
  },
}));
