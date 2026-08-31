import { create } from 'zustand';

/**
 * Nav-HUD Busy (Busy-Kreis) — getrennt vom Mega-Finnus / Map-Extract.
 * Dual-Write aus useFinnusStore.setNavRouteLoading.
 */
export type NavHudState = {
  navRouteLoading: boolean;
  navActive: boolean;
  setNavRouteLoading: (v: boolean) => void;
  setNavActive: (v: boolean) => void;
};

export const useNavHudStore = create<NavHudState>((set) => ({
  navRouteLoading: false,
  navActive: false,
  setNavRouteLoading: (navRouteLoading) => set({ navRouteLoading }),
  setNavActive: (navActive) => set({ navActive }),
}));

export function selectNavHudLoading(s: NavHudState): boolean {
  return s.navRouteLoading === true;
}
