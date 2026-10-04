# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\weather\rainIncomingPolicy.ts")
text = p.read_text(encoding="utf-8")

start = text.index("/**\n * HUD / Regenradar-Zeile")
end = text.index("  const mins = minutesUntilIncomingRain(opts);")
new_falling = '''/**
 * HUD / Regenradar-Zeile (SSOT Radar-Nowcast Timing) — nur Fakt, kein Schirm/Indoor:
 * - faellt: „Aktuell [starker/leichter] Regen“ bzw. „… noch X Min“ / „… bis HH:MM“
 * - kommt <=60 Min: Countdown „Regen in X Min“ (+ optional „Dauer ca. Y Min“)
 * - kommt >60 Min: nur „Regen ab HH:MM“ — keine Dauer
 */
export function formatRainHudLine(opts: {
  nowMs?: number;
  currentPrecipMm?: number | null;
  rainStartsInMin?: number | null;
  nextRainAtMs?: number | null;
  rainEndsAtMs?: number | null;
  rainWindows?: RainWindow[] | null;
  weatherCode?: number | null;
  isHeavyRain?: boolean | null;
  /** Max. Horizont fuer „Regen ab …“ (Default: bis Abend ~12 h). */
  maxHorizonMin?: number;
}): string | null {
  const now = opts.nowMs ?? Date.now();
  const horizon = opts.maxHorizonMin ?? 12 * 60;
  const falling = isRainAlreadyFalling(opts);
  if (falling) {
    const noun = rainHudIntensityNoun(opts);
    const endMs = activeRainEndMs(opts.rainWindows, {
      nowMs: now,
      rainEndsAtMs: opts.rainEndsAtMs,
      nextRainAtMs: opts.nextRainAtMs,
    });
    if (endMs != null && endMs > now + 60_000) {
      const leftMin = Math.max(1, Math.round((endMs - now) / 60_000));
      if (leftMin <= RAIN_CLOCK_AFTER_MIN) {
        return `${noun} noch ${leftMin} Min`;
      }
      return `${noun} bis ${clockLabel(endMs)}`;
    }
    if (noun === 'Regen') return 'Aktuell Regen';
    return `Aktuell ${noun.charAt(0).toLowerCase()}${noun.slice(1)}`;
  }
'''
text = text[:start] + new_falling + text[end:]

old2 = """/** True wenn die Zeile akuten Regen meint (jetzt / noch / in ≤60 Min). */
export function isRainHudUrgent(line: string | null | undefined): boolean {
  if (!line) return false;
  return /^(Regen jetzt|Regen noch |Regen in )/i.test(line.trim());
}

/** True wenn die Zeile belegtes Radar-Timing trägt (auch „ab HH:MM“). */
export function isRainHudRadarLine(line: string | null | undefined): boolean {
  if (!line) return false;
  return /^(Regen jetzt|Regen noch |Regen in |Regen ab |Regen bis )/i.test(
    line.trim(),
  );
}"""

new2 = """/** True wenn die Zeile akuten Regen meint (aktuell / noch / in <=60 Min). */
export function isRainHudUrgent(line: string | null | undefined): boolean {
  if (!line) return false;
  const t = stripRainHudPrefix(line);
  if (isRainHudFallingLine(t)) return true;
  return /^(Starker\\s+|Leichter\\s+)?Regen in /i.test(t);
}

/** True wenn die Zeile belegtes Radar-Timing traegt (auch „ab HH:MM“). */
export function isRainHudRadarLine(line: string | null | undefined): boolean {
  if (!line) return false;
  const t = stripRainHudPrefix(line);
  if (isRainHudFallingLine(t)) return true;
  return /^(Starker\\s+|Leichter\\s+)?Regen (in |ab )/i.test(t);
}"""

if old2 not in text:
    raise SystemExit("block2 not found")
text = text.replace(old2, new2, 1)
p.write_text(text, encoding="utf-8")
print("ok")
