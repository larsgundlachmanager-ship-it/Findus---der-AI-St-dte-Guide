/**
 * Magazin-Wetterzeile (Format + Cover).
 * Run: npx --yes --package tsx@4.19.4 tsx src/reisebuero/research/destinationTripWeather.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { formatDestWeatherLine } from './destinationTripWeather';
import { buildCoverSubline } from './storyMagazine';
import { cloneEmptyLedger, entry, mergeLedger } from '../slotLedger';

{
  const line = formatDestWeatherLine({
    highC: 29.4,
    lowC: 23.1,
    weatherCode: 0,
    kind: 'forecast',
  });
  assert.match(line, /23–29°/);
  assert.match(line, /klar|☀️/);
  assert.ok(!/typisch/i.test(line), 'forecast not typical');
}

{
  const line = formatDestWeatherLine({
    highC: 18,
    lowC: 12,
    weatherCode: 61,
    kind: 'typical',
  });
  assert.match(line, /typisch/);
  assert.match(line, /12–18°/);
  assert.match(line, /Regen/);
}

{
  const led = mergeLedger(cloneEmptyLedger(), {
    dateStart: entry('2026-10-16', 'user', 'must'),
    dateEnd: entry('2026-10-19', 'user', 'wish'),
  });
  const sub = buildCoverSubline(
    {
      placeName: 'Antalya, Türkei',
      weatherLine: '☀️ 24–30° · klar',
    } as any,
    led,
  );
  assert.match(sub, /16\.10/);
  assert.match(sub, /Antalya/);
  // Wetter nur einmal (Facts/Chip) — nicht in Cover-Subline
  assert.doesNotMatch(sub, /24–30°/);
}

console.log('destinationTripWeather.smoke.test.ts: ok');
