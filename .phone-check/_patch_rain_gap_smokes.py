# -*- coding: utf-8 -*-
from pathlib import Path

# rainIncomingPolicy smoke
p = Path("src/services/weather/rainIncomingPolicy.smoke.test.ts")
t = p.read_text(encoding="utf-8")
if "findSeriesRainEndMs" not in t:
    t = t.replace(
        """import {
  isRainAlreadyFalling,
  minutesUntilIncomingRain,
  rainDurationMin,
  formatRainHudLine,
  isPrecipWeatherCode,
  isRainDontCareUtterance,
  isRainShelterUtterance,
} from './rainIncomingPolicy';""",
        """import {
  isRainAlreadyFalling,
  minutesUntilIncomingRain,
  rainDurationMin,
  formatRainHudLine,
  isPrecipWeatherCode,
  isRainDontCareUtterance,
  isRainShelterUtterance,
  findSeriesRainEndMs,
  mergeRainWindowsByDryGap,
  RAIN_END_MIN_DRY_GAP_MS,
} from './rainIncomingPolicy';""",
        1,
    )
    insert = """
  // Flatterpause < 30 Min ≠ Regenende
  const seriesBase = now;
  const flutter = [];
  for (let m = 0; m <= 80; m++) {
    const wet = m <= 35 || m >= 45; // 10 Min trocken
    flutter.push({ atMs: seriesBase + m * 60_000, wet });
  }
  assert(
    findSeriesRainEndMs({ samples: flutter }) === seriesBase + 81 * 60_000 ||
      findSeriesRainEndMs({ samples: flutter }) == null,
    '10 Min Pause → kein frühes Ende (Ende erst nach Serie oder null)',
  );
  // findSeries: after last wet at 80, next dry would be... we only go to 80 all wet at end
  // last samples at 80 is wet → returns null (kein echtes Ende in Serie)
  assert(
    findSeriesRainEndMs({ samples: flutter }) == null,
    'Serie endet nass → null (kein 36-Min-Fake-Ende)',
  );
  const realPause = [];
  for (let m = 0; m <= 90; m++) {
    const wet = m <= 30 || m >= 65; // 35 Min Pause
    realPause.push({ atMs: seriesBase + m * 60_000, wet });
  }
  assert(
    findSeriesRainEndMs({ samples: realPause }) === seriesBase + 31 * 60_000,
    '≥30 Min Pause → Ende am ersten Trocken-Slot',
  );
  const mergedWin = mergeRainWindowsByDryGap([
    { startMs: now, endMs: now + 40 * 60_000, pop: 70 },
    { startMs: now + 50 * 60_000, endMs: now + 100 * 60_000, pop: 60 },
  ]);
  assert(mergedWin.length === 1 && mergedWin[0]!.endMs === now + 100 * 60_000, 'Fenster 10-Min-Lücke gemerged');
  assert(RAIN_END_MIN_DRY_GAP_MS === 30 * 60_000, '30 Min Pause-SSOT');

"""
    # insert before nextWeatherPollDelayMs asserts
    needle = "  assert(\n    nextWeatherPollDelayMs({\n      rainingNow: false,\n      dayStableDry: true,"
    if needle not in t:
        raise SystemExit("poll needle missing")
    t = t.replace(needle, insert + needle, 1)
    # Fix the contradictory assert - remove the first OR assert
    t = t.replace(
        """  assert(
    findSeriesRainEndMs({ samples: flutter }) === seriesBase + 81 * 60_000 ||
      findSeriesRainEndMs({ samples: flutter }) == null,
    '10 Min Pause → kein frühes Ende (Ende erst nach Serie oder null)',
  );
  // findSeries: after last wet at 80, next dry would be... we only go to 80 all wet at end
  // last samples at 80 is wet → returns null (kein echtes Ende in Serie)
  assert(
    findSeriesRainEndMs({ samples: flutter }) == null,
    'Serie endet nass → null (kein 36-Min-Fake-Ende)',
  );
""",
        """  assert(
    findSeriesRainEndMs({ samples: flutter }) == null,
    '10 Min Flatterpause → kein frühes Ende (Serie endet noch nass)',
  );
""",
        1,
    )
tmp = Path(".phone-check/_rain_smoke_gap.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.replace(p)
print("rain smoke ok")

# gps smoke
p = Path("src/services/weather/gpsRainNowcast.smoke.test.ts")
t = p.read_text(encoding="utf-8")
if "timingFromRainSamples" not in t.split("import")[1][:500] if "import" in t else True:
    pass
# check imports at top
if "timingFromRainSamples" not in t:
    t = t.replace(
        "  RADAR_LATE_CLEAR_MS,\n",
        "  RADAR_LATE_CLEAR_MS,\n  timingFromRainSamples,\n",
        1,
    )
else:
    # maybe already imported via other - check
    if "timingFromRainSamples," not in t[:800]:
        t = t.replace(
            "  RADAR_LATE_CLEAR_MS,\n",
            "  RADAR_LATE_CLEAR_MS,\n  timingFromRainSamples,\n",
            1,
        )

gap_test = """
  // 10-Min-Flatterpause darf „hört auf“ nicht triggern
  const gapBase = Date.parse('2026-09-01T12:00:00+02:00');
  const flutterSamples = [];
  for (let m = 0; m <= 90; m += 5) {
    const wet = m <= 30 || m >= 45; // 15 Min Lücke (35,40)
    flutterSamples.push({
      atMs: gapBase + m * 60_000,
      precipMm: wet ? 0.25 : 0,
    });
  }
  const flutterTiming = timingFromRainSamples(flutterSamples, {
    nowMs: gapBase + 10 * 60_000,
    stepMs: 5 * 60_000,
    wetMm: 0.05,
    noisePeakMin: null,
  });
  assert(flutterTiming.rainingNow, 'flutter: noch nass');
  assert(
    flutterTiming.rainEndsAtMs != null &&
      flutterTiming.rainEndsAtMs > gapBase + 80 * 60_000,
    `flutter Ende nach letztem Schauer, got ${flutterTiming.rainEndsAtMs && new Date(flutterTiming.rainEndsAtMs).toISOString()}`,
  );

  const pauseSamples = [];
  for (let m = 0; m <= 90; m += 5) {
    const wet = m <= 20 || m >= 55; // 35 Min Pause
    pauseSamples.push({
      atMs: gapBase + m * 60_000,
      precipMm: wet ? 0.25 : 0,
    });
  }
  const pauseTiming = timingFromRainSamples(pauseSamples, {
    nowMs: gapBase + 5 * 60_000,
    stepMs: 5 * 60_000,
    wetMm: 0.05,
    noisePeakMin: null,
  });
  assert(
    pauseTiming.rainEndsAtMs != null &&
      pauseTiming.rainEndsAtMs < gapBase + 40 * 60_000,
    'echte ≥30 Min Pause → Ende nach erstem Block',
  );

"""
if "10-Min-Flatterpause" not in t:
    t = t.replace(
        "  console.log('gpsRainNowcast.smoke.test.ts ok');",
        gap_test + "  console.log('gpsRainNowcast.smoke.test.ts ok');",
        1,
    )
tmp = Path(".phone-check/_gps_smoke_gap.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.replace(p)
print("gps smoke ok")
