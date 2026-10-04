# -*- coding: utf-8 -*-
from pathlib import Path
import re

bak = Path(r".phone-check/_rainIncomingPolicy.bak.ts")
text = bak.read_text(encoding="utf-8")

pat = r"if \(falling\) \{\n    const endMs = activeRainEndMs.*?return 'Regen jetzt';\n  \}"
new = """if (falling) {
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
  }"""
m = re.search(pat, text, re.S)
if not m:
    raise SystemExit("falling block not found")
text = text[: m.start()] + new + text[m.end() :]

text = text.replace(
    "* - fällt: „Regen noch X Min“ (≤60) bzw. „Regen bis HH:MM“ (>60)",
    "* - fällt: „Aktuell [starker/leichter] Regen“ bzw. „… noch X Min“ / „… bis HH:MM“",
)
text = text.replace(
    "* HUD / Regenradar-Zeile (SSOT Radar-Nowcast Timing):",
    "* HUD / Regenradar-Zeile (SSOT Radar-Nowcast Timing) — nur Fakt, kein Schirm/Indoor:",
)

old2_start = text.find("/** True wenn die Zeile akuten Regen meint")
old2_end = text.find("export function isRainDontCareUtterance")
if old2_start < 0 or old2_end < 0:
    raise SystemExit("urgent block not found")
new2 = r"""/** True wenn die Zeile akuten Regen meint (aktuell / noch / in ≤60 Min). */
export function isRainHudUrgent(line: string | null | undefined): boolean {
  if (!line) return false;
  const t = stripRainHudPrefix(line);
  if (isRainHudFallingLine(t)) return true;
  return /^(Starker\s+|Leichter\s+)?Regen in /i.test(t);
}

/** True wenn die Zeile belegtes Radar-Timing trägt (auch „ab HH:MM“). */
export function isRainHudRadarLine(line: string | null | undefined): boolean {
  if (!line) return false;
  const t = stripRainHudPrefix(line);
  if (isRainHudFallingLine(t)) return true;
  return /^(Starker\s+|Leichter\s+)?Regen (in |ab )/i.test(t);
}

"""
text = text[:old2_start] + new2 + text[old2_end:]

out = Path(r".phone-check/_rainIncomingPolicy.new.ts")
out.write_text(text, encoding="utf-8")
print("ok", "Aktuell Regen" in text, "rainHudIntensityNoun" in text)
