/**
 * Street address + fuzzy city — Feedback 2026-08-12.
 * Run: npx --yes tsx src/services/navigation/streetAddress.test.ts
 */

import {
  looksLikeStreetAddress,
  streetAddressGeocodeCandidates,
  expandStreetAddressGeocodeQueries,
  extractStreetAddressFromUtterance,
  parseStreetHouseQuery,
  sanitizeNavDestQuery,
  stripEntranceDisplaySuffix,
  stripNavDestLeak,
} from './streetAddressQuery';
import {
  fuzzyResolveCityName,
  geocodeBiasForSpokenCity,
  spokenCityFromQuery,
  splitStreetAndCity,
} from './fuzzyCityResolve';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(looksLikeStreetAddress('heisterhof 12'), 'heisterhof 12');
assert(looksLikeStreetAddress('Heisterhoop 12'), 'Heisterhoop 12');
assert(
  extractStreetAddressFromUtterance(
    'Ich möchte zum Heisterhoop 12 navigiert werden',
  ) === 'Heisterhoop 12',
  'Adresse aus Satz',
);
assert(
  extractStreetAddressFromUtterance('navigiert werden zum Heisterhoop 12') ===
    'Heisterhoop 12',
  'navigiert werden zum',
);
assert(parseStreetHouseQuery('Heisterhoop 12')?.housenumber === '12', 'Hausnummer 12');
assert(looksLikeStreetAddress('heisterhof 12 in Prisdorf'), 'with city');
assert(
  extractStreetAddressFromUtterance('Ulmenallee 23 in Pinneberg') ===
    'Ulmenallee 23 in Pinneberg',
  'Stadt hinter der Allee bleibt dran',
);
assert(
  extractStreetAddressFromUtterance(
    'navigiert werden zum Ulmenallee 23 in Pinneberg',
  ) === 'Ulmenallee 23 in Pinneberg',
  'Adresse+Stadt aus Satz',
);

const expandedPinne = expandStreetAddressGeocodeQueries(
  'Ulmenallee 23 in Pinneberg',
  { profileCity: 'Lübeck', biasLat: 53.677, biasLng: 9.764 },
);
assert(expandedPinne[0]?.toLowerCase().includes('pinneberg'), 'gesprochene Stadt zuerst');
assert(
  expandedPinne.findIndex((c) => /lübeck|luebeck/i.test(c)) < 0 ||
    expandedPinne.findIndex((c) => /pinneberg/i.test(c)) <
      expandedPinne.findIndex((c) => /lübeck|luebeck/i.test(c)),
  'Pinneberg vor Lübeck',
);
assert(looksLikeStreetAddress('Hauptstraße 3a'), 'Hauptstraße');
assert(looksLikeStreetAddress('Bahnhofstr. 12'), 'Bahnhofstr.');
assert(!looksLikeStreetAddress('Heisterhof'), 'no number → not address');
assert(!looksLikeStreetAddress('Hotel 12 Apostel'), 'hotel false positive');
assert(!looksLikeStreetAddress('Bus Linie 12'), 'bus false positive');
assert(!looksLikeStreetAddress('unter 500'), 'Budget unter 500 ist keine Adresse');
assert(
  extractStreetAddressFromUtterance(
    'Unterkunft in Berlin mit Pool und Sauna unter 500 Euro',
  ) == null,
  'Hotel-Budget nicht als Straße',
);

const cands = streetAddressGeocodeCandidates('heisterhof 12 in Prisdorf');
assert(cands[0] === 'heisterhof 12 in Prisdorf', 'primary cand');
assert(
  cands.some((c) => /heisterhoop 12/i.test(c)),
  'hof→hoop alternate',
);

assert(fuzzyResolveCityName('Pillerberg') === 'Pinneberg', 'Pillerberg→Pinneberg');
assert(fuzzyResolveCityName('Pilleberg') === 'Pinneberg', 'Pilleberg→Pinneberg');
assert(fuzzyResolveCityName('Pineberg') === 'Pinneberg', 'Pineberg→Pinneberg');
assert(fuzzyResolveCityName('Pinneberg') === 'Pinneberg', 'exact');
assert(fuzzyResolveCityName('den') === null, 'stopword');

const split = splitStreetAndCity('Uhlmannallee 23 in Pillerberg');
assert(split.street === 'Uhlmannallee 23', 'street split');
assert(split.spokenCity === 'Pillerberg', 'city split');

const expanded = expandStreetAddressGeocodeQueries(
  'Uhlmannallee 23 in Pillerberg',
  { profileCity: 'Prisdorf' },
);
assert(
  expanded.some((c) => /pinneberg/i.test(c)),
  'expanded has Pinneberg',
);
assert(
  !expanded.some((c) => /prisdorf/i.test(c)),
  'gesprochene Stadt, nicht Profil-Stadt',
);

const dirtyDuesseldorf = expandStreetAddressGeocodeQueries(
  'Steinstraße 1, Düsseldorf [TASK primary] Beantworte: Steinstraße 1, Düsseldorf, Berlin Umland',
  { profileCity: 'Berlin Umland', biasLat: 52.52, biasLng: 13.405 },
);
assert(
  dirtyDuesseldorf.some((c) => /d[üu]sseldorf/i.test(c)),
  'Düsseldorf bleibt in den Kandidaten',
);
assert(
  !dirtyDuesseldorf.some((c) => /berlin/i.test(c)),
  'kein GPS-Berlin an gesprochener Düsseldorf-Adresse',
);

assert(
  sanitizeNavDestQuery(
    'Steinstraße 1, Düsseldorf [TASK primary] Beantworte: Steinstraße 1, Düsseldorf, Berlin Umland',
  ) === 'Steinstraße 1, Düsseldorf',
  'sanitize hält erste Straße+Stadt',
);
assert(
  !/task|beantworte|berlin/i.test(
    stripNavDestLeak('Steinstraße 1, Düsseldorf [TASK primary] Beantworte: x'),
  ),
  'TASK/Brief weg',
);
assert(
  spokenCityFromQuery('Steinstraße 1, Düsseldorf, Berlin Umland') ===
    'Düsseldorf',
  'erste Stadt im Text gewinnt',
);
const spokenBias = geocodeBiasForSpokenCity('Steinstraße 1, Düsseldorf');
assert(spokenBias?.cityHint === 'Düsseldorf', 'Bias-Stadt Düsseldorf');
assert(
  spokenBias?.biasLat != null && Math.abs(spokenBias.biasLat - 51.22) < 0.1,
  'Düsseldorf-Pack-Koordinaten, nicht GPS',
);

assert(
  stripEntranceDisplaySuffix(
    'Historisches Bahnwartehäuschen · Haupteingang',
  ) === 'Historisches Bahnwartehäuschen',
  'Haupteingang-Suffix weg',
);
assert(
  stripEntranceDisplaySuffix('Bahnhof Prisdorf · Eingang') ===
    'Bahnhof Prisdorf',
  'Eingang-Suffix weg',
);
assert(
  stripEntranceDisplaySuffix('Museum · Nebeneingang Nord') ===
    'Museum · Nebeneingang Nord',
  'benannte Tür bleibt',
);

console.log('streetAddress.test.ts OK');
