# -*- coding: utf-8 -*-
from pathlib import Path

# --- rainIncomingPolicy: add constant + helpers ---
p = Path("src/services/weather/rainIncomingPolicy.ts")
t = p.read_text(encoding="utf-8")
insert_after = "/** HUD zeigt Countdown bis hier; darunter „Aktuell Regen“. */\nexport const RAIN_HUD_MAX_MIN = 90;\n"
helper = """/** HUD zeigt Countdown bis hier; darunter „Aktuell Regen“. */
export const RAIN_HUD_MAX_MIN = 90;

/**
 * Trockenlücke darunter = noch derselbe Schauer.
 * Erst ab ≥ dieser Pause gilt „Regen hört auf“ (nicht 5–10 Min Flatterpause).
 */
export const RAIN_END_MIN_DRY_GAP_MS = 30 * 60_000;

/**
 * Nasse Runs zusammenführen, wenn die Pause dazwischen unter minDryGapMs liegt.
 * `endAtMs` = Zeitpunkt des letzten nassen Samples (oder Fensterende).
 */
export function mergeWetRunsByDryGap<T extends { startAtMs: number; endAtMs: number }>(
  runs: T[],
  minDryGapMs: number = RAIN_END_MIN_DRY_GAP_MS,
): T[] {
  if (!runs.length) return [];
  const sorted = [...runs].sort((a, b) => a.startAtMs - b.startAtMs);
  const out: T[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const prev = out[out.length - 1]!;
    const gapMs = cur.startAtMs - prev.endAtMs;
    if (gapMs < minDryGapMs) {
      out[out.length - 1] = {
        ...prev,
        endAtMs: Math.max(prev.endAtMs, cur.endAtMs),
      };
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Hourly-/Fenster-Liste: kurze Pausen mergen. */
export function mergeRainWindowsByDryGap(
  windows: RainWindow[] | null | undefined,
  minDryGapMs: number = RAIN_END_MIN_DRY_GAP_MS,
): RainWindow[] {
  if (!windows?.length) return [];
  const merged = mergeWetRunsByDryGap(
    windows.map((w) => ({
      startAtMs: w.startMs,
      endAtMs: w.endMs,
      pop: w.pop,
    })),
    minDryGapMs,
  );
  return merged.map((w) => ({
    startMs: w.startAtMs,
    endMs: w.endAtMs,
    pop: (w as { pop?: number }).pop,
  }));
}

/**
 * Ende eines nassen Blocks in einer Zeitreihe.
 * Kurze Trockenlöcher (< minDryGapMs) zählen nicht als Ende.
 * samples chronologisch; wet = Niederschlag spürbar.
 */
export function findSeriesRainEndMs(opts: {
  samples: Array<{ atMs: number; wet: boolean }>;
  fromIdx?: number;
  minDryGapMs?: number;
}): number | null {
  const samples = opts.samples;
  if (!samples.length) return null;
  const minGap = opts.minDryGapMs ?? RAIN_END_MIN_DRY_GAP_MS;
  const fromIdx = Math.max(0, opts.fromIdx ?? 0);
  let seenWet = false;
  for (let j = fromIdx; j < samples.length; j++) {
    const s = samples[j]!;
    if (s.wet) {
      seenWet = true;
      continue;
    }
    if (!seenWet) continue;
    const dryAt = s.atMs;
    let resumes = false;
    for (let k = j; k < samples.length; k++) {
      const t = samples[k]!;
      if (t.atMs - dryAt >= minGap) break;
      if (t.wet) {
        resumes = true;
        break;
      }
    }
    if (!resumes) return dryAt;
  }
  return null;
}

"""
if "RAIN_END_MIN_DRY_GAP_MS" not in t:
    if insert_after not in t:
        raise SystemExit("insert_after missing")
    t = t.replace(insert_after, helper, 1)

# harden activeRainEndMs
old_active = """export function activeRainEndMs(
  windows: RainWindow[] | null | undefined,
  opts?: {
    nowMs?: number;
    rainEndsAtMs?: number | null;
    nextRainAtMs?: number | null;
  },
): number | null {
  const now = opts?.nowMs ?? Date.now();
  if (
    opts?.rainEndsAtMs != null &&
    Number.isFinite(opts.rainEndsAtMs) &&
    opts.rainEndsAtMs > now + 60_000
  ) {
    return opts.rainEndsAtMs;
  }
  if (!windows?.length) return null;
  const active = windows.find((w) => w.startMs <= now + 2 * 60_000 && w.endMs > now);
  if (active) return active.endMs;
  const anchor = opts?.nextRainAtMs ?? now;
  const upcoming = windows.find(
    (w) => w.endMs > anchor && w.startMs <= anchor + 30 * 60_000,
  );
  return upcoming?.endMs ?? null;
}
"""
new_active = """export function activeRainEndMs(
  windows: RainWindow[] | null | undefined,
  opts?: {
    nowMs?: number;
    rainEndsAtMs?: number | null;
    nextRainAtMs?: number | null;
  },
): number | null {
  const now = opts?.nowMs ?? Date.now();
  const merged = mergeRainWindowsByDryGap(windows);
  let endMs: number | null = null;
  if (
    opts?.rainEndsAtMs != null &&
    Number.isFinite(opts.rainEndsAtMs) &&
    opts.rainEndsAtMs > now + 60_000
  ) {
    endMs = opts.rainEndsAtMs;
  }
  if (merged.length) {
    const active =
      merged.find((w) => w.startMs <= now + 2 * 60_000 && w.endMs > now) ??
      (() => {
        const anchor = opts?.nextRainAtMs ?? now;
        return merged.find(
          (w) => w.endMs > anchor && w.startMs <= anchor + 30 * 60_000,
        );
      })();
    if (active) {
      // Kurze Pause im rainEndsAtMs überspringen, wenn Fenster weitergeht.
      if (endMs == null || active.endMs > endMs) endMs = active.endMs;
      else if (active.endMs > endMs - RAIN_END_MIN_DRY_GAP_MS) {
        // rainEndsAtMs mitten in Flatterpause → echtes Fensterende
        const next = merged.find((w) => w.startMs >= endMs! && w.startMs - endMs! < RAIN_END_MIN_DRY_GAP_MS);
        if (next) endMs = Math.max(active.endMs, next.endMs);
        else if (active.endMs > endMs) endMs = active.endMs;
      }
    }
  }
  return endMs;
}
"""
# Simpler activeRainEndMs - cleaner logic:
new_active = """export function activeRainEndMs(
  windows: RainWindow[] | null | undefined,
  opts?: {
    nowMs?: number;
    rainEndsAtMs?: number | null;
    nextRainAtMs?: number | null;
  },
): number | null {
  const now = opts?.nowMs ?? Date.now();
  const merged = mergeRainWindowsByDryGap(windows);
  const fromWindows = (() => {
    if (!merged.length) return null;
    const active = merged.find(
      (w) => w.startMs <= now + 2 * 60_000 && w.endMs > now,
    );
    if (active) return active.endMs;
    const anchor = opts?.nextRainAtMs ?? now;
    const upcoming = merged.find(
      (w) => w.endMs > anchor && w.startMs <= anchor + 30 * 60_000,
    );
    return upcoming?.endMs ?? null;
  })();
  const fromTip =
    opts?.rainEndsAtMs != null &&
    Number.isFinite(opts.rainEndsAtMs) &&
    opts.rainEndsAtMs > now + 60_000
      ? opts.rainEndsAtMs
      : null;
  if (fromTip == null) return fromWindows;
  if (fromWindows == null) return fromTip;
  // Tip zu früh (Flatterpause): Fensterende nehmen, wenn es weiterregnet.
  if (fromWindows > fromTip && fromWindows - fromTip < RAIN_END_MIN_DRY_GAP_MS * 4) {
    // Wenn Fenster deutlich länger als Tip → Tip war nur kurze Lücke
    return fromWindows;
  }
  // Tip später als Fenster → Tip (Radar) gewinnen, außer Fenster endet erst viel später
  return Math.max(fromTip, fromWindows);
}
"""
if old_active not in t:
    raise SystemExit("activeRainEndMs block missing")
t = t.replace(old_active, new_active, 1)

# rainDurationMin should also use merged windows
t = t.replace(
    """export function rainDurationMin(
  windows: RainWindow[] | null | undefined,
  startMs: number | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!windows?.length) return null;
  const anchor = startMs ?? nowMs;
  const hit =
    windows.find((w) => w.endMs > anchor && w.startMs <= anchor + 20 * 60_000) ??
    windows.find((w) => w.startMs >= anchor - 5 * 60_000);
""",
    """export function rainDurationMin(
  windows: RainWindow[] | null | undefined,
  startMs: number | null | undefined,
  nowMs = Date.now(),
): number | null {
  const windowsM = mergeRainWindowsByDryGap(windows);
  if (!windowsM.length) return null;
  const anchor = startMs ?? nowMs;
  const hit =
    windowsM.find((w) => w.endMs > anchor && w.startMs <= anchor + 20 * 60_000) ??
    windowsM.find((w) => w.startMs >= anchor - 5 * 60_000);
""",
    1,
)

tmp = Path(".phone-check/_rain_policy_gap.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.replace(p)
print("rainIncomingPolicy ok")
