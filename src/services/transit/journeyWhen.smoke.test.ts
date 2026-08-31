/**
 * Run: npx --yes tsx src/services/transit/journeyWhen.smoke.test.ts
 */
import { parseJourneyWhen, journeyPlanTimeOpts } from './journeyWhen';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const wedNoon = new Date('2026-08-19T12:00:00+02:00');

const morgen = parseJourneyWhen('Fahr morgen um 14 Uhr nach Pinneberg', wedNoon);
assert(morgen?.kind === 'depart', 'morgen 14 = Abfahrt');
assert(morgen?.at.getDate() === 20 && morgen.at.getHours() === 14, '20.8. 14 Uhr');

const arrive = parseJourneyWhen(
  'Ich muss Mittwoch spätestens um 18 Uhr in Hamburg ankommen',
  wedNoon,
);
assert(arrive?.kind === 'arrive', 'spätestens ankommen = Ankunft');
assert(arrive?.at.getDate() === 19 && arrive.at.getHours() === 18, 'heute Mi 18 Uhr');

const opts = journeyPlanTimeOpts('morgen 14 Uhr nach Altona', wedNoon);
assert(opts.departAt instanceof Date && !opts.arriveBy, 'departAt gesetzt');

const nowish = parseJourneyWhen('ÖPNV nach Pinneberg', wedNoon);
assert(nowish == null, 'ohne Uhr → nächste Live-Bahn');

console.log('journeyWhen.smoke.test.ts OK');
