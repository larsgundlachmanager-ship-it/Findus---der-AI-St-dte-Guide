# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
p = ROOT / "src/services/ui/weatherDayPlanSpeech.ts"
text = p.read_text(encoding="utf-8")


def write_rplus(path: Path, content: str) -> None:
    with path.open("r+", encoding="utf-8", newline="\n") as f:
        f.seek(0)
        f.write(content)
        f.truncate()


def must_replace(content: str, old: str, new: str, label: str) -> str:
    if old not in content:
        raise SystemExit(f"missing: {label}")
    return content.replace(old, new, 1)


text = must_replace(
    text,
    """  tomorrowSummary?: string | null;
  nightLowC?: number | null;
  weatherCode?: number | null;""",
    """  tomorrowSummary?: string | null;
  day2Summary?: string | null;
  windSpeedMs?: number | null;
  windGustMs?: number | null;
  nightLowC?: number | null;
  weatherCode?: number | null;""",
    "WeatherChatSnap fields",
)

HELPERS = r'''
type ForecastDayBit = {
  label: string;
  sky: string;
  rainy: boolean;
  highC: number | null;
};

function skyBucket(sky: string): string {
  const s = sky.toLowerCase();
  if (/schauer|regen|niesel|gewitter/.test(s)) return 'nass';
  if (/dicht|bewölkt|bewoelkt|wolken/.test(s) && !/sonne/.test(s)) return 'bewölkt';
  if (/sonne|klar|wolken und sonne|leicht/.test(s)) return 'sonnig';
  return s || 'wechselhaft';
}

function parseDaySummary(raw: string | null | undefined): {
  sky: string;
  rainy: boolean;
  highC: number | null;
} {
  const t = (raw || '').trim();
  const tempM = t.match(/(-?\d+)\s*[–\-]\s*(-?\d+)\s*°/);
  const untilM = t.match(/bis\s+(-?\d+)\s*°/i);
  const skyM = t.match(
    /(klar\s*\/\s*Sonne|klar|Sonne|bewölkt|bewoelkt|Wolken und Sonne|leicht bewölkt|Regen|Schauer|Niesel|Gewitter|Schnee|diesig|neblig|wechselhaft)[^,]*/i,
  );
  const rainM = t.match(/Regenrisiko\s+(\d+)\s*%/i);
  const rainPct = rainM ? Number(rainM[1]) : null;
  const sky = (skyM?.[0] || 'wechselhaft').trim();
  const rainy =
    (typeof rainPct === 'number' && rainPct >= 40) ||
    /regen|schauer|niesel|gewitter/i.test(sky);
  let highC: number | null = null;
  if (tempM) highC = Number(tempM[2]);
  else if (untilM) highC = Number(untilM[1]);
  return { sky, rainy, highC };
}

function weekdayLabelDe(ms: number): string {
  return new Date(ms).toLocaleDateString('de-DE', { weekday: 'long' });
}

function joinDayLabels(labels: string[]): string {
  if (!labels.length) return '';
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} und ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} und ${labels[labels.length - 1]}`;
}

function skySpeechPhrase(sky: string): string {
  const b = skyBucket(sky);
  if (b === 'bewölkt') return 'dicht bewölkt';
  if (b === 'sonnig') {
    if (/wolken und sonne|leicht/i.test(sky)) return 'zeitweiligen Sonnenschein';
    if (/klar/i.test(sky)) return 'überwiegend klar';
    return 'zeitweiligen Sonnenschein';
  }
  if (b === 'nass') return sky.toLowerCase();
  return sky.toLowerCase();
}

/** Allgemeine Vorhersage — Radio-/DWD-Struktur, Slots dynamisch. */
function formatGeneralForecastSpeech(opts: {
  snap: WeatherChatSnap;
  city?: string | null;
  namedCity?: boolean;
  nowMs: number;
}): string | null {
  const snap = opts.snap;
  const nowMs = opts.nowMs;
  const todaySky =
    skyPhraseFromCode(snap.weatherCode, { night: false }) || 'wechselhaft';
  const todayRain =
    (snap.nextRainProb ?? 0) >= 40 ||
    Boolean(snap.isHeavyRain) ||
    /regen|schauer/i.test(todaySky);
  const tom = parseDaySummary(snap.tomorrowSummary);
  const day2 = parseDaySummary(snap.day2Summary);
  const hasTom = Boolean((snap.tomorrowSummary || '').trim());
  const hasDay2 = Boolean((snap.day2Summary || '').trim());
  if (!hasTom && !hasDay2) return null;

  const days: ForecastDayBit[] = [
    {
      label: 'heute',
      sky: todaySky,
      rainy: todayRain,
      highC: roundDeg(snap.dayHighC),
    },
  ];
  if (hasTom) {
    days.push({
      label: 'morgen',
      sky: tom.sky,
      rainy: tom.rainy,
      highC: tom.highC,
    });
  }
  if (hasDay2) {
    days.push({
      label: `am ${weekdayLabelDe(nowMs + 2 * 24 * 3600_000)}`,
      sky: day2.sky,
      rainy: day2.rainy,
      highC: day2.highC,
    });
  }

  // Gruppe nach Himmel-Bucket
  const groups = new Map<string, ForecastDayBit[]>();
  for (const d of days) {
    const key = skyBucket(d.sky);
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const primary = ordered[0];
  const secondary = ordered.find((g) => g[0] !== primary?.[0]);

  const place =
    opts.namedCity && opts.city
      ? ` in ${opts.city}`
      : '';

  const sentences: string[] = [];
  if (primary && secondary) {
    const pLabels = joinDayLabels(primary[1].map((d) => d.label));
    const sLabels = joinDayLabels(secondary[1].map((d) => d.label));
    const pPhrase = skySpeechPhrase(primary[1][0]!.sky);
    const sPhrase = skySpeechPhrase(secondary[1][0]!.sky);
    // „gibt es … Sonnenschein“ vs „zeigt sich … bewölkt“
    const sVerb = /sonnenschein|klar/i.test(sPhrase)
      ? `gibt es ${sLabels} ${sPhrase}`
      : `zeigt sich ${sLabels} eher ${sPhrase}`;
    sentences.push(
      `Während sich das Wetter${place} ${pLabels} ${pPhrase} zeigt, ${sVerb}.`,
    );
  } else if (primary) {
    const pLabels = joinDayLabels(primary[1].map((d) => d.label));
    const pPhrase = skySpeechPhrase(primary[1][0]!.sky);
    sentences.push(
      `Das Wetter${place} zeigt sich ${pLabels} eher ${pPhrase}.`,
    );
  }

  const rainyLabels = days.filter((d) => d.rainy).map((d) => d.label);
  if (rainyLabels.length) {
    sentences.push(
      `Dabei muss ${joinDayLabels(rainyLabels)} mit Regenschauern gerechnet werden.`,
    );
  }

  const windMs = snap.windSpeedMs;
  const gustMs = snap.windGustMs;
  const windy =
    (typeof windMs === 'number' && windMs >= 8) ||
    (typeof gustMs === 'number' && gustMs >= 12);
  const highs = days
    .map((d) => d.highC)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const highAvg =
    highs.length > 0
      ? Math.round(highs.reduce((a, b) => a + b, 0) / highs.length)
      : roundDeg(snap.dayHighC);

  const tailBits: string[] = [];
  if (windy) {
    tailBits.push('weht ein böig auffrischender Wind');
  }
  if (highAvg != null) {
    tailBits.push(`werden Höchstwerte um ${highAvg} Grad erreicht`);
  }
  if (tailBits.length === 1) {
    sentences.push(`Dazu ${tailBits[0]}.`);
  } else if (tailBits.length === 2) {
    sentences.push(`Dazu ${tailBits[0]} und es ${tailBits[1]}.`);
  }

  const speech = sentences
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return speech || null;
}

'''

# Insert helpers before formatWeatherVoiceAnswer
text = must_replace(
    text,
    """export function formatWeatherVoiceAnswer(opts: {""",
    HELPERS + """export function formatWeatherVoiceAnswer(opts: {""",
    "insert helpers",
)

# Wire general forecast early after rainFocus detection
text = must_replace(
    text,
    """  const bits: string[] = [];
  if (dayAhead) {""",
    """  let generalForecast = false;
  try {
    const { weatherAskIsGeneralForecast } = require('../../module2/planning/planUtteranceGate') as {
      weatherAskIsGeneralForecast: (s: string) => boolean;
    };
    generalForecast = weatherAskIsGeneralForecast(opts.userText ?? '');
  } catch {
    generalForecast = /\\bwettervorhersage\\b/iu.test(opts.userText ?? '');
  }

  if (generalForecast && !rainFocus && !dayAhead) {
    const radio = formatGeneralForecastSpeech({
      snap,
      city,
      namedCity,
      nowMs,
    });
    if (radio) {
      const bullets = buildWeatherFactChips({
        snap: snapForRain,
        nowMs,
        dayAhead: false,
        night: false,
      });
      return { speech: radio, bullets };
    }
  }

  const bits: string[] = [];
  if (dayAhead) {""",
    "wire general forecast",
)

write_rplus(p, text)
print("weatherDayPlanSpeech ok")
