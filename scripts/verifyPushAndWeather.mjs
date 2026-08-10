/**
 * Local verification for push-reminder math + Open-Meteo weather routing.
 * Run: node scripts/verifyPushAndWeather.mjs
 */

const OPEN_METEO =
  'https://api.open-meteo.com/v1/forecast?latitude=53.676&longitude=9.766' +
  '&current_weather=true' +
  '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code' +
  '&forecast_days=1&timezone=auto';

const DEFAULT_SAFETY_BUFFER_MIN = 9;

function clampSafetyBufferMin(bufferMin) {
  if (bufferMin == null || !Number.isFinite(bufferMin)) {
    return DEFAULT_SAFETY_BUFFER_MIN;
  }
  return Math.min(10, Math.max(8, Math.round(bufferMin)));
}

function computeLeaveByMs(opts) {
  const now = opts.nowMs ?? Date.now();
  const safety = clampSafetyBufferMin(opts.safetyBufferMin);
  const walk = Math.max(0, Math.ceil(opts.walkEtaMinutes));
  const leaveByMs = opts.departureMs - (walk + safety) * 60_000;
  const leadMs = leaveByMs - now;
  const minLead = opts.minLeadMs ?? 15_000;
  if (leadMs < minLead) return null;
  return { leaveByMs, leadMs, safetyBufferMin: safety };
}

function buildTransitReminderBody(opts) {
  const line = (opts.line || 'Linie').replace(/\s+/g, ' ').trim();
  const mins = Math.max(1, Math.round(opts.minutesUntilDeparture));
  const station = opts.stationName?.trim();
  const where = station ? ` zur Haltestelle ${station}` : '';
  return (
    `Hey! Zeit aufzubrechen. Dein Bus/Bahn [${line}] kommt in ${mins} Minuten` +
    `${where}. Hast du schon gezahlt?`
  );
}

const HEAVY = new Set([63, 65, 67, 81, 82, 95, 96, 99]);
const RAIN = new Set([
  51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99,
]);

function isHeavyRainScenario({ weatherCode, precipitationMm }) {
  if (precipitationMm != null && precipitationMm > 2) return true;
  return weatherCode != null && HEAVY.has(Math.round(weatherCode));
}

function buildWeatherRoutingAdjustment(opts) {
  const weatherCode =
    opts.weatherCode != null && Number.isFinite(opts.weatherCode)
      ? Math.round(opts.weatherCode)
      : null;
  const precipitationMm =
    opts.precipitationMm != null && Number.isFinite(opts.precipitationMm)
      ? opts.precipitationMm
      : null;
  const isHeavyRain = isHeavyRainScenario({ weatherCode, precipitationMm });
  const isClearOrGood =
    !isHeavyRain &&
    !(weatherCode != null && RAIN.has(weatherCode)) &&
    (precipitationMm == null || precipitationMm < 0.2);
  const station = opts.stationName?.trim();
  if (isHeavyRain) {
    const covered = station
      ? ` Empfehle dir den überdachten Weg zur Bus-Haltestelle ${station}.`
      : ' Empfehle dir wenn möglich einen überdachten Weg zur Haltestelle.';
    const voiceAlert =
      `Draußen regnet es aktuell stark. Ich habe dir etwas mehr Laufzeit eingeplant.${covered}`;
    return {
      isHeavyRain: true,
      isClearOrGood: false,
      walkEtaMultiplier: 1.12,
      voiceAlert,
      promptBlock: `WETTER-ROUTING: Starkregen — ETA ×1.12. Voice: ${voiceAlert}`,
    };
  }
  return {
    isHeavyRain: false,
    isClearOrGood,
    walkEtaMultiplier: 1,
    voiceAlert: null,
    promptBlock:
      'WETTER-ROUTING: gutes/klares Wetter — Standard-Tempo.',
  };
}

function applyWalkEtaWeatherMultiplier(walkMinutes, multiplier) {
  const base = Math.max(1, Math.ceil(walkMinutes));
  if (!Number.isFinite(multiplier) || multiplier <= 1) return base;
  return Math.max(base, Math.ceil(base * multiplier));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  let failed = 0;
  const ok = (name) => console.log(`✓ ${name}`);
  const fail = (name, err) => {
    failed += 1;
    console.error(`✗ ${name}: ${err}`);
  };

  // 0) Shared cache key: many users → one slot
  try {
    function weatherCacheKey(opts) {
      const city = (opts.cityId ?? '').toString().trim().toLowerCase();
      if (city) return `city:${city}`;
      const lat = Math.round(opts.lat * 10) / 10;
      const lng = Math.round(opts.lng * 10) / 10;
      return `geo:${lat.toFixed(1)}:${lng.toFixed(1)}`;
    }
    assert(
      weatherCacheKey({ lat: 53.55, lng: 9.99, cityId: 'Hamburg' }) ===
        'city:hamburg',
      'city key',
    );
    assert(
      weatherCacheKey({ lat: 53.51, lng: 9.99 }) ===
        weatherCacheKey({ lat: 53.54, lng: 10.01 }),
      'nearby users share geo cell',
    );
    assert(
      weatherCacheKey({ lat: 53.55, lng: 9.99 }) !==
        weatherCacheKey({ lat: 52.52, lng: 13.4 }),
      'Berlin ≠ Hamburg cell',
    );
    ok('shared weather cache key (city / geo cell)');
  } catch (e) {
    fail('shared weather cache key (city / geo cell)', e.message);
  }

  // 1) Reminder math
  try {
    const now = Date.parse('2026-07-27T12:00:00Z');
    const departureMs = Date.parse('2026-07-27T12:30:00Z');
    const leave = computeLeaveByMs({
      departureMs,
      walkEtaMinutes: 8,
      safetyBufferMin: 9,
      nowMs: now,
    });
    assert(leave, 'leave-by should exist');
    // 30 - 8 - 9 = 13 min lead → leave at 12:13
    assert(
      leave.leaveByMs === Date.parse('2026-07-27T12:13:00Z'),
      `expected 12:13, got ${new Date(leave.leaveByMs).toISOString()}`,
    );
    assert(leave.safetyBufferMin === 9, 'safety buffer');
    assert(clampSafetyBufferMin(7) === 8, 'clamp low');
    assert(clampSafetyBufferMin(12) === 10, 'clamp high');

    const body = buildTransitReminderBody({
      line: 'RB61',
      minutesUntilDeparture: 12,
      stationName: 'Prisdorf',
    });
    assert(
      body.includes('RB61') &&
        body.includes('12 Minuten') &&
        body.includes('Hast du schon gezahlt'),
      `unexpected body: ${body}`,
    );

    const tooSoon = computeLeaveByMs({
      departureMs: now + 5 * 60_000,
      walkEtaMinutes: 8,
      safetyBufferMin: 9,
      nowMs: now,
    });
    assert(tooSoon == null, 'too soon should be null');
    ok('local push reminder math + payload');
  } catch (e) {
    fail('local push reminder math + payload', e.message);
  }

  // 2) Weather routing scenarios (offline)
  try {
    const heavy = buildWeatherRoutingAdjustment({
      weatherCode: 65,
      precipitationMm: 0.5,
      stationName: 'Prisdorf Bahnhof',
    });
    assert(heavy.isHeavyRain, 'code 65 is heavy');
    assert(heavy.walkEtaMultiplier === 1.12, 'multiplier');
    assert(
      heavy.voiceAlert?.includes('regnet es aktuell stark'),
      'voice alert missing',
    );
    assert(
      heavy.voiceAlert?.includes('überdachten Weg'),
      'covered path missing',
    );
    assert(applyWalkEtaWeatherMultiplier(10, 1.12) === 12, '10→12 min');

    const byPrecip = buildWeatherRoutingAdjustment({
      weatherCode: 0,
      precipitationMm: 2.5,
    });
    assert(byPrecip.isHeavyRain, 'precip > 2mm is heavy');

    const clear = buildWeatherRoutingAdjustment({
      weatherCode: 0,
      precipitationMm: 0,
    });
    assert(clear.isClearOrGood && clear.walkEtaMultiplier === 1, 'clear weather');
    assert(clear.voiceAlert == null, 'no voice on clear');
    ok('weather routing / voice context (offline scenarios)');
  } catch (e) {
    fail('weather routing / voice context (offline scenarios)', e.message);
  }

  // 3) Live Open-Meteo fetch
  try {
    const res = await fetch(OPEN_METEO);
    assert(res.ok, `HTTP ${res.status}`);
    const data = await res.json();
    assert(data.current_weather != null, 'current_weather missing');
    assert(
      typeof data.current_weather.weathercode === 'number',
      'weathercode missing',
    );
    assert(Array.isArray(data.hourly?.weather_code), 'hourly weather_code');
    assert(Array.isArray(data.hourly?.precipitation), 'hourly precipitation');

    const code = data.current_weather.weathercode;
    const precip = data.hourly.precipitation?.[0] ?? 0;
    const routing = buildWeatherRoutingAdjustment({
      weatherCode: code,
      precipitationMm: precip,
      stationName: 'Prisdorf',
    });
    console.log(
      `  Open-Meteo live: weathercode=${code}, precip≈${precip} mm → ` +
        `heavy=${routing.isHeavyRain}, ETA×${routing.walkEtaMultiplier}`,
    );
    if (routing.voiceAlert) {
      console.log(`  Voice: ${routing.voiceAlert}`);
    } else {
      console.log(`  Voice: (standard pacing — ${routing.promptBlock})`);
    }
    ok('Open-Meteo forecast fetch + weathercode parse');
  } catch (e) {
    fail('Open-Meteo forecast fetch + weathercode parse', e.message);
  }

  // 4) Simulated scheduled notification timeline
  try {
    const now = Date.now();
    const walk = 8;
    const safety = 9;
    const departureMs = now + (walk + safety + 5) * 60_000;
    const leave = computeLeaveByMs({
      departureMs,
      walkEtaMinutes: walk,
      safetyBufferMin: safety,
      nowMs: now,
    });
    assert(leave, 'simulated leave');
    const fireInSec = Math.round(leave.leadMs / 1000);
    assert(fireInSec >= 4 * 60 && fireInSec <= 6 * 60, `fireIn=${fireInSec}s`);
    console.log(
      `  Simulated OS notification would fire in ~${fireInSec}s ` +
        `(leave-by ${new Date(leave.leaveByMs).toISOString()}, ` +
        `departure ${new Date(departureMs).toISOString()})`,
    );
    ok('simulated local notification schedule timing');
  } catch (e) {
    fail('simulated local notification schedule timing', e.message);
  }

  console.log('');
  if (failed) {
    console.error(`FAILED: ${failed} check(s)`);
    process.exit(1);
  }
  console.log('All verification checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
