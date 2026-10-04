/**
 * Run: npx --yes tsx src/services/weather/gpsRainNowcast.smoke.test.ts
 */

import {
  applyGpsNowcastToTiming,
  maxNearTermRainPopPct,
  parseBrightSkyRadarNowcast,
  parseGpsRainNowcast,
  precipMmFromRadarUnits,
  shouldFetchGpsRainNowcast,
  RADAR_EARLY_WARN_MS,
  RADAR_LATE_CLEAR_MS,
  timingFromRainSamples,
} from './gpsRainNowcast';
import { formatRainHudLine } from './rainIncomingPolicy';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function run(): void {
  const now = Date.parse('2026-08-28T20:22:00+02:00');
  const recentProbe = now - 60_000;

  assert(
    !shouldFetchGpsRainNowcast({
      nowMs: now,
      nextRainAtMs: now + 40 * 60_000,
      lastGpsNowcastAtMs: recentProbe,
      nextRainProb: 20,
      dayStableDry: true,
      weatherCode: 800,
    }),
    'in 40 Min + 20% + Sonne → kein GPS',
  );
  assert(
    shouldFetchGpsRainNowcast({
      nowMs: now,
      nextRainAtMs: now + 12 * 60_000,
      lastGpsNowcastAtMs: recentProbe,
    }),
    'in 12 Min → GPS-Nowcast',
  );
  assert(
    shouldFetchGpsRainNowcast({ nowMs: now, rainingNow: true }),
    'regnet → GPS-Nowcast',
  );

  assert(
    !shouldFetchGpsRainNowcast({
      nowMs: now,
      lastGpsNowcastAtMs: null,
      dayStableDry: true,
      weatherCode: 800,
      nextRainProb: 10,
      maxNearPopPct: 10,
    }),
    '30° Gefühl: klar + 10% → kein Blind-Probe',
  );

  assert(
    !shouldFetchGpsRainNowcast({
      nowMs: now,
      lastGpsNowcastAtMs: null,
      maxNearPopPct: 20,
      weatherCode: 801,
    }),
    '20% Pop + leicht bewölkt → kein Check',
  );

  assert(
    shouldFetchGpsRainNowcast({
      nowMs: now,
      lastGpsNowcastAtMs: null,
      maxNearPopPct: 20,
      dayStableDry: true,
      weatherCode: 804,
    }),
    'bedeckt + niedrige Pop → trotzdem GPS (lokale Schauer)',
  );

  assert(
    shouldFetchGpsRainNowcast({
      nowMs: now,
      lastGpsNowcastAtMs: null,
      maxNearPopPct: 0,
    }),
    'ohne Wettercode → einmal GPS-Radar (Discovery)',
  );

  assert(
    !shouldFetchGpsRainNowcast({
      nowMs: now,
      lastGpsNowcastAtMs: recentProbe,
      maxNearPopPct: 0,
    }),
    'ohne Wettercode aber Probe frisch → warten',
  );

  assert(
    shouldFetchGpsRainNowcast({
      nowMs: now,
      lastGpsNowcastAtMs: null,
      maxNearPopPct: 55,
      weatherCode: 802,
    }),
    '55% + Wolken/Sonne → Check',
  );

  assert(
    !shouldFetchGpsRainNowcast({
      nowMs: now,
      lastGpsNowcastAtMs: now - 2 * 60_000,
      maxNearPopPct: 55,
      weatherCode: 802,
    }),
    '55% aber Probe vor 2 Min → noch warten',
  );

  assert(
    shouldFetchGpsRainNowcast({
      nowMs: now,
      lastGpsNowcastAtMs: now - 16 * 60_000,
      maxNearPopPct: 55,
      weatherCode: 802,
    }),
    '55% + Probe vor 16 Min → wieder Check',
  );

  assert(
    maxNearTermRainPopPct({
      nowMs: now,
      nextRainProb: 20,
      rainWindows: [
        { startMs: now + 3600_000, endMs: now + 7200_000, pop: 60 },
      ],
    }) === 60,
    'Fenster-Pop schlägt nextRainProb',
  );

  const wetNow = parseGpsRainNowcast(
    {
      current: { precipitation: 0.4, weather_code: 61 },
      minutely_15: {
        time: [
          '2026-08-28T20:15',
          '2026-08-28T20:30',
          '2026-08-28T20:45',
          '2026-08-28T21:00',
        ],
        precipitation: [0.3, 0.2, 0.1, 0],
        weather_code: [61, 61, 61, 3],
      },
    },
    { lat: 53.682, lng: 9.763, nowMs: now },
  );
  assert(wetNow && wetNow.rainingNow, 'current precip → rainingNow');

  const mergedWet = applyGpsNowcastToTiming(
    {
      nextRainAtMs: null,
      rainStartsInMin: null,
      rainEndsAtMs: null,
      currentPrecipMm: 0,
      dayStableDry: true,
      summaryLine: 'Aktuell 18° · leicht bewölkt · heute bis 21°',
      currentTemp: 18,
    },
    wetNow,
  );
  assert(mergedWet.dayStableDry === false, 'nass → nicht dayStableDry');
  assert(
    /regen/i.test(mergedWet.summaryLine ?? ''),
    'Summary muss Regen zeigen, nicht Wolken-Mix',
  );

  const dry = parseGpsRainNowcast(
    {
      current: { precipitation: 0, weather_code: 3 },
      minutely_15: {
        time: [
          '2026-08-28T20:15',
          '2026-08-28T20:30',
          '2026-08-28T20:45',
          '2026-08-28T21:00',
        ],
        precipitation: [0, 0, 0, 0],
        weather_code: [3, 3, 3, 3],
      },
    },
    { lat: 53.682, lng: 9.763, nowMs: now },
  );
  assert(dry && !dry.rainingNow && dry.nextRainAtMs == null, 'trocken → kein Countdown');

  const soon = parseGpsRainNowcast(
    {
      current: { precipitation: 0, weather_code: 3 },
      minutely_15: {
        time: [
          '2026-08-28T20:15',
          '2026-08-28T20:30',
          '2026-08-28T20:45',
          '2026-08-28T21:00',
        ],
        precipitation: [0, 0, 0.2, 0.4],
        weather_code: [3, 3, 80, 81],
      },
    },
    { lat: 53.682, lng: 9.763, nowMs: now },
  );
  // Early-Warn: Midpoint(20:30,20:45)=20:37:30 − 2 Min ≈ 20:35:30
  const firstWet = Date.parse('2026-08-28T20:45');
  const lastDry = Date.parse('2026-08-28T20:30');
  const midStart = Math.round((lastDry + firstWet) / 2);
  const warnAt = midStart - RADAR_EARLY_WARN_MS;
  assert(soon && !soon.rainingNow, 'Zukunftsregen ≠ rainingNow (±20-Min-Bug weg)');
  assert(soon && soon.nextRainAtMs === warnAt, `Regen-Warn Midpoint−early, got ${soon?.nextRainAtMs}`);
  assert(
    soon && soon.rainStartsInMin === Math.round((warnAt - now) / 60_000),
    `StartsIn from warn, got ${soon?.rainStartsInMin}`,
  );

  // Früher Bug: nasser Bucket in +15 Min → fälschlich rainingNow.
  const falsePos = parseGpsRainNowcast(
    {
      current: { precipitation: 0, weather_code: 3 },
      minutely_15: {
        time: [
          '2026-09-01T03:00',
          '2026-09-01T03:15',
          '2026-09-01T03:30',
          '2026-09-01T03:45',
        ],
        precipitation: [0, 0, 0.4, 0.1],
        weather_code: [3, 3, 61, 3],
      },
    },
    {
      lat: 53.661,
      lng: 9.797,
      nowMs: Date.parse('2026-09-01T03:12:00+02:00'),
    },
  );
  assert(falsePos && !falsePos.rainingNow, '03:12 + Regen erst 03:30 → nicht rainingNow');

  const merged = applyGpsNowcastToTiming(
    {
      nextRainAtMs: now + 38 * 60_000,
      rainStartsInMin: 38,
      rainEndsAtMs: null,
      currentPrecipMm: 0,
      dayStableDry: false,
    },
    dry,
  );
  assert(merged.nextRainAtMs == null, 'Nowcast-Trocken löscht Fake-38-Min');

  // ── Pinneberg 2026-09-01: Bright Sky RV 5-Min am GPS-Punkt ──────────────
  // Ground truth (WetterOnline): trocken 03:10–03:20, Start ~03:22–03:25,
  // Ende ~03:36–03:40.
  const pinFrames: Array<{ t: string; u: number }> = [
    ['03:10', 0],
    ['03:15', 0],
    ['03:20', 0],
    ['03:25', 1],
    ['03:30', 29],
    ['03:35', 4],
    ['03:40', 0],
    ['03:45', 1], // Noise-Fleck (Peak 1 < 3) → ignorieren
    ['03:50', 0],
  ].map(([hm, u]) => ({ t: `2026-09-01T${hm}:00+02:00`, u: u as number }));

  const pinRadar = {
    latlon_position: { x: 1, y: 1 },
    radar: pinFrames.map(({ t, u }) => ({
      timestamp: t,
      precipitation_5: [
        [0, 0, 0],
        [0, u, 0],
        [0, 0, 0],
      ],
    })),
  };

  const at312 = parseBrightSkyRadarNowcast(pinRadar, {
    lat: 53.661,
    lng: 9.797,
    nowMs: Date.parse('2026-09-01T03:12:00+02:00'),
  });
  assert(at312 && !at312.rainingNow, 'Pinneberg 03:12: Radar trocken → nicht rainingNow');
  assert(at312 && at312.source === 'brightsky_rv', 'Quelle Bright Sky RV');
  // Midpoint 03:20/03:25 = 03:22:30 − Early 2 Min = 03:20:30
  const midStartPin = Math.round(
    (Date.parse('2026-09-01T03:20:00+02:00') +
      Date.parse('2026-09-01T03:25:00+02:00')) /
      2,
  );
  const pinWarn = midStartPin - RADAR_EARLY_WARN_MS;
  assert(
    at312 && at312.nextRainAtMs === pinWarn,
    `03:12 Warn-Start Midpoint−early, got ${at312?.nextRainAtMs && clockLabel(at312.nextRainAtMs)}`,
  );
  const hud312 = formatRainHudLine({
    nowMs: Date.parse('2026-09-01T03:12:00+02:00'),
    nextRainAtMs: at312!.nextRainAtMs,
    rainEndsAtMs: at312!.rainEndsAtMs,
    currentPrecipMm: at312!.currentPrecipMm,
  });
  assert(
    /^Regen in \d+ Min/.test(hud312 ?? ''),
    `HUD 03:12 Countdown, got ${hud312}`,
  );
  assert(!/^Regen noch /.test(hud312 ?? ''), 'nie „Regen noch“ wenn Punkt trocken');

  const at330 = parseBrightSkyRadarNowcast(pinRadar, {
    lat: 53.661,
    lng: 9.797,
    nowMs: Date.parse('2026-09-01T03:30:00+02:00'),
  });
  assert(at330 && at330.rainingNow, '03:30: Zelle über Punkt → rainingNow');
  const hud330 = formatRainHudLine({
    nowMs: Date.parse('2026-09-01T03:30:00+02:00'),
    nextRainAtMs: at330!.nextRainAtMs,
    rainEndsAtMs: at330!.rainEndsAtMs,
    currentPrecipMm: at330!.currentPrecipMm,
    rainingNow: undefined,
  });
  assert(
    /^(Starker |Leichter )?Regen noch \d+ Min$/.test(hud330 ?? '') || /^(Starker |Leichter )?Regen bis /.test(hud330 ?? ''),
    `HUD 03:30 während Regen, got ${hud330}`,
  );

  const at338 = parseBrightSkyRadarNowcast(pinRadar, {
    lat: 53.661,
    lng: 9.797,
    nowMs: Date.parse('2026-09-01T03:38:00+02:00'),
  });
  // Midpoint Ende 03:35/03:40 = 03:37:30 + Late-Clear 3 → 03:40:30
  const midEndPin = Math.round(
    (Date.parse('2026-09-01T03:35:00+02:00') +
      Date.parse('2026-09-01T03:40:00+02:00')) /
      2,
  );
  assert(
    at338 && at338.rainingNow,
    '03:38: Late-Clear hält rainingNow nach Zellen-Abzug',
  );
  assert(
    at338 && at338.rainEndsAtMs === midEndPin + RADAR_LATE_CLEAR_MS,
    `Ende = Midpoint-Ende + Late-Clear, got ${at338?.rainEndsAtMs}`,
  );

  const at350 = parseBrightSkyRadarNowcast(pinRadar, {
    lat: 53.661,
    lng: 9.797,
    nowMs: Date.parse('2026-09-01T03:50:00+02:00'),
  });
  assert(
    at350 && !at350.rainingNow && at350.nextRainAtMs == null,
    '03:50: Noise-Fleck 03:45 ignoriert → trocken',
  );

  assert(
    precipMmFromRadarUnits(29) === 0.29,
    '29 Units = 0.29 mm / 5 Min',
  );

  // OWM-Fake „schon nass“ via Weather-Code wird durch Radar-trocken entkräftet
  const cleared = applyGpsNowcastToTiming(
    {
      nextRainAtMs: Date.parse('2026-09-01T03:12:00+02:00'),
      rainStartsInMin: 0,
      rainEndsAtMs: Date.parse('2026-09-01T03:45:00+02:00'),
      currentPrecipMm: 0.5,
      currentWeatherId: 501,
      dayStableDry: false,
    },
    at312,
  );
  assert(cleared.currentPrecipMm === 0, 'Radar trocken → precip 0');
  assert(cleared.currentWeatherId === 803, 'OWM Regen-Code entkräftet');
  assert(!cleared.dayStableDry || cleared.nextRainAtMs != null, 'Warn bleibt');


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

  console.log('gpsRainNowcast.smoke.test.ts ok');
  console.log('  Pinneberg 03:12 HUD:', hud312);
  console.log('  Pinneberg 03:30 HUD:', hud330);
}

run();
