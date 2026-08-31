/**
 * Ein Satz-Strom für eine TTS-Session: Push während LLM/Synthese,
 * Consumer spielt mit Prefetch (Satz 3 spricht → 4 bereit, 5+6 in Arbeit).
 * TTS_SENTENCE_PIPELINE_LOCK
 */

export type LiveSentencePump = {
  push: (text: string) => void;
  end: () => void;
  sentences: AsyncIterable<string>;
  /** true nach dem ersten Start der TTS-Session. */
  hasStarted: () => boolean;
  /** true genau beim ersten Aufruf — danach false. */
  markStarted: () => boolean;
  isEnded: () => boolean;
};

/** Rest nach einem schon gesprochenen Lead — sonst endet die TTS nach Satz 1. */
export function remainingSpeechAfterLead(full: string, lead: string): string {
  const f = (full || '').replace(/\s+/g, ' ').trim();
  const l = (lead || '').replace(/\s+/g, ' ').trim();
  if (!f) return '';
  if (!l) return f;
  if (f === l) return '';
  const fLow = f.toLowerCase();
  const lLow = l.toLowerCase();
  if (fLow.startsWith(lLow)) {
    return f.slice(l.length).replace(/^[\s.,;:–—-]+/, '').trim();
  }
  const head = l.slice(0, Math.min(40, l.length)).toLowerCase();
  if (head.length >= 12 && fLow.startsWith(head)) {
    const cut = f.search(/[.!?]/);
    if (cut > 0 && cut < 280) return f.slice(cut + 1).trim();
  }
  return '';
}

export function createLiveSentencePump(): LiveSentencePump {
  const q: string[] = [];
  let closed = false;
  let started = false;
  let wake: (() => void) | null = null;

  const kick = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  return {
    push(text) {
      const t = (text ?? '').replace(/\s+/g, ' ').trim();
      if (!t || closed) return;
      q.push(t);
      kick();
    },
    end() {
      if (closed) return;
      closed = true;
      kick();
    },
    hasStarted: () => started,
    markStarted: () => {
      if (started) return false;
      started = true;
      return true;
    },
    isEnded: () => closed,
    sentences: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (q.length > 0) {
            yield q.shift()!;
            continue;
          }
          if (closed) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
            if (q.length > 0 || closed) resolve();
          });
        }
      },
    },
  };
}
