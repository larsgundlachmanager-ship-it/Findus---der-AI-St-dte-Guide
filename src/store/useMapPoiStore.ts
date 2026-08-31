import { create } from 'zustand';
import type { NativeMapPlace } from '../components/homeMap/NativeHomeMapView';

export type NativeMapCity = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  ring?: Array<[number, number]>;
  color?: string;
  fill?: string;
  border?: string;
};

export type MapPoiState = {
  places: NativeMapPlace[];
  cities: NativeMapCity[];
  setPlaces: (places: NativeMapPlace[]) => void;
  setCities: (cities: NativeMapCity[]) => void;
};

export const useMapPoiStore = create<MapPoiState>((set) => ({
  places: [],
  cities: [],
  setPlaces: (places) => set({ places }),
  setCities: (cities) => set({ cities }),
}));
