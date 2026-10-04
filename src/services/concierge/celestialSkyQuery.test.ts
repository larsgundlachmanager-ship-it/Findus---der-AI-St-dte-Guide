/**
 * Vorcheck + Anti-Nightlife-Guard.
 * Run: npx --yes tsx src/services/concierge/celestialSkyQuery.test.ts
 */

import {
  isCelestialOrSkyQuery,
  isQuickLookupQuery,
  isCrystalClearFactVorcheck,
} from './celestialSkyQuery';
import { resolveBlueprintForText } from '../../module2/blueprints/aliases';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  isCelestialOrSkyQuery('wann ist die Sonnenfinsternis'),
  'anti-nightlife eclipse',
);
assert(
  !isCelestialOrSkyQuery('was geht heute Abend'),
  'nightlife not sky',
);

assert(isQuickLookupQuery('Wie viele Einwohner hat Paris?'), 'einwohner quick');
assert(isQuickLookupQuery('Ist das der aktuelle Papst?'), 'papst followup quick');
assert(
  isQuickLookupQuery('Ist Papst Franziskus aktuell der aktuelle Papst?'),
  'franziskus still pope quick',
);
assert(
  isQuickLookupQuery('Es geht mir gerade darum, wer aktuell Papst ist'),
  'wer aktuell papst quick',
);
assert(
  isQuickLookupQuery('Wie alt ist die älteste aktuelle Person?'),
  'aelteste person quick',
);
assert(
  isQuickLookupQuery('Und wie alt ist die altälteste Person?'),
  'altälteste person quick',
);
assert(isQuickLookupQuery('Alter, wie alt ist der Papst?'), 'slang trivia still quick');
assert(isQuickLookupQuery('Was ist 3 + 3?'), 'arith quick');
assert(
  !isQuickLookupQuery('navigiere mich zum Bahnhof'),
  'nav not quick',
);
assert(
  !isQuickLookupQuery('wo ist denn hier der beste Strand in Lübeck wo man hingehen könnte'),
  'beach go is not trivia quick',
);
assert(
  !isQuickLookupQuery('wie weit ist Travemünde'),
  'distance is not trivia quick',
);
assert(
  !isQuickLookupQuery('wo ist die nächste Toilette'),
  'amenity is not trivia quick',
);

// Vorcheck: Kurzfragen ja — lange Sprachnachricht nein
assert(
  isCrystalClearFactVorcheck('Wie alt ist Mark Forster?'),
  'vorcheck mark',
);
assert(
  isCrystalClearFactVorcheck('Wann ist die Sonnenfinsternis?'),
  'vorcheck eclipse via wann',
);
assert(
  !isCrystalClearFactVorcheck(
    'Hey ich wollte mal fragen wegen der Sonnenfinsternis und dann noch ein Restaurant und ob wir das einplanen',
  ),
  'long → manager',
);

// Sky → Blaupause sky_phenomenon (kein Spezialpfad)
const sky = resolveBlueprintForText({
  userText: 'Wann ist die Sonnenfinsternis?',
});
assert(sky.blueprintId === 'sky_phenomenon', 'sky blueprint');

console.log('celestialSkyQuery.test.ts OK');
