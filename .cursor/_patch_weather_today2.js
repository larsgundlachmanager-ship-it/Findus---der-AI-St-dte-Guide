const fs = require('fs');
const p = 'src/services/ui/weatherDayPlanSpeech.ts';
let s = fs.readFileSync(p, 'utf8');
const old = `    if (radio) {
      const timeline = buildTomorrowTimelineChips(snap, nowMs);
      const bullets =
        timeline.length >= 2
          ? timeline
          : buildWeatherFactChips({
            snap: snapForRain,
            nowMs,
            dayAhead: false,
            night: false,
          });
      return { speech: radio, bullets };
    }`;
const neu = `    if (radio) {
      const todayParts = buildTodayDayPartChips(snap, nowMs);
      const timeline = buildTomorrowTimelineChips(snap, nowMs);
      const bullets =
        todayParts.length >= 3
          ? todayParts
          : timeline.length >= 2
            ? timeline
            : buildWeatherFactChips({
              snap: snapForRain,
              nowMs,
              dayAhead: false,
              night: false,
            });
      return { speech: radio, bullets };
    }`;
if (!s.includes(old)) {
  console.log('block not found');
  process.exit(1);
}
s = s.replace(old, neu);
const tmp = p + '.tmp';
fs.writeFileSync(tmp, s);
fs.renameSync(tmp, p);
console.log('general forecast today parts ok');
