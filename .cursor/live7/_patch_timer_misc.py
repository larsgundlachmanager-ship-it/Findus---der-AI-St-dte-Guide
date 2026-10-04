# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\alarms\ensureWakeNativePresent.ts")
t = p.read_text(encoding="utf-8")
old = "cardTitle: clock.cardTitle || 'Wecker',"
new = "cardTitle: clock.cardTitle || (clock.kind === 'timer' ? 'Timer' : 'Wecker'),"
if old not in t:
    raise SystemExit("not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("ensureWake ok")

# earlyJustDoIt: timer never yields to day plan
ej = Path(r"c:\Users\larsf\Findus 2.0\src\services\concierge\earlyJustDoIt.ts")
et = ej.read_text(encoding="utf-8")
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
if old2 not in et:
    raise SystemExit("earlyJustDoIt guard not found")
if "Timer ist immer Just-Do-It" not in et:
    ej.write_text(et.replace(old2, new2, 1), encoding="utf-8")
    print("earlyJustDoIt ok")
else:
    print("earlyJustDoIt already")
