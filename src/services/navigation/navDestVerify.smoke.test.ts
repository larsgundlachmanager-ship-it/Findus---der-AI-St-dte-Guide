/**
 * Smoke: Unbenanntes Fernziel → finden + nachfragen, nicht silent starten.
 * Mit Stadt im Namen (nach „Ja“) darf starten.
 * Run: npx --yes tsx src/services/navigation/navDestVerify.smoke.test.ts
 */

import { verifyNavDestAgainstGps } from './navDestVerify';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const PRISDORF = { lat: 53.6799982, lng: 9.7606944 };
const HOLSTENTOR = { lat: 53.8664, lng: 10.6798 };
const LUEBECK_CENTER = { lat: 53.8654673, lng: 10.6865593 };

const far = verifyNavDestAgainstGps({
  name: 'Holstentor',
  lat: HOLSTENTOR.lat,
  lng: HOLSTENTOR.lng,
  userLat: PRISDORF.lat,
  userLng: PRISDORF.lng,
  simulation: false,
});
assert(!far.ok, 'Holstentor ohne Stadt von Prisdorf darf nicht auto-starten');
assert(
  !far.ok && far.kind === 'confirm',
  'Ohne Stadt: nachfragen, nicht hart blocken',
);
if (!far.ok) {
  assert(Boolean(far.message.trim()), 'Confirm braucht Sprachtext');
  assert(
    Boolean(far.destCity),
    'Confirm soll die gefundene Zielstadt mitgeben',
  );
}

const named = verifyNavDestAgainstGps({
  name: 'Holstentor Lübeck',
  lat: HOLSTENTOR.lat,
  lng: HOLSTENTOR.lng,
  userLat: PRISDORF.lat,
  userLng: PRISDORF.lng,
  mentionedCity: 'Lübeck',
  simulation: false,
});
assert(named.ok, 'Mit Stadt Lübeck im Namen darf Fernziel starten');

const afterJa = verifyNavDestAgainstGps({
  name: 'Holstentor, Lübeck',
  lat: HOLSTENTOR.lat,
  lng: HOLSTENTOR.lng,
  userLat: PRISDORF.lat,
  userLng: PRISDORF.lng,
  simulation: false,
});
assert(afterJa.ok, 'Stadt im Offer-Namen (nach Ja) darf starten');

const local = verifyNavDestAgainstGps({
  name: 'Holstentor',
  lat: HOLSTENTOR.lat,
  lng: HOLSTENTOR.lng,
  userLat: LUEBECK_CENTER.lat,
  userLng: LUEBECK_CENTER.lng,
  simulation: false,
});
assert(local.ok, 'Gleiches Stadtgebiet muss starten');

const sim = verifyNavDestAgainstGps({
  name: 'Holstentor',
  lat: HOLSTENTOR.lat,
  lng: HOLSTENTOR.lng,
  userLat: PRISDORF.lat,
  userLng: PRISDORF.lng,
  simulation: true,
});
assert(sim.ok, 'Simulation darf Verify überspringen');

const berlinMarzahn = { lat: 52.545, lng: 13.541 };
const berlinGps = { lat: 52.52, lng: 13.405 };
const saidDuesseldorf = verifyNavDestAgainstGps({
  name: 'Steinstraße 1, Düsseldorf',
  lat: berlinMarzahn.lat,
  lng: berlinMarzahn.lng,
  userLat: berlinGps.lat,
  userLng: berlinGps.lng,
  mentionedCity: 'Düsseldorf',
  simulation: false,
});
assert(!saidDuesseldorf.ok, 'Düsseldorf genannt, Berlin-Treffer nicht auto-starten');
assert(
  !saidDuesseldorf.ok && saidDuesseldorf.kind === 'wrong_city',
  'falsche Stadt = neu suchen, nicht „meinst du Berlin?“',
);

console.log('navDestVerify.smoke.test.ts OK');
