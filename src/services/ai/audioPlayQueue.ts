/**
 * AudioPlayQueue — Satz-für-Satz mit festem Vorlauf (Default: 2).
 * Produzent (LLM/Kokoro) füllt, Konsument spielt lückenlos ab.
 */

export type AudioPlayQueueItem = {
  uri: string;
  text: string;
};

export type AudioPlayQueue = {
  /** Ziel-Vorlauf in fertigen Audio-Chunks (nicht inkl. aktuell spielend). */
  readonly targetLookahead: number;
  push(item: AudioPlayQueueItem): void;
  close(error?: unknown): void;
  /** Wartet, bis Platz unter targetLookahead ist (für Producer-Throttle). */
  waitForSlot(): Promise<void>;
  /** Nächstes fertiges Item (oder null wenn geschlossen & leer). */
  take(): Promise<AudioPlayQueueItem | null>;
  get size(): number;
  get closed(): boolean;
};

export function createAudioPlayQueue(
  targetLookahead: number = 2,
): AudioPlayQueue {
  const pending: AudioPlayQueueItem[] = [];
  let wakeTake: (() => void) | null = null;
  let wakeSlot: (() => void) | null = null;
  let closed = false;
  let fail: unknown = null;

  const notifyTake = () => {
    const w = wakeTake;
    wakeTake = null;
    w?.();
  };
  const notifySlot = () => {
    const w = wakeSlot;
    wakeSlot = null;
    w?.();
  };

  return {
    targetLookahead,
    get size() {
      return pending.length;
    },
    get closed() {
      return closed;
    },
    push(item: AudioPlayQueueItem) {
      if (closed) return;
      if (!item.uri || !item.text.trim()) return;
      pending.push(item);
      notifyTake();
    },
    close(error?: unknown) {
      if (closed) return;
      closed = true;
      if (error !== undefined) fail = error;
      notifyTake();
      notifySlot();
    },
    waitForSlot() {
      return new Promise<void>((resolve) => {
        if (closed || pending.length < targetLookahead) {
          resolve();
          return;
        }
        wakeSlot = resolve;
      });
    },
    async take() {
      while (!closed || pending.length > 0) {
        if (pending.length === 0) {
          if (closed) break;
          await new Promise<void>((r) => {
            wakeTake = r;
          });
          continue;
        }
        const item = pending.shift()!;
        notifySlot();
        return item;
      }
      if (fail) throw fail;
      return null;
    },
  };
}
