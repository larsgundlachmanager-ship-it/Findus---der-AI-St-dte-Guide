from pathlib import Path

src = Path("src/services/alarms/wakeAlarmAdvisor.ts")
tmp = Path(".phone-check/_wakeAlarmAdvisor_out.ts")
wt = src.read_text(encoding="utf-8")

start = wt.find("export function buildWakeSuccessExtras")
end = wt.find("export function formatClockDe")
if start < 0 or end < 0:
    raise SystemExit(f"markers {start} {end}")

new_fn = r'''export function buildWakeSuccessExtras(opts: {
  wakeAtMs: number;
  reasonLabel?: string;
  planHintTitle?: string | null;
  suggestedEarlierMs?: number | null;
  /** Explizite Uhr ohne Plan-Anker → keine Extra-Buttons */
  lean?: boolean;
}): { bullets: string[]; quickActions: QuickAction[] } {
  const wakeClock = formatClockDe(opts.wakeAtMs);
  const day = new Date(opts.wakeAtMs);
  const dayLabel = day.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  // Ein Stichpunkt reicht — kein Doppel zur Speech
  const bullets = [`${wakeClock} · ${dayLabel}`];
  if (opts.planHintTitle && !opts.lean) {
    bullets.push(`Plan: ${opts.planHintTitle}`);
  }

  const quickActions: QuickAction[] = [];
  if (opts.lean) {
    return { bullets: bullets.slice(0, 2), quickActions: [] };
  }
  const earlier15 = opts.wakeAtMs - 15 * 60_000;
  if (earlier15 > Date.now() + 60_000) {
    const c = formatClockDe(earlier15);
    quickActions.push({
      type: 'SET_WAKE_ALARM',
      label: `15 Min früher (${c})`,
      payload: {
        dateIso: new Date(earlier15).toISOString(),
        timeLabel: c,
        destName: opts.reasonLabel || 'Aufstehen',
        wakeMode: 'replace',
        replaceWakeAtMs: opts.wakeAtMs,
      },
    });
  }
  if (
    opts.suggestedEarlierMs != null &&
    opts.suggestedEarlierMs > Date.now() + 60_000 &&
    opts.suggestedEarlierMs < opts.wakeAtMs - 5 * 60_000
  ) {
    const alt = formatClockDe(opts.suggestedEarlierMs);
    quickActions.push({
      type: 'SET_WAKE_ALARM',
      label: `Früher ${alt}`,
      payload: {
        dateIso: new Date(opts.suggestedEarlierMs).toISOString(),
        timeLabel: alt,
        destName: opts.planHintTitle || opts.reasonLabel || 'Aufstehen',
        wakeMode: 'replace',
        replaceWakeAtMs: opts.wakeAtMs,
      },
    });
  }
  return { bullets: bullets.slice(0, 2), quickActions: quickActions.slice(0, 3) };
}

'''

wt2 = wt[:start] + new_fn + wt[end:]
wt2 = wt2.replace(
    """    const extras = buildWakeSuccessExtras({
      wakeAtMs: explicit,
      reasonLabel: 'Aufstehen',
      planHintTitle,
      suggestedEarlierMs,
    });""",
    """    const extras = buildWakeSuccessExtras({
      wakeAtMs: explicit,
      reasonLabel: 'Aufstehen',
      planHintTitle,
      suggestedEarlierMs,
      lean: !planHintTitle,
    });""",
    1,
)
tmp.write_text(wt2, encoding="utf-8")
tmp.replace(src)
print("wakeAlarmAdvisor replaced", src.stat().st_size)
