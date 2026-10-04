import {
  parseFlightTripSlots,
  isFlightTripQuery,
  inferFlightBookingStance,
} from '../src/services/flights/flightTripIntent.ts';
import { largestTripGap, mergeTripSlots } from '../src/services/travel/tripSlotMerge.ts';

const samples = [
  'Ich fliege morgen nach London. Wann muss ich dann am Flughafen sein?',
  'Ich fliege morgen nach London. Wann musst du ich dann am Flughafen sein?',
  'Ich fliege morgen nach London. Wann muss ich am Flughafen sein?',
];

for (const t of samples) {
  const s = parseFlightTripSlots(t);
  console.log('---', t);
  console.log({
    isFlight: isFlightTripQuery(t),
    stance: s.stance,
    leaveByAsk: s.leaveByAsk,
    destHint: s.destHint,
    dateHint: s.dateHint,
    clockHm: s.clockHm,
    inferred: inferFlightBookingStance(t),
  });
}
