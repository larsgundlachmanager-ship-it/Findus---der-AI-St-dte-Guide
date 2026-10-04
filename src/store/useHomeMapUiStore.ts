import { create } from 'zustand';
import {
  allHomeMapFiltersOff,
  allHomeMapFiltersOn,
  standardHomeMapFilters,
  type HomeMapFilterId,
} from '../services/homeMap/homeMapPlaceFilter';
import {
  allAmenityIconsOff,
  allAmenityIconsOn,
} from '../services/homeMap/homeMapAmenityIconPrefs';
import type { HomeMapPlaceIcon } from '../services/homeMap/homeMapPlaceType';
import type { MapPlacePreview } from '../services/homeMap/mapPlacePreview';
import { noteOverlayBusy } from '../services/boot/interactiveBootGate';

type HomeMapUiState = {
  filters: Record<HomeMapFilterId, boolean>;
  toggleFilter: (id: HomeMapFilterId) => void;
  selectAllFilters: () => void;
  selectNoFilters: () => void;
  /** Nur Status-Chips — Icon-Prefs bleiben. */
  selectStandardFilters: () => void;
  /** Amenity-PNGs — Default alle an (Kartenbild wie bisher). */
  amenityIcons: Record<HomeMapPlaceIcon, boolean>;
  toggleAmenityIcon: (id: HomeMapPlaceIcon) => void;
  selectAllAmenityIcons: () => void;
  selectNoAmenityIcons: () => void;
  placePopup: MapPlacePreview | null;
  setPlacePopup: (place: MapPlacePreview | null) => void;
  /** Nur Explore-Chip — nicht HomePresenceMap re-rendern. */
  mapBearing: number;
  setMapBearing: (deg: number) => void;
};

export const useHomeMapUiStore = create<HomeMapUiState>((set, get) => ({
  filters: standardHomeMapFilters(),
  amenityIcons: allAmenityIconsOn(),
  toggleFilter: (id) => {
    const cur = get().filters;
    set({ filters: { ...cur, [id]: !cur[id] } });
  },
  selectAllFilters: () =>
    set({
      filters: allHomeMapFiltersOn(),
      amenityIcons: allAmenityIconsOn(),
    }),
  selectNoFilters: () =>
    set({
      filters: allHomeMapFiltersOff(),
      amenityIcons: allAmenityIconsOff(),
    }),
  selectStandardFilters: () => set({ filters: standardHomeMapFilters() }),
  toggleAmenityIcon: (id) => {
    const cur = get().amenityIcons;
    set({ amenityIcons: { ...cur, [id]: !cur[id] } });
  },
  selectAllAmenityIcons: () => set({ amenityIcons: allAmenityIconsOn() }),
  selectNoAmenityIcons: () => set({ amenityIcons: allAmenityIconsOff() }),
  placePopup: null,
  setPlacePopup: (place) => {
    set({ placePopup: place });
    if (place) {
      noteOverlayBusy(true);
      return;
    }
    try {
      const { useHomeOverlayStore } = require('./useHomeOverlayStore') as {
        useHomeOverlayStore: {
          getState: () => { settingsVisible: boolean; seekVisible: boolean };
        };
      };
      const { usePlanCalendarUiStore } = require('../module2/timeline/planCalendarUiStore') as {
        usePlanCalendarUiStore: { getState: () => { calendarVisible: boolean } };
      };
      const o = useHomeOverlayStore.getState();
      const c = usePlanCalendarUiStore.getState();
      if (!o.settingsVisible && !o.seekVisible && !c.calendarVisible) {
        noteOverlayBusy(false);
      }
    } catch {
      noteOverlayBusy(false);
    }
  },
  mapBearing: 0,
  setMapBearing: (deg) => {
    const n = ((deg % 360) + 360) % 360;
    const prev = get().mapBearing;
    let d = Math.abs(n - prev);
    if (d > 180) d = 360 - d;
    // Feiner → Kompass-Nadel folgt Kartendrehung ohne Ruckler.
    if (d < 0.04) return;
    set({ mapBearing: n });
  },
}));
