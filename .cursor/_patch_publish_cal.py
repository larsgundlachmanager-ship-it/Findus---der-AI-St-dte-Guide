from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\publishPitchUi.ts")
s = p.read_text(encoding="utf-8")
old = """  useFuturePlanStore.getState().ensureDay(dayKey);
  requestDayKey(dayKey);
  requestOpenPlanCalendar();
  clearChoiceStopsOnDay(dayKey, opts.stepKey);"""
new = """  useFuturePlanStore.getState().ensureDay(dayKey);
  requestDayKey(dayKey);
  // Ideal: Calendar nur bei explizitem openCalendar — nicht bei jedem Pitch
  if ((opts as { openCalendar?: boolean }).openCalendar === true) {
    requestOpenPlanCalendar();
  }
  clearChoiceStopsOnDay(dayKey, opts.stepKey);"""
if old not in s:
    raise SystemExit("block missing")
s = s.replace(old, new, 1)
old2 = """  if (result.uiLayout === 'timeline_stack') {
    publishPitchToTimeline(result, opts);
  } else {"""
new2 = """  if (result.uiLayout === 'timeline_stack') {
    publishPitchToTimeline(result, {
      ...opts,
      openCalendar: (opts as { openCalendar?: boolean }).openCalendar === true,
    });
  } else {"""
if old2 not in s:
    raise SystemExit("publishPitchResult block missing")
s = s.replace(old2, new2, 1)
tmp = p.with_suffix(".ts.patching")
tmp.write_text(s, encoding="utf-8")
tmp.replace(p)
print("ok")
