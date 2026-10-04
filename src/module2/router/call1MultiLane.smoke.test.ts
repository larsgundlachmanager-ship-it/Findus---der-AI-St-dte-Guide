/**
 * Multi-Lane Call-1 Struktur — or_either, fetch_then_spot, outdoor+wetter.
 */
import assert from 'node:assert/strict';
import {
  detectMultiLanePlan,
  inventOpenResearchExtras,
  multiLaneAuthorIntent,
  multiLaneWorkItems,
} from '../router/call1MultiLane';
import {
  inventOutdoorActivityFromText,
  evaluateOutdoorEveningWeather,
  looksLikeOpenAirVenue,
  wantsOutdoorProgramHard,
} from '../router/outdoorWeatherGate';

const orEither = detectMultiLanePlan(
  'Ich möchte heute ins Theater oder ins Kino gehen, hast du irgendwelche Komödien im Angebot?',
);
assert.ok(orEither, 'or_either plan');
assert.equal(orEither!.kind, 'or_either');
assert.equal(orEither!.lanes.length, 2);
assert.ok(
  orEither!.lanes.some((l) => l.pitchKind === 'cinema'),
  'cinema lane',
);
assert.ok(
  orEither!.lanes.some((l) => /theater/i.test(l.label)),
  'theater lane',
);
assert.ok(
  orEither!.sharedMust.some((m) => /komödie/i.test(m)),
  'genre shared',
);

const workOr = multiLaneWorkItems(orEither!, 'here_now');
assert.ok(workOr.length >= 3, 'parallel work items');
assert.ok(
  workOr.some((w) => w.worker === 'events') &&
    workOr.some((w) => w.worker === 'pitch'),
  'events + pitch workers',
);
assert.ok(multiLaneAuthorIntent(orEither!).includes('parallele'), 'author intent');

const fetchSpot = detectMultiLanePlan(
  'Ich möchte gerne hier ein Legga Eis to go holen und dann ja keine Ahnung, irgendwo wo es schön ist, mit Blick auf den Hafen mich hinsetzen und das Eis genießen',
);
assert.ok(fetchSpot, 'fetch_then_spot plan');
assert.equal(fetchSpot!.kind, 'fetch_then_spot');
assert.equal(fetchSpot!.lanes.length, 1);
assert.ok(fetchSpot!.followOn, 'follow-on spot');
assert.equal(fetchSpot!.followOn!.preferNearFollowOn, true);
assert.equal(fetchSpot!.implyOpenNow, true);
assert.ok(
  fetchSpot!.lanes[0]!.mustLabels.some((m) => /legga|eis/i.test(m)),
  'fetch must',
);
assert.ok(
  fetchSpot!.followOn!.mustLabels.some((m) => /hafen|aussicht/i.test(m)),
  'harbor must',
);

const workFs = multiLaneWorkItems(fetchSpot!, 'here_now');
assert.ok(
  workFs.some((w) => w.id.includes('follow')) &&
    workFs.some((w) => w.worker === 'dining' || w.worker === 'pitch'),
  'fetch + spot workers',
);

const openAirQ =
  'Ich habe Lust irgendwie heute Abend auf so ein Open Air Kino. Welche Filme laufen aktuell da?';
assert.ok(wantsOutdoorProgramHard(openAirQ), 'outdoor hard');
const oa = detectMultiLanePlan(openAirQ);
assert.ok(oa, 'outdoor plan');
assert.equal(oa!.kind, 'outdoor_program_weather');
assert.equal(oa!.hardOutdoorOnly, true);
assert.ok(oa!.weatherGate?.deferIfRainTonight, 'weather defer');
assert.ok(
  oa!.sharedMust.some((m) => /open_air|kino/i.test(m)),
  'open_air must',
);

const mini = detectMultiLanePlan(
  'Lust auf Minigolf heute Nachmittag — wo können wir hin?',
);
assert.ok(mini, 'minigolf plan');
assert.equal(mini!.kind, 'outdoor_program_weather');
assert.ok(mini!.lanes[0]!.mustLabels.some((m) => /minigolf/i.test(m)));
assert.ok(mini!.weatherGate?.checkTonight);

// Nie gelistetes Thema: Open-Air-Yoga — muss trotzdem inventiert werden
const yoga = inventOutdoorActivityFromText(
  'Heute Abend Open-Air-Yoga im Park — wo geht das?',
);
assert.ok(yoga, 'invent yoga');
assert.ok(/yoga/i.test(yoga!.label + yoga!.mustLabels.join(',')));
const yogaPlan = detectMultiLanePlan(
  'Heute Abend Open-Air-Yoga im Park — wo geht das?',
);
assert.ok(yogaPlan, 'yoga outdoor plan without whitelist entry');
assert.equal(yogaPlan!.kind, 'outdoor_program_weather');

const golf = inventOutdoorActivityFromText('Können wir irgendwo golfen gehen?');
assert.ok(golf && /golf/i.test(golf.kind + golf.label), 'golf invent');

const freilicht = detectMultiLanePlan(
  'Gibt es Freilichttheater heute Abend in der Nähe?',
);
assert.ok(freilicht, 'freilicht plan');
assert.ok(freilicht!.lanes[0]!.mustLabels.some((m) => /theater/i.test(m)));

const workOa = multiLaneWorkItems(oa!, 'here_now');
assert.ok(
  workOa.some((w) => w.worker === 'weather') &&
    workOa.some((w) => w.worker === 'events' || w.worker === 'pitch'),
  'weather + activity workers',
);
const invent = inventOpenResearchExtras(openAirQ, 'here_now');
assert.ok(
  invent.some((w) => w.worker === 'weather'),
  'invent weather extras',
);
assert.ok(
  invent.some((w) => w.worker === 'deep_web' || w.worker === 'events' || w.worker === 'pitch'),
  'invent outdoor research',
);

assert.ok(looksLikeOpenAirVenue('Open Air Kino Stadtpark'));
assert.ok(!looksLikeOpenAirVenue('Cineplex Innenstadt'));
assert.ok(looksLikeOpenAirVenue('Minigolf am See'));

const eveningMs = (() => {
  const d = new Date();
  d.setHours(20, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  // force "tonight" evening relative to now: if past 17 use today 20 else today 20
  const t = new Date();
  t.setHours(20, 0, 0, 0);
  return t.getTime();
})();
const rainy = evaluateOutdoorEveningWeather(
  {
    fetchedAtMs: Date.now(),
    lat: 0,
    lng: 0,
    cityHint: null,
    summaryLine: 'Regen abends',
    promptBlock: '',
    nextRainAtMs: eveningMs,
    nextRainProb: 70,
    weatherCode: null,
    precipitationMm: 0,
    isHeavyRain: false,
    warned30ForRainAt: null,
    warned10ForRainAt: null,
    warnedHeavyRainAtMs: null,
    nightLowC: 9,
    currentTempC: 18,
    tomorrowSummary: 'Morgen trocken und klar',
  },
  // now = heute 18 Uhr, damit 20 Uhr im Abendfenster liegt
  (() => {
    const n = new Date();
    n.setHours(18, 0, 0, 0);
    return n.getTime();
  })(),
);
assert.equal(rainy.tonightRainLikely, true);
assert.equal(rainy.preferDay, 'tomorrow');
assert.ok(rainy.jacketHint, 'jacket on cold night');

// Kein False-Positive bei einfacher Gastro / Indoor-Kino
assert.equal(
  detectMultiLanePlan('Wo gibt es gutes Steak in der Nähe?'),
  null,
);
assert.equal(
  detectMultiLanePlan('Kinoprogramm heute Abend?'),
  null,
);

console.log('call1MultiLane.smoke: ok');
