/**
 * Neighbor-pack / rental Call-3 structure smoke (no Expo FS).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/neighborPackCascade.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { extractRentalPricesFromText } from '../../services/research/rentalPriceFromWebsite';
import { shouldRunCall3Rethink } from '../reboot/pipeline/call3Rethink';

// Pure mirror of packGeoAnchor (SSOT in packPlaceResolve — kein Expo im Smoke)
function packGeoAnchor(pack: {
  lat?: number;
  lng?: number;
  _coverage?: {
    latMin?: number;
    latMax?: number;
    lngMin?: number;
    lngMax?: number;
  } | null;
}): { lat: number; lng: number } | null {
  if (
    typeof pack.lat === 'number' &&
    Number.isFinite(pack.lat) &&
    typeof pack.lng === 'number' &&
    Number.isFinite(pack.lng)
  ) {
    return { lat: pack.lat, lng: pack.lng };
  }
  const c = pack._coverage;
  if (
    c &&
    typeof c.latMin === 'number' &&
    typeof c.latMax === 'number' &&
    typeof c.lngMin === 'number' &&
    typeof c.lngMax === 'number'
  ) {
    return {
      lat: (c.latMin + c.latMax) / 2,
      lng: (c.lngMin + c.lngMax) / 2,
    };
  }
  return null;
}

assert.deepEqual(packGeoAnchor({ lat: 53.55, lng: 9.99 }), {
  lat: 53.55,
  lng: 9.99,
});
assert.ok(
  packGeoAnchor({
    _coverage: { latMin: 53.5, latMax: 53.6, lngMin: 9.9, lngMax: 10.0 },
  }),
);

const rentalHits = extractRentalPricesFromText(
  'SUP Verleih Preise: 20 € / 2 Stunden. Board 15 Euro pro Stunde.',
);
assert.ok(rentalHits.length >= 1, 'rental price extract');
assert.match(rentalHits[0]!.label, /€/);

assert.equal(
  shouldRunCall3Rethink({
    bullets: [],
    followUp: {
      needed: true,
      reason: 'rental_prices',
      delegateTo: 'call3',
      promptSeed: 'SUP Preis',
    },
  }),
  true,
  'call3 rental_prices',
);

console.log('[neighborPackCascade] ok', { rental: rentalHits[0]?.label });
