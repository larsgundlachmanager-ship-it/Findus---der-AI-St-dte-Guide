/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/sameNavDestination.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  isLikelyCityOnlyNavLabel,
  isSameNavDestination,
  shouldRejectCityGeocodeForVenueQuery,
} from './sameNavDestination';
import { packPlaceNameScore } from './packPlaceNameScore';
import { peekAnswerLeadBridge } from '../speech/answerLeadBridge';
import { canonicalizeLandmarkQuery } from './landmarkAliases';

assert.equal(isLikelyCityOnlyNavLabel('Prisdorf, Schleswig-Holstein, Deutschland'), true);
assert.equal(isLikelyCityOnlyNavLabel('Tennis-Club Prisdorf TCP'), false);

assert.equal(
  isSameNavDestination({
    liveName: 'Prisdorf, Schleswig-Holstein, Deutschland',
    nextName: 'Tennis-Club Prisdorf TCP',
    liveLat: 53.68,
    liveLng: 9.76,
    nextLat: 53.683,
    nextLng: 9.751,
  }),
  false,
  'Stadt-Mitte darf Tennis-Club nicht als „schon aktiv“ halten',
);

assert.equal(
  shouldRejectCityGeocodeForVenueQuery(
    'Tennis Club Prisdorf',
    'Prisdorf, Kreis Pinneberg, Schleswig-Holstein, Deutschland',
  ),
  true,
  'Venue-Query + Stadt-Label → reject',
);

assert.ok(
  packPlaceNameScore('Tennis-Club Prisdorf TCP', 'Tennis Club Prisdorf') >= 70,
  'TCP Pack-Score stark genug',
);

const peek = peekAnswerLeadBridge('Navigiere mich zum Tennis Club Prisdorf') || '';
assert.match(peek, /navigiere dich zu/i, 'Nav-Peek nennt Ziel, kein nacktes Alles klar');
assert.ok(!/^Alles klar,?$/i.test(peek.trim()), 'kein nacktes Alles klar');

const canon = canonicalizeLandmarkQuery('Tennis Club prsidorf');
assert.equal(canon.matchedLandmark, true, 'prsidorf → TCP alias');
assert.match(canon.query, /Tennis-Club Prisdorf/i);

console.log('sameNavDestination.smoke.test.ts OK');
