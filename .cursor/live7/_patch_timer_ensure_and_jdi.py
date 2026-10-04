# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\alarms\ensureWakeNativePresent.ts")
t = p.read_text(encoding="utf-8")
old = """  if (!t) return null;
  if (looksLikeNativeWakeSpeech(currentSpeech)) return null;

  try {
    const { isClockIntent, prepareClockIntentFollowUp } = await import(
      './clockIntents'
    );
"""
new = """  if (!t) return null;
  if (looksLikeNativeWakeSpeech(currentSpeech)) return null;
  try {
    const { looksLikeNativeTimerSpeech } = require('./timerService') as {
      looksLikeNativeTimerSpeech: (s: string) => boolean;
    };
    if (looksLikeNativeTimerSpeech(currentSpeech)) return null;
  } catch {
    /* soft */
  }

  try {
    const { isClockIntent, prepareClockIntentFollowUp } = await import(
      './clockIntents'
    );
"""
if "looksLikeNativeTimerSpeech(currentSpeech)" not in t:
    if old not in t:
        raise SystemExit("ensureWake skip needle missing")
    t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")
    print("ensureWake timer skip ok")
else:
    print("ensureWake already")

import subprocess
subprocess.check_call(["python", r"c:\Users\larsf\Findus 2.0\.cursor\live7\_patch_timer_early_jdi.py"])
