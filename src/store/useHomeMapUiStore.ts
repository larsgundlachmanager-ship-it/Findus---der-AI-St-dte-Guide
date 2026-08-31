import { create } from 'zustand';
import {
  allHomeMapFiltersOff,
  allHomeMapFiltersOn,
  standardHomeMapFilters,
  type HomeMapFilterId,
} from '../services/homeMap/homeMapPlaceFilter';
import type { MapPlacePreview } from '../services/homeMap/mapPlacePreview';

type HomeMapUiState = {
  filters: Record<HomeMapFilterId, boolean>;
  toggleFilter: (id: HomeMapFilterId) => void;
  selectAllFilters: () => void;
  selectNoFilters: () => void;
  selectStandardFilters: () => void;
  placePopup: MapPlacePreview | null;
  setPlacePopup: (place: MapPlacePreview | null) => void;
  /** Nur Explore-Chip — nicht HomePresenceMap re-rendern. */
  mapBearing: number;
  setMapBearing: (deg: number) => void;
};

export const useHomeMapUiStore = create<HomeMapUiState>((set, get) => ({
  filters: standardHomeMapFilters(),
  toggleFilter: (id) => {
    const cur = get().filters;
    set({ filters: { ...cur, [id]: !cur[id] } });
  },
  selectAllFilters: () => set({ filters: allHomeMapFiltersOn() }),
  selectNoFilters: () => set({ filters: allHomeMapFiltersOff() }),
  selectStandardFilters: () => set({ filters: standardHomeMapFilters() }),
  placePopup: null,
  setPlacePopup: (place) => set({ placePopup: place }),
  mapBearing: 0,
  setMapBearing: (deg) => {
    const n = ((deg % 360) + 360) % 360;
    const prev = get().mapBearing;
    let d = Math.abs(n - prev);
    if (d > 180) d = 360 - d;
    if (d < 0.6) return;
    set({ mapBearing: n });
  },
}));
