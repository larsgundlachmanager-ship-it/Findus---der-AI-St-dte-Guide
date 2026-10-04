/**
 * Run: npx --yes tsx src/services/homeMap/basemapFeatureQuery.smoke.test.ts
 */

import {
  listBasemapBuildingLayerIds,
  listBasemapPoiLayerIds,
  firstBasemapRoadLabelLayerId,
  pickBestBuildingRingAt,
  hasBasemapPoiSymbolNear,
  ringFromGeoJsonFeature,
  PROTOMAPS_ROAD_LABEL_LAYER_FALLBACK,
} from './basemapFeatureQuery';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Layer-IDs: Building-Fill erkennen, Fallback wenn keiner passt.
const style = {
  layers: [
    { id: 'background', type: 'background' },
    { id: 'buildings', type: 'fill' },
    { id: 'building-3d', type: 'fill-extrusion' },
    { id: 'building-outline', type: 'line' },
    { id: 'poi-label', type: 'symbol' },
    { id: 'park-label', type: 'symbol' },
    { id: 'place-city', type: 'symbol' },
    { id: 'road-major', type: 'line' },
  ],
};
const buildingIds = listBasemapBuildingLayerIds(style);
assert(buildingIds.includes('buildings'), 'building fill layer erkannt');
assert(
  !buildingIds.includes('building-3d') && !buildingIds.includes('building-outline'),
  'nur Fill-Building-Layer, keine 3d/line',
);
assert(
  listBasemapBuildingLayerIds({ layers: [] }).join(',') === 'buildings',
  'Fallback [buildings] wenn kein Match',
);
assert(
  listBasemapBuildingLayerIds(null).join(',') === 'buildings',
  'Fallback [buildings] wenn kein Style',
);

const poiIds = listBasemapPoiLayerIds(style);
assert(
  poiIds.includes('poi-label') && poiIds.includes('park-label'),
  'poi/park label layer erkannt',
);
assert(!poiIds.includes('place-city'), 'Stadt-Label-Layer nicht als Shop-Tap');
assert(!poiIds.includes('road-major'), 'road ist kein poi layer');

{
  const {
    pickBasemapPoiAt,
    pickBasemapPoiKindFallback,
  } = require('./basemapFeatureQuery') as typeof import('./basemapFeatureQuery');
  const hit = pickBasemapPoiAt(53.676, 9.763, [
    {
      properties: { name: 'team Tankstelle', kind: 'fuel' },
      geometry: { type: 'Point', coordinates: [9.763, 53.676] },
    },
  ]);
  assert(hit?.name === 'team Tankstelle', 'Basemap-POI Tap → Name');
  assert(hit?.kind === 'fuel', 'Basemap-POI Tap → kind');
  const brandHit = pickBasemapPoiAt(53.676, 9.763, [
    {
      properties: { brand: "McDonald's", shop: 'fast_food' },
      geometry: { type: 'Point', coordinates: [9.7632, 53.6761] },
    },
  ]);
  assert(brandHit?.name === "McDonald's", 'Basemap brand → Name');
  const kindOnly = pickBasemapPoiKindFallback(53.676, 9.763, [
    {
      properties: { shop: 'electronics' },
      geometry: { type: 'Point', coordinates: [9.763, 53.676] },
    },
  ]);
  assert(!!kindOnly?.name, 'Kind-Fallback ohne Name');
}

assert(
  firstBasemapRoadLabelLayerId({
    layers: [
      { id: 'roads_minor', type: 'line' },
      { id: 'roads_labels_minor', type: 'symbol' },
      { id: 'roads_labels_major', type: 'symbol' },
    ],
  }) === 'roads_labels_minor',
  'erster Straßenname-Layer',
);
assert(
  firstBasemapRoadLabelLayerId({ layers: [{ id: 'poi-label', type: 'symbol' }] }) ==
    null,
  'kein Straßenlabel → null',
);
assert(
  PROTOMAPS_ROAD_LABEL_LAYER_FALLBACK === 'roads_labels_minor',
  'Protomaps Fallback-ID',
);

// ringFromGeoJsonFeature: lng,lat → lat,lng, größter Ring bei MultiPolygon.
const poly = ringFromGeoJsonFeature({
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [9.7588, 53.6781],
        [9.7591, 53.6781],
        [9.7591, 53.67835],
        [9.7588, 53.67835],
        [9.7588, 53.6781],
      ],
    ],
  },
});
assert(poly !== null && poly.length >= 4, 'Polygon → Ring');
assert(
  poly![0]![0] === 53.6781 && poly![0]![1] === 9.7588,
  'Reihenfolge lng,lat → lat,lng gedreht',
);

const multi = ringFromGeoJsonFeature({
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      // kleiner Ring
      [
        [
          [9.7, 53.6],
          [9.7001, 53.6],
          [9.7001, 53.6001],
          [9.7, 53.6001],
          [9.7, 53.6],
        ],
      ],
      // großer Ring
      [
        [
          [9.75, 53.65],
          [9.752, 53.65],
          [9.752, 53.652],
          [9.75, 53.652],
          [9.75, 53.65],
        ],
      ],
    ],
  },
});
assert(multi !== null, 'MultiPolygon → Ring');
assert(
  multi!.some(([la]) => la >= 53.65),
  'MultiPolygon nimmt den größten Ring',
);

assert(ringFromGeoJsonFeature(null) === null, 'null feature → null');
assert(
  ringFromGeoJsonFeature({ geometry: { type: 'Point', coordinates: [9, 53] } }) ===
    null,
  'Point-Geometrie → kein Ring',
);

// pickBestBuildingRingAt: kleinstes enthaltendes Gebäude unter dem Pin.
const featureA = {
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [9.7588, 53.6781],
        [9.7591, 53.6781],
        [9.7591, 53.67835],
        [9.7588, 53.67835],
        [9.7588, 53.6781],
      ],
    ],
  },
};
const featureFar = {
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [9.8, 53.7],
        [9.801, 53.7],
        [9.801, 53.701],
        [9.8, 53.701],
        [9.8, 53.7],
      ],
    ],
  },
};
const best = pickBestBuildingRingAt(53.6782, 9.75895, [featureA, featureFar]);
assert(best !== null, 'Gebäude unter Pin gefunden');
assert(best![0]![0] === 53.6781, 'nahes Gebäude gewählt (nicht das ferne)');
assert(pickBestBuildingRingAt(53.6782, 9.75895, []) === null, 'leer → null');

const poiHere = {
  properties: { name: 'Bäcker', kind: 'bakery' },
  geometry: { type: 'Point', coordinates: [9.75895, 53.6782] },
};
const poiFar = {
  properties: { name: 'Andere', kind: 'cafe' },
  geometry: { type: 'Point', coordinates: [9.77, 53.69] },
};
assert(
  hasBasemapPoiSymbolNear(53.6782, 9.75895, [poiHere, poiFar]),
  'nahes Basemap-Symbol zählt',
);
assert(
  !hasBasemapPoiSymbolNear(53.6782, 9.75895, [poiFar]),
  'fernes Symbol zählt nicht',
);
assert(
  !hasBasemapPoiSymbolNear(53.6782, 9.75895, [
    {
      properties: { name: 'Prisdorf', kind: 'village' },
      geometry: { type: 'Point', coordinates: [9.75895, 53.6782] },
    },
  ]),
  'Ortsname ist kein POI-Icon',
);

console.log('basemapFeatureQuery.smoke.test.ts OK');
