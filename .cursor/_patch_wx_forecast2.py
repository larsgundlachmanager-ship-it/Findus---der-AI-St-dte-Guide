# -*- coding: utf-8 -*-
"""Patch weather data + radio forecast speech."""
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def write_rplus(path: Path, text: str) -> None:
    with path.open("r+", encoding="utf-8", newline="\n") as f:
        f.seek(0)
        f.write(text)
        f.truncate()


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing: {label}")
    return text.replace(old, new, 1)


# --- planUtteranceGate ---
p = ROOT / "src/module2/planning/planUtteranceGate.ts"
text = p.read_text(encoding="utf-8")
old = """/** Morgen/Übermorgen -- nicht den Jetzt-Snap als ganze Antwort nehmen. */
export function weatherAskIsFutureDay(text: string): boolean {
  const t = (text ?? '').replace(/\\s+/g, ' ').trim();
  if (!t) return false;
  if (/\\bheut(?:e)?\\s+morgen\\b/iu.test(t)) return false;
  return /\\b(morgen|übermorgen|uebermorgen)\\b/iu.test(t);
}"""
new = """/** Morgen/Übermorgen -- nicht den Jetzt-Snap als ganze Antwort nehmen. */
export function weatherAskIsFutureDay(text: string): boolean {
  const t = (text ?? '').replace(/\\s+/g, ' ').trim();
  if (!t) return false;
  if (/\\bheut(?:e)?\\s+morgen\\b/iu.test(t)) return false;
  return /\\b(morgen|übermorgen|uebermorgen)\\b/iu.test(t);
}

/** Allgemeine Mehrtages-Vorhersage (Radio-Stil) — nicht Slot/Jetzt/Regen-only. */
export function weatherAskIsGeneralForecast(text: string): boolean {
  const t = (text ?? '').replace(/\\s+/g, ' ').trim();
  if (!t) return false;
  if (weatherAskIsFutureDay(t)) return false;
  if (weatherAskIsImmediateNow(t)) return false;
  if (/\\b(anzieh(?:en)?|outfit|kleidung|was\\s+soll\\s+ich\\s+an)\\b/iu.test(t)) {
    return false;
  }
  const rainOnly =
    /\\b(regnet|regnen|regen|schauer|schirm)\\b/iu.test(t) &&
    !/\\b(wetter|wettervorhersage)\\b/iu.test(t);
  if (rainOnly) return false;
  if (/\\bwettervorhersage\\b/iu.test(t)) return true;
  if (/\\bwochenende\\b/iu.test(t) && /\\bwetter\\b/iu.test(t)) return true;
  if (/\\bwie\\s+(?:wird|ist)\\s+(?:das\\s+)?wetter\\b/iu.test(t)) {
    // „heute“ allein = Tagesfrage, kein Mehrtages-Radio
    if (/\\bheut(?:e|en)\\b/iu.test(t) && !/\\b(morgen|wochenende|tage)\\b/iu.test(t)) {
      return false;
    }
    return true;
  }
  // Nacktes „Wetter?“ / „Wetter bitte“ ohne Slot
  return (
    /\\bwetter\\b/iu.test(t) &&
    !/\\bheut(?:e|en)\\b/iu.test(t) &&
    t.split(/\\s+/).length <= 6
  );
}"""
text = must_replace(text, old, new, "weatherAskIsGeneralForecast insert")

old = """    rainAsk
      ? '- REGEN-FRAGE: Speech ZUERST nur Regen (ja/nein + Timing belegt). Temp optional danach. Kein Outfit-Essay, keine Navigation, kein Extra-Pitch.'
      : '- Speech immer (nur belegt, nie erfinden): Himmel, Temperatur von–bis oder Spitze, wann Regen/Schauer — kurze VOLLE Sätze. KEINE Kleidungsvorschläge bei reiner Wetterfrage (nur wenn Outfit/Anziehen gefragt).',"""
new = """    rainAsk
      ? '- REGEN-FRAGE: Speech ZUERST nur Regen (ja/nein + Timing belegt). Temp optional danach. Kein Outfit-Essay, keine Navigation, kein Extra-Pitch.'
      : weatherAskIsGeneralForecast(text ?? '')
        ? '- ALLGEMEINE VORHERSAGE: 2–3 Fließsätze Radio-Stil — Himmel über heute/morgen/Tag+2 kontrastieren, Schauer den Tagen zuordnen, Wind nur belegt+spürbar, Höchst am Ende. Kein Telegramm/Prozent.'
        : '- Speech immer (nur belegt, nie erfinden): Himmel, Temperatur von–bis oder Spitze, wann Regen/Schauer — kurze VOLLE Sätze. KEINE Kleidungsvorschläge bei reiner Wetterfrage (nur wenn Outfit/Anziehen gefragt).',"""
text = must_replace(text, old, new, "lookup tips general")
write_rplus(p, text)
print("planUtteranceGate ok")

# --- openWeatherOneCall ---
p = ROOT / "src/services/weather/openWeatherOneCall.ts"
text = p.read_text(encoding="utf-8")
text = must_replace(
    text,
    """  current?: {
    temp?: number;
    sunrise?: number;
    sunset?: number;
    weather?: Array<{ id: number; description: string }>;
    rain?: { '1h'?: number };
  };""",
    """  current?: {
    temp?: number;
    sunrise?: number;
    sunset?: number;
    weather?: Array<{ id: number; description: string }>;
    rain?: { '1h'?: number };
    wind_speed?: number;
    wind_gust?: number;
  };""",
    "owm current wind",
)
text = must_replace(
    text,
    """  /** Morgen kurz, nur belegt */
  tomorrowSummary?: string | null;
};""",
    """  /** Morgen kurz, nur belegt */
  tomorrowSummary?: string | null;
  /** Übermorgen / Tag+2 kurz, nur belegt */
  day2Summary?: string | null;
  /** Wind m/s (current), nur belegt */
  windSpeedMs?: number | null;
  /** Böen m/s, nur belegt */
  windGustMs?: number | null;
};""",
    "owm result fields",
)
text = must_replace(
    text,
    """function buildTomorrowSummary(opts: {
  daily?: Array<{
    dt?: number;
    temp?: { min?: number; max?: number };
    weather?: Array<{ id?: number; description?: string }>;
    pop?: number;
  }>;
  hourly: OwmHourly[];
  nowMs: number;
}): string | null {
  const day = opts.daily?.[1];
  if (day?.temp) {
    const lo = day.temp.min;
    const hi = day.temp.max;
    const wid = day.weather?.[0]?.id ?? null;
    const popPct =
      typeof day.pop === 'number' && Number.isFinite(day.pop)
        ? Math.round(day.pop * 100)
        : null;
    const bits: string[] = [];
    if (
      typeof lo === 'number' &&
      typeof hi === 'number' &&
      Number.isFinite(lo) &&
      Number.isFinite(hi)
    ) {
      bits.push(`${Math.round(lo)}–${Math.round(hi)}°`);
    } else if (typeof hi === 'number' && Number.isFinite(hi)) {
      bits.push(`bis ${Math.round(hi)}°`);
    }
    const sky = owmSkyBit(wid);
    if (sky) bits.push(sky);
    if (popPct != null && popPct >= 30) {
      bits.push(`Regenrisiko ${popPct}%`);
    }
    if (bits.length) return bits.join(', ');
  }

  // Fallback: Hourly 24–48 h
  const start = opts.nowMs + 20 * 3600_000;
  const end = opts.nowMs + 44 * 3600_000;
  const slice = opts.hourly.filter((h) => {
    const t = h.dt * 1000;
    return t >= start && t <= end;
  });
  if (!slice.length) return null;
  let lo: number | null = null;
  let hi: number | null = null;
  let maxPop = 0;
  let skyId: number | null = null;
  for (const h of slice) {
    if (typeof h.temp === 'number' && Number.isFinite(h.temp)) {
      lo = lo == null ? h.temp : Math.min(lo, h.temp);
      hi = hi == null ? h.temp : Math.max(hi, h.temp);
    }
    maxPop = Math.max(maxPop, h.pop ?? 0);
    const id = h.weather?.[0]?.id;
    if (typeof id === 'number') skyId = id;
  }
  const bits: string[] = [];
  if (lo != null && hi != null) bits.push(`${Math.round(lo)}–${Math.round(hi)}°`);
  const sky = owmSkyBit(skyId);
  if (sky) bits.push(sky);
  const popPct = Math.round(maxPop * 100);
  if (popPct >= 30) bits.push(`Regenrisiko ${popPct}%`);
  return bits.length ? bits.join(', ') : null;
}""",
    """function buildDailySummaryFromDay(day: {
  temp?: { min?: number; max?: number };
  weather?: Array<{ id?: number; description?: string }>;
  pop?: number;
} | undefined): string | null {
  if (!day?.temp) return null;
  const lo = day.temp.min;
  const hi = day.temp.max;
  const wid = day.weather?.[0]?.id ?? null;
  const popPct =
    typeof day.pop === 'number' && Number.isFinite(day.pop)
      ? Math.round(day.pop * 100)
      : null;
  const bits: string[] = [];
  if (
    typeof lo === 'number' &&
    typeof hi === 'number' &&
    Number.isFinite(lo) &&
    Number.isFinite(hi)
  ) {
    bits.push(`${Math.round(lo)}–${Math.round(hi)}°`);
  } else if (typeof hi === 'number' && Number.isFinite(hi)) {
    bits.push(`bis ${Math.round(hi)}°`);
  }
  const sky = owmSkyBit(wid);
  if (sky) bits.push(sky);
  if (popPct != null && popPct >= 30) {
    bits.push(`Regenrisiko ${popPct}%`);
  }
  return bits.length ? bits.join(', ') : null;
}

function buildTomorrowSummary(opts: {
  daily?: Array<{
    dt?: number;
    temp?: { min?: number; max?: number };
    weather?: Array<{ id?: number; description?: string }>;
    pop?: number;
  }>;
  hourly: OwmHourly[];
  nowMs: number;
  dayIndex?: number;
}): string | null {
  const idx = opts.dayIndex ?? 1;
  const fromDaily = buildDailySummaryFromDay(opts.daily?.[idx]);
  if (fromDaily) return fromDaily;

  // Fallback: Hourly window for dayIndex (1=morgen, 2=übermorgen)
  const start = opts.nowMs + (20 + (idx - 1) * 24) * 3600_000;
  const end = opts.nowMs + (44 + (idx - 1) * 24) * 3600_000;
  const slice = opts.hourly.filter((h) => {
    const t = h.dt * 1000;
    return t >= start && t <= end;
  });
  if (!slice.length) return null;
  let lo: number | null = null;
  let hi: number | null = null;
  let maxPop = 0;
  let skyId: number | null = null;
  for (const h of slice) {
    if (typeof h.temp === 'number' && Number.isFinite(h.temp)) {
      lo = lo == null ? h.temp : Math.min(lo, h.temp);
      hi = hi == null ? h.temp : Math.max(hi, h.temp);
    }
    maxPop = Math.max(maxPop, h.pop ?? 0);
    const id = h.weather?.[0]?.id;
    if (typeof id === 'number') skyId = id;
  }
  const bits: string[] = [];
  if (lo != null && hi != null) bits.push(`${Math.round(lo)}–${Math.round(hi)}°`);
  const sky = owmSkyBit(skyId);
  if (sky) bits.push(sky);
  const popPct = Math.round(maxPop * 100);
  if (popPct >= 30) bits.push(`Regenrisiko ${popPct}%`);
  return bits.length ? bits.join(', ') : null;
}""",
    "buildTomorrowSummary refactor",
)

# find tomorrowSummary assignment and add day2 + wind
text = must_replace(
    text,
    """  const tomorrowSummary = buildTomorrowSummary({
    daily: data.daily,
    hourly,
    nowMs: now,
  });""",
    """  const tomorrowSummary = buildTomorrowSummary({
    daily: data.daily,
    hourly,
    nowMs: now,
    dayIndex: 1,
  });
  const day2Summary = buildTomorrowSummary({
    daily: data.daily,
    hourly,
    nowMs: now,
    dayIndex: 2,
  });
  const windSpeedMs =
    typeof data.current?.wind_speed === 'number' &&
    Number.isFinite(data.current.wind_speed)
      ? data.current.wind_speed
      : null;
  const windGustMs =
    typeof data.current?.wind_gust === 'number' &&
    Number.isFinite(data.current.wind_gust)
      ? data.current.wind_gust
      : null;""",
    "tomorrow+day2+wind assign",
)

text = must_replace(
    text,
    """    tomorrowSummary ? `Morgen: ${tomorrowSummary}` : '',
  ]
    .filter(Boolean)
    .join('\\n');""",
    """    tomorrowSummary ? `Morgen: ${tomorrowSummary}` : '',
    day2Summary ? `Übermorgen: ${day2Summary}` : '',
    windSpeedMs != null
      ? `Wind ~${Math.round(windSpeedMs)} m/s${
          windGustMs != null ? `, Böen ~${Math.round(windGustMs)} m/s` : ''
        }`
      : '',
  ]
    .filter(Boolean)
    .join('\\n');""",
    "promptBlock day2 wind",
)

text = must_replace(
    text,
    """    dayHighC: dayHigh,
    tomorrowSummary,
  };
}""",
    """    dayHighC: dayHigh,
    tomorrowSummary,
    day2Summary,
    windSpeedMs,
    windGustMs,
  };
}""",
    "return day2 wind",
)
write_rplus(p, text)
print("openWeatherOneCall ok")

print("partial done")
