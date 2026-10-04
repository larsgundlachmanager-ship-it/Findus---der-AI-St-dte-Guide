/**
 * Live-HUD Regen = Fakt; Soft-Pitches (Jacke/Indoor/Burger) nicht im Banner.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/ui/liveHudRainFact.smoke.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { formatRainHudLine } from '../weather/rainIncomingPolicy';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const now = Date.parse('2026-08-23T12:00:00');
assert(
  formatRainHudLine({
    nowMs: now,
    currentPrecipMm: 4,
    isHeavyRain: true,
    rainEndsAtMs: now + 20 * 60_000,
  }) === 'Starker Regen noch 20 Min',
  'starker Regen Fakt',
);
assert(
  formatRainHudLine({ nowMs: now, currentPrecipMm: 0.8, weatherCode: 501 }) ===
    'Aktuell Regen',
  'aktuell Regen ohne Ende',
);

const ui = path.join(process.cwd(), 'src', 'services', 'ui');
const engine = fs.readFileSync(path.join(ui, 'proactiveHudEngine.ts'), 'utf8');
const cards = fs.readFileSync(path.join(ui, 'liveHudCards.ts'), 'utf8');
const nice = fs.readFileSync(path.join(ui, 'niceInfoScenarios.ts'), 'utf8');

assert(!/Schirm\/Indoor\?/.test(engine), 'kein Schirm/Indoor Meta');
assert(!/Schirm dabei\?/.test(engine), 'kein Schirm dabei Meta');
assert(/sudden_rain_indoor.*profile_burger|profile_burger.*sudden_rain_indoor/s.test(engine), 'Soft-Pitch IDs gefiltert');
assert(/push\(dinnerCard\(nowMs\)\)/.test(cards), 'konkrete Meal-Karte wieder aktiv');
assert(!/title: 'Mittagessen nah\?'/.test(cards), 'kein Soft-Placeholder-Mittag-Titel');
assert(
  /export function isClearishSunsetSky/.test(cards),
  'isClearishSunsetSky muss definiert sein (sonst HUD-Crash)',
);
assert(
  /isPrecipWeatherCode\(snap\.weatherCode\)/.test(cards),
  'sunsetSkyIsPoor nutzt isPrecipWeatherCode (nicht code>=51)',
);
assert(!/Regen möglich — Jacke mitnehmen/.test(nice), 'kein Jacke-Outfit-Tipp');
assert(!/Schirm einpacken\?/.test(nice), 'kein Schirm-Meta');

console.log('liveHudRainFact.smoke.test.ts ok');
