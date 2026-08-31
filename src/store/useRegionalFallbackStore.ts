import { create } from 'zustand';
import type { RegionalFallbackSnap } from '../services/homeMap/regionalFallbackLoader';

export type RegionalFallbackStoreState = {
  snap: RegionalFallbackSnap | null;
  setSnap: (snap: RegionalFallbackSnap | null) => void;
};

export const useRegionalFallbackStore = create<RegionalFallbackStoreState>((set) => ({
  snap: null,
  setSnap: (snap) => set({ snap }),
}));
