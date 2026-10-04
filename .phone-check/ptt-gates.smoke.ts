import {
  isActivitySportQuery,
  detectActivityKind,
  extractNamedActivityPlace,
} from '../src/services/research/activitySportResearch';
import {
  isCrediblePizzaVenue,
  isLodgingOnlyVenue,
} from '../src/module2/pitch/pizzaVenueGate';
import { shouldHandoffToPitchModule } from '../src/module2/pitch/shouldHandoffPitch';
import { isQuickLookupQuery } from '../src/services/concierge/celestialSkyQuery';
import { isWeakCategoryBullet } from '../src/module2/pitch/weakCategoryBullet';

function assert(cond: boolean, name: string) {
  if (!cond) throw new Error('FAIL ' + name);
  console.log('OK', name);
}

assert(
  isActivitySportQuery('Stand-Up-Pedal auf der Alster') &&
    detectActivityKind('Stand-Up-Pedal auf der Alster') === 'sup',
  'sup query',
);
assert(extractNamedActivityPlace('SUP auf der Alster') === 'Alster', 'alster extract');
assert(
  isLodgingOnlyVenue('Pension Tornisch', 'pension hotel pinneberg') === true,
  'pension out',
);
assert(
  isCrediblePizzaVenue('pizzeria rucola steinofen', 'Pizzeria Bella') === true,
  'pizzeria in',
);
assert(shouldHandoffToPitchModule('Wie alt ist der Papst?') === false, 'papst no pitch');
assert(
  shouldHandoffToPitchModule('Wo kann ich auf der Alster Stand-Up-Pedal fahren?') === false,
  'sup no pitch',
);
assert(isQuickLookupQuery('Wie alt ist der Papst?') === true, 'quick papst');
assert(isWeakCategoryBullet('Ambiente') === true, 'weak ambiente');
assert(isWeakCategoryBullet('Rucola-Pizza 12 Euro') === false, 'keep price');
console.log('ptt-gates.smoke ok');
