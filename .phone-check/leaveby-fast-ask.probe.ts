import { peekFlightBeat1Bridge, prepareFlightTripFollowUp } from '../src/services/flights/flightTripAdvisor';

async function main() {
  const t =
    'Ich fliege morgen nach London. Wann muss ich dann am Flughafen sein?';
  console.log('bridge', peekFlightBeat1Bridge(t));
  const t0 = Date.now();
  const r = await prepareFlightTripFollowUp(t);
  console.log('ms', Date.now() - t0);
  console.log('speech', r?.speech);
  console.log('title', r?.cardTitle);
  if (!r?.speech || !/Abflugzeit|Flugnummer|Wann fliegst/i.test(r.speech + (r.cardTitle || ''))) {
    throw new Error('expected askWhen speech');
  }
  if (Date.now() - t0 > 5000) {
    throw new Error('leave-by ask too slow');
  }
  console.log('leaveby-fast-ask ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
