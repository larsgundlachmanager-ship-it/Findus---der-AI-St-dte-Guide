/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/mapLoadPhases.smoke.test.ts
 */

import {
  MAP_CITY_PARTIAL_DEADLINE_MS,
  MAP_NEAR_RADIUS_M,
  beginMapLoadPhases,
  isMapExtractFrozen,
  isMapWorldReleaseAllowed,
  noteMapCityFinal,
  noteMapCityPartial,
  noteMapNearReady,
  noteMapPlacesReady,
  peekMapLoadPhases,
  peekMapPaintRelease,
  resetMapLoadPhases,
  shouldSkipSameCityReclip,
  whenMapWorldAllowed,
} from './mapLoadPhases';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

resetMapLoadPhases();
beginMapLoadPhases('prisdorf');
assert(peekMapLoadPhases().phase === 'near', 'start near');
assert(peekMapPaintRelease() === 0, 'release 0 at start');
assert(MAP_NEAR_RADIUS_M === 5_000, '5 km near');
assert(!shouldSkipSameCityReclip('prisdorf'), 'vor Near-Ready noch reclip ok');
noteMapNearReady('prisdorf');
assert(peekMapPaintRelease() === 1, 'R1 roads');
assert(shouldSkipSameCityReclip('prisdorf'), 'nach Near kein Pan-Reclip');
assert(!isMapWorldReleaseAllowed(), 'EU noch zu');
assert(!peekMapLoadPhases().placesReady, 'Places noch nicht');
assert(!isMapExtractFrozen('prisdorf'), 'noch nicht frozen');

let world = false;
const unsub = whenMapWorldAllowed(() => {
  world = true;
});
noteMapPlacesReady('prisdorf');
assert(peekMapPaintRelease() === 2, 'R2 places');
assert(peekMapLoadPhases().phase === 'partial', 'places = partial');
assert(peekMapLoadPhases().placesReady, 'placesReady');
assert(!world, 'Places öffnet EU nicht');
assert(MAP_CITY_PARTIAL_DEADLINE_MS === 60_000, '60 s Partial');

noteMapCityPartial('prisdorf');
assert(peekMapLoadPhases().phase === 'partial', 'partial alias');

noteMapCityFinal('prisdorf');
assert(peekMapPaintRelease() === 3, 'R3 final');
assert(peekMapLoadPhases().phase === 'final', 'final');
assert(isMapWorldReleaseAllowed(), 'Final öffnet EU');
assert(world, 'whenMapWorldAllowed feuert');
assert(isMapExtractFrozen('prisdorf'), 'final friert');
assert(shouldSkipSameCityReclip('prisdorf'), 'frozen skip reclip');
unsub();

resetMapLoadPhases();
beginMapLoadPhases('tornesch');
noteMapNearReady('tornesch');
noteMapPlacesReady('tornesch');
noteMapCityFinal('tornesch');
assert(peekMapPaintRelease() === 3, '3 releases done');
assert(isMapExtractFrozen('tornesch'), 'explicit final freeze');
assert(!isMapExtractFrozen('prisdorf'), 'fremd-Stadt nicht frozen');

resetMapLoadPhases();
beginMapLoadPhases('prisdorf');
noteMapNearReady('prisdorf');
noteMapCityFinal('prisdorf');
beginMapLoadPhases('amsterdam');
assert(!isMapExtractFrozen('amsterdam'), 'switch taut freeze');
assert(peekMapPaintRelease() === 0, 'switch resets release count');
assert(peekMapLoadPhases().cityId === 'amsterdam', 'switch reset city');
assert(peekMapLoadPhases().phase === 'near', 'switch start near');

console.log('mapLoadPhases.smoke.test.ts OK');
