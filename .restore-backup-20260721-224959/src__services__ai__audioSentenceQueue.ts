/**
 * Producer-Consumer-Warteschlange mit eingebauter Phonetic-Transformation (Phase 3).
 * LLM/OpenAI → pushRaw → Phonetic Transformer → Queue → Kokoro.
 */

import { createBufferedSentenceQueue } from './bufferedSentenceQueue';
import {
  transformPhoneticSentence,
  transformPhoneticSentenceAsync,
  type PhoneticTransformOptions,
} from '../tts/phoneticTransformer';

export type PhoneticSentenceQueue = {
  /** Rohtext → Phase-3-Transform → Queue. */
  pushRaw(sentence: string): void;
  /** Async-Variante inkl. Stadt-Fremdwort-IPA. */
  pushRawAsync(sentence: string): Promise<void>;
  close(error?: unknown): void;
  iterate(): AsyncGenerator<string, void, unknown>;
};

export function createPhoneticSentenceQueue(
  options?: PhoneticTransformOptions,
): PhoneticSentenceQueue {
  const inner = createBufferedSentenceQueue();
  const opts = options ?? {};

  return {
    pushRaw(sentence: string) {
      const t = sentence.trim();
      if (!t) return;
      inner.push(transformPhoneticSentence(t, opts));
    },
    async pushRawAsync(sentence: string) {
      const t = sentence.trim();
      if (!t) return;
      inner.push(await transformPhoneticSentenceAsync(t, opts));
    },
    close(error?: unknown) {
      inner.close(error);
    },
    iterate() {
      return inner.iterate();
    },
  };
}
