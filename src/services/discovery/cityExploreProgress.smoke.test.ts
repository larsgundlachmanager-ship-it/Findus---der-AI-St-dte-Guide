/**
 * Run: npx --yes tsx src/services/discovery/cityExploreProgress.smoke.test.ts
 *
 * Explore-Progress ist stadt-scoped und überlebt poiId-Remap via lat/lng.
 */

import type { Poi } from '../../db/types';
import { isCityExplorePlaceSeen } from './cityExploreVisitMatch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

type Stamp = {
  poiId: number;
  name: string;
  kind: 'historic';
  keyFacts: string[];
  visitedAt: number;
  lat?: number | null;
  lng?: number | null;
  cityId?: string | null;
};

function poi(
  partial: Partial<Poi> & Pick<Poi, 'id' | 'name' | 'lat' | 'lng'>,
): Poi {
  return {
    radius_meters: 40,
    spot_key: partial.spot_key ?? `spot_${partial.id}`,
    parent_poi_id: null,
    kind: 'area',
    category: 'museum',
    tags_json: JSON.stringify(['story']),
    polygon_json: null,
    teaser_text: null,
    condition_rule: 'always',
    special_radius_m: null,
    ...partial,
  };
}

const prisdorfBounds = {
  latMin: 53.65,
  latMax: 53.71,
  lngMin: 9.72,
  lngMax: 9.81,
};

const wangeroogeBounds = {
  latMin: 53.77,
  latMax: 53.81,
  lngMin: 7.84,
  lngMax: 7.94,
};

const prisdorfPoi = poi({
  id: 1,
  name: 'Kirche Prisdorf',
  lat: 53.675,
  lng: 9.76,
});
const wangeroogePoi = poi({
  id: 1,
  name: 'Westturm',
  lat: 53.79,
  lng: 7.87,
});

const stampPrisdorf: Stamp = {
  poiId: 1,
  name: 'Kirche Prisdorf',
  kind: 'historic',
  keyFacts: ['Modul-1-Hauptpunkt'],
  visitedAt: 1,
  lat: 53.6751,
  lng: 9.7601,
  cityId: 'prisdorf',
};

const stampRemapped: Stamp = {
  poiId: 99,
  name: 'Kirche Prisdorf',
  kind: 'historic',
  keyFacts: ['Modul-1-Hauptpunkt'],
  visitedAt: 2,
  lat: 53.67505,
  lng: 9.76005,
  cityId: 'prisdorf',
};

assert(
  isCityExplorePlaceSeen(prisdorfPoi, [stampPrisdorf], {
    cityId: 'prisdorf',
    bounds: prisdorfBounds,
  }),
  'Stamp in Prisdorf zählt',
);

assert(
  !isCityExplorePlaceSeen(wangeroogePoi, [stampPrisdorf], {
    cityId: 'wangerooge',
    bounds: wangeroogeBounds,
  }),
  'Prisdorf-Stempel darf Wangerooge-POI mit gleicher ID nicht grün machen',
);

assert(
  isCityExplorePlaceSeen(prisdorfPoi, [stampRemapped], {
    cityId: 'prisdorf',
    bounds: prisdorfBounds,
  }),
  'Nach ID-Remap via lat/lng wiederhergestellt',
);

console.log('cityExploreProgress.smoke: OK');
