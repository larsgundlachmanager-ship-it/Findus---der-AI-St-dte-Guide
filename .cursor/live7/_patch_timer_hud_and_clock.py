# -*- coding: utf-8 -*-
"""Pin timer HUD + local-time Just-Do-It (one clock, no timezone dump)."""
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# --- 1) Header: don't auto-rotate away from timer ---
header = ROOT / "src/components/Header.tsx"
ht = header.read_text(encoding="utf-8")
old_rot = """  // Auto-rotate: ein stabiles Interval, liest Refs — kein Restart bei jedem Rebuild
  useEffect(() => {
    if (mode !== 'idle') return;
    const id = setInterval(() => {
      if (userSwiping.current) return;
      if (Date.now() < autoResumeAtMs.current) return;
      const len = cardsLenRef.current;
      if (len <= 1) return;
"""
new_rot = """  // Auto-rotate: ein stabiles Interval, liest Refs — kein Restart bei jedem Rebuild
  useEffect(() => {
    if (mode !== 'idle') return;
    const id = setInterval(() => {
      if (userSwiping.current) return;
      if (Date.now() < autoResumeAtMs.current) return;
      // Küchen-Timer: Karte fest oben — nicht wegdrehen
      try {
        const { getActiveTimer } = require('../services/alarms/timerService') as {
          getActiveTimer: () => { endsAtMs: number } | null;
        };
        const t = getActiveTimer();
        if (t && t.endsAtMs > Date.now()) {
          if (cardIndexRef.current !== 0) {
            cardIndexRef.current = 0;
            setCardIndex(0);
            scrollToLogical(0, true);
          }
          return;
        }
      } catch {
        /* soft */
      }
      const len = cardsLenRef.current;
      if (len <= 1) return;
"""
if "Küchen-Timer: Karte fest oben" not in ht:
    if old_rot not in ht:
        raise SystemExit("header rotate block missing")
    ht = ht.replace(old_rot, new_rot, 1)
    # dependency array may need scrollToLogical - check
    ht = ht.replace(
        "  }, [mode, fade]);\n\n  const pauseAutoRotate",
        "  }, [mode, fade, scrollToLogical]);\n\n  const pauseAutoRotate",
        1,
    )
    header.write_text(ht, encoding="utf-8")
    print("header pin ok")
else:
    print("header already")

# --- 2) timerCard title clearer ---
hud = ROOT / "src/services/ui/liveHudCards.ts"
ht2 = hud.read_text(encoding="utf-8")
old_tc = """    return polishCard({
      id: `timer-${t.endsAtMs}`,
      title: `⏱️ ${t.label} · ${clock}`,
      meta: 'läuft · klingelt auch im Hintergrund',
      tellMorePrompt: `Status zu meinem Timer „${t.label}“ — noch wie lange, und was danach?`,
    });"""
new_tc = """    return polishCard({
      id: `timer-${t.endsAtMs}`,
      title: `Timer ${clock}`,
      meta: t.label !== 'Timer' ? `${t.label} · läuft` : 'läuft · klingelt auch aus',
      tellMorePrompt: `Status zu meinem Timer „${t.label}“ — noch wie lange, und was danach?`,
    });"""
if "Timer ${clock}" not in ht2:
    if old_tc not in ht2:
        raise SystemExit("timerCard block missing")
    hud.write_text(ht2.replace(old_tc, new_tc, 1), encoding="utf-8")
    print("hud title ok")
else:
    print("hud already")

# --- 3) local time just-do-it ---
lt = ROOT / "src/services/alarms/localTimeAsk.ts"
lt.write_text(
    """/**
 * „Wie spät ist es?“ — eine lokale Uhrzeit, kein UTC/Zeitzonen-Vortrag.
 */

export function isLocalTimeAsk(text: string): boolean {
  const t = (text || '').replace(/\\s+/g, ' ').trim();
  if (!t || t.length > 80) return false;
  if (
    /\\b(wecker|timer|flug|bahn|leave|abfahrt|ankunft|öffnungs|oeffnungs|kino|termin)\\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  return (
    /\\bwie\\s+sp(?:ä|ae)t\\b/iu.test(t) ||
    /\\b(?:welche|wie\\s*viel)\\s+uhr(?:zeit)?\\b/iu.test(t) ||
    /\\b(?:aktuelle\\s+)?uhrzeit\\b/iu.test(t) ||
    /\\bwie\\s+viel\\s+uhr\\b/iu.test(t)
  );
}

export function formatLocalTimeSpeech(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const hm = d.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Es ist ${hm} Uhr.`;
}

export function prepareLocalTimeFollowUp(text: string): {
  speech: string;
  bullets: string[];
  cardTitle: string;
} | null {
  if (!isLocalTimeAsk(text)) return null;
  const speech = formatLocalTimeSpeech();
  const hm = speech.replace(/^Es ist\\s+/i, '').replace(/\\s*Uhr\\.?$/i, '').trim();
  return {
    speech,
    bullets: [hm.includes(':') ? hm : speech],
    cardTitle: 'Uhrzeit',
  };
}
""",
    encoding="utf-8",
)
print("localTimeAsk written")

# --- 4) earlyJustDoIt: local time before timer? After timer is fine - before LLM path ---
ej = ROOT / "src/services/concierge/earlyJustDoIt.ts"
et = ej.read_text(encoding="utf-8")
# Add kind
if "| 'local_time'" not in et:
    et = et.replace(
        "| 'repeat';",
        "| 'repeat'\n    | 'local_time';",
        1,
    )
# Insert after timer-first block
needle = """  // Letzte Antwort 1:1 wiederholen — vor Wecker/Volume/Pitch
"""
insert = """  // „Wie spät?“ — eine lokale Uhrzeit (kein UTC/Zeitzonen-Doppel).
  try {
    const { isLocalTimeAsk, prepareLocalTimeFollowUp } = require('../alarms/localTimeAsk') as {
      isLocalTimeAsk: (s: string) => boolean;
      prepareLocalTimeFollowUp: (s: string) => {
        speech: string;
        bullets: string[];
        cardTitle: string;
      } | null;
    };
    if (isLocalTimeAsk(t)) {
      const local = prepareLocalTimeFollowUp(t);
      if (local?.speech) {
        return {
          kind: 'local_time',
          speech: local.speech,
          bullets: local.bullets,
          quickActions: [],
          cardTitle: local.cardTitle,
        };
      }
    }
  } catch {
    /* soft */
  }

  // Letzte Antwort 1:1 wiederholen — vor Wecker/Volume/Pitch
"""
if "Wie spät?" not in et and "Wie spät" not in et:
    if needle not in et:
        raise SystemExit("earlyJustDoIt needle missing")
    et = et.replace(needle, insert, 1)
    ej.write_text(et, encoding="utf-8")
    print("earlyJustDoIt local time ok")
else:
    print("earlyJustDoIt already has local time?")

# Also force early path in runConciergeTurn for local time (like timer)
# Add isLocalTimeAsk to forceClock check
rct = ROOT / "src/module2/router/runConciergeTurn.ts"
rt = rct.read_text(encoding="utf-8")
old_fc = """    const { isTimerIntent } = require('../../services/alarms/timerService') as {
      isTimerIntent: (s: string) => boolean;
    };
    let forceClock = isTimerIntent(rewritten);
    if (!forceClock) {
"""
new_fc = """    const { isTimerIntent } = require('../../services/alarms/timerService') as {
      isTimerIntent: (s: string) => boolean;
    };
    let forceClock = isTimerIntent(rewritten);
    if (!forceClock) {
      try {
        const { isLocalTimeAsk } = require('../../services/alarms/localTimeAsk') as {
          isLocalTimeAsk: (s: string) => boolean;
        };
        forceClock = isLocalTimeAsk(rewritten);
      } catch {
        /* soft */
      }
    }
    if (!forceClock) {
"""
if "isLocalTimeAsk(rewritten)" not in rt:
    if old_fc not in rt:
        raise SystemExit("runConciergeTurn forceClock missing")
    rt = rt.replace(old_fc, new_fc, 1)
    # accept local_time kind in early return
    rt = rt.replace(
        "(earlyClock.kind === 'timer' || earlyClock.kind === 'wake')",
        "(earlyClock.kind === 'timer' || earlyClock.kind === 'wake' || earlyClock.kind === 'local_time')",
    )
    rct.write_text(rt, encoding="utf-8")
    print("runConciergeTurn local time ok")
else:
    print("runConciergeTurn already")

# --- 5) planningClockContextBlock: don't speak UTC/tz ---
dk = ROOT / "src/utils/dateKeys.ts"
dt = dk.read_text(encoding="utf-8")
old_blk = """  return [
    `System-Jetzt (UTC ISO): ${iso}`,
    `System-Jetzt (lokal ${tz}): ${local}`,
    `Heute YYYY-MM-DD (Plan-Tag, Rollover 02:30): ${planDayKeyFromMs(nowMs)}`,
"""
new_blk = """  return [
    `System-Jetzt (UTC ISO, nur intern): ${iso}`,
    `System-Jetzt (lokal ${tz}): ${local}`,
    `Bei „wie spät / Uhrzeit jetzt“: genau EINE lokale Uhrzeit nennen (HH:MM). Kein UTC, keine Zeitzone, kein Doppel.`,
    `Heute YYYY-MM-DD (Plan-Tag, Rollover 02:30): ${planDayKeyFromMs(nowMs)}`,
"""
if "keine Zeitzone, kein Doppel" not in dt:
    if old_blk not in dt:
        raise SystemExit("planningClock block missing")
    dk.write_text(dt.replace(old_blk, new_blk, 1), encoding="utf-8")
    print("dateKeys policy ok")
else:
    print("dateKeys already")

print("ALL DONE")
