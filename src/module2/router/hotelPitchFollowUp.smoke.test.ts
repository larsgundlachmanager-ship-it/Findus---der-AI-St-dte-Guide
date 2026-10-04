/**
 * Hotel empty follow-up — kein „erstes Hotel“ ohne Inventar.
 * Run: npx --yes tsx src/module2/router/hotelPitchFollowUp.smoke.test.ts
 */

import {
  clearLastLiveInventory,
  noteLastLiveInventory,
} from '../context/shortTermContext';
import {
  buildHotelWidenRetryQuery,
  inferHotelPitchOutcomeFromSpeech,
  isHotelOrdinalVerifyFollowUp,
  resolveHotelEmptyFollowUp,
} from './hotelPitchFollowUp';
import { isInventoryFollowUp } from './liveInventoryGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  isHotelOrdinalVerifyFollowUp('Hat das erste Hotel wirklich einen Pool?'),
  'ordinal pool verify',
);
assert(
  !isHotelOrdinalVerifyFollowUp('Wie wird das Wetter morgen?'),
  'weather not hotel follow',
);

assert(
  inferHotelPitchOutcomeFromSpeech(
    'Kein passendes Hotel in Prisdorf mit Pool unter 500 Euro.',
  ) === 'empty',
  'empty speech',
);
assert(
  inferHotelPitchOutcomeFromSpeech('Zwei Optionen:', [], ['Hotel Nord', 'Seeblick']),
  'named from options',
);

clearLastLiveInventory();
noteLastLiveInventory({
  kind: 'hotel',
  query: 'Hotel Freitag bis Sonntag mit Pool und Sauna unter 500 Euro',
  hotelOutcome: 'empty',
});
assert(
  isInventoryFollowUp('Hat das erste Hotel wirklich einen Pool?'),
  'pool verify is inventory follow-up',
);

const retry = resolveHotelEmptyFollowUp({
  userText: 'Hat das erste Hotel wirklich einen Pool?',
  turnId: 't1',
  inheritInventory: true,
});
assert(retry && 'retryQuery' in retry, 'first follow-up widens search');
assert(/breiter suchen/i.test(retry && 'retryQuery' in retry ? retry.retryQuery : ''), 'retry hint');

noteLastLiveInventory({
  kind: 'hotel',
  query: 'Hotel Freitag bis Sonntag mit Pool und Sauna unter 500 Euro',
  hotelOutcome: 'empty',
  hotelRetried: true,
});
const clarify = resolveHotelEmptyFollowUp({
  userText: 'Hat das erste Hotel wirklich einen Pool?',
  turnId: 't2',
  inheritInventory: true,
});
assert(clarify && 'turnId' in clarify, 'second follow-up clarifies');
assert(
  /kein konkretes Hotel/i.test(
    clarify && 'logic' in clarify ? clarify.logic.spokenDraft : '',
  ),
  'clarify speech',
);

const widen = buildHotelWidenRetryQuery(
  'Hotel Pool Sauna',
  'Hat das erste Hotel wirklich einen Pool?',
);
assert(/Follow-up:/i.test(widen), 'widen query keeps follow-up');

console.log('hotelPitchFollowUp.smoke.test.ts OK');
