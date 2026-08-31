/**
 * Run: npx --yes tsx src/services/weather/gpsRainNowcast.smoke.test.ts
 */

import {
  applyGpsNowcastToTiming,
  maxNearTermRainPopPct,
  parseGpsRainNowcast,
  shouldFetchGpsRainNowcast,
} from './gpsRainNowcast';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
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
    '20% Pop → kein Check',
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
    }),
    '55% aber Probe vor 2 Min → noch warten',
  );

  assert(
    shouldFetchGpsRainNowcast({
      nowMs: now,
      lastGpsNowcastAtMs: now - 16 * 60_000,
      maxNearPopPct: 55,
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
  assert(soon && soon.nextRainAtMs === Date.parse('2026-08-28T20:45'), 'Regen ab 20:45');
  assert(soon && soon.rainStartsInMin === 23, `StartsIn ~23, got ${soon?.rainStartsInMin}`);

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

  console.log('gpsRainNowcast.smoke.test.ts ok');
}

run();
