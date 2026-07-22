/**
 * Story-Engine: kontextbezogener Fast Hook + sofortige Auflösung.
 * Erster LLM-Satz = Hook; Folgesätze lösen das Versprechen ein.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { createDefaultProfile } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import { filterDeepStoryFacts } from './deepStoryFilter';
import {
  buildContextAwareOfflineNarration,
  buildDeepStoryPrompt,
  extractKeyFactsFromNarrationFacts,
  resolvePromptStyleSettings,
} from './promptBuilder';
import { buildFastHook, classifyPoiHookKind } from './fastHook';
import { sentencesFromFullText } from './sentenceStream';
import type { SessionMemory, VisitedPlaceMemory } from './sessionMemory';
import { streamPromptSentences } from '../localAiService';

export type StoryStreamInput = {
  poi: PoiWithFacts;
  /** Bereits gesprochener Hook — Deep Story muss ihn auflösen. */
  fastHook: string;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
};

export type HookThenStoryResult = {
  /** Erster Satz (Hook) — sofort sprechen. */
  hook: string;
  /** Restliche Sätze (Auflösung + Story). */
  body: AsyncGenerator<string, void, unknown>;
};

function filteredPoiFromDeep(
  poi: PoiWithFacts,
  deep: ReturnType<typeof filterDeepStoryFacts>,
): PoiWithFacts {
  return {
    ...poi,
    facts: deep.facts.map((f) => ({
      id: f.id,
      poi_id: poi.id,
      fact_text: f.text,
    })),
  };
}

/**
 * Streamt nur den Hauptteil — Fast Hook wurde bereits gesprochen.
 * Erster Satz MUSS das Hook-Versprechen einlösen.
 */
export async function* streamDeepStory(
  input: StoryStreamInput,
): AsyncGenerator<string, void, unknown> {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const deep = filterDeepStoryFacts(input.poi, {
    profile,
    sessionMemory: input.sessionMemory,
  });
  const filteredPoi = filteredPoiFromDeep(input.poi, deep);

  const prompt = buildDeepStoryPrompt({
    poi: filteredPoi,
    profile,
    fastHook: input.fastHook,
    sessionMemory: input.sessionMemory,
    yearsPreference: deep.yearsPreference,
    hoursHint: deep.hoursHint,
    includeHook: false,
  });

  try {
    let yielded = false;
    for await (const sentence of streamPromptSentences(prompt)) {
      const clean = sentence.replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      if (
        !yielded &&
        input.fastHook &&
        clean
          .toLowerCase()
          .startsWith(input.fastHook.slice(0, 16).toLowerCase())
      ) {
        continue;
      }
      yielded = true;
      yield clean;
    }
    if (yielded) return;
  } catch (error) {
    console.warn('[storyService] LLM stream failed, offline:', error);
  }

  const offline = buildOfflineDeepStory(input, filteredPoi, profile);
  yield* sentencesFromFullText(offline);
}

/**
 * Ein Stream: Satz 1 = kontextbezogener Hook, Satz 2+ = Auflösung + Story.
 */
export async function* streamHookResolvingNarration(input: {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
}): AsyncGenerator<string, void, unknown> {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const deep = filterDeepStoryFacts(input.poi, {
    profile,
    sessionMemory: input.sessionMemory,
  });
  const filteredPoi = filteredPoiFromDeep(input.poi, deep);

  const prompt = buildDeepStoryPrompt({
    poi: filteredPoi,
    profile,
    fastHook: '',
    sessionMemory: input.sessionMemory,
    yearsPreference: deep.yearsPreference,
    hoursHint: deep.hoursHint,
    includeHook: true,
  });

  try {
    let count = 0;
    for await (const sentence of streamPromptSentences(prompt)) {
      const clean = sentence.replace(/\s+/g, ' ').trim();
      if (!clean) continue;
      count += 1;
      yield clean;
    }
    if (count > 0) return;
  } catch (error) {
    console.warn('[storyService] hook+story stream failed, offline:', error);
  }

  const fallbackHook = buildFastHook(
    input.poi,
    profile,
    input.sessionMemory,
  );
  yield fallbackHook;
  const offline = buildContextAwareOfflineNarration(
    filteredPoi,
    profile,
    input.sessionMemory,
  );
  yield* sentencesFromFullText(offline);
}

/**
 * Ein LLM-Stream: Satz 1 = kontextbezogener Fast Hook, Rest = Auflösung + Story.
 * Timeout: fakt-basierter Template-Hook + neuer Deep-Story-Stream, der genau
 * diesen Hook auflöst (kein Clickbait-Mismatch).
 */
export async function beginHookResolvingStream(
  input: {
    poi: PoiWithFacts;
    profile?: UserProfile | null;
    sessionMemory?: SessionMemory | null;
  },
  options?: { hookTimeoutMs?: number },
): Promise<{
  hook: string;
  bodySentenceStream: AsyncIterable<string>;
  usedLlmHook: boolean;
}> {
  const timeoutMs = options?.hookTimeoutMs ?? 1100;
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const fallbackHook = buildFastHook(
    input.poi,
    profile,
    input.sessionMemory,
  );

  const iterator = streamHookResolvingNarration(input)[Symbol.asyncIterator]();

  type Race =
    | { kind: 'llm'; sentence: string }
    | { kind: 'timeout' }
    | { kind: 'empty' };

  const first = await Promise.race<Race>([
    iterator.next().then((r) =>
      r.done || !r.value?.trim()
        ? ({ kind: 'empty' } as const)
        : ({ kind: 'llm', sentence: r.value.trim() } as const),
    ),
    new Promise<Race>((resolve) =>
      setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs),
    ),
  ]);

  if (first.kind === 'llm') {
    async function* bodyFromLlm(): AsyncGenerator<string, void, unknown> {
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        const s = next.value?.trim();
        if (s) yield s;
      }
    }
    return {
      hook: first.sentence,
      bodySentenceStream: bodyFromLlm(),
      usedLlmHook: true,
    };
  }

  // Timeout/leer: Template-Hook + neuer Stream, der GENAU diesen Hook auflöst.
  // Iterator nicht weiter lesen (kein paralleles next() — sonst Doppel-Konsum).
  async function* bodyFromDeep(): AsyncGenerator<string, void, unknown> {
    for await (const sentence of streamDeepStory({
      poi: input.poi,
      profile,
      sessionMemory: input.sessionMemory,
      fastHook: fallbackHook,
    })) {
      yield sentence;
    }
  }

  return {
    hook: fallbackHook,
    bodySentenceStream: bodyFromDeep(),
    usedLlmHook: false,
  };
}

function buildOfflineDeepStory(
  input: StoryStreamInput,
  filteredPoi: PoiWithFacts,
  profile: UserProfile,
): string {
  const full = buildContextAwareOfflineNarration(
    filteredPoi,
    profile,
    input.sessionMemory,
  );
  const hook = input.fastHook.trim();
  const resolution = hook
    ? `Genau deshalb: ${hook.replace(/\?$/, '.')} Die Fakten dazu stecken in dem, was du hier siehst.`
    : null;
  const hookNorm = hook.toLowerCase();
  const parts = full
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !hookNorm.includes(s.toLowerCase().slice(0, 18)));

  return [resolution, ...parts].filter(Boolean).join(' ');
}

export async function collectDeepStory(
  input: StoryStreamInput,
): Promise<string> {
  const parts: string[] = [];
  for await (const s of streamDeepStory(input)) {
    parts.push(s);
  }
  return parts.join(' ').trim();
}

/** Memory-Eintrag nach erfolgreicher Station. */
export function buildVisitedMemoryEntry(
  poi: PoiWithFacts,
  spokenFacts?: string[],
): VisitedPlaceMemory {
  const deep = filterDeepStoryFacts(poi);
  return {
    poiId: poi.id,
    name: poi.name,
    kind: classifyPoiHookKind(poi),
    keyFacts:
      spokenFacts?.slice(0, 3) ??
      extractKeyFactsFromNarrationFacts(deep.facts.map((f) => f.text)),
    visitedAt: Date.now(),
  };
}

export { resolvePromptStyleSettings };
