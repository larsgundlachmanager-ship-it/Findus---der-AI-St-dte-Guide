/**
 * Safety-Net: Wake-Intent → Native Clock, bevor Card/TTS LLM-„gestellt“ zeigen.
 * presentToUi und Synthesis-Pfad umgehen sonst presentConciergeResponse.
 */

import type { QuickAction } from '../../types/concierge';

export type EnsuredWakePresent = {
  speech: string;
  bullets: string[];
  quickActions: QuickAction[];
  cardTitle: string;
};

/** True wenn Speech schon aus Native-Confirm kommt (nicht nochmal stellen). */
export function looksLikeNativeWakeSpeech(speech: string): boolean {
  const s = (speech || '').trim();
  if (!s) return false;
  if (/^Alles klar,\s*ich habe den Wecker/iu.test(s)) return true;
  if (/^Yo,\s*hab den Wecker/iu.test(s)) return true; // legacy
  if (/^Du hast schon einen Wecker auf /iu.test(s)) return true;
  if (/^Schon ein Wecker um /iu.test(s)) return true; // legacy
  if (/Willst du die Zeit aktualisieren/iu.test(s)) return true;
  if (/Wecker auf .+ ging gerade nicht/iu.test(s)) return true;
  if (/ging gerade nicht|Clock|Uhr-App/iu.test(s) && /Wecker/iu.test(s)) {
    return true;
  }
  return false;
}

/** LLM-Fake ohne Native („Wecker gestellt auf 7:57“). */
export function looksLikeFakeWakeClaim(speech: string): boolean {
  const s = (speech || '').trim();
  if (!s || looksLikeNativeWakeSpeech(s)) return false;
  return (
    /Wecker gestellt auf/iu.test(s) ||
    /Wecker (?:ist|wurde) (?:auf|um) .{0,12} gestellt/iu.test(s)
  );
}

/**
 * Wenn User-Text Wecker/Timer meint: Native ausführen und Speech ersetzen.
 * Idempotent wenn Speech schon Native-Confirm ist.
 */
export async function ensureWakeNativeBeforePresent(
  userText: string | null | undefined,
  currentSpeech: string,
): Promise<EnsuredWakePresent | null> {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
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
    if (!isClockIntent(t)) return null;
    const clock = await prepareClockIntentFollowUp(t);
    if (!clock?.speech) return null;
    return {
      speech: clock.speech,
      bullets: clock.bullets ?? [],
      quickActions: clock.quickActions ?? [],
      cardTitle: clock.cardTitle || (clock.kind === 'timer' ? 'Timer' : 'Wecker'),
    };
  } catch (err) {
    console.warn('[ensureWakeNative] failed', err);
    return null;
  }
}
