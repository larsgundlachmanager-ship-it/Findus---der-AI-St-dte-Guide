import { create } from 'zustand';
import type { WalkTrackPoint } from '../services/discovery/walkTrackService';
import type { FogBounds, FogPolygon } from '../services/discovery/fogCoverage';

export type FogStoreState = {
  walkTrack: WalkTrackPoint[];
  exploredPolygons: FogPolygon[];
  exploredAtMs: number;
  trackKey: string;
  setWalkTrack: (track: WalkTrackPoint[]) => void;
  setExplored: (polygons: FogPolygon[], trackKey: string) => void;
  viewportBounds: FogBounds | null;
  setViewportBounds: (bounds: FogBounds | null) => void;
};

export const useFogStore = create<FogStoreState>((set) => ({
  walkTrack: [],
  exploredPolygons: [],
  exploredAtMs: 0,
  trackKey: '',
  viewportBounds: null,
  setWalkTrack: (walkTrack) => set({ walkTrack }),
  setExplored: (exploredPolygons, trackKey) =>
    set({ exploredPolygons, trackKey, exploredAtMs: Date.now() }),
  setViewportBounds: (viewportBounds) => set({ viewportBounds }),
}));
