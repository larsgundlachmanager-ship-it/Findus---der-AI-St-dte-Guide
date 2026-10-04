/**
 * Quick smokes for founder-must fixes (Node-safe, no RN).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/concierge/founderMustFixes.smoke.ts
 */
import { isWorldFactUtterance } from '../../module2/reboot/pipeline/worldFactGuard';
import { normalizeAmenityCriterionKey } from '../../module2/pitch/call1Criteria';
import { wantsTaxiRide } from '../mobility/taxiRideIntent';
import {
  parseFlightTripSlots,
  shouldScrubFlightOnTopicCut,
} from '../flights/flightTripIntent';
import { classifyTimeCareIntent } from './timeCareIntent';

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    failed += 1;
  }
}

const brush =
  'Was brauche ich noch — eine Zahnbürste. Kannst du mich daran erinnern, die mitzunehmen?';
assert(classifyTimeCareIntent(brush)?.kind === 'reminder', 'toothbrush → reminder');

assert(isWorldFactUtterance('Wie hoch ist der Michel?'), 'michel height world fact');
assert(normalizeAmenityCriterionKey('besten Terrasse') === 'terrasse', 'besten terrasse key');

const south = parseFlightTripSlots(
  'ich will morgen fliegen — guck bei Hamburg Flüge Richtung Süden Tickets',
);
assert(south.regionHint === 'south', 'regionHint south');
assert(south.destHint == null, 'Süden not dest');

assert(
  shouldScrubFlightOnTopicCut(
    'Welche Theaterstücke oder Vorstellungen laufen heute oder die Tage in der Nähe?',
  ),
  'theater scrubs flight',
);
assert(
  wantsTaxiRide('Reserviere morgen früh um 7 Uhr ein Taxi zum Flughafen Hamburg'),
  'taxi prebook intent',
);
assert(
  classifyTimeCareIntent(
    'Reserviere morgen früh um 7 Uhr ein Taxi zum Flughafen Hamburg',
  ) == null,
  'taxi not transit_leave',
);

{
  const {
    isPackItemReminderAnchor,
    defaultPackItemReminderMs,
  } = require('./timeCareIntent') as {
    isPackItemReminderAnchor: (s: string) => boolean;
    defaultPackItemReminderMs: (n?: number) => number;
  };
  assert(isPackItemReminderAnchor('Zahnbürste'), 'brush pack anchor');
  assert(isPackItemReminderAnchor('zahnbuerste'), 'brush ascii');
  const fire = defaultPackItemReminderMs(Date.parse('2026-09-07T10:00:00+02:00'));
  assert(fire > Date.parse('2026-09-07T10:00:00+02:00'), 'pack fire future');
}

if (failed) {
  console.error(`founderMustFixes smoke: ${failed} failed`);
  process.exit(1);
}
console.log('founderMustFixes smoke: ok');
