/**
 * Layer-Hunt: Ebenen nacheinander freischalten (Video-Test pro Stufe).
 * Nur Legacy GeoJSON-Extract — bei Vector-Basemap aus (mapTileConfig).
 */

import { isVectorBasemapEnabled } from './mapTileConfig';

export type MapLayerGroup =
  | 'extract'
  | 'places-fill'
  | 'places-dot'
  | 'places-icons'
  | 'fog'
  | 'cities'
  | 'world-base'
  | 'world-labels'
  | 'regional';

export type MapLayerDebugInject =
  | 'places'
  | 'fog'
  | 'cities'
  | 'extract-full'
  | 'world';

export const MAP_LAYER_DEBUG_STEPS = [
  {
    step: 0,
    group: 'extract' as MapLayerGroup,
    title: 'Basis — Straßen + Gebäude (R1)',
    hint: 'Nur Extract Near. Das lief bei dir gut.',
  },
  {
    step: 1,
    group: 'places-fill' as MapLayerGroup,
    title: 'Orte-Flächen',
    hint: 'Lila/grün/blau Story-Fills',
  },
  {
    step: 2,
    group: 'places-dot' as MapLayerGroup,
    title: 'Orte-Punkte',
    hint: 'Kreise ohne Gebäude-Fläche',
  },
  {
    step: 3,
    group: 'places-icons' as MapLayerGroup,
    title: 'Orte-Icons',
    hint: 'Bahnhof, Gastro, Park, …',
  },
  {
    step: 4,
    group: 'fog' as MapLayerGroup,
    title: 'Fog (Nebel)',
    hint: 'Reveal + Mask',
  },
  {
    step: 5,
    group: 'cities' as MapLayerGroup,
    title: 'Stadt-Grenzen',
    hint: 'Nachbar-Städte + Labels',
  },
  {
    step: 6,
    group: 'extract' as MapLayerGroup,
    title: 'Extract 10 km (R3)',
    hint: 'Mehr Straßen/Gebäude im selben Layer',
  },
  {
    step: 7,
    group: 'world-base' as MapLayerGroup,
    title: 'World — Flächen',
    hint: 'Land, Seen, Bundesländer',
  },
  {
    step: 8,
    group: 'world-labels' as MapLayerGroup,
    title: 'World — Labels',
    hint: 'Flüsse, Fernstraßen, Städtenamen',
  },
  {
    step: 9,
    group: 'regional' as MapLayerGroup,
    title: 'Regional-Fallback',
    hint: 'EU-Übersicht ohne Pack',
  },
] as const;

const GROUP_FIRST_STEP: Record<MapLayerGroup, number> = {
  extract: 0,
  'places-fill': 1,
  'places-dot': 2,
  'places-icons': 3,
  fog: 4,
  cities: 5,
  'world-base': 7,
  'world-labels': 8,
  regional: 9,
};

const INJECT_FIRST_STEP: Record<MapLayerDebugInject, number> = {
  places: 1,
  fog: 4,
  cities: 5,
  'extract-full': 6,
  world: 7,
};

let currentStep = 0;
const listeners = new Set<(step: number) => void>();

export function isMapLayerDebugEnabled(): boolean {
  if (isVectorBasemapEnabled()) return false;
  const v = (process.env.EXPO_PUBLIC_MAP_LAYER_DEBUG ?? '0').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function getMapLayerDebugStep(): number {
  return currentStep;
}

export function getMapLayerDebugStepCount(): number {
  return MAP_LAYER_DEBUG_STEPS.length;
}

export function peekMapLayerDebugMeta(step = currentStep) {
  return MAP_LAYER_DEBUG_STEPS[Math.max(0, Math.min(step, MAP_LAYER_DEBUG_STEPS.length - 1))];
}

export function resetMapLayerDebugStep(): void {
  currentStep = 0;
  for (const fn of [...listeners]) {
    try {
      fn(currentStep);
    } catch {
      /* soft */
    }
  }
}

export function setMapLayerDebugStep(step: number): void {
  const next = Math.max(0, Math.min(step, MAP_LAYER_DEBUG_STEPS.length - 1));
  if (next === currentStep) return;
  currentStep = next;
  for (const fn of [...listeners]) {
    try {
      fn(currentStep);
    } catch {
      /* soft */
    }
  }
}

export function advanceMapLayerDebugStep(): number {
  if (currentStep >= MAP_LAYER_DEBUG_STEPS.length - 1) return currentStep;
  setMapLayerDebugStep(currentStep + 1);
  return currentStep;
}

export function subscribeMapLayerDebug(fn: (step: number) => void): () => void {
  listeners.add(fn);
  fn(currentStep);
  return () => {
    listeners.delete(fn);
  };
}

export function isMapLayerGroupVisible(group: MapLayerGroup): boolean {
  if (!isMapLayerDebugEnabled()) return true;
  return currentStep >= GROUP_FIRST_STEP[group];
}

export function mapLayerDebugAllows(inject: MapLayerDebugInject): boolean {
  if (!isMapLayerDebugEnabled()) return true;
  return currentStep >= INJECT_FIRST_STEP[inject];
}

/** Nach R1: Extract-Store-Churn nicht an Native durchreichen bis Stufe 7. */
export function isMapLayerDebugExtractLocked(): boolean {
  if (!isMapLayerDebugEnabled()) return false;
  return currentStep < INJECT_FIRST_STEP['extract-full'];
}
