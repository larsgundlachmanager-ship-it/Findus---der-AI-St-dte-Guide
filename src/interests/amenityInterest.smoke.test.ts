/**
 * Smoke: Directory-Tennis bei Sport=yes darf Modul-1 feuern.
 * Run: npx --yes tsx src/interests/amenityInterest.smoke.test.ts
 */

import {
  amenitySkipBlocksProactive,
  isHardAmenityNoise,
  isInterestVisitVenue,
  isNonStoryTouristNoisePoi,
} from './amenityInterestPolicy';
import type { Poi } from '../db/types';
import type { UserProfile } from '../types/userProfile';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function poi(partial: Partial<Poi> & { name: string }): Poi {
  return {
    id: partial.id ?? 1,
    name: partial.name,
    lat: 53.87,
    lng: 10.69,
    radius_meters: 40,
    spot_key: partial.spot_key ?? 'x',
    parent_poi_id: null,
    kind: partial.kind ?? 'area',
    category: partial.category ?? null,
    tags_json: partial.tags_json ?? '[]',
    polygon_json: null,
    teaser_text: null,
    condition_rule: 'always',
    special_radius_m: null,
  };
}

const tennis = poi({
  name: 'Tennisschule Raabe GbR im LBV Phönix',
  category: 'sport',
  tags_json: JSON.stringify([
    'sport',
    'directory',
    'amenity_skip',
    'tier4',
    'offline_lookup',
  ]),
});

const toilet = poi({
  name: 'Öffentliche Toilette',
  category: 'toilette',
  tags_json: JSON.stringify(['toilette', 'directory', 'amenity_skip']),
});

const theater = poi({
  name: 'Theater Lübeck',
  category: 'theater',
  tags_json: JSON.stringify(['theater', 'must_have', 'story']),
});

assert(isInterestVisitVenue(tennis), 'tennis is interest venue');
assert(isHardAmenityNoise(toilet), 'toilet is hard noise');
assert(!isHardAmenityNoise(tennis), 'tennis not hard noise');

const profileYes = {
  experiencePrefs: { sport: 'yes' },
} as unknown as UserProfile;
const profileNo = {
  experiencePrefs: { sport: 'no' },
} as unknown as UserProfile;

assert(
  !amenitySkipBlocksProactive(tennis, profileYes),
  'tennis + sport=yes may fire',
);
assert(
  amenitySkipBlocksProactive(tennis, profileNo),
  'tennis + sport=no still blocked',
);
const dentist = poi({
  name: 'Zahnarztpraxis Heilmann und von Döhren',
  category: 'gesundheit',
  tags_json: JSON.stringify([
    'gesundheit',
    'directory',
    'amenity_skip',
    'tier4',
    'offline_lookup',
  ]),
});

assert(isHardAmenityNoise(dentist), 'zahnarzt is hard amenity noise');
assert(
  amenitySkipBlocksProactive(dentist, profileYes),
  'zahnarzt never auto-triggers',
);
const pharmacy = poi({
  name: 'Apotheke am Markt',
  category: 'gesundheit',
  tags_json: JSON.stringify(['gesundheit', 'directory', 'amenity_skip']),
});
assert(isHardAmenityNoise(pharmacy), 'apotheke is hard amenity noise');
assert(isNonStoryTouristNoisePoi(pharmacy), 'apotheke ohne story nicht auf Karte');
assert(isNonStoryTouristNoisePoi(dentist), 'zahnarzt ohne story nicht auf Karte');
assert(isNonStoryTouristNoisePoi(toilet), 'toilette ohne story nicht auf Karte');
assert(!isNonStoryTouristNoisePoi(theater), 'theater-story bleibt auf der Karte');
assert(!isNonStoryTouristNoisePoi(tennis), 'tennis-venue bleibt auf der Karte');
assert(amenitySkipBlocksProactive(toilet, profileYes), 'toilet always blocked');
assert(
  !amenitySkipBlocksProactive(theater, profileYes),
  'must_have theater never amenity-blocked',
);

console.log('amenityInterest.smoke.test.ts OK');
