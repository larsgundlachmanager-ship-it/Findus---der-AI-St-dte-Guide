/**
 * SUP / Aktivitäts-Recherche: STT-Garbling + harte Places-Query.
 */
import assert from 'node:assert/strict';
import {
  buildActivityPlacesQuery,
  detectActivityKind,
  extractNamedActivityPlace,
  isActivitySportQuery,
  normalizeActivityUtterance,
} from './activitySportQuery';

assert.equal(
  normalizeActivityUtterance('Centerpanel auf der Alster fahren'),
  'SUP auf der Alster fahren',
);
assert.equal(
  normalizeActivityUtterance('Sub Verleih an der Alster'),
  'SUP Verleih an der Alster',
);
assert.match(
  normalizeActivityUtterance('Stellappell wo kann man'),
  /^SUP\b/i,
);

assert.equal(
  isActivitySportQuery('Kann ich auf der Alster Centerpanel fahren?'),
  true,
);
assert.equal(detectActivityKind('Centerpanel auf der Alster'), 'sup');
assert.equal(detectActivityKind('Sub Verleih Alster'), 'sup');
assert.equal(extractNamedActivityPlace('SUP auf der Alster'), 'Alster');

assert.equal(
  buildActivityPlacesQuery('sup', 'Alster', 'Prisdorf'),
  'SUP Verleih Alster Hamburg',
);
assert.match(
  buildActivityPlacesQuery('sup', null, 'Hamburg'),
  /^SUP Verleih Hamburg$/,
);

console.log('activitySportResearch.smoke.test.ts: ok');
