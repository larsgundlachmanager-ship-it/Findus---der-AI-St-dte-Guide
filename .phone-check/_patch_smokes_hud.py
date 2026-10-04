# -*- coding: utf-8 -*-
from pathlib import Path

# Update smoke tests
rain_smoke = Path("src/services/weather/rainIncomingPolicy.smoke.test.ts")
t = rain_smoke.read_text(encoding="utf-8")
t2 = t.replace("'Regen jetzt'", "'Aktuell Regen'")
# Gewitter-Code 200 → Intensität stark
t2 = t2.replace(
    ") === 'Regen noch 40 Min',\n    'Gewitter → noch Minuten (≤60), nicht Uhrzeit',",
    ") === 'Starker Regen noch 40 Min',\n    'Gewitter → starker Regen + noch Minuten (≤60)',",
)
needle = "  assert(\n    fallingLine === 'Regen noch 40 Min',\n    `Regen noch Minuten, got ${fallingLine}`,\n  );"
extra = """
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

"""
if "Starker Regen noch 25 Min" not in t2:
    if needle not in t2:
        raise SystemExit("fallingLine assert missing")
    t2 = t2.replace(needle, needle + "\n" + extra, 1)
tmp = Path(".phone-check/_rain_smoke.new.ts")
tmp.write_text(t2, encoding="utf-8")
rain_smoke.unlink(missing_ok=True)
tmp.replace(rain_smoke)
print("rain smoke updated")

# weatherDayPlanSpeech smoke - hudNow title may stay Regen noch 35 Min
wx = Path("src/services/ui/weatherDayPlanSpeech.smoke.test.ts")
wt = wx.read_text(encoding="utf-8")
# Add heavy rain hud assert after hudNow
needle = "assert(hudNow?.title === '🌧 Regen noch 35 Min', `falling title: ${hudNow?.title}`);"
extra = """
const hudHeavy = formatWeatherHudCard({
  snap: {
    currentTempC: 12,
    dayHighC: 14,
    precipitationMm: 4,
    isHeavyRain: true,
    rainEndsAtMs: Date.parse('2026-08-23T12:20:00'),
    weatherCode: 502,
  },
  nowMs: Date.parse('2026-08-23T12:00:00'),
});
assert(
  hudHeavy?.title === '🌧 Starker Regen noch 20 Min',
  `heavy falling: ${hudHeavy?.title}`,
);
assert(!/Jacke|Indoor|Schirm/i.test(hudHeavy?.meta ?? ''), 'no advice in rain meta');
"""
if "Starker Regen noch 20 Min" not in wt:
    if needle not in wt:
        raise SystemExit("hudNow assert missing")
    wt = wt.replace(needle, needle + "\n" + extra, 1)
    tmp = Path(".phone-check/_wx_smoke.new.ts")
    tmp.write_text(wt, encoding="utf-8")
    wx.unlink(missing_ok=True)
    tmp.replace(wx)
    print("wx smoke updated")
else:
    print("wx smoke already")

# liveHudPlacePin - dinner soft pitch gone
pin = Path("src/services/ui/liveHudPlacePin.smoke.test.ts")
pt = pin.read_text(encoding="utf-8")
pt2 = pt.replace(
    "assert(/title = 'Hunger\\?'/.test(mealSrc), 'Hunger?-Titel');",
    "assert(!/push\\(dinnerCard/.test(fs.readFileSync(path.join(dir, 'liveHudCards.ts'), 'utf8')), 'kein dinnerCard Soft-Pitch');\n"
    "assert(!/Burger lokal/.test(matrixSrc), 'Burger lokal nicht als HUD-Titel — gefiltert in Engine');\n"
    "// Meal-Modul darf intern existieren, darf aber nicht als Soft-Banner gepusht werden.",
)
# Wait - Burger lokal still in matrixSrc as title - filter is in engine not matrix.
# Fix assertion:
pt2 = pt.replace(
    "assert(/title = 'Hunger\\?'/.test(mealSrc), 'Hunger?-Titel');\n"
    "assert(/ranked\\.length >= 1/.test(mealSrc), 'nur ein Meal-Vorschlag');\n"
    "assert(!/· offen/.test(mealSrc), 'kein offen-Hinweis im Meal-HUD');",
    "const cardsSrc = fs.readFileSync(path.join(dir, 'liveHudCards.ts'), 'utf8');\n"
    "assert(!/push\\(dinnerCard/.test(cardsSrc), 'kein dinnerCard Soft-Pitch im Idle-HUD');\n"
    "assert(!/themes\\.has\\('dinner'\\)\\) push\\(dinnerCard/.test(cardsSrc), 'kein dinner Theme-Pitch');\n"
    "const engineSrc = fs.readFileSync(path.join(dir, 'proactiveHudEngine.ts'), 'utf8');\n"
    "assert(/sudden_rain_indoor/.test(engineSrc) && /profile_burger/.test(engineSrc), 'Soft-Pitch Filter vorhanden');\n"
    "assert(/Jacke mitnehmen\\|Regen möglich/.test(cardsSrc), 'Jacke/Regen Soft-Filter im HUD');\n",
)
if pt2 == pt:
    raise SystemExit("place pin smoke replace failed")
tmp = Path(".phone-check/_pin_smoke.new.ts")
tmp.write_text(pt2, encoding="utf-8")
pin.unlink(missing_ok=True)
tmp.replace(pin)
print("pin smoke updated")

# small dedicated smoke for soft pitch filter
smoke = Path("src/services/ui/liveHudRainFact.smoke.test.ts")
smoke.write_text(
    """/**
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

assert(!/Schirm\\/Indoor\\?/.test(engine), 'kein Schirm/Indoor Meta');
assert(!/Schirm dabei\\?/.test(engine), 'kein Schirm dabei Meta');
assert(/sudden_rain_indoor.*profile_burger|profile_burger.*sudden_rain_indoor/s.test(engine), 'Soft-Pitch IDs gefiltert');
assert(!/push\\(dinnerCard/.test(cards), 'kein dinner Soft-Push');
assert(!/Regen möglich — Jacke mitnehmen/.test(nice), 'kein Jacke-Outfit-Tipp');
assert(!/Schirm einpacken\\?/.test(nice), 'kein Schirm-Meta');

console.log('liveHudRainFact.smoke.test.ts ok');
""",
    encoding="utf-8",
)
print("wrote liveHudRainFact smoke")
