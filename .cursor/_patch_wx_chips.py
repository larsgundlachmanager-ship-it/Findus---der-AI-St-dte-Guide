# -*- coding: utf-8 -*-
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


# --- WeatherChatSnap ---
p = ROOT / "src/services/ui/weatherDayPlanSpeech.ts"
text = p.read_text(encoding="utf-8")
text = must_replace(
    text,
    """  rainWindows?: Array<{ startMs: number; endMs: number; pop: number }>;
};""",
    """  rainWindows?: Array<{ startMs: number; endMs: number; pop: number }>;
  /** Stunden-Wettercode (OWM oder WMO) für Zeitfenster-Chips */
  skyHours?: Array<{ ms: number; code: number }>;
};""",
    "snap skyHours",
)

HELPER = r'''
function skyWindowEmoji(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) return '⛅';
  if (code >= 200) {
    if (code >= 200 && code < 300) return '⛈️';
    if (code >= 520 && code <= 531) return '🌦️';
    if (code >= 300 && code < 600) return '🌧️';
    if (code >= 600 && code < 700) return '❄️';
    if (code === 800) return '☀️';
    if (code >= 801 && code <= 802) return '⛅';
    return '☁️';
  }
  if (code === 0) return '☀️';
  if (code <= 2) return '⛅';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  if (code <= 99) return '⛈️';
  return '⛅';
}

/** Morgen-Zeitfenster: Temp-Spanne, dann Icon + Uhr (letzte Phase „ab“). */
export function buildTomorrowTimelineChips(
  snap: WeatherChatSnap | null,
  nowMs = Date.now(),
): string[] {
  if (!snap) return [];
  const raw = (snap.tomorrowSummary || '').trim();
  const tempM = raw.match(/(-?\d+)\s*[–\-]\s*(-?\d+)\s*°/);
  const parsed = parseDaySummary(raw);
  const lo = tempM ? Number(tempM[1]) : null;
  const hi = parsed.highC;
  const chips: string[] = [];
  if (lo != null && hi != null && lo !== hi) chips.push(`🌡️ ${lo}° bis ${hi}°`);
  else if (hi != null) chips.push(`🌡️ bis ${hi}°`);
  else if (lo != null) chips.push(`🌡️ ${lo}°`);

  const day = new Date(nowMs);
  day.setDate(day.getDate() + 1);
  day.setHours(0, 0, 0, 0);
  const start = day.getTime();
  const end = start + 24 * 3600_000;
  const hours = (snap.skyHours ?? [])
    .filter((h) => h.ms >= start && h.ms < end)
    .filter((h) => {
      const hr = new Date(h.ms).getHours();
      return hr >= 6 && hr <= 23;
    })
    .sort((a, b) => a.ms - b.ms);

  type Win = { emoji: string; startH: number; endH: number };
  const wins: Win[] = [];
  for (const h of hours) {
    const emoji = skyWindowEmoji(h.code);
    const hr = new Date(h.ms).getHours();
    const last = wins[wins.length - 1];
    if (last && last.emoji === emoji && hr <= last.endH + 1) {
      last.endH = Math.max(last.endH, hr);
    } else {
      wins.push({ emoji, startH: hr, endH: hr });
    }
  }
  while (wins.length > 3) {
    let idx = 1;
    let best = Infinity;
    for (let i = 1; i < wins.length; i++) {
      const len = wins[i]!.endH - wins[i]!.startH;
      if (len < best) {
        best = len;
        idx = i;
      }
    }
    wins[idx - 1]!.endH = Math.max(wins[idx - 1]!.endH, wins[idx]!.endH);
    wins.splice(idx, 1);
  }
  for (let i = 0; i < wins.length; i++) {
    const w = wins[i]!;
    const last = i === wins.length - 1;
    const label = last
      ? `ab ${w.startH} Uhr`
      : `${w.startH} bis ${wins[i + 1]!.startH} Uhr`;
    chips.push(`${w.emoji} ${label}`);
  }
  return chips.slice(0, 4);
}

'''

text = must_replace(
    text,
    "function weekdayLabelDe(ms: number): string {",
    HELPER + "function weekdayLabelDe(ms: number): string {",
    "insert timeline chips",
)

text = must_replace(
    text,
    """    if (radio) {
      const bullets = buildWeatherFactChips({
        snap: snapForRain,
        nowMs,
        dayAhead: false,
        night: false,
      });
      return { speech: radio, bullets };
    }""",
    """    if (radio) {
      const timeline = buildTomorrowTimelineChips(snap, nowMs);
      const bullets = timeline.length
        ? timeline
        : buildWeatherFactChips({
            snap: snapForRain,
            nowMs,
            dayAhead: false,
            night: false,
          });
      return { speech: radio, bullets };
    }""",
    "general forecast chips",
)

text = must_replace(
    text,
    """  let bullets = buildWeatherFactChips({
    snap: fakeSnap,
    dayAhead: true,
    night: false,
    skyOverride: sky,
  });""",
    """  const timeline = buildTomorrowTimelineChips(snap, Date.now());
  let bullets = timeline.length
    ? timeline
    : buildWeatherFactChips({
        snap: fakeSnap,
        dayAhead: true,
        night: false,
        skyOverride: sky,
      });""",
    "tomorrow chat chips",
)
write_rplus(p, text)
print("speech ok")

# --- OWM ---
p = ROOT / "src/services/weather/openWeatherOneCall.ts"
text = p.read_text(encoding="utf-8")
text = must_replace(
    text,
    """  /** Böen m/s, nur belegt */
  windGustMs?: number | null;
};""",
    """  /** Böen m/s, nur belegt */
  windGustMs?: number | null;
  /** Stunden-Codes für Tages-Zeitfenster */
  skyHours?: Array<{ ms: number; code: number }>;
};""",
    "owm type",
)
text = must_replace(
    text,
    """    windSpeedMs,
    windGustMs,
  };
}""",
    """    windSpeedMs,
    windGustMs,
    skyHours: hourly
      .map((h) => ({
        ms: h.dt * 1000,
        code: h.weather?.[0]?.id ?? -1,
      }))
      .filter((h) => h.code >= 0)
      .slice(0, 48),
  };
}""",
    "owm return",
)
write_rplus(p, text)
print("owm ok")

# --- weatherService ---
p = ROOT / "src/services/weatherService.ts"
text = p.read_text(encoding="utf-8")
text = must_replace(
    text,
    """  /** Tiefstwert heute Nacht °C (jetzt bis morgen früh) */
  nightLowC?: number | null;
};""",
    """  /** Tiefstwert heute Nacht °C (jetzt bis morgen früh) */
  nightLowC?: number | null;
  /** Stunden-Wettercode für Zeitfenster-Chips */
  skyHours?: Array<{ ms: number; code: number }>;
};""",
    "snap type",
)
text = must_replace(
    text,
    """    windGustMs?: number | null;
    nightLowC?: number | null;
  },
  prev?: WeatherSnapshot | null,
): Promise<WeatherSnapshot> {""",
    """    windGustMs?: number | null;
    nightLowC?: number | null;
    skyHours?: Array<{ ms: number; code: number }>;
  },
  prev?: WeatherSnapshot | null,
): Promise<WeatherSnapshot> {""",
    "owm param",
)
text = must_replace(
    text,
    """    windGustMs:
      owm.windGustMs != null && Number.isFinite(owm.windGustMs)
        ? owm.windGustMs
        : prior?.windGustMs ?? null,""",
    """    windGustMs:
      owm.windGustMs != null && Number.isFinite(owm.windGustMs)
        ? owm.windGustMs
        : prior?.windGustMs ?? null,
    skyHours: owm.skyHours?.length ? owm.skyHours : prior?.skyHours,""",
    "snap assign",
)
old_meteo = """            windSpeedMs: meteo.windSpeedMs ?? null,
            windGustMs: meteo.windGustMs ?? null,
            nightLowC: meteo.nightLowC ?? null,"""
new_meteo = """            windSpeedMs: meteo.windSpeedMs ?? null,
            windGustMs: meteo.windGustMs ?? null,
            nightLowC: meteo.nightLowC ?? null,
            skyHours: meteo.skyHours ?? undefined,"""
if old_meteo not in text:
    raise SystemExit("missing meteo adapters")
text = text.replace(old_meteo, new_meteo)
write_rplus(p, text)
print("weatherService ok")

# --- open meteo ---
p = ROOT / "src/services/weather/openMeteoFallback.ts"
text = p.read_text(encoding="utf-8")
text = must_replace(
    text,
    """  windGustMs?: number | null;
  nightLowC: number | null;
};""",
    """  windGustMs?: number | null;
  nightLowC: number | null;
  skyHours?: Array<{ ms: number; code: number }>;
};""",
    "meteo type",
)
text = must_replace(
    text,
    """    precipitation_probability?: number[];
    precipitation?: number[];
  };""",
    """    precipitation_probability?: number[];
    precipitation?: number[];
    weather_code?: number[];
  };""",
    "hourly type",
)
text = must_replace(
    text,
    """      'temperature_2m,precipitation_probability,precipitation',""",
    """      'temperature_2m,precipitation_probability,precipitation,weather_code',""",
    "hourly query",
)
text = must_replace(
    text,
    """    windGustMs: null,
    nightLowC: nightLow,
  };
}""",
    """    windGustMs: null,
    nightLowC: nightLow,
    skyHours: (data.hourly?.time ?? [])
      .map((iso, i) => ({
        ms: Date.parse(iso ?? ''),
        code: Number(data.hourly?.weather_code?.[i]),
      }))
      .filter((h) => Number.isFinite(h.ms) && Number.isFinite(h.code))
      .slice(0, 48),
  };
}""",
    "meteo return",
)
write_rplus(p, text)
print("meteo ok")

# --- keep timeline chips through UI clamp ---
p = ROOT / "src/services/concierge/outfitWeatherPresent.ts"
text = p.read_text(encoding="utf-8")
text = must_replace(
    text,
    """export function finalizeOutfitWeatherBullets(
  bullets: string[],
  speech: string,
  opts?: { userText?: string | null },
): string[] {
  const rainAsk = looksLikeRainAsk(opts?.userText);""",
    """function isTomorrowTimelineChip(raw: string): boolean {
  const b = String(raw ?? '').replace(/\\s+/g, ' ').trim();
  if (!b) return false;
  return (
    /🌡/.test(b) ||
    /\\b\\d{1,2}\\s*°\\s*bis\\s*\\d{1,2}\\s*°/.test(b) ||
    /\\b(?:bis|ab)\\s+\\d{1,2}\\s*Uhr\\b/iu.test(b)
  );
}

export function finalizeOutfitWeatherBullets(
  bullets: string[],
  speech: string,
  opts?: { userText?: string | null },
): string[] {
  const timeline = (bullets ?? [])
    .map((b) => String(b ?? '').replace(/\\s+/g, ' ').trim())
    .filter(isTomorrowTimelineChip);
  if (timeline.length >= 2) return timeline.slice(0, 4);

  const rainAsk = looksLikeRainAsk(opts?.userText);""",
    "preserve timeline chips",
)
write_rplus(p, text)
print("outfit present ok")
