# -*- coding: utf-8 -*-
from pathlib import Path
import shutil

p = Path(r"c:\Users\larsf\Findus 2.0\src\utils\dateKeys.ts")
dt = p.read_text(encoding="utf-8")
old = """  return [
    `System-Jetzt (UTC ISO): ${iso}`,
    `System-Jetzt (lokal ${tz}): ${local}`,
    `Heute YYYY-MM-DD (Plan-Tag, Rollover 02:30): ${planDayKeyFromMs(nowMs)}`,
"""
new = """  return [
    `System-Jetzt (UTC ISO, nur intern): ${iso}`,
    `System-Jetzt (lokal ${tz}): ${local}`,
    `Bei „wie spät / Uhrzeit jetzt“: genau EINE lokale Uhrzeit nennen (HH:MM). Kein UTC, keine Zeitzone, kein Doppel.`,
    `Heute YYYY-MM-DD (Plan-Tag, Rollover 02:30): ${planDayKeyFromMs(nowMs)}`,
"""
if "keine Zeitzone, kein Doppel" in dt:
    print("already")
elif old not in dt:
    raise SystemExit("missing block")
else:
    tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7\_dateKeys_tmp.ts")
    tmp.write_text(dt.replace(old, new, 1), encoding="utf-8")
    shutil.copyfile(tmp, p)
    print("ok")
