/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/transit/directionLabel.smoke.test.ts
 */

import {
  cleanDirectionLabel,
  looksLikeStreetHeadsign,
  pickRawDirection,
} from './directionLabel';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  looksLikeStreetHeadsign('Nincoper Straße 160'),
  'Straßen+Nr. erkannt',
);
assert(looksLikeStreetHeadsign('Hauptstrasse 12'), 'strasse+Nr.');
assert(!looksLikeStreetHeadsign('Wrist'), 'Wrist ist kein Straßen-Ziel');
assert(!looksLikeStreetHeadsign('Pinneberg'), 'Stadtname ok');
assert(cleanDirectionLabel('Wrist Bahnhof') === 'Wrist', 'Bahnhof strippen');
assert(cleanDirectionLabel('Pinneberg') === 'Pinneberg', 'Stadt unverändert');
assert(
  pickRawDirection('Nincoper Straße 160', 'Nincoper Straße 160') ===
    'Nincoper Straße 160',
  'beide Straße → tripTo',
);
assert(
  pickRawDirection('Wrist', 'Nincoper Straße 160') === 'Wrist',
  'sauberer Headsign gewinnt',
);

console.log('directionLabel.smoke.test.ts OK');
