/**
 * RAM-Druckventil für die Home-Map (Background / Low-Memory).
 * Disk-Caches bleiben; nur JS/Native-Duplikate raus.
 */

import { clearCityMapExtractMem } from './cityMapExtract';
import { isVectorBasemapEnabled } from './mapTileConfig';
import {
  listWarmMapPinCityIds,
  trimMapPinIndexesToKeep,
} from './mapPinIndex';
import { useFogStore } from '../../store/useFogStore';
import { useMapExtractStore } from '../../store/useMapExtractStore';

export type TrimHomeMapMemoryOpts = {
  /** Aktive Profil-/GPS-Stadt behalten. */
  keepCityIds?: Array<string | null | undefined>;
  reason?: string;
};

/**
 * Schwere Overlay-/Extract-Kopien droppen.
 * Pins: nur Keep-Liste + Warm-Limit.
 * Fog: explored Polygone (neu berechenbar), Walk-Track bleibt.
 */
export function trimHomeMapMemory(opts: TrimHomeMapMemoryOpts = {}): void {
  const keep = new Set(
    (opts.keepCityIds ?? [])
      .map((id) => (id || '').trim().toLowerCase())
      .filter(Boolean),
  );

  const beforePins = listWarmMapPinCityIds().length;
  trimMapPinIndexesToKeep(keep);
  const afterPins = listWarmMapPinCityIds().length;

  // Vector-Basemap: Legacy-Extract nur Ballast in JS.
  if (isVectorBasemapEnabled()) {
    clearCityMapExtractMem();
    try {
      useMapExtractStore.getState().clear();
    } catch {
      /* soft */
    }
  } else {
    clearCityMapExtractMem();
  }

  try {
    useFogStore.getState().trimExplored();
  } catch {
    /* soft */
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[trimHomeMapMemory]', opts.reason ?? 'trim', {
      pins: `${beforePins}→${afterPins}`,
      keep: [...keep],
    });
  }
}
