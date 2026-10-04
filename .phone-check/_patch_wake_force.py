from pathlib import Path

# 1) turnKernel CLOCK_RE — geweckt werden / aufstehen mit Uhr
p = Path("src/module2/kernel/turnKernel.ts")
t = p.read_text(encoding="utf-8")
old = """const CLOCK_RE =
  /\\b(wecker|weck\\s+mich|wecke\\s+mich|timer|stell(?:e)?\\s+(?:mir\\s+)?(?:einen\\s+)?wecker|um\\s+\\d{1,2}(?:[:.]\\d{2})?\\s+uhr.{0,24}wecker)\\b/iu;"""
new = """const CLOCK_RE =
  /\\b(wecker|weck\\s+mich|wecke\\s+mich|timer|stell(?:e)?\\s+(?:mir\\s+)?(?:einen\\s+)?wecker|um\\s+\\d{1,2}(?:[:.]\\d{2})?\\s+uhr.{0,24}wecker|geweckt\\b.{0,40}\\d{1,2}|\\d{1,2}(?::\\d{2})?\\s*(?:uhr)?.{0,24}geweckt|auf\\s*steh\\w*.{0,32}\\d{1,2}|weck(?:e|en)?\\s+(?:mich|uns))\\b/iu;"""
if old not in t:
    raise SystemExit("CLOCK_RE missing")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("kernel CLOCK_RE ok")

# 2) runConciergeTurn — force wake just-do-it
p2 = Path("src/module2/router/runConciergeTurn.ts")
t2 = p2.read_text(encoding="utf-8")
old2 = """  // Just-Do-It (Wecker/Lautstärke/Timer/Wiederholen) nur wenn Call 1 es freigibt —
  // nie Keyword-Steal gegen execution/lane — Ausnahme: klarer Wiederhol-Befehl.
  try {
    const { shouldAbortTurnForEarlyJustDoIt, looksLikeClockIntentLite } =
      require('../kernel/turnKernel') as {
        shouldAbortTurnForEarlyJustDoIt: (s: string) => boolean;
        looksLikeClockIntentLite: (s: string) => boolean;
      };
    let isRepeatAsk = false;
    try {
      const { isRepeatLastSpeechIntent } = require('../../services/speech/lastReplayableSpeech') as {
        isRepeatLastSpeechIntent: (s: string) => boolean;
      };
      isRepeatAsk = isRepeatLastSpeechIntent(rewritten);
    } catch {
      isRepeatAsk = false;
    }
    const call1AllowsJustDoIt =
      call1Execution === 'memory' ||
      call1Execution === 'chat_lane' ||
      call1Execution === 'task_fanout' ||
      isRepeatAsk;
    if (
      !choiceFast &&
      (isRepeatAsk ||
        (call1AllowsJustDoIt &&
          shouldAbortTurnForEarlyJustDoIt(rewritten) &&
          managerLane !== 'nav' &&
          managerLane !== 'pitch' &&
          managerLane !== 'plan' &&
          managerLane !== 'm1'))
    ) {
      const { tryEarlyJustDoIt } = await import(
        '../../services/concierge/earlyJustDoIt'
      );
      const early = await tryEarlyJustDoIt(rewritten);
      if (early?.speech) {
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: early.speech,
            visualBullets: (early.bullets ?? []).slice(0, 3),
            quickActions: (early.quickActions ?? []).slice(0, 5),
            cardTitle: early.cardTitle,
          },
          {
            userText: rewritten,
            skipAutoNav: true,
            skipNoteReplayable: early.kind === 'repeat',
          },
        );
        const logic: LogicNodeOutput = {
          spokenDraft: early.speech,
          bullets: (early.bullets ?? []).slice(0, 3),
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: analysis.bridge || null,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'day_plan_budget',
        };
      }
    } else if (call1AllowsJustDoIt && looksLikeClockIntentLite(rewritten)) {
      const { prepareClockIntentFollowUp } = await import(
        '../../services/alarms/clockIntents'
      );
      void prepareClockIntentFollowUp(rewritten);
    }
  } catch (err) {
    console.warn('[pipeline] just-do-it after manager failed', err);
  }"""

new2 = """  // Just-Do-It (Wecker/Lautstärke/Timer/Wiederholen).
  // Wecker+klare Zeit: IMMER Native stellen — nie nur LLM „gestellt“ + Reminder-Button.
  try {
    const { shouldAbortTurnForEarlyJustDoIt, looksLikeClockIntentLite } =
      require('../kernel/turnKernel') as {
        shouldAbortTurnForEarlyJustDoIt: (s: string) => boolean;
        looksLikeClockIntentLite: (s: string) => boolean;
      };
    let isRepeatAsk = false;
    try {
      const { isRepeatLastSpeechIntent } = require('../../services/speech/lastReplayableSpeech') as {
        isRepeatLastSpeechIntent: (s: string) => boolean;
      };
      isRepeatAsk = isRepeatLastSpeechIntent(rewritten);
    } catch {
      isRepeatAsk = false;
    }
    let forceWakeClock = false;
    try {
      const { isWakeAlarmIntent, hasClockHint } = require('../../services/alarms/wakeIntentDetect') as {
        isWakeAlarmIntent: (s: string) => boolean;
        hasClockHint: (s: string) => boolean;
      };
      const { isTimerIntent } = require('../../services/alarms/timerService') as {
        isTimerIntent: (s: string) => boolean;
      };
      forceWakeClock =
        (isWakeAlarmIntent(rewritten) && hasClockHint(rewritten)) ||
        isTimerIntent(rewritten) ||
        looksLikeClockIntentLite(rewritten);
    } catch {
      forceWakeClock = looksLikeClockIntentLite(rewritten);
    }
    const call1AllowsJustDoIt =
      call1Execution === 'memory' ||
      call1Execution === 'chat_lane' ||
      call1Execution === 'task_fanout' ||
      isRepeatAsk ||
      forceWakeClock;
    if (
      !choiceFast &&
      (isRepeatAsk ||
        forceWakeClock ||
        (call1AllowsJustDoIt &&
          shouldAbortTurnForEarlyJustDoIt(rewritten) &&
          managerLane !== 'nav' &&
          managerLane !== 'pitch' &&
          managerLane !== 'plan' &&
          managerLane !== 'm1'))
    ) {
      const { tryEarlyJustDoIt } = await import(
        '../../services/concierge/earlyJustDoIt'
      );
      const early = await tryEarlyJustDoIt(rewritten);
      if (early?.speech) {
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: early.speech,
            visualBullets: (early.bullets ?? []).slice(0, 3),
            quickActions: (early.quickActions ?? []).slice(0, 5),
            cardTitle: early.cardTitle,
          },
          {
            userText: rewritten,
            skipAutoNav: true,
            skipNoteReplayable: early.kind === 'repeat',
            skipButlerRemind: early.kind === 'wake' || early.kind === 'timer',
          },
        );
        const logic: LogicNodeOutput = {
          spokenDraft: early.speech,
          bullets: (early.bullets ?? []).slice(0, 3),
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: analysis.bridge || null,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: early.kind === 'wake' || early.kind === 'timer' ? 'memory' : 'day_plan_budget',
        };
      }
    }
  } catch (err) {
    console.warn('[pipeline] just-do-it after manager failed', err);
  }"""

if old2 not in t2:
    raise SystemExit("just-do-it block missing")
p2.write_text(t2.replace(old2, new2, 1), encoding="utf-8")
print("runConciergeTurn ok")
