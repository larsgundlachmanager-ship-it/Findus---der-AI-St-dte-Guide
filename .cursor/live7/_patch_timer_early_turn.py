# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\runConciergeTurn.ts")
text = p.read_text(encoding="utf-8")

marker = """  // choiceFast VOR Analyze (kein TDZ). Early Bridge läuft schon parallel (nach Rewrite).
  let choiceFast: import('./choiceTurnContext').ChoiceFastPathArm | null = null;
  try {
    const { takeChoiceFastPath } = await import('./choiceTurnContext');
    choiceFast = takeChoiceFastPath();
  } catch {
    choiceFast = null;
  }"""

early = r"""  // Timer/Wecker: VOR Choice + Call-1-Nav — sticky Pitch/Nav darf den Auftrag nicht fressen.
  try {
    const { isTimerIntent } = require('../../services/alarms/timerService') as {
      isTimerIntent: (s: string) => boolean;
    };
    let forceClock = isTimerIntent(rewritten);
    if (!forceClock) {
      try {
        const { isWakeAlarmIntent, hasClockHint } = require('../../services/alarms/wakeIntentDetect') as {
          isWakeAlarmIntent: (s: string) => boolean;
          hasClockHint: (s: string) => boolean;
        };
        const { looksLikeClockIntentLite } = require('../kernel/turnKernel') as {
          looksLikeClockIntentLite: (s: string) => boolean;
        };
        forceClock =
          (isWakeAlarmIntent(rewritten) && hasClockHint(rewritten)) ||
          looksLikeClockIntentLite(rewritten);
      } catch {
        forceClock = false;
      }
    }
    if (forceClock) {
      try {
        const { takeChoiceFastPath } = await import('./choiceTurnContext');
        // Armed Choice verwerfen — Timer/Wecker schlägt Options-Tap.
        takeChoiceFastPath();
      } catch {
        /* soft */
      }
      const { tryEarlyJustDoIt } = await import(
        '../../services/concierge/earlyJustDoIt'
      );
      const earlyClock = await tryEarlyJustDoIt(rewritten);
      if (
        earlyClock?.speech &&
        (earlyClock.kind === 'timer' || earlyClock.kind === 'wake')
      ) {
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: earlyClock.speech,
            visualBullets: (earlyClock.bullets ?? []).slice(0, 1),
            quickActions: (earlyClock.quickActions ?? []).slice(0, 5),
            cardTitle: earlyClock.cardTitle,
          },
          {
            userText: rewritten,
            skipAutoNav: true,
            skipButlerRemind: true,
            skipAlarmBackgroundTasks: true,
          },
        );
        const logic: LogicNodeOutput = {
          spokenDraft: earlyClock.speech,
          bullets: (earlyClock.bullets ?? []).slice(0, 3),
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: earlyClock.speech,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: earlyClock.kind === 'timer' || earlyClock.kind === 'wake' ? 'memory' : 'day_plan_budget',
        };
      }
    }
  } catch (err) {
    console.warn('[runConciergeTurn] early timer/wake failed', err);
  }

  // choiceFast VOR Analyze (kein TDZ). Early Bridge läuft schon parallel (nach Rewrite).
  let choiceFast: import('./choiceTurnContext').ChoiceFastPathArm | null = null;
  try {
    const { takeChoiceFastPath } = await import('./choiceTurnContext');
    choiceFast = takeChoiceFastPath();
  } catch {
    choiceFast = null;
  }"""

if marker not in text:
    raise SystemExit("choiceFast marker not found")
if "early timer/wake failed" in text:
    print("early block already present")
else:
    text = text.replace(marker, early, 1)

# Guard nav_execute when timer
old_nav = """  // Call-1 sagte nav_execute → Hard-Dest / Mode-Switch. Kein Keyword-Steal mehr.
  try {
    if (call1Execution === 'nav_execute') {
      const forceExplicitNav = true;"""

new_nav = """  // Call-1 sagte nav_execute → Hard-Dest / Mode-Switch. Kein Keyword-Steal mehr.
  try {
    let skipNavForClock = false;
    try {
      const { isTimerIntent } = require('../../services/alarms/timerService') as {
        isTimerIntent: (s: string) => boolean;
      };
      skipNavForClock = isTimerIntent(rewritten);
      if (!skipNavForClock) {
        const { isWakeAlarmIntent, hasClockHint } = require('../../services/alarms/wakeIntentDetect') as {
          isWakeAlarmIntent: (s: string) => boolean;
          hasClockHint: (s: string) => boolean;
        };
        skipNavForClock = isWakeAlarmIntent(rewritten) && hasClockHint(rewritten);
      }
    } catch {
      skipNavForClock = false;
    }
    if (call1Execution === 'nav_execute' && !skipNavForClock) {
      const forceExplicitNav = true;"""

if old_nav not in text:
    raise SystemExit("nav_execute marker not found")
if "skipNavForClock" not in text:
    text = text.replace(old_nav, new_nav, 1)

# Guard pending nav offer when timer
old_offer = """  // Nav-Angebot „Ja“ nach Call-1 — Compound (Ja + Wecker) nicht abbrechen.
  if (managerLane === 'nav') {
    try {
      const {
        shouldStartNavFromOffer,
        resolveNavOfferFromReply,
      } = await import('../../services/navigation/pendingOffer');
      const store = useFinnusStore.getState();
      if (
        shouldStartNavFromOffer(
          rewritten,
          store.pendingNavOffer,
          store.pendingNavAlternatives,
        )
      ) {"""

new_offer = """  // Nav-Angebot „Ja“ nach Call-1 — Compound (Ja + Wecker) nicht abbrechen.
  if (managerLane === 'nav') {
    try {
      let clockBlocksNavOffer = false;
      try {
        const { isTimerIntent } = require('../../services/alarms/timerService') as {
          isTimerIntent: (s: string) => boolean;
        };
        clockBlocksNavOffer = isTimerIntent(rewritten);
      } catch {
        clockBlocksNavOffer = false;
      }
      const {
        shouldStartNavFromOffer,
        resolveNavOfferFromReply,
      } = await import('../../services/navigation/pendingOffer');
      const store = useFinnusStore.getState();
      if (
        !clockBlocksNavOffer &&
        shouldStartNavFromOffer(
          rewritten,
          store.pendingNavOffer,
          store.pendingNavAlternatives,
        )
      ) {"""

if old_offer not in text:
    raise SystemExit("nav offer marker not found")
if "clockBlocksNavOffer" not in text:
    text = text.replace(old_offer, new_offer, 1)

# Fix skipAlarmBackgroundTasks for timer in late early-just-do-it
old_skip = """            skipAlarmBackgroundTasks: (() => {
              if (early.kind !== 'wake' && early.kind !== 'timer') return false;
              try {
                const {
                  looksLikeNativeWakeSpeech,
                } = require('../../services/alarms/ensureWakeNativePresent') as {
                  looksLikeNativeWakeSpeech: (s: string) => boolean;
                };
                return looksLikeNativeWakeSpeech(early.speech);
              } catch {
                return early.kind === 'wake' || early.kind === 'timer';
              }
            })(),"""

new_skip = """            skipAlarmBackgroundTasks: (() => {
              if (early.kind === 'timer') return true;
              if (early.kind !== 'wake') return false;
              try {
                const {
                  looksLikeNativeWakeSpeech,
                } = require('../../services/alarms/ensureWakeNativePresent') as {
                  looksLikeNativeWakeSpeech: (s: string) => boolean;
                };
                return looksLikeNativeWakeSpeech(early.speech);
              } catch {
                return true;
              }
            })(),"""

if old_skip not in text:
    raise SystemExit("skipAlarm marker not found")
text = text.replace(old_skip, new_skip, 1)

tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live7\_runConciergeTurn_timer_patch.ts")
tmp.write_text(text, encoding="utf-8")
p.write_text(text, encoding="utf-8")
print("runConciergeTurn patched", len(text))
