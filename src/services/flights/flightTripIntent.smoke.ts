/**
 * Smoke: Flug-Trip Intent (gebucht vs Wunsch, kein Bahn-Hijack).
 * Run: npx --yes tsx src/services/flights/flightTripIntent.smoke.ts
 */
import {
  extractClockHm,
  extractFlightIdent,
  inferFlightBookingStance,
  isAirportRideFollowUp,
  isFlightBufferFollowUp,
  isFlightPlanAck,
  isFlightThanks,
  isFlightIdentAsk,
  isFlightTripFollowUp,
  isFlightTripQuery,
  parseFlightTripSlots,
  shouldEnterFlightAdvisor,
  shouldYieldPlanWaitToFlight,
  isShortReplyToLastAsk,
  luggageFromLastAskReply,
  speechInventedAirportLead,
  shouldPreserveFlightTripSession,
  shouldScrubFlightOnTopicCut,
} from './flightTripIntent';
import { classifyTimeCareIntent } from '../concierge/timeCareIntent';
import { formatDurationMinutesDe, formatDwellSinceDe } from '../navigation/travelEtaFormat';
import {
  commercialAirportsWithinKm,
  airportCodeMatches,
  findAirportByCityHint,
  findAirportMentionedInText,
  nearestCommercialAirport,
  relatedAirportIatas,
  airportTimeZone,
} from './airportIata';
import { identVariants, identsMatch, preferredIataIdent, publicFlightIdent, flightTimelineTitle } from './flightIdent';
import { pickBestHitByClock } from './flightScheduleMatch';
import { airportLageplanLink } from './airportIndoorMap';
import { isSaneAirportAccessTransit } from './airportAccessSane';
import { computeFlightPacing } from './flightPacing';
import {
  accessLegTitle,
  checkinDeskLabel,
  flightGroupLabel,
  formatWalkMinutes,
  gateLabel,
  planAccessLeg,
  securityWaitNote,
  shouldShowEndClock,
  terminalLabel,
  tidyTransitPlace,
  toPlacePrep,
  walkNaturalEndMs,
} from './flightTimelineCopy';
import {
  anaRawToBoardRow,
  berRawToBoardRow,
  berTerminal,
  fraConcreteGate,
  fraRawToBoardRow,
  hamRawToBoardRow,
  matchOriginBoardRow,
  parseHamWaitingMinutes,
  parseHamBoardMs,
} from './originAirportBoard';
import {
  collectBoardCandidateUrls,
  parseOpsFromHtml,
} from './originBoardDiscover';
import {
  getAirportBoardProfile,
  hasPublicOriginBoard,
  horizonDaysFromRows,
  resetAirportBoardCatalogForTests,
} from './airportBoardCatalog';
import {
  airportLeadMin,
  pacingMinsForStyle,
  resetFlightBufferStyleForTests,
  stepFlightBufferStyle,
} from './flightBufferProfile';
import { buildLeaveBySpeech } from './flightLeaveBySpeech';
import { formatDateKeyDe, formatDateKeySpokenDe } from '../../utils/dateKeys';
import {
  largestTripGap,
  mergeTripSlots,
} from '../travel/tripSlotMerge';

let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    failed += 1;
  }
}

assert(
  isFlightTripQuery(
    'Ich muss nach Wien fliegen. Wann muss ich los, damit ich pünktlich den Flieger bekommen kann?',
  ),
  'wien fliegen is flight trip',
);
assert(
  classifyTimeCareIntent(
    'Ich muss nach Wien fliegen. Wann muss ich los, damit ich pünktlich den Flieger bekommen kann?',
  ) == null,
  'wien fliegen is not transit_leave',
);
assert(
  classifyTimeCareIntent('Ich muss um 8:45 zur Bahn')?.kind === 'transit_leave',
  'bahn stays transit',
);

assert(
  inferFlightBookingStance('Ich muss nach Wien fliegen, wann muss ich los') ===
    'booked',
  'muss fliegen → booked',
);
assert(
  inferFlightBookingStance('wann ich morgen nach Antalya fliege') === 'booked',
  'wann morgen dest → booked',
);
assert(
  parseFlightTripSlots('wann ich morgen nach Antalya fliege').stance ===
    'booked',
  'parse wann morgen booked',
);
assert(
  inferFlightBookingStance('ich möchte gerne nach Wien heute fliegen') ===
    'wish',
  'möchte gerne → wish',
);
assert(
  inferFlightBookingStance('flieg heute Abend nach Wien') === 'booked',
  'flieg heute abend → booked',
);
assert(
  inferFlightBookingStance('ich fliege heute von Wien zurück') === 'booked',
  'zurück → booked',
);

const wien = parseFlightTripSlots('Ich muss nach Wien fliegen');
assert(wien.destHint?.toLowerCase().includes('wien') === true, 'dest Wien');
assert(findAirportByCityHint('Wien')?.iata === 'VIE', 'Wien → VIE');
assert(findAirportByCityHint('antalja')?.iata === 'AYT', 'STT Antalja → AYT');
assert(
  findAirportMentionedInText('ich fliege morgen nach antalya')?.iata === 'AYT',
  'lowercase nach antalya',
);
assert(
  parseFlightTripSlots('ich fliege morgen nach antalya').destHint
    ?.toLowerCase()
    .includes('antalya') === true,
  'lowercase destHint',
);
assert(
  parseFlightTripSlots('Antalya').destHint?.toLowerCase().includes('antalya') ===
    true,
  'bare Antalya dest',
);
assert(findAirportByCityHint('Amsterdam')?.iata === 'AMS', 'Amsterdam → AMS');
assert(findAirportByCityHint('Antalya')?.iata !== 'AMS', 'Antalya not AMS');
assert(findAirportByCityHint('Antalya')?.iata !== 'ATH', 'Antalya not ATH');
assert(
  parseFlightTripSlots('Ich fliege morgen nach Antalya wann muss ich am Flughafen sein')
    .destHint === 'Antalya',
  'STT dest is city only, not wann/muss',
);
assert(
  parseFlightTripSlots('Ich fliege morgen nach Antalya, wann muss ich los')
    .destHint === 'Antalya',
  'dest Antalya exact',
);
assert(
  parseFlightTripSlots('Ich fliege morgen nach Antalya').dateHint === 'tomorrow',
  'morgen → tomorrow',
);
assert(
  parseFlightTripSlots('Nur Handgepäck').luggage === 'carry',
  'Handgepäck chip',
);
assert(
  parseFlightTripSlots('Mit Aufgabegepäck').luggage === 'checked',
  'Aufgabegepäck chip',
);
assert(
  nearestCommercialAirport(53.68, 9.76)?.iata === 'HAM',
  'Prisdorf → HAM',
);

assert(
  !formatDwellSinceDe(1329).includes('1329'),
  'dwell not raw minutes',
);
assert(/Std/.test(formatDwellSinceDe(1329)), 'dwell uses hours');

const now = Date.now();
assert(
  !isSaneAirportAccessTransit(
    {
      durationSec: (26 * 60 + 15) * 60,
      startTime: new Date(now - 20 * 3600_000),
      endTime: new Date(now + 6 * 3600_000),
    },
    { arriveByMs: now + 5 * 3600_000, taxiMin: 40, nowMs: now },
  ),
  '26h transit rejected',
);

const pacing = computeFlightPacing({
  depMs: now + 8 * 3600_000,
  boardingWindowMin: 40,
  securityWaitMin: 20,
  luggage: 'carry',
});
assert(pacing.boardMs > pacing.bufferMs, 'board after buffer');
assert(pacing.bufferMs > pacing.securityMs, 'buffer after security');
assert(pacing.airportMs < pacing.securityMs, 'arrive before security');
assert(pacing.gateBufferMin === 20, 'default gate buffer 20');
assert(terminalLabel('2') === 'Terminal 2', 'terminal 2');
assert(terminalLabel('Terminal 1') === 'Terminal 1', 'terminal already labeled');
assert(tidyTransitPlace('Weiter') == null, 'Weiter not a place');
assert(toPlacePrep('Bushaltestelle') === 'zur Bushaltestelle', 'zur Bushaltestelle');
assert(flightGroupLabel('Antalya') === 'Flug nach Antalya', 'group label no clock');
assert(gateLabel(null) == null, 'no fake gate');
assert(gateLabel('C05') === 'Gate C05', 'live gate');
assert(checkinDeskLabel('6') === 'Check-in-Schalter 6', 'checkin desk label');
assert(parseHamWaitingMinutes('< 1 min') === 1, 'ham wait under 1');
{
  // Live-Shape GQ 873 HAM→ATH (Doppel-Space + UTC Z → Berlin-Datum)
  const row = hamRawToBoardRow({
    flightnumber: 'GQ  873',
    plannedDepartureTime: '2026-08-31T16:15:00Z',
    departureTerminal: '2',
    gate: 'C07',
    checkinRow: '9',
    destinationAirport3LCode: 'ATH',
    cancelled: false,
  });
  assert(row?.ident === 'GQ873', 'GQ873 ident spaces');
  assert(row?.dateKey === '2026-08-31', 'GQ873 date berlin');
  assert(row?.gate === 'C07', 'GQ873 gate');
  assert(row?.checkinDesk === '9', 'GQ873 checkin');
  assert(row?.terminal === '2', 'GQ873 terminal');
  const hit = matchOriginBoardRow([row!], {
    ident: 'GQ873',
    dateKey: '2026-08-31',
    destIata: 'ATH',
  });
  assert(hit?.gate === 'C07' && hit?.checkinDesk === '9', 'GQ873 match ops');
  // Aero ICAO SEH ≡ Tafel GQ
  assert(identsMatch('SEH873', 'GQ873'), 'GQ≡SEH Sky Express');
  const sehHit = matchOriginBoardRow([row!], {
    ident: 'SEH873',
    dateKey: '2026-08-31',
    destIata: 'ATH',
  });
  assert(sehHit?.gate === 'C07', 'SEH873 matches GQ board row');
  assert(
    checkinDeskLabel(hit!.checkinDesk) === 'Check-in-Schalter 9',
    'GQ873 checkin label',
  );
  assert(gateLabel(hit!.gate) === 'Gate C07', 'GQ873 gate label');
}
{
  const { normalizeAirportIata, iataForIcao } = require('./airportIata') as {
    normalizeAirportIata: (c: string) => string | null;
    iataForIcao: (c: string) => string | null;
  };
  assert(iataForIcao('EDDH') === 'HAM', 'EDDH→HAM');
  assert(normalizeAirportIata('EDDH') === 'HAM', 'normalize EDDH');
  assert(normalizeAirportIata('HAM') === 'HAM', 'normalize HAM');
}
{
  const row = hamRawToBoardRow({
    flightnumber: 'XQ  671',
    plannedDepartureTime: '2026-08-19T17:55:00Z',
    departureTerminal: '1',
    gate: 'C05',
    checkinRow: '6',
    destinationAirport3LCode: 'AYT',
    cancelled: false,
  });
  assert(row?.ident === 'XQ671', 'ham ident spaces');
  assert(row?.dateKey === '2026-08-19', 'ham date berlin');
  assert(row?.gate === 'C05', 'ham gate');
  assert(row?.checkinDesk === '6', 'ham checkin');
  const hit = matchOriginBoardRow([row!], {
    ident: 'XQ671',
    dateKey: '2026-08-19',
    destIata: 'AYT',
  });
  assert(hit?.gate === 'C05', 'match tomorrow not today');
  assert(
    matchOriginBoardRow([row!], {
      ident: 'XQ671',
      dateKey: '2026-08-18',
      destIata: 'AYT',
    }) == null,
    'no cross-day gate copy',
  );
}
{
  const row = hamRawToBoardRow({
    flightnumber: 'A3  825',
    plannedDepartureTime: '2026-08-21T09:05:00Z',
    destinationAirport3LCode: 'ATH',
    cancelled: false,
  });
  assert(row?.ident === 'A3825', 'ham a3 ident');
  assert(row?.dateKey === '2026-08-21', 'ham a3 date berlin');
  const clk = matchOriginBoardRow([row!], {
    ident: 'CLK1100',
    dateKey: '2026-08-21',
    destIata: 'ATH',
    clockMs: (row!.plannedMs ?? 0) - 5 * 60_000,
  });
  assert(clk?.ident === 'A3825', 'CLK 11:00 snaps to 11:05 board');
  const early = hamRawToBoardRow({
    flightnumber: 'A3  111',
    plannedDepartureTime: '2026-08-21T08:40:00Z',
    destinationAirport3LCode: 'ATH',
    cancelled: false,
  });
  const later = hamRawToBoardRow({
    flightnumber: 'A3  222',
    plannedDepartureTime: '2026-08-21T09:20:00Z',
    destinationAirport3LCode: 'ATH',
    cancelled: false,
  });
  const nextBoard = matchOriginBoardRow([early!, later!], {
    ident: 'CLK1100',
    dateKey: '2026-08-21',
    destIata: 'ATH',
    clockMs: Date.parse('2026-08-21T09:00:00Z'),
  });
  assert(nextBoard?.ident === 'A3222', 'board: 11:00 → next 11:20 not 10:40');
  const berlinHit = pickBestHitByClock(
    [
      {
        ident: 'A3825',
        scheduledDeparture: new Date('2026-08-21T09:05:00Z'),
        estimatedDeparture: null,
      },
    ],
    '11:00',
    45,
    'Europe/Berlin',
  );
  assert(berlinHit?.ident === 'A3825', '11:00 spoken → 11:05 HAM Tafel');
  const nextOfMany = pickBestHitByClock(
    [
      {
        ident: 'EARLY',
        scheduledDeparture: new Date('2026-08-21T08:40:00Z'),
        estimatedDeparture: null,
      },
      {
        ident: 'NEXT',
        scheduledDeparture: new Date('2026-08-21T09:20:00Z'),
        estimatedDeparture: null,
      },
    ],
    '11:00',
    45,
    'Europe/Berlin',
  );
  assert(nextOfMany?.ident === 'NEXT', '11:00 + two hits → next 11:20 not 10:40');
  const tooFar = pickBestHitByClock(
    [
      {
        ident: 'FAR',
        scheduledDeparture: new Date('2026-08-21T09:55:00Z'),
        estimatedDeparture: null,
      },
    ],
    '11:00',
    45,
    'Europe/Berlin',
  );
  assert(tooFar == null, '50 min later is outside 45');
  const naive = parseHamBoardMs('2026-08-21T11:05:00');
  const zulu = parseHamBoardMs('2026-08-21T09:05:00Z');
  assert(
    naive != null &&
      zulu != null &&
      Math.abs(naive - zulu) < 60_000,
    'naive HAM local = Berlin',
  );
}
assert(airportTimeZone('HAM') === 'Europe/Berlin', 'HAM tz');
assert(fraConcreteGate('A17') === 'A17', 'FRA concrete gate');
assert(fraConcreteGate('A') == null, 'FRA hall letter is not a gate');
{
  const row = fraRawToBoardRow({
    fnr: 'XQ 141',
    iata: 'AYT',
    sched: '2026-08-19T08:00:00+0200',
    terminal: '1',
    gate: 'B44',
    schalterarea: '19',
    status: '',
  });
  assert(row?.ident === 'XQ141', 'fra ident');
  assert(row?.gate === 'B44', 'fra gate');
  assert(row?.checkinDesk === '19', 'fra checkin zone');
  assert(row?.destIata === 'AYT', 'fra dest');
}
assert(berTerminal('T1') === '1', 'BER T1 → 1');
{
  const row = anaRawToBoardRow({
    day: '19/08/2026',
    time: '05:05',
    terminal: 'T1',
    flightNumber: 'LH 1171',
    destination: 'Frankfurt',
    movtype: 'D',
    state: { label: 'Departed', value: '05:32' },
  });
  assert(row?.ident === 'LH1171', 'ana ident');
  assert(row?.dateKey === '2026-08-19', 'ana date');
  assert(row?.destIata === 'FRA', 'ana dest city → IATA');
  assert(row?.terminal === '1', 'ana terminal');
  assert(row?.gate == null, 'ana has no gate field');
}
assert(findAirportByCityHint('london')?.iata === 'LHR', 'london city hint stays Heathrow');
{
  const around = commercialAirportsWithinKm(51.5074, -0.1278, 100).map((a) => a.iata);
  assert(around.includes('LHR') && around.includes('LGW') && around.includes('STN'), 'London 100km has LHR+LGW+STN');
  assert(around.includes('LTN') && around.includes('LCY'), 'London 100km has LTN+LCY');
}
assert(relatedAirportIatas('LHR').includes('STN') && relatedAirportIatas('LGW').includes('LCY'), 'London airport family');
{
  const row = berRawToBoardRow({
    flight_number: 'EW 8536',
    arr_airport_iata: 'AGP',
    scheduled_time: '2026-08-19T05:40:00+02:00',
    terminal: 'T1',
    gate: '',
    checkin_counter: '323-326',
    flight_status_id: 'scheduled',
    flight_status_label: 'Planmäßig',
  });
  assert(row?.ident === 'EW8536', 'ber ident');
  assert(row?.terminal === '1', 'ber terminal');
  assert(row?.gate == null, 'ber empty gate is null');
  assert(row?.checkinDesk === '323-326', 'ber checkin');
}
resetAirportBoardCatalogForTests();
assert(hasPublicOriginBoard('HAM') && hasPublicOriginBoard('FRA') && hasPublicOriginBoard('BER') && hasPublicOriginBoard('LIS'), 'HAM+FRA+BER+LIS have JSON FIDS');
assert(!hasPublicOriginBoard('AYT') && !hasPublicOriginBoard('JFK'), 'no fake JSON for unchecked hubs');
assert(findAirportByCityHint('leipzig')?.iata === 'LEJ', 'Leipzig city → LEJ even without FIDS JSON');
assert(!hasPublicOriginBoard('LEJ') && !hasPublicOriginBoard('MUC'), 'LEJ+MUC have no FIDS until discovery');
{
  const mucDetail =
    '<div class="flight-box-details"><h3 class="flight-box-area">T2 - Gate G41</h3></div><span>LH 1688 (A321)</span><a href="/flugdetailseite-75020?flight_id=9857060.0">Prag (PRG)</a>';
  const ops = parseOpsFromHtml(mucDetail, 'LH1688');
  assert(ops?.gate === 'G41', 'MUC HTML detail gate');
  assert(ops?.terminal === '2', 'MUC HTML detail terminal');
  assert(ops?.destIata === 'PRG', 'MUC HTML dest IATA');
  const urls = collectBoardCandidateUrls(
    '{"departuresUrl":"/flightsearch/departures"}',
    'https://www.munich-airport.de/abfliegen-89403',
  );
  assert(urls.some((u) => /flightsearch\/departures/.test(u)), 'sniff departuresUrl');
}
assert(getAirportBoardProfile('FRA').gateHorizonDays === 3, 'FRA seed 3d gates');
assert(getAirportBoardProfile('HAM').gateHorizonDays === 7, 'HAM seed 7d gates');
assert(getAirportBoardProfile('BER').checkinHorizonDays === 3, 'BER seed 3d check-in');
assert(
  horizonDaysFromRows(
    [
      { dateKey: '2026-08-19', gate: 'C05', checkinDesk: '6' },
      { dateKey: '2026-08-22', gate: 'A14', checkinDesk: '12-13' },
      { dateKey: '2026-08-23', gate: null, checkinDesk: null },
    ],
    Date.parse('2026-08-19T00:00:00Z'),
    'gate',
    '2026-08-19',
  ) === 3,
  'horizon counts last day with a gate',
);
assert(formatWalkMinutes(34 * 60, 400) <= 8, 'clamp padded walk minutes');
assert(
  walkNaturalEndMs({
    startMs: Date.parse('2026-08-19T17:26:00'),
    reportedEndMs: Date.parse('2026-08-19T18:00:00'),
    durationSec: 34 * 60,
    distanceM: 400,
  }).padded,
  'last walk to airport is padded',
);
assert(
  !shouldShowEndClock(
    Date.parse('2026-08-19T16:50:00'),
    Date.parse('2026-08-19T16:50:00'),
  ),
  'hide sequential end clock',
);
assert(
  shouldShowEndClock(
    Date.parse('2026-08-19T16:53:00'),
    Date.parse('2026-08-19T17:00:00'),
  ),
  'show transfer buffer clock',
);
{
  const legs = [
    {
      mode: 'WALK',
      fromName: 'Heisterholz 12',
      toName: 'Prisdorf',
      durationSec: 6 * 60,
      distanceM: 487,
      startMs: Date.parse('2026-08-19T16:40:00'),
      endMs: Date.parse('2026-08-19T16:48:00'),
    },
    {
      mode: 'RAIL',
      line: 'RB61',
      headsign: 'Hamburg-Altona',
      fromName: 'Prisdorf',
      toName: 'Pinneberg',
      durationSec: 2 * 60,
      stationCount: 1,
      startMs: Date.parse('2026-08-19T16:48:00'),
      endMs: Date.parse('2026-08-19T16:50:00'),
    },
    {
      mode: 'WALK',
      fromName: 'Pinneberg',
      toName: 'Pinneberg Bahnhof',
      durationSec: 3 * 60,
      distanceM: 127,
      startMs: Date.parse('2026-08-19T16:50:00'),
      endMs: Date.parse('2026-08-19T16:53:00'),
    },
    {
      mode: 'BUS',
      line: 'X95',
      fromName: 'Pinneberg Bahnhof',
      toName: 'Sperlingsweg',
      durationSec: 33 * 60,
      startMs: Date.parse('2026-08-19T16:53:00'),
      endMs: Date.parse('2026-08-19T17:26:00'),
    },
    {
      mode: 'WALK',
      fromName: 'Sperlingsweg',
      toName: 'Sperlingsweg',
      durationSec: 34 * 60,
      distanceM: 400,
      startMs: Date.parse('2026-08-19T17:26:00'),
      endMs: Date.parse('2026-08-19T18:00:00'),
    },
  ];
  const first = planAccessLeg({
    legs,
    index: 0,
    airportLabel: 'Hamburg Airport',
    airportMs: Date.parse('2026-08-19T18:00:00'),
  });
  assert(/^zu Fuß · 487 m · 6 Min$/.test(first.title), first.title);
  assert(/Einstieg in RB61/.test(first.notes ?? ''), first.notes ?? '');
  assert(!/Fußweg zum Prisdorf|Von Fußweg/.test(first.title), 'no Fußweg-zum-Ort');
  const rail = planAccessLeg({
    legs,
    index: 1,
    airportLabel: 'Hamburg Airport',
    airportMs: Date.parse('2026-08-19T18:00:00'),
  });
  assert(/RB61 Richtung Hamburg-Altona/.test(rail.title), rail.title);
  const bus = planAccessLeg({
    legs,
    index: 3,
    airportLabel: 'Hamburg Airport',
    airportMs: Date.parse('2026-08-19T18:00:00'),
  });
  assert(/^X95 · 33 Min$/.test(bus.title), bus.title);
  assert(!/Sperlingsweg/.test(bus.title), 'bus not named Sperlingsweg');
  const last = planAccessLeg({
    legs,
    index: 4,
    airportLabel: 'Hamburg Airport',
    airportMs: Date.parse('2026-08-19T18:00:00'),
  });
  assert(/^zu Fuß/.test(last.title), last.title);
  assert(last.padded, 'last walk padded');
  assert(last.waitMin >= 20, `puffer ${last.waitMin}`);
  assert(/Puffer/.test(last.notes ?? ''), last.notes ?? '');
  const xfer = planAccessLeg({
    legs,
    index: 2,
    airportLabel: 'Hamburg Airport',
    airportMs: Date.parse('2026-08-19T18:00:00'),
  });
  assert(/^zu Fuß/.test(xfer.title), xfer.title);
}
assert(
  /^zu Fuß/.test(
    accessLegTitle({
      leg: {
        mode: 'WALK',
        fromName: 'Heisterholz 12',
        toName: 'Prisdorf',
        durationSec: 6 * 60,
        distanceM: 487,
        startMs: 0,
        endMs: 1,
      },
      index: 0,
      isLast: false,
      nextMode: 'RAIL',
      originLabel: 'Heisterholz 12',
    }),
  ),
  'first walk mini zu Fuß',
);
assert(
  /Voraussichtlich/.test(
    securityWaitNote(20, Date.parse('2026-08-20T11:05:00'), Date.parse('2026-08-18T16:00:00')),
  ),
  'security planned not aktuell',
);
assert(
  /Aktuell/.test(
    securityWaitNote(20, Date.parse('2026-08-18T16:30:00'), Date.parse('2026-08-18T15:00:00')),
  ),
  'security live within 2h',
);

assert(
  formatDurationMinutesDe(742, 'speech').includes('Stunden'),
  '742 min not raw minutes',
);
assert(
  !formatDurationMinutesDe(742, 'speech').includes('742'),
  '742 not spoken',
);
assert(
  formatDurationMinutesDe(75, 'speech').includes('15'),
  '75 → Stunde 15',
);
assert(
  /eineinhalb/.test(formatDurationMinutesDe(90, 'speech')),
  '90 → eineinhalb',
);
assert(
  /zweieinhalb/.test(formatDurationMinutesDe(150, 'speech')),
  '150 → zweieinhalb',
);
assert(formatDurationMinutesDe(45, 'speech').includes('Minuten'), '45 min');

assert(extractFlightIdent('4M 262') === '4M262', '4M 262 ident');
assert(
  extractFlightIdent('die Flugnummer ist 4M 262') === '4M262',
  'flugnummer 4M 262',
);
assert(extractFlightIdent('Flug 4M262') === '4M262', 'Flug 4M262');
assert(
  identVariants('4M262').includes('MGH262'),
  '4M262 → MGH262',
);
assert(identsMatch('4M262', 'MGH262'), '4M ≡ MGH');
assert(preferredIataIdent('MGH262') === '4M262', 'MGH → 4M');
assert(airportCodeMatches('LTAI', 'AYT'), 'LTAI ≡ AYT');
assert(formatDateKeyDe('2026-08-18') === '18.08.2026', 'DE date');
assert(
  formatDateKeySpokenDe('2026-08-18', Date.parse('2026-08-17T12:00:00')) ===
    'morgen',
  'spoken morgen',
);
assert(
  parseFlightTripSlots('4M 262').flightCode === '4M262',
  'bare ident slots',
);
assert(
  airportLageplanLink({ originIata: 'HAM', gate: 'B53' })?.url.includes(
    'locationId=B53',
  ) === true,
  'HAM Lageplan Gate B53',
);
assert(
  airportLageplanLink({ originIata: 'AYT', gate: 'B53' }) == null,
  'no fake AYT map',
);

assert(
  inferFlightBookingStance(
    'Ich fliege morgen nach Antalya. Wann muss ich am Flughafen sein?',
  ) === 'booked',
  'antalya leave-by → booked',
);
assert(
  parseFlightTripSlots(
    'Ich fliege morgen nach Antalya. Wann muss ich am Flughafen sein?',
  ).leaveByAsk === true,
  'leaveByAsk',
);
assert(extractClockHm('um 12:00 Uhr') === '12:00', '12:00 Uhr');
assert(extractClockHm('Ich fliege um 12 Uhr') === '12:00', 'um 12 Uhr');
assert(extractClockHm('um 12 Uhr fliege ich') === '12:00', 'um 12 Uhr fliege ich');
assert(extractClockHm('geht um 12 Uhr') === '12:00', 'geht um 12');
assert(extractClockHm('um zwölf Uhr') === '12:00', 'zwölf Uhr');
assert(extractClockHm('um 2:30') === '02:30', '2:30');
assert(extractClockHm('um 2.30 Uhr') === '02:30', '2.30 Uhr');
assert(extractClockHm('gegen halb drei') === '02:30', 'halb drei');
assert(extractClockHm('um viertel nach zwei') === '02:15', 'viertel nach');
assert(extractClockHm('viertel vor drei') === '02:45', 'viertel vor');
assert(extractClockHm('um 2 30') === '02:30', 'spaced 2 30');
assert(
  parseFlightTripSlots('Ich fliege morgen um 2:30 nach Wien').clockHm ===
    '02:30',
  'parse 2:30',
);
assert(
  parseFlightTripSlots('Aufgabegepäck, aber ich fliege erst um 16 Uhr')
    .luggage === 'checked',
  'mixed luggage',
);
assert(
  parseFlightTripSlots('Aufgabegepäck, aber ich fliege erst um 16 Uhr')
    .clockHm === '16:00',
  'mixed clock',
);
assert(findAirportByCityHint('Hataya')?.iata === 'AYT', 'Hataya → AYT');

const t0 = Date.parse('2026-08-18T00:26:00');
let trip = mergeTripSlots(null, {
  nowMs: t0,
  destCity: 'Antalya',
  destIata: 'AYT',
  originIata: 'HAM',
  originName: 'Hamburg Airport',
  originCity: 'Hamburg',
  originLat: 53.63,
  originLng: 10.0,
  dateHint: 'tomorrow',
  stance: 'booked',
  leaveByAsk: true,
});
assert(trip.stance === 'booked', 'merge booked');
assert(largestTripGap(trip) === 'time', 'gap time after dest+morgen');
assert(trip.dateLocked === true, 'morgen locks date');
assert(trip.dateFromUserHint === true, 'morgen is user hint');
const morgenKey = trip.dateKey;
assert(Boolean(morgenKey), 'morgen dateKey set');

trip = mergeTripSlots(trip, { nowMs: t0, clockHm: '12:00' });
assert(trip.clockHm === '12:00', 'clock kept');
assert(trip.destIata === 'AYT', 'dest kept after clock');
assert(
  trip.dateKey === morgenKey,
  'clock follow-up must not overwrite user morgen',
);
assert(trip.dateFromUserHint === true, 'hint flag survives clock');
assert(largestTripGap(trip) === 'luggage', 'gap luggage after clock');

// Abend: morgen → dann „um 14 Uhr“ darf nicht auf heute springen
const evening = Date.parse('2026-08-18T20:34:00');
let eve = mergeTripSlots(null, {
  nowMs: evening,
  destCity: 'Athen',
  destIata: 'ATH',
  originIata: 'HAM',
  dateHint: 'tomorrow',
  leaveByAsk: true,
});
const eveMorgen = eve.dateKey;
eve = mergeTripSlots(eve, { nowMs: evening, clockHm: '14:00' });
assert(eve.dateKey === eveMorgen, 'evening: 14h clock keeps morgen');
eve = mergeTripSlots(eve, { nowMs: evening, clockHm: '02:30' });
assert(eve.dateKey === eveMorgen, 'evening: 02:30 clock keeps morgen');
assert(eve.clockHm === '02:30', '02:30 clock stored');

trip = mergeTripSlots(trip, {
  nowMs: t0,
  luggage: 'checked',
  clockHm: '16:00',
});
assert(trip.luggage === 'checked', 'luggage merge');
assert(trip.clockHm === '16:00', 'clock corrected in same turn');
assert(largestTripGap(trip) === 'ready', 'ready after luggage+clock');

let wienSess = mergeTripSlots(null, {
  nowMs: t0,
  destCity: 'Wien',
  destIata: 'VIE',
  originIata: 'HAM',
  originName: 'Hamburg Airport',
  originCity: 'Hamburg',
  originLat: 53.63,
  originLng: 10.0,
  stance: 'booked',
});
assert(largestTripGap(wienSess) === 'date', 'wien ohne tag');
wienSess = mergeTripSlots(wienSess, {
  nowMs: t0,
  destCity: 'Amsterdam',
  destIata: 'AMS',
  clockHm: '16:00',
  stance: 'booked',
});
assert(wienSess.destIata === 'AMS', 'amsterdam replaces wien');
assert(wienSess.clockHm === '16:00', 'clock on dest change');
assert(largestTripGap(wienSess) !== 'date', 'clock implies date');

let istanbulTrip = mergeTripSlots(null, {
  nowMs: t0,
  destCity: 'Istanbul',
  destIata: 'IST',
  originIata: 'HAM',
  originName: 'Hamburg Airport',
  originCity: 'Hamburg',
  originLat: 53.63,
  originLng: 10.0,
  clockHm: '12:30',
  dateHint: 'tomorrow',
  luggage: 'checked',
  stance: 'booked',
  leaveByAsk: true,
});
assert(istanbulTrip.clockHm === '12:30', 'istanbul clock');
istanbulTrip = mergeTripSlots(istanbulTrip, {
  nowMs: t0,
  destCity: 'Prag',
  destIata: 'PRG',
  weekdayDe: 'donnerstag',
  stance: 'booked',
  leaveByAsk: true,
});
assert(istanbulTrip.destIata === 'PRG', 'prag replaces istanbul');
assert(istanbulTrip.clockHm == null, 'new dest/date drops 12:30');
assert(istanbulTrip.selectedIdent == null, 'new dest drops ident');
assert(largestTripGap(istanbulTrip) === 'time', 'prag asks real time');

const okt = parseFlightTripSlots('im Oktober günstig nach Antalya');
assert(okt.isFlightTrip === true, 'oktober dest is flight');
assert(okt.monthIndex === 10, 'oktober month');
assert(okt.dateFlex === 'cheapest', 'günstig → cheapest');
assert(okt.stance === 'wish', 'oktober günstig → wish');
const cheapAsk = parseFlightTripSlots(
  'Was ist der günstigste Flug nach Antalya?',
);
assert(cheapAsk.isFlightTrip === true, 'günstigster Flug is trip');
assert(cheapAsk.stance === 'wish', 'günstigster Flug → wish');
assert(cheapAsk.dateFlex === 'cheapest', 'günstigster → cheapest');
const oktTrip = mergeTripSlots(null, {
  nowMs: t0,
  destCity: 'Antalya',
  destIata: 'AYT',
  originIata: 'HAM',
  originName: 'Hamburg Airport',
  originCity: 'Hamburg',
  originLat: 53.63,
  originLng: 10.0,
  monthIndex: okt.monthIndex,
  dateFlex: okt.dateFlex,
  stance: okt.stance,
});
assert(largestTripGap(oktTrip) === 'search', 'wish → search pitch');

const stickyWish = mergeTripSlots(null, {
  nowMs: t0,
  destCity: 'Antalya',
  destIata: 'AYT',
  originIata: 'HAM',
  originName: 'Hamburg Airport',
  originLat: 53.63,
  originLng: 10.0,
  dateFlex: 'cheapest',
  stance: 'wish',
});
const stickyBooked = mergeTripSlots(stickyWish, {
  nowMs: t0,
  destCity: 'Antalya',
  destIata: 'AYT',
  originIata: 'HAM',
  originName: 'Hamburg Airport',
  originLat: 53.63,
  originLng: 10.0,
  dateHint: 'tomorrow',
  stance: parseFlightTripSlots('wann ich morgen nach Antalya fliege').stance,
});
assert(stickyBooked.stance === 'booked', 'concrete tomorrow drops sticky wish');
assert(stickyBooked.dateFlex == null, 'locked day drops cheapest flex');
assert(largestTripGap(stickyBooked) === 'time', 'booked morgen asks time');

const clockHit20 = pickBestHitByClock(
  [
    {
      ident: 'XQ671',
      scheduledDeparture: new Date(2026, 7, 19, 19, 55, 0, 0),
      estimatedDeparture: null,
    },
  ],
  '20:00',
  45,
);
assert(clockHit20?.ident === 'XQ671', '20:00 → 19:55 XQ671');

resetFlightBufferStyleForTests();
const fastLead = airportLeadMin(pacingMinsForStyle('fast'), 'carry');
assert(fastLead >= 50 && fastLead <= 65, `fast carry lead ${fastLead}`);
const fastBag = airportLeadMin(pacingMinsForStyle('fast'), 'checked');
assert(fastBag > fastLead, 'checked longer than carry');
const fanaticBag = airportLeadMin(pacingMinsForStyle('fanatic'), 'checked');
assert(fanaticBag >= 170, `fanatic ~3h ${fanaticBag}`);
const depMs = Date.parse('2026-08-19T12:00:00');
const fastPace = computeFlightPacing({
  depMs,
  ...pacingMinsForStyle('fast'),
  luggage: 'carry',
});
assert(
  Math.round((depMs - fastPace.airportMs) / 60_000) === fastLead,
  'pacing matches lead',
);
resetFlightBufferStyleForTests();
assert(stepFlightBufferStyle('less') === 'fast', 'normal less → fast');
assert(stepFlightBufferStyle('more') === 'normal', 'fast more → normal');
assert(stepFlightBufferStyle('more') === 'fanatic', 'normal more → fanatic');
resetFlightBufferStyleForTests();

const spoken = buildLeaveBySpeech({
  destCity: 'Antalya',
  ident: '4M262',
  depMs: Date.parse('2026-08-19T12:00:00'),
  leaveMs: Date.parse('2026-08-19T08:30:00'),
  airportMs: Date.parse('2026-08-19T11:00:00'),
  luggage: 'carry',
  leaveByAsk: true,
});
assert(/8:30/.test(spoken.speech) && /11:00/.test(spoken.speech), 'leave-by speech clocks');
assert(/los/i.test(spoken.speech) && /Flughafen/.test(spoken.speech), 'leave-by Los+Flughafen');
assert(!/nach Antalya musst/i.test(spoken.speech), 'no nach-city-musst');
assert(!/klingt richtig gut/i.test(spoken.speech), 'no klingt-richtig-gut in leave-by');
assert(/Am Flughafen/i.test(spoken.speech), 'answer-first airport time');
assert(/4M262 nach Antalya um 12:00/.test(spoken.speech), 'found ident+clock');
assert(/Taxi mit Uber/.test(spoken.speech) || /ÖPNV/.test(spoken.speech), 'access choice after pack');
assert(!/Wunschflug/.test(spoken.speech), 'no Wunschflug');
assert(spoken.bullets.some((b) => /4M262/.test(b)), 'ident in bullets');
assert(!/CLK/.test(spoken.speech), 'no CLK in speech');
const nudged = buildLeaveBySpeech({
  destCity: 'Antalya',
  ident: 'CLK1200',
  depMs: Date.parse('2026-08-19T12:00:00'),
  leaveMs: Date.parse('2026-08-19T08:30:00'),
  airportMs: Date.parse('2026-08-19T11:05:00'),
  luggage: 'carry',
  leaveByAsk: true,
  bufferConfirm: true,
});
assert(/Neuer Puffer/.test(nudged.speech), 'buffer confirm');
assert(!/Passt der Puffer/.test(nudged.speech), 'buffer confirm no re-ask');
assert(!/CLK/.test(nudged.speech), 'no CLK after buffer');
assert(isFlightBufferFollowUp('Weniger Puffer am Flughafen'), 'buffer follow');
assert(isAirportRideFollowUp('Zum Flughafen mit dem Taxi'), 'taxi follow');
assert(isAirportRideFollowUp('Zum Flughafen mit Transfer'), 'transfer follow');
assert(
  isFlightPlanAck('Ja, der Zeitplan, der passt erstmal so, danke.'),
  'zeitplan passt',
);
assert(isFlightThanks('Super, vielen Dank.'), 'thanks after flight');
assert(
  isFlightIdentAsk('wie heißen die Flugnummer von meinem Flug'),
  'ident ask',
);
assert(
  isFlightTripFollowUp('wie heißen die Flugnummer von meinem Flug', true),
  'ident ask stays on flight',
);
assert(
  isFlightTripFollowUp('Super, vielen Dank.', true),
  'thanks stays on flight thread',
);
assert(!isFlightThanks('Hafenrundfahrt planen'), 'hafen not thanks');
assert(relatedAirportIatas('IST').includes('SAW'), 'IST family includes SAW');
assert(publicFlightIdent('CLK1230') == null, 'CLK not public');
assert(preferredIataIdent('TKJ078') === 'VF078', 'TKJ → VF');
assert(
  !/CLK/.test(flightTimelineTitle('CLK1230', 'Istanbul', '12:30')),
  'timeline title no CLK',
);
const clockHit = pickBestHitByClock(
  [
    {
      ident: 'VF078',
      scheduledDeparture: new Date('2026-08-19T12:35:00'),
      estimatedDeparture: null,
    },
    {
      ident: 'TK123',
      scheduledDeparture: new Date('2026-08-19T18:10:00'),
      estimatedDeparture: null,
    },
  ],
  '12:30',
  25,
);
assert(clockHit?.ident === 'VF078', '12:30 → 12:35 VF078');
const ackSpeech = buildLeaveBySpeech({
  destCity: 'Istanbul',
  ident: 'VF078',
  depMs: Date.parse('2026-08-19T12:35:00'),
  leaveMs: Date.parse('2026-08-19T09:45:00'),
  airportMs: Date.parse('2026-08-19T10:30:00'),
  luggage: 'checked',
  leaveByAsk: true,
  planAck: true,
});
assert(/Istanbul/.test(ackSpeech.speech), 'plan ack keeps dest');
assert(!/Wien/.test(ackSpeech.speech), 'plan ack no Wien');
assert(!/Neuer Puffer/.test(ackSpeech.speech), 'plan ack not buffer nudge');
const arrive = Date.parse('2026-08-19T10:30:00');
const nowMs = Date.parse('2026-08-18T15:00:00');
assert(
  isSaneAirportAccessTransit(
    {
      durationSec: 75 * 60,
      startTime: new Date('2026-08-19T09:15:00'),
      endTime: new Date('2026-08-19T10:30:00'),
    },
    { arriveByMs: arrive, taxiMin: 45, nowMs },
  ),
  'sane tomorrow ÖPNV',
);
assert(
  !isSaneAirportAccessTransit(
    {
      durationSec: 75 * 60,
      startTime: new Date('2026-08-18T15:00:00'),
      endTime: new Date('2026-08-18T16:15:00'),
    },
    { arriveByMs: arrive, taxiMin: 45, nowMs },
  ),
  'reject ÖPNV starting now for tomorrow arrive-by',
);

const ELB_PLAN =
  'Ich muss morgen um 15:00 Uhr an der Hamburger Elbphilharmonie sein. Kannst du mir das einplanen?';
assert(!isFlightTripQuery(ELB_PLAN), 'elbphilharmonie is not a flight query');
assert(
  !isFlightTripFollowUp(ELB_PLAN, true),
  'elbphilharmonie is not a sticky flight follow-up',
);
assert(
  isFlightTripFollowUp('um 15 Uhr', true),
  'bare clock still follows an open flight',
);
assert(
  isFlightTripQuery('Ich möchte morgen nach Antalya fliegen'),
  'antalya fliegen stays flight',
);
assert(
  isFlightTripQuery(
    'Am Freitag fliege ich nach Antalya. Wann muss ich spätestens am Freitag am Flughafen sein?',
  ),
  'leave-by + dest is flight',
);
assert(
  shouldEnterFlightAdvisor({
    userText:
      'Am Freitag fliege ich nach Antalya. Wann muss ich spätestens am Freitag am Flughafen sein?',
    chatLane: 'plan',
  }),
  'plan lane still enters flight advisor',
);
assert(
  shouldEnterFlightAdvisor({
    userText: 'Kannst du das einmal durchrechnen und ins Timetable eintragen?',
    chatLane: 'plan',
    hasOpenSession: true,
  }),
  'timetable follow-up enters flight advisor',
);
assert(
  shouldEnterFlightAdvisor({
    userText: 'Ich fliege von Hamburg aus am Freitag',
    chatLane: 'chat',
  }),
  'fliege hamburg enters',
);
assert(
  shouldEnterFlightAdvisor({
    userText:
      'ich fliege am Sonntag nach Athen wann muss ich dann spätestens am Flughafen sein',
    chatLane: 'plan',
  }),
  'athen sunday leave-by enters flight advisor',
);
assert(
  parseFlightTripSlots(
    'ich fliege am Sonntag nach Athen wann muss ich dann spätestens am Flughafen sein',
  ).destHint === 'Athen',
  'athen dest from leave-by',
);
{
  const { composeBlueprintOnMiss } = require('../../module2/blueprints/registry') as {
    composeBlueprintOnMiss: (o: { userText: string }) => { id?: string } | null;
  };
  assert(
    composeBlueprintOnMiss({
      userText:
        'ich fliege am Sonntag nach Athen wann muss ich dann spätestens am Flughafen sein',
    }) == null,
    'athen leave-by is not dining blueprint',
  );
}
{
  const { rewriteQuery } = require('../../module2/pipeline/queryRewriter') as {
    rewriteQuery: (
      t: string,
      c?: { lastTopic?: string; lastPlaceName?: string; lastAssistantSnippet?: string },
    ) => { rewritten: string };
  };
  const rw = rewriteQuery(
    'ich fliege am Sonntag nach Athen wann muss ich dann spätestens am Flughafen sein',
    {
      lastTopic: 'Frühstück',
      lastPlaceName: 'Pannenfisch',
      lastAssistantSnippet: 'Zum Essen in Hamburg passt Pannenfisch.',
    },
  );
  assert(
    !/frühstück|pannenfisch|essen in hamburg/i.test(rw.rewritten),
    'flight leave-by is not dining follow-up rewrite',
  );
}
assert(
  !shouldEnterFlightAdvisor({
    userText: 'Ich hab Lust auf Spaghetti-Eis',
    chatLane: 'pitch',
    hasOpenSession: true,
  }),
  'pitch ice does not steal into flight',
);
assert(
  !shouldEnterFlightAdvisor({
    userText: 'Wie wird das Wetter morgen?',
    chatLane: 'chat',
    session: 'new',
    hasOpenSession: true,
  }),
  'weather does not continue dead flight session',
);

assert(extractFlightIdent('A3825') === 'A3825', 'aegean ident A3825');
assert(extractFlightIdent('A3 825') === 'A3825', 'aegean ident spaced');
assert(publicFlightIdent('A3825') === 'A3825', 'aegean public ident');
assert(isShortReplyToLastAsk('ja'), 'bare ja is last-ask reply');
assert(isShortReplyToLastAsk('ja klar'), 'ja klar is last-ask reply');
assert(
  luggageFromLastAskReply('ja', 'luggage') === 'checked',
  'ja after luggage ask = checked',
);
assert(
  luggageFromLastAskReply('nein', 'luggage') === 'carry',
  'nein after luggage ask = carry',
);
assert(
  luggageFromLastAskReply('ja', 'ride') == null,
  'ja after ride ask is not luggage',
);
assert(
  shouldYieldPlanWaitToFlight({
    userText:
      'ich fliege am Sonntag nach Athen wann muss ich dann spätestens am Flughafen sein',
  }),
  'sunday leave-by yields plan wait',
);
assert(
  shouldYieldPlanWaitToFlight({
    userText: 'ja',
    hasOpenSession: true,
    pendingAsk: 'luggage',
  }),
  'ja to luggage yields plan wait',
);
assert(
  !shouldYieldPlanWaitToFlight({
    userText: 'ja',
    hasOpenSession: false,
  }),
  'bare ja without flight session stays plan',
);
assert(
  parseFlightTripSlots(
    'ja (gerade gefragt: Fliegst du mit Aufgabegepäck oder nur mit Handgepäck?)',
  ).luggage === 'checked',
  'rewritten ja+luggage ask parses checked',
);

assert(
  speechInventedAirportLead('Sei zwei Stunden vorher am Flughafen.'),
  'pauschal zwei Stunden is invented lead',
);
assert(
  !speechInventedAirportLead('Ich bau den Plan rückwärts vom Abflug.'),
  'reverse-plan bridge is not invented lead',
);
assert(
  shouldEnterFlightAdvisor({
    userText: 'Wann muss ich los?',
    chatLane: 'plan',
    flightWorker: true,
  }),
  'Call-1 flight worker still enters advisor',
);
{
  const { looksLikeModul5PlanUtterance } = require('../../module2/planning/planUtteranceGate') as {
    looksLikeModul5PlanUtterance: (s: string) => boolean;
  };
  assert(
    !looksLikeModul5PlanUtterance(
      'ich fliege am Sonntag nach Athen wann muss ich dann spätestens am Flughafen sein',
    ),
    'leave-by is not modul 5',
  );
}
{
  const { wantsTaxiRide } = require('../mobility/taxiRideIntent') as {
    wantsTaxiRide: (s: string) => boolean;
  };
  const taxiFlight =
    'also ich fliege morgen nach Athen kannst du mir ein Taxi vorbestellen';
  assert(!wantsTaxiRide(taxiFlight), 'flight+taxi is not a hail');
  assert(
    shouldEnterFlightAdvisor({ userText: taxiFlight, chatLane: 'nav' }),
    'flight+taxi still enters advisor',
  );
}
{
  assert(
    isShortReplyToLastAsk('um 20 Uhr'),
    'clock reply is short reply to last ask',
  );
  assert(
    shouldPreserveFlightTripSession(
      'ich fliege morgen nach Athen man muss am Flughafen sein',
    ),
    'fresh flight query preserves (creates) session path',
  );
  assert(
    shouldScrubFlightOnTopicCut('Wie wird das Wetter morgen?'),
    'weather scrubs flight',
  );
  assert(
    shouldScrubFlightOnTopicCut('Wo ist aktuell Bier im Angebot?'),
    'supermarket prospect scrubs flight',
  );
  assert(
    !shouldScrubFlightOnTopicCut('um 20 Uhr'),
    'bare clock does not scrub flight',
  );
  assert(
    !shouldScrubFlightOnTopicCut('Wer war der Papst?'),
    'knowledge does not scrub flight',
  );
}
{
  const withSec = buildLeaveBySpeech({
    destCity: 'Athen',
    ident: 'A3501',
    depMs: Date.parse('2026-08-23T12:00:00'),
    leaveMs: Date.parse('2026-08-23T08:30:00'),
    airportMs: Date.parse('2026-08-23T11:00:00'),
    luggage: 'checked',
    leaveByAsk: true,
    taxiMin: 35,
    taxiPrice: 'ca. 42–58 €',
    wakeClock: '06:45',
    checkinClock: '10:20',
  });
  assert(/Check-in um 10:20/.test(withSec.speech), 'check-in clock in leave-by');
  assert(/Wecker auf 06:45/.test(withSec.speech), 'wake ask in leave-by');
  assert(!/aktuell/i.test(withSec.speech), 'no live-now taxi/security at night');
  assert(
    shouldYieldPlanWaitToFlight({
      userText: 'um 20 Uhr',
      hasOpenSession: true,
      pendingAsk: 'when',
    }),
    'bare clock yields plan wait to flight',
  );
  assert(
    shouldEnterFlightAdvisor({
      userText: 'um 20 Uhr',
      chatLane: 'plan',
      hasOpenSession: true,
    }),
    'bare clock with session enters flight advisor',
  );
  // Abendflug: Wecker-Vorschlag nur morgens sinnvoll
  {
    const leaveEve = Date.parse('2026-08-28T18:00:00');
    const depEve = Date.parse('2026-08-28T20:00:00');
    const wakeEve = leaveEve - 50 * 60_000; // 17:10
    const wakeHour = new Date(wakeEve).getHours();
    assert(wakeHour >= 11, 'evening prep wake is afternoon');
    assert(
      !(wakeHour < 11 && wakeEve < leaveEve - 30 * 60_000 && Math.abs(wakeEve - depEve) > 90 * 60_000),
      'evening flight must not propose wake',
    );
    const wakeMorn = Date.parse('2026-08-28T06:45:00');
    const leaveMorn = Date.parse('2026-08-28T08:30:00');
    const depMorn = Date.parse('2026-08-28T12:00:00');
    const wh = new Date(wakeMorn).getHours();
    assert(
      wh < 11 &&
        wakeMorn < leaveMorn - 30 * 60_000 &&
        Math.abs(wakeMorn - depMorn) > 90 * 60_000,
      'morning flight may propose wake',
    );
  }
}

if (failed) {
  console.error(`flightTripIntent smoke: ${failed} failed`);
  process.exit(1);
}
console.log('flightTripIntent smoke: ok');
