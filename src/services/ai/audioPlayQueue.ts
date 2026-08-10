/**
 * AudioPlayQueue — fertige Audio-Chunks im RAM.
 *
 * Producer synthesisiert voraus (Lookahead), Consumer spielt FIFO.
 * targetLookahead=2: während Satz N spielt, liegen N+1 und N+2 schon bereit.
 */

export type AudioPlayQueueItem = {
  /** Fertige WAV-Bytes im RAM — wird erst abgespielt, wenn vollständig gerendert. */
  wavBytes: Uint8Array;
  text: string;
  /** Cloud-TTS: fertige Datei (WAV/MP3) statt wavBytes. */
  cloudUri?: string;
  /** @deprecated use cloudUri */
  openAiUri?: string;
};

export type AudioPlayQueue = {
  /** Ziel-Vorlauf in fertigen Audio-Chunks (nicht inkl. aktuell spielend). */
  readonly targetLookahead: number;
  push(item: AudioPlayQueueItem): void;
  close(error?: unknown): void;
  /** Wartet, bis Platz unter targetLookahead ist (sequentieller Producer-Throttle). */
  waitForSlot(): Promise<void>;
  /** Nächstes fertiges Item (oder null wenn geschlossen & leer). */
  take(): Promise<AudioPlayQueueItem | null>;
  get size(): number;
  get closed(): boolean;
};

export function createAudioPlayQueue(
  targetLookahead: number = 1,
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
      const hasAudio =
        Boolean(item.cloudUri) ||
        Boolean(item.openAiUri) ||
        Boolean(item.wavBytes?.length);
      if (!hasAudio || !item.text.trim()) return;
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
        // Solange Platz in der Queue ist ODER die Queue leer ist (erste Sätze sofort), erlaube Push.
        if (closed || pending.length < Math.max(1, targetLookahead)) {
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
        notifySlot(); // Platz freigeben, nachdem der Satz aus der Queue ENTNOMMEN wurde (wird jetzt abgespielt)
        return item;
      }
      if (fail) throw fail;
      return null;
    },
  };
}
