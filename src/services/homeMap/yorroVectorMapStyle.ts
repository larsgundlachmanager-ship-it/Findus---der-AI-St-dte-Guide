/**
 * MapLibre-Style: Protomaps Vector-Tiles + Yorro-Farben (grün/gelb).
 * Kein GeoJSON-Extract — Basiskarte läuft über Kacheln (R2 / Protomaps API).
 */

import {
  HOME_MAP_BG,
  HOME_MAP_BUILDING_FILL,
  HOME_MAP_BUILDING_STROKE,
  HOME_MAP_COUNTRY_BORDER,
  HOME_MAP_ADMIN1_BORDER,
  HOME_MAP_DETAIL_FADE,
  HOME_MAP_PARK,
  HOME_MAP_ROAD_COLORS,
  HOME_MAP_STREET_LABEL_LOD,
  HOME_MAP_WATER,
  HOME_MAP_WOOD,
} from './homeMapStyle';
import {
  isMapVectorSourceConfigured,
  resolveMapVectorSource,
  type MapVectorSourceSpec,
} from './mapTileConfig';

const SOURCE_ID = 'yorro-basemap';
const GLYPHS =
  'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
const ATTRIB = '© Protomaps © OpenStreetMap';

function sourceJson(spec: MapVectorSourceSpec): Record<string, unknown> {
  if (spec.kind === 'pmtiles' || spec.kind === 'tilejson') {
    return {
      type: 'vector',
      url: spec.url,
      attribution: ATTRIB,
    };
  }
  return {
    type: 'vector',
    tiles: spec.tiles,
    minzoom: spec.minzoom ?? 0,
    maxzoom: spec.maxzoom ?? 15,
    attribution: ATTRIB,
  };
}

function yorroBasemapLayers(): Record<string, unknown>[] {
  const s = SOURCE_ID;
  const bldgFrom = HOME_MAP_DETAIL_FADE.fullAt;
  const labelMajor = HOME_MAP_STREET_LABEL_LOD.majorFrom;
  const labelStreet = HOME_MAP_STREET_LABEL_LOD.streetFrom;

  return [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': HOME_MAP_BG },
    },
    {
      id: 'earth',
      type: 'fill',
      source: s,
      'source-layer': 'earth',
      paint: { 'fill-color': HOME_MAP_BG },
    },
    {
      id: 'landuse-grass',
      type: 'fill',
      source: s,
      'source-layer': 'landuse',
      filter: ['in', 'kind', 'grass', 'forest', 'wood', 'farmland'],
      paint: {
        'fill-color': [
          'match',
          ['get', 'kind'],
          'forest',
          HOME_MAP_WOOD,
          'wood',
          HOME_MAP_WOOD,
          HOME_MAP_PARK,
        ],
        'fill-opacity': 0.85,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: s,
      'source-layer': 'water',
      paint: { 'fill-color': HOME_MAP_WATER },
    },
    {
      id: 'boundaries-country',
      type: 'line',
      source: s,
      'source-layer': 'boundaries',
      filter: ['==', 'kind', 'country'],
      paint: {
        'line-color': HOME_MAP_COUNTRY_BORDER,
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 6, 1.1, 10, 1.6],
        'line-opacity': 0.88,
      },
    },
    {
      id: 'boundaries-region',
      type: 'line',
      source: s,
      'source-layer': 'boundaries',
      minzoom: 4,
      filter: ['==', 'kind', 'region'],
      paint: {
        'line-color': HOME_MAP_ADMIN1_BORDER,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.35, 8, 0.9],
        'line-opacity': 0.72,
      },
    },
    {
      id: 'buildings',
      type: 'fill',
      source: s,
      'source-layer': 'buildings',
      minzoom: bldgFrom,
      filter: ['in', 'kind', 'building', 'building_part'],
      paint: {
        'fill-color': HOME_MAP_BUILDING_FILL,
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          bldgFrom,
          0,
          bldgFrom + 0.35,
          0.72,
        ],
        'fill-outline-color': HOME_MAP_BUILDING_STROKE,
      },
    },
    {
      id: 'roads-all',
      type: 'line',
      source: s,
      'source-layer': 'roads',
      // Kein kind-Filter zuerst — sonst fehlen Straßen wenn Schema abweicht.
      paint: {
        'line-color': [
          'match',
          ['get', 'kind'],
          'highway',
          HOME_MAP_ROAD_COLORS.major,
          'major_road',
          HOME_MAP_ROAD_COLORS.major,
          'path',
          HOME_MAP_ROAD_COLORS.path,
          'rail',
          '#8E9BA3',
          HOME_MAP_ROAD_COLORS.street,
        ],
        'line-width': [
          'interpolate',
          ['exponential', 1.6],
          ['zoom'],
          6,
          0.3,
          10,
          0.9,
          14,
          2.4,
          17,
          5,
        ],
      },
    },
    {
      id: 'roads-highway',
      type: 'line',
      source: s,
      'source-layer': 'roads',
      filter: ['==', 'kind', 'highway'],
      paint: {
        'line-color': HOME_MAP_ROAD_COLORS.major,
        'line-width': [
          'interpolate',
          ['exponential', 1.6],
          ['zoom'],
          3,
          0.35,
          6,
          0.9,
          10,
          1.6,
          14,
          4,
          17,
          7,
        ],
      },
    },
    {
      id: 'roads-major',
      type: 'line',
      source: s,
      'source-layer': 'roads',
      minzoom: 6,
      filter: ['==', 'kind', 'major_road'],
      paint: {
        'line-color': HOME_MAP_ROAD_COLORS.major,
        'line-width': [
          'interpolate',
          ['exponential', 1.6],
          ['zoom'],
          6,
          0.25,
          10,
          1.1,
          14,
          2.8,
          17,
          5.5,
        ],
      },
    },
    {
      id: 'roads-minor',
      type: 'line',
      source: s,
      'source-layer': 'roads',
      minzoom: 10,
      filter: ['==', 'kind', 'minor_road'],
      paint: {
        'line-color': HOME_MAP_ROAD_COLORS.street,
        'line-width': [
          'interpolate',
          ['exponential', 1.6],
          ['zoom'],
          11,
          0.2,
          13,
          0.8,
          16,
          2.4,
          18,
          4.5,
        ],
      },
    },
    {
      id: 'roads-path',
      type: 'line',
      source: s,
      'source-layer': 'roads',
      minzoom: 12,
      filter: ['==', 'kind', 'path'],
      paint: {
        'line-color': HOME_MAP_ROAD_COLORS.path,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.25, 16, 1.1],
      },
    },
    {
      id: 'roads-rail',
      type: 'line',
      source: s,
      'source-layer': 'roads',
      minzoom: 9,
      filter: ['==', 'kind', 'rail'],
      paint: {
        'line-color': '#8E9BA3',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 14, 1.6, 17, 2.4],
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: 'road-label-major',
      type: 'symbol',
      source: s,
      'source-layer': 'roads',
      minzoom: labelMajor,
      filter: ['in', 'kind', 'highway', 'major_road'],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name'], ['get', 'ref']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-max-angle': HOME_MAP_STREET_LABEL_LOD.maxAngleDeg,
      },
      paint: {
        'text-color': '#E8DDB8',
        'text-halo-color': '#1A3D32',
        'text-halo-width': 1.2,
      },
    },
    {
      id: 'road-label-street',
      type: 'symbol',
      source: s,
      'source-layer': 'roads',
      minzoom: labelStreet,
      filter: ['in', 'kind', 'minor_road'],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-max-angle': HOME_MAP_STREET_LABEL_LOD.maxAngleDeg,
      },
      paint: {
        'text-color': '#D4C898',
        'text-halo-color': '#1A3D32',
        'text-halo-width': 1,
      },
    },
  ];
}

/** Fallback wenn keine Tile-URL konfiguriert — nur Hintergrund (Dev-Hinweis). */
export const YORRO_VECTOR_MAP_STYLE_FALLBACK = {
  version: 8,
  name: 'yorro-vector-unconfigured',
  glyphs: GLYPHS,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': HOME_MAP_BG },
    },
  ],
} as const;

let cachedStyle: Record<string, unknown> | null = null;
let cachedKey = '';

/** Style-Cache leeren (nach Layer-Fixes). */
export function invalidateYorroVectorMapStyleCache(): void {
  cachedStyle = null;
  cachedKey = '';
}

/** Bump bei Style/Source-Fixes — sonst klebt alter Cache ohne Straßen. */
const STYLE_REV = 'v4-tilejson-roads-all';

export function buildYorroVectorMapStyle(): Record<string, unknown> {
  const spec = resolveMapVectorSource();
  const key = `${STYLE_REV}:${spec ? JSON.stringify(spec) : 'none'}`;
  if (cachedStyle && cachedKey === key) return cachedStyle;

  if (!spec) {
    cachedStyle = { ...YORRO_VECTOR_MAP_STYLE_FALLBACK };
    cachedKey = key;
    return cachedStyle;
  }

  cachedStyle = {
    version: 8,
    name: 'yorro-protomaps',
    glyphs: GLYPHS,
    sources: {
      [SOURCE_ID]: sourceJson(spec),
    },
    layers: yorroBasemapLayers(),
  };
  cachedKey = key;
  if (__DEV__) {
    console.log(
      '[map-vector] style',
      spec.kind,
      spec.kind === 'tilejson' || spec.kind === 'pmtiles'
        ? String(spec.url).replace(/key=[^&]+/i, 'key=…')
        : `${spec.tiles.length} tiles`,
    );
  }
  return cachedStyle;
}

export function peekYorroVectorMapStyleReady(): boolean {
  return isMapVectorSourceConfigured();
}
