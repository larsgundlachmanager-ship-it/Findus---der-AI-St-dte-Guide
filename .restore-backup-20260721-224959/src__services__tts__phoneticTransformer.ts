/**
 * Phase 3 — Pass-through vor Kokoro.
 * Keine Text-Mutation. G2P läuft nur in AudioVoiceService.textToTokens.
 */

import type { FindusPersonality } from '../ai/types';

export type PhoneticTransformOptions = {
  personality?: FindusPersonality;
  isRhyme?: boolean;
};

/** Identity: nur Whitespace normalisieren. */
export function transformPhoneticSentence(
  text: string,
  _options?: PhoneticTransformOptions,
): string {
  return text.replace(/\s+/g, ' ').trim();
}

export async function transformPhoneticSentenceAsync(
  text: string,
  options?: PhoneticTransformOptions,
): Promise<string> {
  return transformPhoneticSentence(text, options);
}

export function transformPhoneticText(
  text: string,
  options?: PhoneticTransformOptions,
): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => transformPhoneticSentence(s.trim(), options))
    .filter(Boolean)
    .join(' ');
}
