const fs = require('fs');
const p = 'src/services/ui/weatherDayPlanSpeech.ts';
let s = fs.readFileSync(p, 'utf8');
const marker = '  const bullets = buildWeatherFactChips({\n    snap: snapForRain,\n    nowMs,\n    dayAhead,\n    night,\n  });\n\n  return { speech, bullets };\n}';
const neu = `  const bulletsRaw = (() => {
    if (dayAhead || generalForecast) {
      const dayParts = buildTodayDayPartChips(snap, nowMs);
      if (dayParts.length >= 3) return dayParts;
    }
    return buildWeatherFactChips({
      snap: snapForRain,
      nowMs,
      dayAhead,
      night,
    });
  })();
  const bullets = bulletsRaw.map((b) => {
    try {
      const { compactBulletDigits } = require('../concierge/bulletDigits');
      return compactBulletDigits(b);
    } catch {
      return b;
    }
  });

  return { speech, bullets };
}`;
if (!s.includes(marker)) {
  console.log('marker not found');
  const idx = s.indexOf('const bullets = buildWeatherFactChips');
  console.log('idx', idx, s.slice(idx, idx + 200));
  process.exit(1);
}
s = s.replace(marker, neu);
const tmp = p + '.tmp';
fs.writeFileSync(tmp, s);
fs.renameSync(tmp, p);
console.log('ok');
