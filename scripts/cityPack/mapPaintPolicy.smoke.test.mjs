/**
 * mapPaintPolicy — Pack-SSOT story_fill / building_focus / icon_only
 */
import assert from 'node:assert/strict';
import {
  resolveMapPaint,
  stampMapPaintOnPack,
  needsBuildingFootprint,
} from './mapPaintPolicy.mjs';

assert.equal(
  resolveMapPaint({
    name: 'Spielplatz Schnickenfeld',
    category: 'spielplatz',
    pack_role: 'directory',
    tags: ['directory', 'spielplatz'],
  }),
  'icon_only',
  'Spielplatz = icon_only',
);

assert.equal(
  resolveMapPaint({
    name: 'Gewerbegebiet Peiner Hag',
    category: 'service',
    pack_role: 'directory',
    tags: ['directory', 'gewerbegebiet'],
  }),
  'icon_only',
  'Gewerbegebiet = icon_only',
);

assert.equal(
  resolveMapPaint({
    name: "Marktkauf Meyer's Frischecenter",
    category: 'supermarket',
    pack_role: 'directory',
    tags: ['directory', 'supermarket'],
  }),
  'building_focus',
  'Marktkauf = building_focus',
);

assert.equal(
  resolveMapPaint({
    name: 'Badehaus Prisdorf',
    category: 'freizeit',
    pack_role: 'story',
    place_tier: 2,
    tags: ['story', 'module1', 'must_have'],
  }),
  'story_fill',
  'Badehaus = story_fill',
);

assert.equal(
  needsBuildingFootprint({
    name: 'Spielplatz',
    category: 'spielplatz',
    tags: ['spielplatz'],
  }),
  false,
);

assert.equal(
  needsBuildingFootprint({
    name: 'Marktkauf',
    category: 'supermarket',
    tags: ['supermarket'],
  }),
  true,
);

const pack = {
  spots: [
    {
      id: 'a',
      name: 'Spielplatz X',
      category: 'spielplatz',
      pack_role: 'directory',
      tags: ['directory'],
      polygonCoordinates: [
        { latitude: 1, longitude: 1 },
        { latitude: 1, longitude: 2 },
        { latitude: 2, longitude: 2 },
        { latitude: 2, longitude: 1 },
        { latitude: 1, longitude: 1 },
      ],
    },
  ],
  trigger_points: [],
};
const stats = stampMapPaintOnPack(pack);
assert.equal(stats.iconOnly, 1);
assert.equal(stats.polysCleared, 1);
assert.ok(!pack.spots[0].polygonCoordinates);
assert.ok(pack.spots[0].tags.includes('map_icon_only'));

console.log('mapPaintPolicy.smoke.test.mjs OK');
