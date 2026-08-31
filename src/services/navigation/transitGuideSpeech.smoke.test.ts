/**
 * Run: npx --yes tsx src/services/navigation/transitGuideSpeech.smoke.test.ts
 */
import {
  haltArrivedSpeech,
  vehicleSoonSpeech,
  onboardSpeech,
  remainingStopsSpeech,
  alightNowSpeech,
  transferWalkSpeech,
  lastWalkSpeech,
  platformSpoken,
  rideSpoken,
} from './transitGuideSpeech';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const facts = {
  line: 'RB61',
  headsign: 'Pinneberg',
  platform: '2',
  haltName: 'Prisdorf',
  alightName: 'Pinneberg',
  waitMin: 4,
  remainingStops: 5,
  rideMin: 7,
  destWalkM: 300,
  destName: 'DHL Packstation',
  vehicle: 'Bahn' as const,
};

assert(platformSpoken('2') === 'Gleis 2', 'Gleis-Prefix');
assert(/RB61/.test(rideSpoken(facts)) && /Pinneberg/.test(rideSpoken(facts)), 'Linie + Ziel');

const halt = haltArrivedSpeech(facts);
assert(/Gleis 2/.test(halt), `Halt nennt Gleis: ${halt}`);
assert(/RB61/.test(halt), `Halt nennt Linie: ${halt}`);
assert(/4/.test(halt), `Halt nennt Wartezeit: ${halt}`);

const soon = vehicleSoonSpeech({ ...facts, waitMin: 1 });
assert(/RB61/.test(soon) && /ein|steig/i.test(soon), `Einfahrt: ${soon}`);

const on = onboardSpeech(facts);
assert(/5/.test(on) && /7/.test(on), `Onboard Rest + Minuten: ${on}`);
assert(/Pinneberg/.test(on), `Onboard Ausstieg: ${on}`);

const three = remainingStopsSpeech(3, facts);
assert(/drei|3/i.test(three) && /Pinneberg/.test(three), `3 Halte: ${three}`);
assert(/Puffer/i.test(three), `3 Halte mit Puffer: ${three}`);

const one = remainingStopsSpeech(1, facts);
assert(/Pinneberg/.test(one) && /raus|Halt|aussteig/i.test(one), `nächster Halt: ${one}`);

const alight = alightNowSpeech(facts);
assert(/Pinneberg/.test(alight), `Jetzt raus: ${alight}`);

const xfer = transferWalkSpeech({
  ...facts,
  platform: '3',
  line: 'S3',
  headsign: 'Hamburg',
});
assert(/Gleis 3/.test(xfer) && /S3/.test(xfer), `Umstieg: ${xfer}`);

const last = lastWalkSpeech(facts);
assert(/300/.test(last) && /DHL/.test(last), `letzter Fußweg: ${last}`);
assert(/raus|Bahnhof|draußen/i.test(last), `Bahnhof raus: ${last}`);

console.log('transitGuideSpeech.smoke.test.ts OK');
