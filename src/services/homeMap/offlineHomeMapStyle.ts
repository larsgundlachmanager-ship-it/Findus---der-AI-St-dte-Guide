/**
 * Offline-Basiskarte: Ozean-Hintergrund + Weltpaket als ShapeSources.
 * Stadt-Extract liegt darüber; keine HTTP-Kacheln.
 */

import { HOME_MAP_OCEAN } from './homeMapStyle';

export const OFFLINE_HOME_MAP_STYLE = {
  version: 8,
  name: 'yorro-offline',
  glyphs: 'asset://fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': HOME_MAP_OCEAN },
    },
  ],
} as const;
