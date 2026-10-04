/**
 * Cruise-Terminal-Anker — Nähe ≤ 12 km → Pack-Stadt.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/cruiseTerminalAnchors.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  findNearbyCruiseTerminal,
  cruiseTerminalPinFromText,
  cruiseTerminalAnchorForCityId,
} from './cruiseTerminalAnchors';
import { IN_CITY_KM } from './cityProximityDecision';

assert.equal(IN_CITY_KM, 12, '12 km remains SSOT');

// Gdynia Cruise Terminal → Danzig pack
const gdynia = findNearbyCruiseTerminal(54.5333, 18.5514, IN_CITY_KM);
assert.ok(gdynia, 'gdynia terminal hit');
assert.equal(gdynia!.anchor.cityId, 'danzig');
assert.ok(gdynia!.km < 1, 'on terminal');

// Gdańsk Altstadt (~21 km) — kein Terminal-Hit bei 12 km
const gdanskCenter = findNearbyCruiseTerminal(54.352, 18.6466, IN_CITY_KM);
assert.equal(gdanskCenter, null, 'altstadt outside 12 km of Gdynia terminal');

// Kiel Ostseekai
const kiel = findNearbyCruiseTerminal(54.32487, 10.14549, IN_CITY_KM);
assert.ok(kiel);
assert.equal(kiel!.anchor.cityId, 'kiel');

assert.equal(
  cruiseTerminalPinFromText('Cruise Center Kiel')?.name.includes('Ostseekai'),
  true,
);
assert.equal(
  cruiseTerminalPinFromText('Mein Schiff Gdynia')?.lat != null,
  true,
);
assert.equal(cruiseTerminalAnchorForCityId('danzig')?.cityId, 'danzig');

console.log('cruiseTerminalAnchors.smoke.test.ts OK');
