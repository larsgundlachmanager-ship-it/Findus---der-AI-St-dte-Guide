/**
 * Offline-Basiskarte: Land-Hintergrund ab Frame 0 + Weltpaket als ShapeSources.
 * Stadt-Extract liegt darüber; keine HTTP-Kacheln.
 * Kein Ozean-First (sonst Kaltstart „schwarz → hell“ auf langsamen Geräten).
 */

import { HOME_MAP_BG } from './homeMapStyle';

export const OFFLINE_HOME_MAP_STYLE = {
  version: 8,
  name: 'yorro-offline',
  glyphs: 'asset://fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': HOME_MAP_BG },
    },
  ],
} as const;
