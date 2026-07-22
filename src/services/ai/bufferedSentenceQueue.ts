/**
 * Puffer-Queue: Produzent (LLM) läuft parallel zum Intro,
 * Konsument (TTS) liest Sätze sobald Intro fertig ist.
 */
export type BufferedSentenceQueue = {
  push(sentence: string): void;
  close(error?: unknown): void;
  iterate(): AsyncGenerator<string, void, unknown>;
};

export function createBufferedSentenceQueue(): BufferedSentenceQueue {
  const pending: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  let fail: unknown = null;

  const notify = () => {
    wake?.();
    wake = null;
  };

  return {
    push(sentence: string) {
      if (closed) return;
      const t = sentence.trim();
      if (!t) return;
      pending.push(t);
      notify();
    },
    close(error?: unknown) {
      if (closed) return;
      closed = true;
      if (error !== undefined) fail = error;
      notify();
    },
    async *iterate() {
      while (!closed || pending.length > 0) {
        if (pending.length === 0) {
          if (closed) break;
          await new Promise<void>((r) => {
            wake = r;
          });
          continue;
        }
        yield pending.shift()!;
      }
      if (fail) throw fail;
    },
  };
}
