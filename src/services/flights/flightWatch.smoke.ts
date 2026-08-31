/**
 * Smoke: Phase 3 Live-Watch (Ausfall Just-Do-It, Hotline, Leave-Shift).
 * Run: npx --yes tsx src/services/flights/flightWatch.smoke.ts
 */
import { lookupAirlineHotline } from './airlineHotline';
import { pickUniqueHitByClock } from './flightScheduleMatch';
import {
  flightWatchKey,
  listFlightWatches,
  resetFlightWatchesForTests,
  upsertFlightWatch,
  type ActiveFlightWatch,
} from './flightWatchStore';
import {
  buildCancelWatchActions,
  buildCancelWatchSpeech,
  buildDelayWatchSpeech,
  cancelSpeechAsksPermission,
  flightLooksCancelled,
  inferFlightWatchPhase,
  shouldSpeakLeaveShift,
  shouldSpeakWatchBag,
  shouldSpeakWatchGate,
  shouldSpeakWatchTerminal,
  shouldSpeakWatchDelay,
  isPreDepartureAlertLive,
  classifyBoardStatus,
  shouldPushWatchGate,
  shouldAnnounceBoarding,
  shouldScheduleBoardingPush,
  buildBoardingWatchSpeech,
  buildTrainArrivingSpeech,
} from './flightWatchEvents';
import { aeroScheduleWindow, flightWatchShouldPoll, flightWatchShouldPollAero } from './aeroApiBudget';
import { buildCheapFlightBookActions, parseResearchDateKey } from './cheapFlightBook';
import {
  buildGoogleFlightsSearchUrl,
  buildGoogleHotelsSearchUrl,
  buildSkyscannerSearchUrl,
} from './googleTravelLinks';

let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    failed += 1;
  }
}

assert(lookupAirlineHotline('LH123')?.e164 === '+496986799799', 'LH hotline');
assert(lookupAirlineHotline('4M262')?.e164 === '+908507772777', '4M hotline');
assert(lookupAirlineHotline('MGH262')?.e164 === '+908507772777', 'MGH ≡ 4M');
assert(lookupAirlineHotline('ZZ999') == null, 'unknown airline no fake phone');

const cancel = buildCancelWatchSpeech({
  ident: '4M262',
  destLabel: 'Antalya',
  altIdent: 'XQ901',
  altClock: '14:10',
  airlineName: 'Mavi Gök',
});
assert(!cancelSpeechAsksPermission(cancel.speech), 'cancel no permission ask');
assert(/XQ901/.test(cancel.speech) && /14:10/.test(cancel.speech), 'alt in speech');
assert(!/soll ich/i.test(cancel.speech), 'no soll ich');

const actions = buildCancelWatchActions({
  cancelledIdent: '4M262',
  altIdent: 'XQ901',
  altClock: '14:10',
  kiwiUrl: 'https://www.kiwi.com/de/search/results/ham/ayt/2026-08-19/',
});
assert(
  actions.some((a) => a.type === 'SHOW_MORE' && /XQ901/.test(a.label)),
  'alt flight chip',
);
assert(
  actions.some(
    (a) => a.type === 'DIAL_PHONE' && a.payload.phoneNumber === '+908507772777',
  ),
  'hotline button',
);
assert(
  actions.some((a) => a.type === 'OPEN_URL' && /Flüge ansehen/.test(a.label)),
  'kiwi not hollow book',
);

const noAlt = buildCancelWatchSpeech({
  ident: 'LH400',
  destLabel: 'New York',
});
assert(!cancelSpeechAsksPermission(noAlt.speech), 'no-alt still no ask');
assert(/Hotline|Button|Suche/i.test(noAlt.speech), 'honest no-alt');

assert(
  flightLooksCancelled({ cancelled: true, status: null }),
  'cancelled flag',
);
assert(
  flightLooksCancelled({ cancelled: false, status: 'Cancelled' }),
  'cancelled status',
);
assert(
  !flightLooksCancelled({ cancelled: false, status: 'Scheduled' }),
  'not cancelled',
);

const now = Date.parse('2026-08-19T07:00:00');
assert(
  shouldSpeakLeaveShift({
    prevLeaveMs: Date.parse('2026-08-19T08:00:00'),
    nextLeaveMs: Date.parse('2026-08-19T08:30:00'),
    nowMs: now,
  }),
  'later leave still helps',
);
assert(
  !shouldSpeakLeaveShift({
    prevLeaveMs: Date.parse('2026-08-19T08:00:00'),
    nextLeaveMs: Date.parse('2026-08-19T08:30:00'),
    nowMs: Date.parse('2026-08-19T08:05:00'),
  }),
  'already left — no new leave',
);
assert(
  !shouldSpeakLeaveShift({
    prevLeaveMs: Date.parse('2026-08-19T08:00:00'),
    nextLeaveMs: Date.parse('2026-08-19T08:05:00'),
    nowMs: now,
  }),
  'tiny shift silent',
);

const delayOnly = buildDelayWatchSpeech({
  ident: 'LH123',
  delayMin: 25,
  depMs: Date.parse('2026-08-19T12:25:00'),
  leaveMs: Date.parse('2026-08-19T08:30:00'),
  speakLeave: false,
});
assert(/25/.test(delayOnly) && !/Los verschiebt/i.test(delayOnly), 'delay no leave');
const delayLeave = buildDelayWatchSpeech({
  ident: 'LH123',
  delayMin: 40,
  depMs: Date.parse('2026-08-19T12:40:00'),
  leaveMs: Date.parse('2026-08-19T08:45:00'),
  speakLeave: true,
});
assert(/Los verschiebt/.test(delayLeave) && /08:45/.test(delayLeave), 'delay with leave');

const hits = [
  {
    ident: 'XQ901',
    scheduledDeparture: new Date('2026-08-19T12:15:00'),
    estimatedDeparture: new Date('2026-08-19T12:15:00'),
  },
  {
    ident: 'PC440',
    scheduledDeparture: new Date('2026-08-19T18:00:00'),
    estimatedDeparture: new Date('2026-08-19T18:00:00'),
  },
];
assert(pickUniqueHitByClock(hits, '12:00')?.ident === 'XQ901', 'clock finds unique 12:15');
assert(pickUniqueHitByClock(hits, '12:00', 5) == null, 'too far not unique');
assert(
  pickUniqueHitByClock(
    [
      ...hits,
      {
        ident: 'XQ903',
        scheduledDeparture: new Date('2026-08-19T12:20:00'),
        estimatedDeparture: new Date('2026-08-19T12:20:00'),
      },
    ],
    '12:00',
  ) == null,
  'two near 12:00 → no auto ident',
);

assert(
  flightWatchKey({ ident: 'LH400', dateKey: '2026-08-19' }) !==
    flightWatchKey({ ident: 'LH401', dateKey: '2026-08-19' }),
  'two idents two watches',
);
assert(
  flightWatchKey({
    ident: 'CLK1200',
    originIata: 'HAM',
    destIata: 'AYT',
    dateKey: '2026-08-19',
    clockHm: '12:00',
  }) !==
    flightWatchKey({
      ident: 'CLK0800',
      originIata: 'AYT',
      destIata: 'HAM',
      dateKey: '2026-08-26',
      clockHm: '08:00',
    }),
  'hin ≠ rück',
);

resetFlightWatchesForTests();
function stubWatch(partial: Partial<ActiveFlightWatch> & { ident: string }): ActiveFlightWatch {
  const dep = new Date('2026-08-19T12:00:00');
  return {
    destLabel: 'Antalya',
    airportName: 'Hamburg',
    airportLat: 53.63,
    airportLng: 10,
    originIata: 'HAM',
    destIata: 'AYT',
    dateKey: '2026-08-19',
    clockHm: '12:00',
    luggage: 'carry',
    lastFlight: {
      ident: partial.ident,
      faFlightId: null,
      status: null,
      originCode: 'HAM',
      originName: 'Hamburg',
      destinationCode: 'AYT',
      destinationName: 'Antalya',
      scheduledDeparture: dep,
      estimatedDeparture: dep,
      actualDeparture: null,
      scheduledArrival: null,
      estimatedArrival: null,
      actualArrival: null,
      delayMin: null,
      departureTerminal: null,
    departureGate: null,
    checkinDesk: null,
    arrivalTerminal: null,
      arrivalGate: null,
      baggageClaim: null,
      cancelled: false,
      diverted: false,
      inboundFaFlightId: null,
    },
    lastSpokenDelayMin: 0,
    lastGate: null,
    lastTerminal: null,
    lastSpokenTerminal: null,
    lastBag: null,
    lastLeaveMs: null,
    lastInboundLateMin: 0,
    lastPollMs: 0,
    announcedCancel: false,
    ...partial,
  };
}
upsertFlightWatch(stubWatch({ ident: '4M262', destLabel: 'Antalya' }));
upsertFlightWatch(
  stubWatch({
    ident: 'XQ190',
    destLabel: 'Hamburg',
    originIata: 'AYT',
    destIata: 'HAM',
    dateKey: '2026-08-26',
    clockHm: '08:00',
  }),
);
assert(listFlightWatches().length === 2, 'hin+rück both stored');

const win = aeroScheduleWindow({ dateKey: '2026-08-19', clockHm: '12:00' });
assert(!!win, 'clock window');
if (win) {
  const span = new Date(win.end).getTime() - new Date(win.start).getTime();
  assert(span === 3 * 3600_000, 'clock window ±90min');
}
const day = aeroScheduleWindow({ dateKey: '2026-08-19' });
assert(!!day, 'day window');

const pollNow = Date.parse('2026-08-19T10:00:00');
const week = 7 * 24 * 3600_000;
assert(
  !flightWatchShouldPoll({
    dep: new Date(pollNow + 5 * week),
    now: pollNow,
    lastPollMs: 0,
  }),
  '5 weeks quiet',
);
assert(
  flightWatchShouldPoll({
    dep: new Date(pollNow + week - 60_000),
    now: pollNow,
    lastPollMs: 0,
  }),
  'first check inside 7d',
);
assert(
  !flightWatchShouldPoll({
    dep: new Date(pollNow + 4 * 24 * 3600_000),
    now: pollNow,
    lastPollMs: pollNow - 60_000,
  }),
  'no 3h chatter mid-week',
);
assert(
  flightWatchShouldPoll({
    dep: new Date(pollNow + 3 * 24 * 3600_000),
    now: pollNow,
    lastPollMs: pollNow - 4 * 24 * 3600_000,
  }),
  '3d FIDS milestone',
);
assert(
  flightWatchShouldPoll({
    dep: new Date(pollNow + 90 * 60_000),
    now: pollNow,
    lastPollMs: pollNow - 16 * 60_000,
  }),
  'last 2h: 15 min cadence',
);
assert(
  !flightWatchShouldPoll({
    dep: new Date(pollNow + 90 * 60_000),
    now: pollNow,
    lastPollMs: pollNow - 5 * 60_000,
  }),
  'not every 5 min',
);
assert(
  !flightWatchShouldPollAero({
    dep: new Date(pollNow + 20 * 3600_000),
    now: pollNow,
    lastPollMs: 0,
    hasOriginBoard: true,
  }),
  'FIDS origin: no Aero 20h out',
);
assert(
  flightWatchShouldPollAero({
    dep: new Date(pollNow + 20 * 3600_000),
    now: pollNow,
    lastPollMs: 0,
    hasOriginBoard: false,
  }),
  'no FIDS: Aero still at first 7d check',
);
assert(
  flightWatchShouldPollAero({
    dep: new Date(pollNow + 90 * 60_000),
    now: pollNow,
    lastPollMs: pollNow - 16 * 60_000,
    hasOriginBoard: true,
  }),
  'FIDS origin: Aero in last 2h',
);

assert(
  inferFlightWatchPhase({
    untilMs: 6 * 3600_000,
    distM: 20_000,
    nearAirport: false,
    leavePassed: false,
    departed: false,
    arrived: false,
  }) === 'remote',
  '6h still remote',
);
assert(
  shouldSpeakWatchGate('remote') === false &&
    shouldSpeakWatchGate('landside') === false &&
    shouldSpeakWatchGate('airside') === true,
  'gate only airside',
);
assert(shouldSpeakWatchTerminal('landside') && !shouldSpeakWatchTerminal('airside'), 'terminal landside');
assert(shouldSpeakWatchBag('landed') && !shouldSpeakWatchBag('airside'), 'bag after landing');

assert(
  shouldSpeakWatchDelay('remote', -35 * 60_000) === false,
  'stale delay 35 min after scheduled dep is silent',
);
assert(
  shouldSpeakWatchDelay('airborne', 10 * 60_000) === false,
  'airborne delay is silent',
);
assert(
  shouldSpeakWatchDelay('remote', 40 * 60_000) === true,
  'delay still live 40 min before dep',
);
assert(
  isPreDepartureAlertLive({
    nowMs: Date.parse('2026-08-23T11:51:00'),
    liveDepMs: Date.parse('2026-08-23T11:16:00'),
  }) === false,
  'screenshot case: 11:51 vs dep 11:16 is dead',
);
assert(
  isPreDepartureAlertLive({
    nowMs: Date.parse('2026-08-23T11:00:00'),
    liveDepMs: Date.parse('2026-08-23T11:16:00'),
  }) === true,
  'delay 16 min before dep is live',
);
assert(classifyBoardStatus('Boarding') === 'boarding', 'boarding status');
assert(classifyBoardStatus('Last Call') === 'last_call', 'last call status');
assert(classifyBoardStatus('Departed') === 'departed', 'departed status');
assert(
  shouldPushWatchGate('landside', 30 * 60_000) === true &&
    shouldPushWatchGate('remote', 30 * 60_000) === true &&
    shouldPushWatchGate('remote', 5 * 3600_000) === false,
  'gate push landside or last 2h',
);
assert(
  shouldAnnounceBoarding({
    boardKind: 'boarding',
    untilMs: 35 * 60_000,
    boardingWindowMs: 40 * 60_000,
    phase: 'airside',
    announcedBoarding: false,
    announcedLastCall: false,
  }) === true,
  'fids boarding announces',
);
assert(
  shouldAnnounceBoarding({
    boardKind: 'scheduled',
    untilMs: -10 * 60_000,
    boardingWindowMs: 40 * 60_000,
    phase: 'remote',
    announcedBoarding: false,
    announcedLastCall: false,
  }) === false,
  'no boarding after dep',
);
assert(
  shouldAnnounceBoarding({
    boardKind: 'boarding',
    untilMs: -35 * 60_000,
    boardingWindowMs: 40 * 60_000,
    phase: 'remote',
    announcedBoarding: false,
    announcedLastCall: false,
  }) === false,
  'fids boarding 35 min after dep is silent',
);
assert(
  shouldScheduleBoardingPush({
    nowMs: Date.parse('2026-08-23T11:51:00'),
    liveDepMs: Date.parse('2026-08-23T11:16:00'),
    announcedBoarding: false,
    boardingWindowMin: 40,
  }) === null,
  'screenshot: no leftover boarding push at 11:51',
);
assert(
  shouldScheduleBoardingPush({
    nowMs: Date.parse('2026-08-23T09:00:00'),
    liveDepMs: Date.parse('2026-08-23T11:16:00'),
    announcedBoarding: false,
    boardingWindowMin: 40,
  }) === Date.parse('2026-08-23T10:36:00'),
  'boarding push scheduled at window start',
);
assert(
  /Gate C4/.test(
    buildBoardingWatchSpeech({
      ident: 'A3825',
      gate: 'C4',
      lastCall: false,
    }),
  ),
  'boarding speech has gate',
);
assert(
  /einer Minute/.test(
    buildTrainArrivingSpeech({
      title: 'RE 70',
      kind: 'train',
      platform: '3',
    }),
  ) && /Gleis 3/.test(
    buildTrainArrivingSpeech({
      title: 'RE 70',
      kind: 'train',
      platform: '3',
    }),
  ),
  'train arriving speech',
);

const gUrl = buildGoogleFlightsSearchUrl({
  originIata: 'HAM',
  destIata: 'AYT',
  dateKey: '2026-08-19',
});
assert(!!gUrl && /google\.com\/travel\/flights/.test(gUrl) && /HAM/.test(gUrl), 'google flights url');
const sky = buildSkyscannerSearchUrl({
  originIata: 'HAM',
  destIata: 'AYT',
  dateKey: '2026-08-19',
});
assert(!!sky && /skyscanner\.de/.test(sky) && /260819/.test(sky), 'skyscanner url');
const hUrl = buildGoogleHotelsSearchUrl({ city: 'Antalya' });
assert(!!hUrl && /google\.com\/travel\/hotels/.test(hUrl), 'google hotels url');

assert(parseResearchDateKey('2026-10-14') === '2026-10-14', 'iso date');
const book = buildCheapFlightBookActions({
  originIata: 'HAM',
  destIata: 'AYT',
  dateKey: '2026-10-14',
  ident: 'XQ123',
  clockHm: '12:40',
  airlineUrl: 'https://www.sunexpress.com/',
  airlineName: 'SunExpress',
});
assert(book.some((a) => a.type === 'SHOW_MORE' && /XQ123/.test(a.label)), 'ident chip');
assert(
  book.some(
    (a) =>
      a.type === 'OPEN_URL' &&
      a.label === 'Bei Kiwi buchen' &&
      /travelpayouts|kiwi\.com/i.test(a.payload.url ?? '') &&
      /ham/i.test(a.payload.url ?? '') &&
      /ayt/i.test(a.payload.url ?? ''),
  ),
  'kiwi book not google button',
);
assert(
  book.some((a) => a.type === 'OPEN_URL' && /SunExpress/.test(a.label)),
  'airline button',
);
assert(
  book.some(
    (a) =>
      a.type === 'OPEN_URL' &&
      /Aviasales/i.test(a.label) &&
      /HAM1410AYT1|origin_iata=HAM/i.test(a.payload.url ?? '') &&
      /AYT|destination_iata=AYT/i.test(a.payload.url ?? ''),
  ),
  'aviasales compare',
);
assert(
  !book.some((a) => /google\.com\/travel\/flights/i.test(a.payload.url ?? '')),
  'no google flights button',
);

if (failed) {
  console.error(`flightWatch smoke: ${failed} failed`);
  process.exit(1);
}
console.log('flightWatch smoke: ok');
