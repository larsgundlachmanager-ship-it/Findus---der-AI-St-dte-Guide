/**
 * Run: npx --yes tsx src/services/weather/rainIncomingPolicy.smoke.test.ts
 */

import {
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
} from './rainIncomingPolicy';
import { formatClockSpokenDe } from '../../utils/dateKeys';
import { nextWeatherPollDelayMs, WEATHER_POLL } from './weatherPollSchedule';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function clockLabel(ms: number): string {
  return formatClockSpokenDe(ms);
}

function run(): void {
  const now = 1_700_000_000_000;
  assert(
    isRainAlreadyFalling({ nowMs: now, currentPrecipMm: 0.4 }),
    'aktueller Niederschlag = schon nass',
  );
  assert(
    isRainAlreadyFalling({ nowMs: now, rainStartsInMin: 0 }),
    '0 Min = schon nass',
  );
  assert(
    isRainAlreadyFalling({
      nowMs: now,
      weatherCode: 501,
      nextRainAtMs: now + 25 * 60_000,
    }),
    'OWM Regen-Code ohne explizites 0 mm = schon nass',
  );
  assert(
    !isRainAlreadyFalling({
      nowMs: now,
      weatherCode: 80,
      currentPrecipMm: 0,
      nextRainAtMs: now + 38 * 60_000,
    }),
    'WMO 80 + 0 mm = nicht „regnet jetzt“',
  );
  assert(
    isPrecipWeatherCode(502) && isPrecipWeatherCode(95) && !isPrecipWeatherCode(800),
    'Precip-Codes OWM/WMO',
  );
  assert(
    !isRainAlreadyFalling({ nowMs: now, rainStartsInMin: 27, currentPrecipMm: 0 }),
    '27 Min bei Trockenheit = noch nicht nass',
  );
  assert(
    minutesUntilIncomingRain({
      nowMs: now,
      rainStartsInMin: 0,
      currentPrecipMm: 0.2,
    }) == null,
    'schon nass → keine Countdown-Warnung',
  );
  assert(
    minutesUntilIncomingRain({ nowMs: now, rainStartsInMin: 27 }) === 27,
    '27 Min Incoming',
  );
  assert(
    minutesUntilIncomingRain({
      nowMs: now,
      rainStartsInMin: 90,
      nextRainAtMs: now + 27 * 60_000,
    }) === 27,
    'nextRainAtMs schlägt stale rainStartsInMin (90→27)',
  );
  assert(
    formatRainHudLine({
      nowMs: now,
      weatherCode: 200,
      nextRainAtMs: now + 25 * 60_000,
      rainEndsAtMs: now + 40 * 60_000,
    }) === 'Starker Regen noch 40 Min',
    'Gewitter → starker Regen + noch Minuten (≤60)',
  );
  const dur = rainDurationMin(
    [{ startMs: now + 27 * 60_000, endMs: now + 27 * 60_000 + 15 * 60_000 }],
    now + 27 * 60_000,
    now,
  );
  assert(dur === 15, `Dauer 15 Min, got ${dur}`);

  const endMs = now + 40 * 60_000;
  const fallingLine = formatRainHudLine({
    nowMs: now,
    currentPrecipMm: 0.5,
    rainEndsAtMs: endMs,
  });
  assert(
    fallingLine === 'Regen noch 40 Min',
    `Regen noch Minuten, got ${fallingLine}`,
  );

  assert(
    formatRainHudLine({
      nowMs: now,
      currentPrecipMm: 3.2,
      isHeavyRain: true,
      rainEndsAtMs: now + 25 * 60_000,
    }) === 'Starker Regen noch 25 Min',
    'starker Regen + Restminuten',
  );
  assert(
    formatRainHudLine({
      nowMs: now,
      currentPrecipMm: 0.2,
      weatherCode: 61,
    }) === 'Aktuell leichter Regen',
    'leichter Regen ohne Ende',
  );
  assert(
    formatRainHudLine({
      nowMs: now,
      currentPrecipMm: 1.0,
      isHeavyRain: true,
    }) === 'Aktuell starker Regen',
    'starker Regen ohne Ende',
  );



  const longEnd = now + 90 * 60_000;
  assert(
    formatRainHudLine({
      nowMs: now,
      currentPrecipMm: 1,
      rainEndsAtMs: longEnd,
    }) === `Regen bis ${clockLabel(longEnd)}`,
    'Regen >60 Min Rest → Uhrzeit',
  );

  assert(
    formatRainHudLine({
      nowMs: now,
      nextRainAtMs: now + 30 * 60_000,
    }) === 'Regen in 30 Min',
    'countdown start 30 Min',
  );
  assert(
    formatRainHudLine({
      nowMs: now,
      nextRainAtMs: now + 25 * 60_000,
      rainEndsAtMs: now + 25 * 60_000 + 40 * 60_000,
    }) === 'Regen in 25 Min · Dauer ca. 40 Min',
    'countdown + Dauer klar als Länge',
  );
  assert(
    formatRainHudLine({
      nowMs: now + 5 * 60_000,
      nextRainAtMs: now + 30 * 60_000,
    }) === 'Regen in 25 Min',
    'countdown tickt mit nowMs (30→25)',
  );
  assert(
    formatRainHudLine({
      nowMs: now,
      nextRainAtMs: now + 3 * 60 * 60_000,
      rainEndsAtMs: now + 3 * 60 * 60_000 + 30 * 60_000,
    }) === `Regen ab ${clockLabel(now + 3 * 60 * 60_000)}`,
    'in 3 h → nur Regen ab Uhrzeit, keine Dauer',
  );
  assert(
    !/Dauer|ca\. \d+ Min/.test(
      formatRainHudLine({
        nowMs: now,
        nextRainAtMs: now + 75 * 60_000,
        rainEndsAtMs: now + 75 * 60_000 + 30 * 60_000,
      }) ?? '',
    ),
    '>60 Min bis Start → keine Dauer-Anzeige',
  );


  // Flatterpause < 30 Min ≠ Regenende
  const seriesBase = now;
  const flutter = [];
  for (let m = 0; m <= 80; m++) {
    const wet = m <= 35 || m >= 45; // 10 Min trocken
    flutter.push({ atMs: seriesBase + m * 60_000, wet });
  }
  assert(
    findSeriesRainEndMs({ samples: flutter }) == null,
    '10 Min Flatterpause → kein frühes Ende (Serie endet noch nass)',
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

  assert(
    nextWeatherPollDelayMs({
      rainingNow: false,
      dayStableDry: true,
      untilRainMs: null,
    }) === WEATHER_POLL.stableDryMs,
    'trocken → 60 Min',
  );
  assert(
    nextWeatherPollDelayMs({
      rainingNow: false,
      dayStableDry: false,
      untilRainMs: 45 * 60_000,
    }) === WEATHER_POLL.approachingMs,
    '45 Min → 10-Min-Poll',
  );
  assert(
    nextWeatherPollDelayMs({
      rainingNow: false,
      dayStableDry: false,
      untilRainMs: 12 * 60_000,
    }) === WEATHER_POLL.nearMs,
    '12 Min → 5-Min-Poll',
  );
  assert(
    nextWeatherPollDelayMs({
      rainingNow: false,
      dayStableDry: false,
      untilRainMs: 4 * 60_000,
    }) === WEATHER_POLL.imminentMs,
    '4 Min → 1-Min-Poll',
  );
  assert(
    nextWeatherPollDelayMs({
      rainingNow: true,
      dayStableDry: false,
      untilRainMs: null,
    }) === WEATHER_POLL.rainingMs,
    'regnet → 5-Min-Poll (Ende nachziehen)',
  );

  assert(isRainDontCareUtterance('Regen ist mir egal, weiter wie geplant'), 'egal');
  assert(!isRainDontCareUtterance('ist mir egal'), 'bare egal ohne Regen-Wort');
  assert(!isRainDontCareUtterance('Finde ein Café wegen Regen'), 'shelter nicht egal');
  assert(isRainShelterUtterance('Finde ein Café in der Nähe wegen Regen'), 'shelter');
  console.log('rainIncomingPolicy.smoke.test.ts ok');
}

run();
