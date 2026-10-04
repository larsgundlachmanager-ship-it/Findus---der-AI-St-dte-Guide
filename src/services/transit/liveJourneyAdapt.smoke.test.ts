/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/transit/liveJourneyAdapt.smoke.test.ts
 */
import {
  applyLiveAlightArriveToStops,
  assessLiveJourneyPace,
  assessTransferConnection,
  estimateLiveRideEtaSec,
  findUpcomingTransferBoard,
  liveWalkEtaMin,
  neededCatchUpKmh,
  resolveAlightArriveMs,
  shiftTourStopTimesForDelay,
} from './liveJourneyAdapt';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(liveWalkEtaMin({ distanceM: 350, paceMPerMin: 70 }) === 5, '350 m ≈ 5 Min');
assert(liveWalkEtaMin({ distanceM: 10 }) === 0, 'bereits am Halt');

const need = neededCatchUpKmh(200, 72);
assert(need != null && need >= 9.5 && need <= 10.5, `200 m / 72 s ≈ 10 km/h, war ${need}`);

const now = Date.parse('2026-09-02T12:30:00+02:00');
const dep = Date.parse('2026-09-02T12:40:00+02:00');

const relaxed = assessLiveJourneyPace({
  nowMs: now,
  depMs: dep,
  distanceM: 200,
  bufferMin: 3,
  paceMPerMin: 70,
  line: 'RB61',
});
assert(relaxed.scenario === 'relaxed' || relaxed.scenario === 'ok', 'früh genug');
assert(relaxed.waitMin >= 5, `mehr Wartezeit wenn früh (${relaxed.waitMin})`);

const catchUp = assessLiveJourneyPace({
  nowMs: Date.parse('2026-09-02T12:35:00+02:00'),
  depMs: dep,
  distanceM: 200,
  bufferMin: 3,
  paceMPerMin: 70,
  nextDepMs: Date.parse('2026-09-02T12:52:00+02:00'),
  line: 'RB61',
  nextLine: 'Bus 185',
});
assert(
  catchUp.scenario === 'catch_up' || catchUp.scenario === 'wait_next',
  `knapp → Aufholen/Warten (${catchUp.scenario})`,
);
assert(
  catchUp.tip != null &&
    (/km\/h/i.test(catchUp.tip) || /warten/i.test(catchUp.tip)),
  `Tipp mit Tempo oder Wartezeit (${catchUp.tip})`,
);
assert(
  /Bus 185|RB61|km\/h|warten/i.test(catchUp.tip!),
  'Tipp nennt Linie oder Tempo',
);

const delayed = shiftTourStopTimesForDelay(
  [
    {
      role: 'walk',
      vehicleStartMs: dep,
      startMs: now,
      endMs: dep,
      delaySec: 0,
    },
    {
      role: 'alight',
      startMs: dep,
      endMs: dep + 2 * 60_000,
      delaySec: 0,
    },
  ],
  { oldDepMs: dep, newDepMs: dep + 5 * 60_000, delaySec: 300 },
);
assert(
  delayed[0]!.vehicleStartMs === dep + 5 * 60_000,
  'Board-Zeit um Verspätung verschoben',
);
assert(delayed[0]!.delaySec === 300, 'delaySec gesetzt');
assert(
  delayed[1]!.startMs === dep + 5 * 60_000,
  'Ride-Start mitverschoben',
);

const stops = [
  {
    role: 'alight',
    lat: 48.76,
    lng: 8.93,
    name: 'Renningen',
    line: 'S6',
    endMs: Date.parse('2026-09-02T13:10:00+02:00'),
    done: false,
  },
  {
    role: 'transfer',
    lat: 48.761,
    lng: 8.932,
    name: 'Busbahnhof',
    line: 'Bus 745',
    vehicleStartMs: Date.parse('2026-09-02T13:18:00+02:00'),
    vehicleMode: 'BUS',
    durationSec: 180,
    done: false,
  },
];
const xfer = findUpcomingTransferBoard(stops, 0);
assert(xfer != null && xfer.line === 'Bus 745', 'nächster Umstieg Bus');
assert(xfer!.transferWalkMin === 3, 'Umsteige-Fuß aus durationSec');

const arrive = resolveAlightArriveMs({
  stop: stops[0],
  nowMs: Date.parse('2026-09-02T13:05:00+02:00'),
  etaSec: 5 * 60,
});
assert(arrive === Date.parse('2026-09-02T13:10:00+02:00'), 'Live-ETA zum Ausstieg');

const okLink = assessTransferConnection({
  nowMs: Date.parse('2026-09-02T13:05:00+02:00'),
  alightArriveMs: Date.parse('2026-09-02T13:10:00+02:00'),
  nextDepMs: Date.parse('2026-09-02T13:18:00+02:00'),
  transferWalkMin: 3,
  line: 'S6',
  nextLine: 'Bus 745',
});
assert(okLink.scenario === 'ok' || okLink.scenario === 'tight', `Puffer ok (${okLink.scenario})`);

const broken = assessTransferConnection({
  nowMs: Date.parse('2026-09-02T13:05:00+02:00'),
  alightArriveMs: Date.parse('2026-09-02T13:16:00+02:00'),
  nextDepMs: Date.parse('2026-09-02T13:18:00+02:00'),
  transferWalkMin: 4,
  line: 'S6',
  nextLine: 'Bus 745',
});
assert(broken.scenario === 'broken' || broken.scenario === 'at_risk', `knapp/weg (${broken.scenario})`);
assert(broken.tip != null, 'Anschluss-Tipp');

const etaDist = estimateLiveRideEtaSec({
  distanceM: 3600,
  speedMs: 12,
  remainingStations: 3,
});
assert(etaDist === 300, `3600 m / 12 m/s = 300 s (war ${etaDist})`);

const etaStops = estimateLiveRideEtaSec({
  remainingStations: 2,
  durationSec: 600,
  stationCount: 5,
});
assert(etaStops === 240, `2/5 von 600 s = 240 (war ${etaStops})`);

const rideStops = [
  {
    role: 'alight' as const,
    startMs: now,
    endMs: now + 20 * 60_000,
    durationSec: 1200,
    liveHint: null as string | null,
  },
  {
    role: 'transfer' as const,
    vehicleStartMs: now + 25 * 60_000,
    startMs: null,
    endMs: null,
  },
];
const live = applyLiveAlightArriveToStops(rideStops, {
  currentIndex: 0,
  liveAlightArriveMs: now + 12 * 60_000,
  nowMs: now,
});
assert(live != null, 'Live-Ausstieg patch');
assert(live!.stops[0]!.endMs === now + 12 * 60_000, 'endMs = Live-ETA');
assert(
  (live!.stops[1] as { vehicleStartMs?: number }).vehicleStartMs ===
    now + 25 * 60_000,
  'Bus-Abfahrt unverändert',
);
assert(/noch ~12 Min/i.test(live!.stops[0]!.liveHint || ''), 'Hint Restfahrt');


const missedGps = assessLiveJourneyPace({
  nowMs: dep + 60_000,
  depMs: dep,
  distanceM: 10,
  bufferMin: 3,
  gpsUnreliable: true,
  line: 'S6',
});
assert(missedGps.scenario === 'missed', 'schlechtes GPS + nach Abfahrt → verpasst (Zeit)');

const noFalseMiss = assessLiveJourneyPace({
  nowMs: now,
  depMs: dep,
  distanceM: 5000,
  bufferMin: 3,
  gpsUnreliable: true,
  line: 'S6',
});
assert(noFalseMiss.scenario !== 'missed', 'schlechtes GPS vor Abfahrt → kein Distanz-Miss');
assert(
  noFalseMiss.scenario === 'ok' || noFalseMiss.scenario === 'relaxed',
  `vor Abfahrt nur Zeit-Puffer (${noFalseMiss.scenario})`,
);

console.log('liveJourneyAdapt.smoke.test.ts OK');
