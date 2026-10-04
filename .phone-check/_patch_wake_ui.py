from pathlib import Path

# presentConcierge — skipButlerRemind
p = Path("src/services/concierge/presentConcierge.ts")
t = p.read_text(encoding="utf-8")
old = """export async function presentConciergeResponse(
"""
# find opts type
idx = t.find("skipNoteReplayable?: boolean;")
if idx < 0:
    raise SystemExit("skipNoteReplayable missing")
if "skipButlerRemind" not in t:
    t = t.replace(
        "skipNoteReplayable?: boolean;",
        "skipNoteReplayable?: boolean;\n    /** Nach echtem Wecker/Timer: kein Reminder-Button nachschieben */\n    skipButlerRemind?: boolean;",
        1,
    )

old_rem = """  // Erinnerung: Fake-Claim „ich erinnere dich“ → echt stellen oder ehrlich strippen
  try {
    const {
      speechClaimsReminderSet,
      buildRemindOnlyQuickAction,
      speechOffersRemind,
    } = await import('./reminderActionPolicy');
"""
new_rem = """  // Erinnerung: Fake-Claim „ich erinnere dich“ → echt stellen oder ehrlich strippen
  // Nach echtem Native-Wecker nie Reminder-Doppel (User wollte Wecker, nicht „erinner mich“).
  try {
    let skipRemindHonesty = Boolean(opts?.skipButlerRemind);
    if (!skipRemindHonesty && opts?.userText) {
      try {
        const { isWakeAlarmIntent } = require('../alarms/wakeIntentDetect') as {
          isWakeAlarmIntent: (s: string) => boolean;
        };
        skipRemindHonesty = isWakeAlarmIntent(opts.userText);
      } catch {
        /* soft */
      }
    }
    if (skipRemindHonesty) {
      /* Wecker-Turn: Reminder-Honesty überspringen */
    } else {
    const {
      speechClaimsReminderSet,
      buildRemindOnlyQuickAction,
      speechOffersRemind,
    } = await import('./reminderActionPolicy');
"""
if old_rem not in t:
    raise SystemExit("reminder block missing")
t = t.replace(old_rem, new_rem, 1)
# Close the else before catch — find the end of reminder try block
# The block ends with `} catch (err) { console.warn('[present] reminder honesty failed`
marker = """  } catch (err) {
    console.warn('[present] reminder honesty failed:', err);
  }"""
if marker not in t:
    raise SystemExit("reminder catch missing")
# Only first occurrence after our change — insert closing brace for else before catch
# Actually we need `} }` before catch - the inner if claimed... ends, then we need close else
t = t.replace(
    marker,
    """  }
  } catch (err) {
    console.warn('[present] reminder honesty failed:', err);
  }""",
    1,
)
p.write_text(t, encoding="utf-8")
print("presentConcierge ok")

# buildWakeSuccessExtras — lean
wa = Path("src/services/alarms/wakeAlarmAdvisor.ts")
wt = wa.read_text(encoding="utf-8")
old_ex = """export function buildWakeSuccessExtras(opts: {
  wakeAtMs: number;
  reasonLabel?: string;
  planHintTitle?: string | null;
  suggestedEarlierMs?: number | null;
}): { bullets: string[]; quickActions: QuickAction[] } {
  const wakeClock = formatClockDe(opts.wakeAtMs);
  const day = new Date(opts.wakeAtMs);
  const dayLabel = day.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const bullets = [
    `⏰ ${wakeClock} · ${dayLabel}`,
    'In Timeline + zeitlicher Trigger',
  ];
  if (opts.planHintTitle) {
    bullets.push(`Plan-Anker: ${opts.planHintTitle}`);
  }

  const quickActions: QuickAction[] = [];
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
  quickActions.push({
    type: 'SHOW_MORE',
    label: 'Wetter morgen',
    payload: { textPrompt: 'Wie wird das Wetter morgen früh?' },
  });
  return { bullets: bullets.slice(0, 3), quickActions: quickActions.slice(0, 4) };
}"""
new_ex = """export function buildWakeSuccessExtras(opts: {
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
  // Ein Stichpunkt reicht — kein Doppel zur Speech, kein Emoji-Krümel
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
}"""
if old_ex not in wt:
    raise SystemExit("buildWakeSuccessExtras missing")
wt = wt.replace(old_ex, new_ex, 1)
# lean=true for explicit wake success
wt = wt.replace(
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
wa.write_text(wt, encoding="utf-8")
print("wakeAlarmAdvisor ok")
