/**
 * Phase 2 — Deep Content Filter & Persona Generator.
 * Filtert Fakten, generiert Hauptteil im Hintergrund, streamt Satz für Satz.
 */

import type { PoiWithFacts } from '../../db/types';
import {
  buildContextAwareOfflineNarration,
  buildDeepStoryPrompt,
} from './PromptBuilderService';
import type { VisitedHistory } from './types';
import {
  extractCompletedSentences,
  sentencesFromFullText,
} from './sentenceStream';
import { streamPromptSentences } from '../localAiService';
import { getCachedUserProfile } from '../userProfileService';
import { createDefaultProfile } from '../../types/userProfile';

export type DeepStoryInput = {
  poi: PoiWithFacts;
  fastHook: string;
  sessionMemory?: VisitedHistory;
};

/**
 * Offline-Fallback: Hauptteil ohne den bereits gesprochenen Hook.
 */
function buildOfflineDeepStory(input: DeepStoryInput): string {
  const profile = getCachedUserProfile() ?? createDefaultProfile();
  const full = buildContextAwareOfflineNarration(
    input.poi,
    profile,
    input.sessionMemory,
  );

  const hookNorm = input.fastHook.trim().toLowerCase();
  const sentences = full
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const body = sentences.filter(
    (s) => !hookNorm.includes(s.toLowerCase().slice(0, 20)),
  );

  if (body.length === 0 && sentences.length > 1) {
    return sentences.slice(1).join(' ');
  }
  if (body.length === 0) {
    return `Hier bei ${input.poi.name} gibt es einiges zu entdecken — schau dich gern um.`;
  }
  return body.join(' ');
}

/**
 * Streamt den Deep-Story-Hauptteil Satz für Satz (Phase 2 → Phase 3).
 */
export async function* streamDeepStory(
  input: DeepStoryInput,
): AsyncGenerator<string, void, unknown> {
  const profile = getCachedUserProfile() ?? createDefaultProfile();
  const prompt = buildDeepStoryPrompt(
    input.poi,
    profile,
    input.fastHook,
    input.sessionMemory,
  );

  try {
    let yielded = false;
    for await (const sentence of streamPromptSentences(prompt)) {
      const clean = sentence.replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      yielded = true;
      // Rohsatz an Kokoro — keine Post-Polish (zerstört G2P)
      yield clean;
    }
    if (yielded) return;
  } catch (error) {
    console.warn('[deepStory] LLM stream failed, using offline:', error);
  }

  const offline = buildOfflineDeepStory(input);
  yield* sentencesFromFullText(offline);
}

/** Volltext für Chat-Log (alle Deep-Story-Sätze). */
export async function collectDeepStory(input: DeepStoryInput): Promise<string> {
  const parts: string[] = [];
  for await (const s of streamDeepStory(input)) {
    parts.push(s);
  }
  return parts.join(' ').trim();
}

/** Intern: Satz-Extraktion aus Token-Buffer (für Tests). */
export { extractCompletedSentences };
