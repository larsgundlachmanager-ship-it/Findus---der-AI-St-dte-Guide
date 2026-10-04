/**
 * Letzte Yorro-Antwort wiederholen — Just-Do-It, kein neuer Call-2.
 */

export type LastReplayableSpeech = {
  speech: string;
  bullets: string[];
  cardTitle: string | null;
  atMs: number;
};

let last: LastReplayableSpeech | null = null;

const MAX_SPEECH = 4000;

/**
 * Kurzer Wiederhol-Befehl (stadt-agnostisch).
 * Kein Match bei „nochmal andere Optionen“ / „nochmal suchen“.
 */
export function isRepeatLastSpeechIntent(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 72) return false;
  if (
    /\b(andere|neu\s*suchen|option|restaurant|hotel|route|flug|essen|suche|such|plan|navigier|wecker|timer)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  if (
    /^(?:(?:bitte\s+)?(?:noch\s*mal|nochmals|noch\s*einmal)(?:\s+(?:bitte|sagen|wiederholen|wiederhole|wieder\s*holen))?|(?:bitte\s+)?wiederhol(?:e|en)?(?:\s+(?:das|bitte|das\s+bitte))?|(?:bitte\s+)?wieder\s*holen(?:\s+(?:das|bitte))?|(?:sag(?:e)?\s+(?:das|es|mir\s+das)\s+noch\s*mal)|(?:was\s+hast\s+du\s+(?:gerade\s+)?gesagt)|(?:noch\s*mal\s+wiederhol(?:en|e)?)|(?:noch\s*mal\s+wieder\s*holen)|(?:kannst\s+du\s+das\s+(?:noch\s*mal\s+)?wiederholen))\s*[.!?]?$/iu.test(
      t,
    )
  ) {
    return true;
  }
  // „noch mal wiederholen“ / „bitte wiederholen“ ohne Extra-Thema
  if (
    /\b(wiederhol(?:e|en)?|wieder\s*holen|noch\s*mal\s+sagen)\b/iu.test(t) &&
    t.split(/\s+/).length <= 6
  ) {
    return true;
  }
  return false;
}

/** Speichert die zuletzt gesprochene Hauptantwort (Display-Text). */
export function noteLastReplayableSpeech(opts: {
  speech: string;
  bullets?: string[] | null;
  cardTitle?: string | null;
  /** Replay selbst nicht als neue Quelle überschreiben. */
  isReplay?: boolean;
}): void {
  if (opts.isReplay) return;
  const speech = (opts.speech || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SPEECH);
  if (speech.length < 8) return;
  // Meta-Acks / reine Bridge nicht als „letzte Antwort“ merken
  if (
    /^(alles\s+klar|ok(?:ay)?|verstanden|moment|einen\s+augenblick)\b/iu.test(speech) &&
    speech.length < 48
  ) {
    return;
  }
  last = {
    speech,
    bullets: (opts.bullets ?? []).map((b) => String(b).trim()).filter(Boolean).slice(0, 3),
    cardTitle: opts.cardTitle?.trim() || null,
    atMs: Date.now(),
  };
}

export function getLastReplayableSpeech(): LastReplayableSpeech | null {
  return last;
}

export function clearLastReplayableSpeech(): void {
  last = null;
}

export function buildRepeatLastSpeechResult(): {
  speech: string;
  bullets: string[];
  cardTitle: string;
} {
  const snap = last;
  if (!snap?.speech) {
    return {
      speech: 'Hab gerade nichts zum Wiederholen — stell mir die Frage nochmal.',
      bullets: [],
      cardTitle: 'Wiederholen',
    };
  }
  return {
    speech: snap.speech,
    bullets: snap.bullets,
    cardTitle: snap.cardTitle || 'Wiederholen',
  };
}
