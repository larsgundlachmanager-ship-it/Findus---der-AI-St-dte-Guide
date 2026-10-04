# -*- coding: utf-8 -*-
from pathlib import Path

# --- gpsRainNowcast: merge runs with dry gap ---
p = Path("src/services/weather/gpsRainNowcast.ts")
t = p.read_text(encoding="utf-8")
if "RAIN_END_MIN_DRY_GAP_MS" not in t:
    # add import after the file header comment block - find first export or const
    if "from './rainIncomingPolicy'" not in t:
        t = t.replace(
            "const FETCH_MS = 7_000;",
            "import { RAIN_END_MIN_DRY_GAP_MS } from './rainIncomingPolicy';\n\nconst FETCH_MS = 7_000;",
            1,
        )

old = """  const significant =
    noisePeak == null
      ? runs
      : runs.filter((r) => r.peak >= noisePeak);

  // Aktueller Frame ≈ letzter Sample ≤ now (+ halber Step Toleranz).
"""
new = """  const significantRaw =
    noisePeak == null
      ? runs
      : runs.filter((r) => r.peak >= noisePeak);

  // Flatterpausen < 30 Min = noch derselbe Schauer (nicht „hört in 36 Min auf“).
  const significant: Run[] = [];
  for (const r of significantRaw) {
    if (!significant.length) {
      significant.push({ ...r });
      continue;
    }
    const prev = significant[significant.length - 1]!;
    const gapMs = sorted[r.startI]!.atMs - sorted[prev.endI]!.atMs;
    if (gapMs < RAIN_END_MIN_DRY_GAP_MS) {
      prev.endI = r.endI;
      prev.peak = Math.max(prev.peak, r.peak);
    } else {
      significant.push({ ...r });
    }
  }

  // Aktueller Frame ≈ letzter Sample ≤ now (+ halber Step Toleranz).
"""
if old not in t:
    raise SystemExit("gps significant block missing")
t = t.replace(old, new, 1)
tmp = Path(".phone-check/_gps_gap.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.replace(p)
print("gps ok")

# --- openWeatherOneCall: use findSeriesRainEndMs ---
p = Path("src/services/weather/openWeatherOneCall.ts")
t = p.read_text(encoding="utf-8")
if "findSeriesRainEndMs" not in t:
    t = t.replace(
        "from './weatherRainOutlook';",
        "from './weatherRainOutlook';\nimport {\n  RAIN_END_MIN_DRY_GAP_MS,\n  findSeriesRainEndMs,\n  mergeRainWindowsByDryGap,\n} from './rainIncomingPolicy';",
        1,
    )

# Replace minutely end detection blocks
old1 = """  /** Ende des nassen Blocks aus minutely (Wolke schneller/langsamer → neuer Fetch). */
  let rainEndsAtMs: number | null = null;
  if (minutely.length) {
    const fromIdx = rainStartIdx >= 0 ? rainStartIdx : 0;
    let seenWet = rainStartIdx >= 0;
    for (let j = fromIdx; j < minutely.length; j++) {
      const wet = (minutely[j]!.precipitation ?? 0) >= PRECIP_MIN_MM;
      if (wet) seenWet = true;
      else if (seenWet) {
        rainEndsAtMs = minutely[j]!.dt * 1000;
        break;
      }
    }
    if (seenWet && rainEndsAtMs == null) {
      const last = minutely[minutely.length - 1]!;
      rainEndsAtMs = last.dt * 1000 + 60_000;
    }
  }
"""
new1 = """  /** Ende des nassen Blocks — kurze Trockenlöcher (<30 Min) zählen nicht. */
  let rainEndsAtMs: number | null = null;
  if (minutely.length) {
    const fromIdx = rainStartIdx >= 0 ? rainStartIdx : 0;
    const series = minutely.map((m) => ({
      atMs: m.dt * 1000,
      wet: (m.precipitation ?? 0) >= PRECIP_MIN_MM,
    }));
    rainEndsAtMs = findSeriesRainEndMs({
      samples: series,
      fromIdx,
      minDryGapMs: RAIN_END_MIN_DRY_GAP_MS,
    });
    const seenWet =
      rainStartIdx >= 0 || series.slice(fromIdx).some((s) => s.wet);
    if (seenWet && rainEndsAtMs == null) {
      const last = minutely[minutely.length - 1]!;
      rainEndsAtMs = last.dt * 1000 + 60_000;
    }
  }
"""
if old1 not in t:
    raise SystemExit("owm end block1 missing")
t = t.replace(old1, new1, 1)

old2 = """  // Wenn's schon nass ist, Ende ab jetzt (nicht ab einem späteren Minutely-Start).
  if (rainingNow && minutely.length && rainStartIdx > 0) {
    let seenWet = false;
    let endFromNow: number | null = null;
    for (let j = 0; j < minutely.length; j++) {
      const wet = (minutely[j]!.precipitation ?? 0) >= PRECIP_MIN_MM;
      if (wet) seenWet = true;
      else if (seenWet) {
        endFromNow = minutely[j]!.dt * 1000;
        break;
      }
    }
    if (endFromNow != null) rainEndsAtMs = endFromNow;
    else if (seenWet) {
      const last = minutely[minutely.length - 1]!;
      rainEndsAtMs = last.dt * 1000 + 60_000;
    }
  }
"""
new2 = """  // Wenn's schon nass ist, Ende ab jetzt (nicht ab einem späteren Minutely-Start).
  if (rainingNow && minutely.length && rainStartIdx > 0) {
    const series = minutely.map((m) => ({
      atMs: m.dt * 1000,
      wet: (m.precipitation ?? 0) >= PRECIP_MIN_MM,
    }));
    const endFromNow = findSeriesRainEndMs({
      samples: series,
      fromIdx: 0,
      minDryGapMs: RAIN_END_MIN_DRY_GAP_MS,
    });
    if (endFromNow != null) rainEndsAtMs = endFromNow;
    else if (series.some((s) => s.wet)) {
      const last = minutely[minutely.length - 1]!;
      rainEndsAtMs = last.dt * 1000 + 60_000;
    }
  }
"""
if old2 not in t:
    raise SystemExit("owm end block2 missing")
t = t.replace(old2, new2, 1)

# merge rain windows after building
old3 = """  if (winStart != null) {
    const last = hourly[Math.min(23, hourly.length - 1)];
    rainWindows.push({
      startMs: winStart,
      endMs: (last?.dt ?? Date.now() / 1000) * 1000 + 3600_000,
      pop: Math.round(winPop * 100),
    });
  }
"""
# After the whole rainWindows building, reassign merged - find after the if winStart block
marker = """  if (winStart != null) {
    const last = hourly[Math.min(23, hourly.length - 1)];
    rainWindows.push({
      startMs: winStart,
      endMs: (last?.dt ?? Date.now() / 1000) * 1000 + 3600_000,
      pop: Math.round(winPop * 100),
    });
  }

  /** Ende des nassen Blocks"""
# After my replace the comment changed
if "  /** Ende des nassen Blocks — kurze Trockenlöcher" in t:
    t = t.replace(
        """  if (winStart != null) {
    const last = hourly[Math.min(23, hourly.length - 1)];
    rainWindows.push({
      startMs: winStart,
      endMs: (last?.dt ?? Date.now() / 1000) * 1000 + 3600_000,
      pop: Math.round(winPop * 100),
    });
  }

  /** Ende des nassen Blocks — kurze Trockenlöcher""",
        """  if (winStart != null) {
    const last = hourly[Math.min(23, hourly.length - 1)];
    rainWindows.push({
      startMs: winStart,
      endMs: (last?.dt ?? Date.now() / 1000) * 1000 + 3600_000,
      pop: Math.round(winPop * 100),
    });
  }
  // Kurz-Pausen zwischen Stundenfenstern mergen (≥30 Min Pause = neues Fenster)
  const rainWindowsMerged = mergeRainWindowsByDryGap(rainWindows);
  rainWindows.length = 0;
  rainWindows.push(...rainWindowsMerged);

  /** Ende des nassen Blocks — kurze Trockenlöcher""",
        1,
    )
else:
    raise SystemExit("window merge anchor missing")

# Fallback hit also uses already-merged rainWindows
tmp = Path(".phone-check/_owm_gap.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.replace(p)
print("owm ok")
