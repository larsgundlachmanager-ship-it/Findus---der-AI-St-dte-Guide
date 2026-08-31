/**
 * Smoke: Handy-laden akzeptiert nur glaubwürdige Orte — kein Heimat-/Touristen-Junk.
 * Run: npx --yes tsx src/services/navigation/phoneCharge.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  acceptChargePlace,
  formatChargeBullet,
  isPhoneChargeIntent,
  kindLabel,
} from './chargePlacePolicy';

function place(
  name: string,
  types: string[],
  extra?: { openNow?: boolean | null },
) {
  return {
    name,
    types,
    openNow: extra && 'openNow' in extra ? extra.openNow : true,
  };
}

assert.equal(
  acceptChargePlace(
    place('Heimathof Lübeck', ['tourist_attraction', 'point_of_interest']),
    'powerbank',
  ),
  null,
);
assert.equal(
  acceptChargePlace(place('Heimathaus', ['museum']), 'phone_charge'),
  null,
);
assert.equal(
  acceptChargePlace(
    place('Heimatbroschüre', ['store', 'point_of_interest']),
    'cafe',
  ),
  null,
);
assert.equal(
  acceptChargePlace(place('Spielstadt', ['amusement_park']), 'outlet_cafe'),
  null,
);
assert.equal(
  acceptChargePlace(
    place('Heimathaus', ['outlet_cafe', 'point_of_interest', 'cafe']),
    'outlet_cafe',
  ),
  null,
);
assert.equal(
  acceptChargePlace(
    place('Ort mit Steckdose', ['outlet_cafe', 'cafe']),
    'outlet_cafe',
  ),
  null,
);
assert.equal(
  acceptChargePlace(place('Hotel am Dom', ['lodging', 'hotel']), 'cafe'),
  null,
);
assert.equal(
  acceptChargePlace(
    place('Café Pfeiffer', ['cafe', 'food'], { openNow: undefined }),
    'cafe',
  ),
  null,
);

assert.equal(
  acceptChargePlace(
    place('Voozaa Powerbank', ['point_of_interest']),
    'powerbank',
  ),
  'powerbank',
);
assert.equal(
  acceptChargePlace(place('Zufälliger Kiosk', ['store']), 'powerbank'),
  null,
);

assert.equal(
  acceptChargePlace(place('Café Pfeiffer', ['cafe', 'food']), 'cafe'),
  'cafe',
);
assert.equal(
  acceptChargePlace(
    place('Café Pfeiffer', ['cafe'], { openNow: false }),
    'cafe',
  ),
  null,
);

assert.equal(
  acceptChargePlace(
    place('Stadtbibliothek', [
      'outlet_cafe',
      'library',
      'point_of_interest',
    ]),
    'outlet_cafe',
  ),
  'outlet',
);

const b0 = formatChargeBullet({
  kind: 'powerbank',
  name: 'Batterybar Dom',
  distanceM: 200,
});
const b1 = formatChargeBullet({
  kind: 'cafe',
  name: 'Café Pfeiffer',
  distanceM: 2200,
});
assert.ok(b0.includes(kindLabel('powerbank')));
assert.ok(b0.includes('Batterybar Dom'));
assert.ok(b1.includes('Café Pfeiffer'));
assert.ok(!/Heimat|Spielstadt/i.test(b0 + b1));

assert.equal(
  isPhoneChargeIntent(
    'Es ist mein Akku gerade auf 15 %, fahr wo eine Powerbank oder Steckdose ist',
  ),
  true,
);
assert.equal(isPhoneChargeIntent('Was kostet der Eintritt ins Museum?'), false);

console.log('phoneCharge smoke: ok');
