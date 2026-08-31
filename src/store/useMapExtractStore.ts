import { create } from 'zustand';
import type { CityMapExtract } from '../services/homeMap/cityMapExtract';

export type MapExtractStatus = 'idle' | 'loading' | 'ready' | 'error';

export type MapExtractState = {
  cityId: string | null;
  extract: CityMapExtract | null;
  clipCenter: { lat: number; lng: number } | null;
  status: MapExtractStatus;
  setLoading: (cityId: string) => void;
  setExtract: (
    cityId: string,
    extract: CityMapExtract,
    clipCenter: { lat: number; lng: number },
  ) => void;
  clear: () => void;
};

export const useMapExtractStore = create<MapExtractState>((set) => ({
  cityId: null,
  extract: null,
  clipCenter: null,
  status: 'idle',
  // Extract behalten während Reload — sonst flackert die ganze Stadt weg (Pinneberg-Pan).
  setLoading: (cityId) =>
    set((s) => ({
      cityId,
      status: 'loading',
      extract: s.extract,
      clipCenter: s.clipCenter,
    })),
  setExtract: (cityId, extract, clipCenter) =>
    set({ cityId, extract, clipCenter, status: 'ready' }),
  clear: () =>
    set({
      cityId: null,
      extract: null,
      clipCenter: null,
      status: 'idle',
    }),
}));
