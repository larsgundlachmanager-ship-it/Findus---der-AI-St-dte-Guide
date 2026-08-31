/**
 * Live-Untertitel SSOT — Wort-Feed + Konstanten.
 * Layout: `SubtitlesSlot` (genau 1 Zeile).
 */

export const DEFAULT_SUBTITLE_MAX_CHARS = 78;

/** Rise: 5 Frames @24fps — nur innerhalb der Lane (kein 3-Zeilen-Artefakt). */
export const SUBTITLE_RISE_FRAMES = 5;
export const SUBTITLE_ASSUME_FPS = 24;
export const SUBTITLE_RISE_MS = Math.round(
  (1000 * SUBTITLE_RISE_FRAMES) / SUBTITLE_ASSUME_FPS,
); // ≈208
export const SUBTITLE_RISE_PX = 12;
export const SUBTITLE_RISE_EASING: readonly [number, number, number, number] = [
  0.33, 0.0, 0.2, 1,
];

export const SUBTITLE_LANE_GAP = 10;
export const SUBTITLE_LANE_HEIGHT = 22;

/** Andere Zeile ausfaden beim vorletzten Wort. */
export const SUBTITLE_LINE_FADE_MS = 280;

/** 5s ohne neues Wort → langsam ausblenden. */
export const SUBTITLE_IDLE_HOLD_MS = 5000;
export const SUBTITLE_IDLE_FADE_MS = 600;

export const SUBTITLE_WORD_GAP = 7;
export const SUBTITLE_WIDTH_SAFETY_PX = 10;

/**
 * Mini-Lead, damit das Wort mit dem Einsatz kommt — nicht ½ s vor der Stimme.
 * Große Leads + früher Volltext = Untertitel hetzen oder hängen.
 */
export const SUBTITLE_LEAD_MS = 80;

export const FINDUS_KINETIC_SUBTITLE_PROMPT = `
KINETISCHE UNTERTITEL — 1 ZEILE
Dies sind nur Regeln für Ablauf und Layout. Kein fester Wortlaut.

1) Wort für Wort, 1:1 zur Stimme, linksbündig, fester gleicher Gap.
2) Genau 1 Zeile — von links nach rechts.
3) Satzende knüpft in derselben Zeile an (keine neue Zeile).
4) Passt das nächste Wort nicht → Zeile ausfaden, neu von links.
5) Nach 5s ohne neues Wort: langsam ausblenden/clear.
`.trim();

export function isSubtitleSentenceEndWord(word: string): boolean {
  const t = word.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/[!?…]["'»)\]]*$/u.test(t)) return true;
  if (!/\.["'»)\]]*$/u.test(t)) return false;
  const bare = t.replace(/["'»)\]]+$/u, '');
  if (/^\d+\.$/.test(bare)) return false;
  if (
    /^(z\.B|usw|etc|Dr|Mr|Mrs|Nr|Abs|bzw|ca|inkl|exkl|vgl|u\.a|d\.h|m\.E)\.?$/i.test(
      bare,
    )
  ) {
    return false;
  }
  if (/^[A-Za-zÄÖÜäöüß]\.$/u.test(bare)) return false;
  return true;
}

export function splitSubtitleWords(text: string): string[] {
  return text.replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

/** Buchstaben/Ziffern — lange Komposita bekommen mehr Sprechzeit. */
export function subtitleWordWeight(word: string): number {
  let n = 0;
  for (const ch of word) {
    if (/[\p{L}\p{N}]/u.test(ch)) n += 1;
  }
  return Math.max(1, n);
}

export function subtitleWordCountAtElapsed(
  words: readonly string[],
  elapsedMs: number,
  durationMs: number,
): number {
  if (words.length === 0) return 0;
  const dur = Math.max(400, durationMs);
  const t = elapsedMs + SUBTITLE_LEAD_MS;
  if (t >= dur * 0.995) return words.length;
  const weights = words.map(subtitleWordWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  const target = Math.max(0, (t / dur) * total);
  let acc = 0;
  let count = 0;
  for (let i = 0; i < words.length; i++) {
    if (target + 1e-9 < acc) break;
    count = i + 1;
    acc += weights[i]!;
  }
  return Math.min(words.length, Math.max(1, count));
}

export function subtitleWordCountAtProgress(
  wordCount: number,
  progress01: number,
  durMs: number,
): number {
  if (wordCount <= 0) return 0;
  const p = Math.min(1, Math.max(0, progress01));
  if (p >= 0.995) return wordCount;
  const dummy = Array.from({ length: wordCount }, () => 'x');
  return subtitleWordCountAtElapsed(dummy, p * Math.max(400, durMs), durMs);
}

/** Karaoke-Pace wenn der ganze Satz auf einmal ankommt. */
export function subtitleWordRevealDelayMs(
  word: string,
  queuedBehind: number,
  karaoke: boolean,
): number {
  const base = Math.min(280, Math.max(64, subtitleWordWeight(word) * 52));
  if (queuedBehind >= 6) return 28;
  if (karaoke) return base;
  if (queuedBehind >= 3) return 40;
  if (queuedBehind >= 1) return Math.min(80, Math.round(base / 2));
  return 0;
}

export type LiveSubtitlePlan = {
  full: string;
};

export function buildLiveSubtitlePlan(text: string): LiveSubtitlePlan {
  return { full: text.replace(/\s+/g, ' ').trim() };
}

export function estimateSpeechDurationMs(text: string): number {
  const n = text.replace(/\s+/g, ' ').trim().length;
  return Math.max(900, Math.round(n * 68));
}

/** 1:1 wortweise — alle bereits gesprochenen Wörter. */
export function subtitleAtProgress(
  plan: LiveSubtitlePlan,
  progress01: number,
  durationMs?: number,
): string | null {
  const { full } = plan;
  if (!full) return null;
  const words = splitSubtitleWords(full);
  if (words.length === 0) return null;
  const durMs = Math.max(400, durationMs ?? estimateSpeechDurationMs(full));
  const p = Math.min(1, Math.max(0, progress01));
  const count = subtitleWordCountAtElapsed(words, p * durMs, durMs);
  return words.slice(0, count).join(' ');
}

/** Expo-Speech onBoundary: Wort erscheint, sobald die Stimme es anfasst. */
export function subtitleUpToCharIndex(
  text: string,
  charIndex: number,
): string | null {
  const words = splitSubtitleWords(text);
  if (words.length === 0) return null;
  let pos = 0;
  let count = 0;
  for (const w of words) {
    if (charIndex >= pos) count += 1;
    else break;
    pos += w.length + 1;
  }
  return words.slice(0, Math.max(1, count)).join(' ');
}

/**
 * Slot vs. Store: Store ist der gesprochene Stand.
 * - Weiter wachsen → nur neue Wörter.
 * - 1–2 Wörter zurück → Jitter, ignorieren.
 * - Sprung auf kurzen Prefix → neuer Turn, Zeile neu.
 */
export function subtitleFeedAdvance(
  emitted: readonly string[],
  feedWords: readonly string[],
): { pending: string[]; reset: boolean } {
  if (feedWords.length === 0) return { pending: [], reset: true };
  if (emitted.length === 0) {
    return { pending: [...feedWords], reset: false };
  }
  const grows =
    feedWords.length >= emitted.length &&
    emitted.every((w, i) => feedWords[i] === w);
  if (grows) {
    return { pending: feedWords.slice(emitted.length).map(String), reset: false };
  }
  const shrinkPrefix =
    emitted.length > feedWords.length &&
    feedWords.every((w, i) => emitted[i] === w);
  if (shrinkPrefix && emitted.length - feedWords.length <= 2) {
    return { pending: [], reset: false };
  }
  return { pending: [...feedWords], reset: true };
}

export function mergeSubtitleCarry(
  prior: string | null | undefined,
  current: string | null,
): string | null {
  if (current == null) return current;
  const cur = current.replace(/\s+/g, ' ').trim();
  if (!cur) return cur;
  const prev = (prior ?? '').replace(/\s+/g, ' ').trim();
  if (!prev) return cur;
  return `${prev} ${cur}`;
}

export function createLiveSubtitleFeed(
  text: string,
  setSubtitle: (t: string | null) => void,
  durationMs?: number,
): {
  plan: LiveSubtitlePlan;
  updateProgress: (progress01: number, actualDurationMs?: number) => void;
  showInitial: () => void;
  showFinal: () => void;
} {
  const plan = buildLiveSubtitlePlan(text);
  let dur = Math.max(400, durationMs ?? estimateSpeechDurationMs(plan.full));
  let last: string | null | undefined = undefined;
  const push = (t: string | null) => {
    if (t === last) return;
    last = t;
    setSubtitle(t);
  };
  return {
    plan,
    showInitial: () => push(subtitleAtProgress(plan, 0, dur)),
    updateProgress: (progress01: number, actualDurationMs?: number) => {
      if (actualDurationMs && actualDurationMs > 0) dur = actualDurationMs;
      push(subtitleAtProgress(plan, progress01, dur));
    },
    showFinal: () => push(subtitleAtProgress(plan, 1, dur)),
  };
}

export async function runEstimatedLiveSubtitles(
  text: string,
  setSubtitle: (t: string | null) => void,
  speak: () => Promise<void>,
  isActive: () => boolean,
): Promise<void> {
  const feed = createLiveSubtitleFeed(text, setSubtitle);
  feed.showInitial();
  const dur = estimateSpeechDurationMs(text);
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (!isActive()) return;
    const p = (Date.now() - t0) / dur;
    feed.updateProgress(Math.min(1, Math.max(0, p)));
  }, 50);
  try {
    await speak();
  } finally {
    clearInterval(iv);
    feed.showFinal();
  }
}
