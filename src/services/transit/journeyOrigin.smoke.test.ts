/**
 * Journey-Origin harden — Pack-Halt ohne GPS (kein RN).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/transit/journeyOrigin.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  clearTransitStationRegistry,
  setTransitPackConfig,
  pickPrimaryPackRailStop,
} from './stationRegistry';

clearTransitStationRegistry();
assert.equal(pickPrimaryPackRailStop(), null, 'empty pack');

setTransitPackConfig({
  default_ibnr: '8004888',
  stops: [
    {
      id: 'bus1',
      name: 'Prisdorf Ort',
      lat: 53.7,
      lng: 9.7,
      mode: 'bus',
    },
    {
      id: 'rail1',
      name: 'Prisdorf',
      lat: 53.675,
      lng: 9.745,
      mode: 'rail',
      ibnr: '8004888',
    },
  ],
});

const rail = pickPrimaryPackRailStop();
assert.ok(rail, 'rail stop');
assert.equal(rail!.id, 'rail1', 'prefers rail mode');
assert.equal(rail!.lat, 53.675);

// Origin-Hint-Heuristik (spiegel zu extractOriginHint — ohne RN-Import)
function extractOriginHintLite(text: string): string | null {
  const m = text.match(
    /\bvon\s+([A-ZÄÖÜa-zäöüß][\wäöüß\-]*(?:\s+[A-ZÄÖÜa-zäöüß][\wäöüß\-]*){0,2})(?:\s+(?:nach|richtung|zum|zur)\b)/iu,
  );
  const raw = (m?.[1] || '').trim();
  if (raw.length < 3) return null;
  return raw.slice(0, 48);
}
assert.equal(extractOriginHintLite('von Prisdorf nach Kiel'), 'Prisdorf');
assert.equal(extractOriginHintLite('Morgen 12 Uhr Bahn nach Kiel'), null);

clearTransitStationRegistry();
console.log('journeyOrigin.smoke.test.ts OK');
