/**
 * GPS ≠ Abflugstadt — Anreise-Task Detection + Chain.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/flights/flightOriginMismatch.smoke.ts
 */
import assert from 'node:assert/strict';
import {
  detectOriginGpsMismatch,
  buildOriginAccessWorkChain,
  parseOriginAccessReply,
  originAccessChips,
} from './flightOriginMismatch';

// Prien-ish GPS near MUC vs stated Berlin
const mm = detectOriginGpsMismatch({
  gpsLat: 47.855,
  gpsLng: 12.346,
  userText: 'Ich fliege von Berlin nach London, bestell mir ein Taxi zum Flughafen',
});
assert.equal(mm.mismatch, true, 'MUC-area vs Berlin mismatch');
assert.ok(mm.statedAirport && /berlin/i.test(mm.statedAirport.city));
assert.ok(mm.gpsAirport);
assert.ok((mm.distanceKm ?? 0) > 80);

const same = detectOriginGpsMismatch({
  gpsLat: 53.55,
  gpsLng: 10.0,
  userText: 'Taxi zum Flughafen Hamburg für meinen Flug',
  originHint: 'Hamburg',
});
assert.equal(same.mismatch, false, 'same city no mismatch');

const {
  pickPlausibleFlightOrigin,
  flightOriginNeedsClarify,
} = require('./flightOriginMismatch') as typeof import('./flightOriginMismatch');
const { findAirportByCityHint, nearestCommercialAirport, airportByIata } =
  require('./airportIata') as typeof import('./airportIata');

const ham = findAirportByCityHint('Hamburg')!;
const spu = findAirportByCityHint('Split')!;
const muc = nearestCommercialAirport(48.1, 11.5)!; // near MUC
assert.ok(ham && spu && muc);

// Genannter Origin gewinnt — GPS (MUC) darf nicht rein
const named = pickPlausibleFlightOrigin({
  originFromHint: ham,
  originFromGps: muc,
  prevOrigin: airportByIata('BER'),
  dest: spu,
  userNamedOrigin: true,
});
assert.equal(named?.iata, 'HAM', 'named Hamburg wins over GPS/prev');

// Ohne Hint: GPS ok
const gpsPick = pickPlausibleFlightOrigin({
  originFromHint: null,
  originFromGps: ham,
  prevOrigin: null,
  dest: spu,
  userNamedOrigin: false,
});
assert.equal(gpsPick?.iata, 'HAM', 'gps fallback');

// Named aber unauflösbar → null, nicht GPS
const unresolved = pickPlausibleFlightOrigin({
  originFromHint: null,
  originFromGps: muc,
  prevOrigin: ham,
  dest: spu,
  userNamedOrigin: true,
});
assert.equal(unresolved, null, 'named unresolved rejects gps');
assert.equal(
  flightOriginNeedsClarify({
    userNamedOrigin: true,
    origin: null,
    dest: spu,
    originHint: 'Nirgendwo',
  }),
  true,
  'needs clarify',
);

// Origin = Dest verboten
const sameCity = pickPlausibleFlightOrigin({
  originFromHint: spu,
  originFromGps: ham,
  prevOrigin: null,
  dest: spu,
  userNamedOrigin: true,
});
assert.equal(sameCity, null, 'origin≠dest');

const chain = buildOriginAccessWorkChain({
  mismatch: mm,
  flightTaskId: 'flight',
  taxiTaskId: 'taxi',
  accessLeg: 'needed',
})!;
assert.ok(chain.some((w) => w.id === 'origin_access'));
assert.ok(chain.some((w) => w.id === 'taxi' && w.dependsOn === 'origin_access'));

const hotelChain = buildOriginAccessWorkChain({
  mismatch: mm,
  accessLeg: 'hotel',
})!;
assert.ok(hotelChain.some((w) => w.worker === 'hotel'));

assert.equal(parseOriginAccessReply('Ich bin schon in Berlin'), 'already_there');
assert.equal(parseOriginAccessReply('Ich fahre mit der Bahn nach Berlin'), 'train');
assert.equal(
  parseOriginAccessReply('Ich übernachte vorher im Hotel'),
  'hotel',
);

const chips = originAccessChips('Berlin');
assert.ok(chips.length >= 3);
assert.ok(chips.some((c) => /Berlin/i.test(c.label)));

console.log('flightOriginMismatch.smoke.ts OK');
