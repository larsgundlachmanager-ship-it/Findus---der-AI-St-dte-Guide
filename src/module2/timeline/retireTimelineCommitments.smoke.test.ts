/**
 * Run: npx --yes tsx src/module2/timeline/retireTimelineCommitments.smoke.test.ts
 */

import { detectShoppingTaskDoneIntent } from '../../services/shopping/shoppingTaskIntent';
import { detectRetireTopicIntent } from './retireTopicIntent';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

/** Spiegel der Cascade-Guard-Regex — ohne RN-Import. */
function isFlightAccessOrOpenStopId(id: string): boolean {
  return /^ft:[^:]+:(leave|leg\d+|taxiopt|oepnvopt|xfer\w*|transit|access|hotel|car)$/i.test(
    id,
  );
}
assert(isFlightAccessOrOpenStopId('ft:EW123:leave'), 'leave is access');
assert(isFlightAccessOrOpenStopId('ft:EW123:leg0'), 'leg0 is access');
assert(isFlightAccessOrOpenStopId('ft:EW123:taxiopt'), 'taxiopt is access');
assert(!isFlightAccessOrOpenStopId('ft:EW123:dep'), 'dep is core');
assert(!isFlightAccessOrOpenStopId('ft:EW123:airport'), 'airport is core');

const found = detectShoppingTaskDoneIntent(
  'super, habe meine Zahnbürste gefunden',
);
assert(found, 'gefunden wird erkannt');
assert(
  (found?.itemHint || '').toLowerCase().includes('zahnbürste') ||
    (found?.itemHint || '').toLowerCase().includes('zahnbuerste'),
  `Zahnbürste-Hint, got ${found?.itemHint}`,
);

const bought = detectShoppingTaskDoneIntent('Hab die Zahnbürste gekauft');
assert(!!bought?.itemHint, 'gekauft bleibt erkannt');

const retire = detectRetireTopicIntent('Zahnbürste ist irrelevant');
assert(!!retire?.hint, 'irrelevant mit Hint');
assert(
  (retire?.hint || '').toLowerCase().includes('zahnbürste') ||
    (retire?.hint || '').toLowerCase().includes('zahnbuerste'),
  `irrelevant hint, got ${retire?.hint}`,
);

const bare = detectRetireTopicIntent("check, das war's");
assert(!!bare?.closeForeground, "bare check schließt Foreground");

assert(
  !detectShoppingTaskDoneIntent('ich brauche eine Zahnbürste'),
  'Need darf nicht als done gelten',
);

console.log('retireTimelineCommitments.smoke.test.ts OK');
