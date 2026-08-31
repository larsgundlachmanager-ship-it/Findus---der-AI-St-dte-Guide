/**
 * Ambient-/Event-Pitch: Zeit weben, kein Los-jetzt am Nachmittag.
 */
import {
  formatTemporaryLiveSpeech,
  isLaterPlanSchedule,
  isUpcomingForUnsolicitedPitch,
  parseSpokenClockToMinutes,
} from '../speech/laterPlanSpeech';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const afternoon = new Date('2026-08-16T14:00:00');
const evening = new Date('2026-08-16T20:30:00');

assert(
  !isUpcomingForUnsolicitedPitch(
    'heute Abend 21:00 Open-Air-Kino im Pillerwerk',
    new Date('2026-08-16T22:34:00'),
  ),
  '21 Uhr Kino um 22:34 ist vorbei',
);
assert(
  isUpcomingForUnsolicitedPitch(
    'heute Abend 21:00 Open-Air-Kino im Pillerwerk',
    afternoon,
  ),
  '21 Uhr Kino am Nachmittag ist Zukunft',
);
assert(
  !isUpcomingForUnsolicitedPitch(
    'läuft noch bis 23:00',
    evening,
  ),
  'läuft noch ohne Fest-Typ = kein Pitch',
);
assert(
  isUpcomingForUnsolicitedPitch(
    'Straßenfest läuft noch bis 23:00',
    evening,
  ),
  'Straßenfest darf läuft-noch',
);
assert(
  !isUpcomingForUnsolicitedPitch(
    'Straßenfest läuft noch bis 18:00',
    evening,
  ),
  'Straßenfest nach Ende skip',
);
assert(
  isUpcomingForUnsolicitedPitch(
    'heute Abend ist Hafengeburtstag',
    afternoon,
  ),
  'Hafengeburtstag heute Abend am Nachmittag ok',
);
assert(
  isUpcomingForUnsolicitedPitch(
    'Weinfest ab 11 Uhr, Kinderschminken bis 17 Uhr',
    afternoon,
  ),
  'Weinfest/Kinderschminken nachmittags noch',
);
assert(
  !isUpcomingForUnsolicitedPitch(
    'Kinderschminken bis 17 Uhr',
    evening,
  ),
  'Kinderschminken nach 17 Uhr skip',
);
assert(
  !isUpcomingForUnsolicitedPitch(
    'Konzert um 20:00 im Hafen',
    evening,
  ),
  'Konzert nach Start skip',
);
assert(
  !isUpcomingForUnsolicitedPitch(
    'Sonnenfinsternis um 11:00',
    afternoon,
  ),
  'Finsternis nach Start skip',
);
assert(
  isUpcomingForUnsolicitedPitch('morgen 11 Uhr Weinfest', evening),
  'morgen bleibt Zukunft',
);
assert(parseSpokenClockToMinutes('heute Abend 21:00') === 21 * 60, '21:00');
assert(parseSpokenClockToMinutes('ab 21 Uhr') === 21 * 60, 'ab 21 Uhr');
assert(
  isLaterPlanSchedule({
    whenText: 'heute Abend 21:00',
    now: afternoon,
  }),
  '21 Uhr am Nachmittag = später',
);
assert(
  !isLaterPlanSchedule({
    whenText: 'läuft noch bis 23:00',
    now: evening,
  }),
  'läuft noch = jetzt',
);

const later = formatTemporaryLiveSpeech(
  {
    name: 'Pillerwerk',
    whenLabel: 'heute Abend 21:00',
    distanceHintM: 400,
    hook: 'Pack die Decke ein, heute Abend ist Open-Air-Kino im Pillerwerk.',
  },
  afternoon,
);

assert(/21/.test(later), `Uhr fehlt: «${later}»`);
assert(/heute\s+abend/iu.test(later), `heute Abend fehlt: «${later}»`);
assert(/geschaut|geguckt/iu.test(later), `Opener fehlt: «${later}»`);
assert(/einplanen/iu.test(later), `Invite fehlt: «${later}»`);
assert(
  !/um die Ecke|direkt vor dir|in \d+\s*Min da/iu.test(later),
  `Los-jetzt-Ton: «${later}»`,
);
assert(later.length < 420, `zu lang (${later.length}): «${later}»`);

const nowish = formatTemporaryLiveSpeech(
  {
    name: 'Marktplatz',
    whenLabel: 'läuft noch bis 23:00',
    distanceHintM: 80,
    hook: 'Das Straßenfest auf dem Marktplatz ist in vollem Gange.',
  },
  evening,
);

assert(
  !/einplanen/iu.test(nowish),
  `kein Kalender-Invite bei laufendem Fest: «${nowish}»`,
);

console.log('temporaryLiveSpeech.smoke.test.ts ok');
