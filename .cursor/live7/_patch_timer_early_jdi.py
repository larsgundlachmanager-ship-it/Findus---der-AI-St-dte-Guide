# -*- coding: utf-8 -*-
from pathlib import Path

ej = Path(r"c:\Users\larsf\Findus 2.0\src\services\concierge\earlyJustDoIt.ts")
et = ej.read_text(encoding="utf-8")

# Insert timer-first right after empty check
needle = """export async function tryEarlyJustDoIt(
  text: string,
): Promise<EarlyJustDoItResult | null> {
  const t = (text || '').replace(/\\s+/g, ' ').trim();
  if (!t) return null;

  // Letzte Antwort 1:1 wiederholen — vor Wecker/Volume/Pitch
"""

insert = """export async function tryEarlyJustDoIt(
  text: string,
): Promise<EarlyJustDoItResult | null> {
  const t = (text || '').replace(/\\s+/g, ' ').trim();
  if (!t) return null;

  // Timer zuerst — vor Pitch-Einplanen / Tagesplan / Transit.
  try {
    const { isTimerIntent, prepareTimerFollowUp } = require('../alarms/timerService') as {
      isTimerIntent: (s: string) => boolean;
      prepareTimerFollowUp: (s: string) => Promise<{
        speech: string;
        bullets: string[];
        quickActions: import('../../types/concierge').QuickAction[];
      } | null>;
    };
    if (isTimerIntent(t)) {
      const timer = await prepareTimerFollowUp(t);
      if (timer?.speech) {
        return {
          kind: 'timer',
          speech: timer.speech,
          bullets: timer.bullets,
          quickActions: timer.quickActions,
          cardTitle: 'Timer',
        };
      }
    }
  } catch {
    /* soft */
  }

  // Letzte Antwort 1:1 wiederholen — vor Wecker/Volume/Pitch
"""

if "Timer zuerst — vor Pitch-Einplanen" not in et:
    if needle not in et:
        raise SystemExit("needle not found for timer-first")
    et = et.replace(needle, insert, 1)
    print("timer-first inserted")
else:
    print("timer-first already")

old2 = """  try {
    const { clockIntentYieldsToDayPlan } = require('../../module2/planning/planClockGuard') as {
      clockIntentYieldsToDayPlan: (s: string) => boolean;
    };
    if (clockIntentYieldsToDayPlan(t)) return null;
  } catch {
    /* soft */
  }"""

new2 = """  try {
    const { isTimerIntent } = require('../alarms/timerService') as {
      isTimerIntent: (s: string) => boolean;
    };
    // Timer ist immer Just-Do-It — nie hinter Tagesplan schieben.
    if (!isTimerIntent(t)) {
      const { clockIntentYieldsToDayPlan } = require('../../module2/planning/planClockGuard') as {
        clockIntentYieldsToDayPlan: (s: string) => boolean;
      };
      if (clockIntentYieldsToDayPlan(t)) return null;
    }
  } catch {
    /* soft */
  }"""

if "Timer ist immer Just-Do-It" not in et:
    if old2 not in et:
        raise SystemExit("dayplan guard not found")
    et = et.replace(old2, new2, 1)
    print("dayplan guard patched")
else:
    print("dayplan guard already")

ej.write_text(et, encoding="utf-8")
print("earlyJustDoIt written", len(et))
