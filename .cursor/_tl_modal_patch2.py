# -*- coding: utf-8 -*-
from pathlib import Path
import os

p = Path(r"c:\Users\larsf\Findus 2.0\src\components\PlanCalendarModal.tsx")
text = p.read_text(encoding="utf-8")
old = """        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,"""
new = """        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) > 36 && Math.abs(g.dx) > Math.abs(g.dy) * 2.2,"""
if old in text:
    text = text.replace(old, new, 1)
old2 = """                              <Text
                                style={[
                                  styles.routeStripKicker,
                                  styles.routeStripKickerReminder,
                                ]}
                              >"""
new2 = """                              <Text
                                style={[
                                  styles.routeStripKicker,
                                  liveLeaveArrive
                                    ? styles.routeStripKickerReminder
                                    : null,
                                ]}
                              >"""
if old2 in text:
    text = text.replace(old2, new2, 1)
tmp = p.with_name(p.name + ".tmpwrite")
tmp.write_text(text, encoding="utf-8", newline="\n")
os.replace(str(tmp), str(p))
print("ok")
