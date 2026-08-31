/**
 * Run: npx --yes tsx src/services/weather/weatherFetchGate.smoke.test.ts
 *
 * Nur Session/GPS-Gates — Stadt-Bounds ziehen RN und sind hier nicht nötig.
 */

import {
  canFetchLiveWeather,
  WEATHER_LIVE_AFTER_USE_MS,
} from './weatherFetchGate';
import {
  markRainWarnSessionStart,
  resetRainWarnSessionForTests,
} from './rainWarnSessionGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function run(): void {
  resetRainWarnSessionForTests();
  const t0 = 1_700_000_000_000;
  markRainWarnSessionStart(t0);

  const early = canFetchLiveWeather({
    lat: 53.55,
    lng: 10.0,
    cityId: 'hamburg',
    nowMs: t0 + 10 * 60_000,
  });
  assert(!early.ok && early.reason === 'session_too_short', 'unter 30 Min blockiert');

  const earlyBypass = canFetchLiveWeather({
    lat: 53.55,
    lng: 10.0,
    cityId: 'hamburg',
    nowMs: t0 + 10 * 60_000,
    bypassSession: true,
  });
  assert(
    earlyBypass.reason !== 'session_too_short',
    'bypassSession überspringt 30-Min-Gate',
  );

  const noGps = canFetchLiveWeather({
    lat: null,
    lng: null,
    nowMs: t0 + WEATHER_LIVE_AFTER_USE_MS + 1000,
  });
  assert(!noGps.ok && noGps.reason === 'no_gps', 'ohne GPS blockiert');

  console.log('weatherFetchGate.smoke.test.ts ok');
}

run();
