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


# --- openMeteoFallback ---
p = ROOT / "src/services/weather/openMeteoFallback.ts"
text = p.read_text(encoding="utf-8")
text = must_replace(
    text,
    """  dayHighC: number | null;
  tomorrowSummary: string | null;
  nightLowC: number | null;
};""",
    """  dayHighC: number | null;
  tomorrowSummary: string | null;
  day2Summary?: string | null;
  windSpeedMs?: number | null;
  windGustMs?: number | null;
  nightLowC: number | null;
};""",
    "meteo type fields",
)

text = must_replace(
    text,
    """  current?: {
    temperature_2m?: number;
    weather_code?: number;
    precipitation?: number;
    time?: string;
  };""",
    """  current?: {
    temperature_2m?: number;
    weather_code?: number;
    precipitation?: number;
    wind_speed_10m?: number;
    time?: string;
  };""",
    "meteo current type wind",
)

text = must_replace(
    text,
    """  let tomorrowSummary: string | null = null;
  if (dailyTimes.length >= 2) {
    const hi = Number(dailyMax[1]);
    const lo = Number(dailyMin[1]);
    const codeT = Number(dailyCode[1]);
    const popT = Number(dailyPop[1]);
    const bits: string[] = [];
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      bits.push(`${Math.round(lo)}–${Math.round(hi)}°`);
    } else if (Number.isFinite(hi)) {
      bits.push(`bis ${Math.round(hi)}°`);
    }
    if (Number.isFinite(codeT)) bits.push(wmoLabel(codeT));
    if (Number.isFinite(popT) && popT >= 30) {
      bits.push(`Regenrisiko ${Math.round(popT)}%`);
    }
    if (bits.length) tomorrowSummary = bits.join(', ');
  }""",
    """  const dailySummaryAt = (idx: number): string | null => {
    if (dailyTimes.length <= idx) return null;
    const hi = Number(dailyMax[idx]);
    const lo = Number(dailyMin[idx]);
    const codeT = Number(dailyCode[idx]);
    const popT = Number(dailyPop[idx]);
    const bits: string[] = [];
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      bits.push(`${Math.round(lo)}–${Math.round(hi)}°`);
    } else if (Number.isFinite(hi)) {
      bits.push(`bis ${Math.round(hi)}°`);
    }
    if (Number.isFinite(codeT)) bits.push(wmoLabel(codeT));
    if (Number.isFinite(popT) && popT >= 30) {
      bits.push(`Regenrisiko ${Math.round(popT)}%`);
    }
    return bits.length ? bits.join(', ') : null;
  };
  const tomorrowSummary = dailySummaryAt(1);
  const day2Summary = dailySummaryAt(2);
  const windSpeedMs =
    typeof data.current?.wind_speed_10m === 'number' &&
    Number.isFinite(data.current.wind_speed_10m)
      ? data.current.wind_speed_10m
      : null;""",
    "meteo daily 1+2",
)

text = must_replace(
    text,
    """    tomorrowSummary,
  ]
    .filter(Boolean)
    .join('\\n');""",
    """    tomorrowSummary,
    day2Summary,
    windSpeedMs != null ? `Wind ~${Math.round(windSpeedMs)} m/s` : null,
  ]
    .filter(Boolean)
    .join('\\n');""",
    "meteo prompt",
)

text = must_replace(
    text,
    """    dayHighC: dayHigh,
    tomorrowSummary,
    nightLowC: nightLow,
  };
}""",
    """    dayHighC: dayHigh,
    tomorrowSummary,
    day2Summary,
    windSpeedMs,
    windGustMs: null,
    nightLowC: nightLow,
  };
}""",
    "meteo return",
)
write_rplus(p, text)
print("openMeteo ok")

# --- weatherService ---
p = ROOT / "src/services/weatherService.ts"
text = p.read_text(encoding="utf-8")
text = must_replace(
    text,
    """  /** Morgen kurz, nur belegt */
  tomorrowSummary?: string | null;
  /** Tiefstwert heute Nacht °C (jetzt bis morgen früh) */
  nightLowC?: number | null;
};""",
    """  /** Morgen kurz, nur belegt */
  tomorrowSummary?: string | null;
  /** Übermorgen / Tag+2 kurz, nur belegt */
  day2Summary?: string | null;
  /** Wind m/s */
  windSpeedMs?: number | null;
  /** Böen m/s */
  windGustMs?: number | null;
  /** Tiefstwert heute Nacht °C (jetzt bis morgen früh) */
  nightLowC?: number | null;
};""",
    "snap type",
)

# meteo merge paths - tomorrowSummary lines
for label, old, new in [
    (
        "meteo force path",
        """            tomorrowSummary: meteo.tomorrowSummary ?? null,""",
        """            tomorrowSummary: meteo.tomorrowSummary ?? null,
            day2Summary: meteo.day2Summary ?? null,
            windSpeedMs: meteo.windSpeedMs ?? null,
            windGustMs: meteo.windGustMs ?? null,""",
    ),
]:
    # replace_all for duplicate meteo blocks
    if old not in text:
        raise SystemExit(f"missing: {label}")
    text = text.replace(old, new)  # both occurrences

text = must_replace(
    text,
    """    dayHighC?: number | null;
    tomorrowSummary?: string | null;
    nightLowC?: number | null;
  },
  prev?: WeatherSnapshot | null,
): Promise<WeatherSnapshot> {""",
    """    dayHighC?: number | null;
    tomorrowSummary?: string | null;
    day2Summary?: string | null;
    windSpeedMs?: number | null;
    windGustMs?: number | null;
    nightLowC?: number | null;
  },
  prev?: WeatherSnapshot | null,
): Promise<WeatherSnapshot> {""",
    "applyOwm param",
)

text = must_replace(
    text,
    """    tomorrowSummary: owm.tomorrowSummary ?? prior?.tomorrowSummary ?? null,
    nightLowC:
      owm.nightLowC != null && Number.isFinite(owm.nightLowC)
        ? owm.nightLowC
        : prior?.nightLowC ?? null,
  };""",
    """    tomorrowSummary: owm.tomorrowSummary ?? prior?.tomorrowSummary ?? null,
    day2Summary: owm.day2Summary ?? prior?.day2Summary ?? null,
    windSpeedMs:
      owm.windSpeedMs != null && Number.isFinite(owm.windSpeedMs)
        ? owm.windSpeedMs
        : prior?.windSpeedMs ?? null,
    windGustMs:
      owm.windGustMs != null && Number.isFinite(owm.windGustMs)
        ? owm.windGustMs
        : prior?.windGustMs ?? null,
    nightLowC:
      owm.nightLowC != null && Number.isFinite(owm.nightLowC)
        ? owm.nightLowC
        : prior?.nightLowC ?? null,
  };""",
    "applyOwm snap fields",
)
write_rplus(p, text)
print("weatherService ok")
