import { shouldHandoffToPitchModule } from '../pitch/shouldHandoffPitch';
import {
  detectLiveInventoryKind,
  resolveLiveInventoryUserText,
} from '../router/liveInventoryGate';
import { detectPitchKind, parseWishesFromText } from '../pitch/parentBrief';
import { classifyUtteranceFamily } from '../kernel/utteranceFamily';
import { isFlightTripQuery } from '../../services/flights/flightTripIntent';
import { extractNamedRestaurantWish } from '../pitch/namedVenueIntent';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  extractNamedRestaurantWish(
    'In zwei Wochen moechte ich ein Wochenende nach Lissabon planen',
  ) == null,
  'Wochenende nach Lissabon ≠ Venue',
);
assert(
  detectPitchKind(
    'In zwei Wochen moechte ich ein Wochenende nach Lissabon planen',
  ) === 'generic',
  'Wochenende → pitchKind generic',
);
assert(
  classifyUtteranceFamily(
    'In zwei Wochen moechte ich ein Wochenende nach Lissabon planen',
  ).family === 'plan',
  'Wochenende planen → plan family',
);
assert(
  classifyUtteranceFamily('Flug Hamburg Lissabon 11. September').family ===
    'flight',
  'Flug → flight',
);
assert(
  isFlightTripQuery('Flug Hamburg Lissabon 11. September'),
  'Flug is trip query',
);
assert(
  !shouldHandoffToPitchModule('Flug Hamburg Lissabon 11. September'),
  'Flug not pitch handoff',
);
assert(
  detectLiveInventoryKind('Flug Hamburg Lissabon 11. September') == null,
  'Flug not live inventory',
);
assert(
  parseWishesFromText(
    'In zwei Wochen moechte ich ein Wochenende nach Lissabon planen',
  ).every((w) => w.kind !== 'venue'),
  'no venue wish on weekend plan',
);
assert(
  resolveLiveInventoryUserText('Flug Hamburg Lissabon 11. September')
    .inherited === false,
  'Flug not inherited',
);

console.log('lisbonFlightGate.smoke.test.ts ok');
