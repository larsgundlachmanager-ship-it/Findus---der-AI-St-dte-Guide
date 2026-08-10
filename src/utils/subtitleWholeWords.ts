/**
 * Live-Untertitel SSOT — Wort-Feed + Konstanten.
 * Layout: `SubtitlesSlot` (genau 1 Zeile).
 */

import { isProtectedDot } from '../services/audio/punctuationChunker';

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
 * Untertitel bewusst vor der Stimme — Wörter wirkten sonst immer ~1 Tick zu spät.
 */
export const SUBTITLE_LEAD_MS = 500;

export const FINDUS_KINETIC_SUBTITLE_PROMPT = `
KINETISCHE UNTERTITEL — 1 ZEILE
Dies sind nur Regeln für Ablauf und Layout. Kein fester Wortlaut.

1) Wort für Wort, 1:1 zur Stimme, linksbündig, fester gleicher Gap.
2) Genau 1 Zeile — von links nach rechts.
3) Passt das nächste Wort nicht / Satzende → Zeile ausfaden, neu von links.
4) Nach 5s ohne neues Wort: langsam ausblenden/clear.
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

export function subtitleWordCountAtProgress(
  wordCount: number,
  progress01: number,
  durMs: number,
): number {
  if (wordCount <= 0) return 0;
  const p = Math.min(1, Math.max(0, progress01));
  if (p >= 0.995) return wordCount;
  const safeDur = Math.max(400, durMs);
  const lead01 =
    SUBTITLE_LEAD_MS / safeDur +
    Math.min(1 / Math.max(1, wordCount), SUBTITLE_RISE_MS / safeDur);
  const displayP = Math.min(1, p + lead01);
  return Math.min(wordCount, Math.max(1, Math.ceil(displayP * wordCount)));
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
): string | null {
  const { full } = plan;
  if (!full) return null;
  const words = full.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const durMs = estimateSpeechDurationMs(full);
  const count = subtitleWordCountAtProgress(words.length, progress01, durMs);
  return words.slice(0, count).join(' ');
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
): {
  plan: LiveSubtitlePlan;
  updateProgress: (progress01: number) => void;
  showInitial: () => void;
  showFinal: () => void;
} {
  const plan = buildLiveSubtitlePlan(text);
  let last: string | null | undefined = undefined;
  const push = (t: string | null) => {
    if (t === last) return;
    last = t;
    setSubtitle(t);
  };
  return {
    plan,
    showInitial: () => push(subtitleAtProgress(plan, 0)),
    updateProgress: (progress01: number) =>
      push(subtitleAtProgress(plan, progress01)),
    showFinal: () => push(subtitleAtProgress(plan, 1)),
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
  }, 70);
  try {
    await speak();
  } finally {
    clearInterval(iv);
    feed.showFinal();
  }
}
