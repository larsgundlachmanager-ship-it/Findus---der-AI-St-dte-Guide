/**
 * Kompaktes Welt-Fallback (Natural Earth), gebündelt in der APK — kein Nachladen.
 */

import type { GeoJsonFc } from './cityMapExtractGeojson';

export type WorldOverviewBundle = {
  v: number;
  land: GeoJsonFc;
  lakes: GeoJsonFc;
  borders: GeoJsonFc;
  urban: GeoJsonFc;
  admin1: GeoJsonFc;
  admin1De: GeoJsonFc;
};

export type WorldLabelsBundle = {
  v: number;
  cities: GeoJsonFc;
  rivers: GeoJsonFc;
  roads: GeoJsonFc;
  /** Gebirge / Landschaften (optional, v≥2) */
  regions?: GeoJsonFc;
};

let cached: WorldOverviewBundle | null = null;
let labelsCached: WorldLabelsBundle | null = null;

export function getWorldOverview(): WorldOverviewBundle {
  if (cached) return cached;
  cached = require('../../assets/homeMap/worldOverview.json') as WorldOverviewBundle;
  cached.admin1 ??= { type: 'FeatureCollection', features: [] };
  cached.admin1De ??= { type: 'FeatureCollection', features: [] };
  return cached;
}

export function getWorldLabels(): WorldLabelsBundle {
  if (labelsCached) return labelsCached;
  try {
    labelsCached = require('../../assets/homeMap/worldLabels.json') as WorldLabelsBundle;
  } catch {
    labelsCached = {
      v: 1,
      cities: { type: 'FeatureCollection', features: [] },
      rivers: { type: 'FeatureCollection', features: [] },
      roads: { type: 'FeatureCollection', features: [] },
      regions: { type: 'FeatureCollection', features: [] },
    };
  }
  labelsCached.cities ??= { type: 'FeatureCollection', features: [] };
  labelsCached.rivers ??= { type: 'FeatureCollection', features: [] };
  labelsCached.roads ??= { type: 'FeatureCollection', features: [] };
  labelsCached.regions ??= { type: 'FeatureCollection', features: [] };
  return labelsCached;
}
