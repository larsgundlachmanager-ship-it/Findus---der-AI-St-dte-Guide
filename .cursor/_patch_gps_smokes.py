from pathlib import Path

bp = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\boardingDetector.smoke.test.ts")
bt = bp.read_text(encoding="utf-8")
if "schedule_time" not in bt:
    bt = bt.replace(
        """from {
  ALIGHT_DWELL_MS,
  assessAlightReady,
  resetBoardingDetector,
  takeAlightAdvancePending,
  tickBoardingDetector,
} from './boardingDetector';""",
        """from {
  ALIGHT_DWELL_MS,
  ALIGHT_TIME_GRACE_MS,
  BOARD_TIME_GRACE_MS,
  assessAlightReady,
  resetBoardingDetector,
  takeAlightAdvancePending,
  tickBoardingDetector,
} from './boardingDetector';""",
    )
    extra = """
// --- GPS schlecht: Zeit-Fallback ---
assert(
  assessAlightReady({
    speedMs: 8,
    remainingStations: 1,
    nearStation: false,
    nearAlightDest: false,
    dwellStillMs: 0,
    transportIsTransit: true,
    gpsUnreliable: true,
    scheduledAlightMs: t0,
    nowMs: t0 + ALIGHT_TIME_GRACE_MS + 1_000,
  }).reason === 'schedule_time',
  'schlechtes GPS + Ankunftszeit → Ausstieg',
);

resetBoardingDetector();
phase = tickBoardingDetector({
  lat: 48.70,
  lng: 8.90,
  transportMode: 'walk',
  speedMs: 0.2,
  stations: [{ lat: 48.76, lng: 8.93, name: 'Start' }],
  remainingStations: 4,
  hasTransitLegs: true,
  gpsAccuracyM: 120,
  gpsAtMs: t0,
  scheduledBoardMs: t0,
  nowMs: t0 + BOARD_TIME_GRACE_MS + 2_000,
});
assert(phase === 'in_transit', `Board per Zeit bei schlechtem GPS (war ${phase})`);

"""
    needle = "console.log('boardingDetector.smoke.test.ts OK');"
    if needle not in bt:
        raise SystemExit("boarding console missing")
    bt = bt.replace(needle, extra + needle)
    bp.write_text(bt, encoding="utf-8", newline="\n")
    print("boarding smoke patched")
else:
    print("boarding smoke already")

lp = Path(r"c:\Users\larsf\Findus 2.0\src\services\transit\liveJourneyAdapt.smoke.test.ts")
lt = lp.read_text(encoding="utf-8")
if "gpsUnreliable" not in lt:
    extra2 = """
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

"""
    needle2 = "console.log('liveJourneyAdapt.smoke.test.ts OK');"
    if needle2 not in lt:
        raise SystemExit("lja console missing")
    lt = lt.replace(needle2, extra2 + needle2)
    lp.write_text(lt, encoding="utf-8", newline="\n")
    print("lja smoke patched")
else:
    print("lja smoke already")
