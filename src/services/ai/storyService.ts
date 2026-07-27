/**
 * Story-Engine: Single-Shot Gemini (Master-Prompt) → TTS-Sätze.
 * Legacy chain-v1 / FastHook-Stitching entfernt.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { createDefaultProfile } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import type { SessionMemory } from './sessionMemory';
import type { FindusStoryBrief } from './findusTourDirector';
import {
  beginSingleShotStoryStream,
  extractOfflineGeneralInfo,
  streamFindusStorySentences,
} from './singleShotStory';
import { classifyPoiHookKind } from './fastHook';

export type StoryStreamInput = {
  poi: PoiWithFacts;
  /** @deprecated Ignoriert — Single-Shot schreibt die ganze Story. */
  fastHook?: string;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
  tourBrief?: FindusStoryBrief | null;
};

export type HookThenStoryResult = {
  hook: string;
  body: AsyncGenerator<string, void, unknown>;
};

/**
 * Primärer Einstieg für POI-Trigger / speakTwoPhase.
 * Ein Gemini-Call; Satz 1 = Hook, Rest = Body. Offline = general_info.
 */
export async function beginHookResolvingStream(
  input: {
    poi: PoiWithFacts;
    profile?: UserProfile | null;
    sessionMemory?: SessionMemory | null;
    tourBrief?: FindusStoryBrief | null;
    approachAlreadyHeard?: boolean;
  },
  _options?: { hookTimeoutMs?: number; factTimeoutMs?: number },
): Promise<{
  hook: string;
  bodySentenceStream: AsyncIterable<string>;
  usedLlmHook: boolean;
  pipeline: 'single-shot-v1';
}> {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();

  const started = await beginSingleShotStoryStream({
    poi: input.poi,
    profile,
    sessionMemory: input.sessionMemory,
    mode: 'arrival',
    approachAlreadyHeard: input.approachAlreadyHeard,
    // Ein Call braucht Luft — keine 2.5s-Kette mehr
    timeoutMs: 22000,
  });

  return {
    hook: started.hook,
    bodySentenceStream: started.bodySentenceStream,
    usedLlmHook: started.usedLlm,
    pipeline: 'single-shot-v1',
  };
}

/** Volle Story satzweise (ohne Hook/Body-Split). */
export async function* streamDeepStory(
  input: StoryStreamInput,
): AsyncGenerator<string, void, unknown> {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  yield* streamFindusStorySentences({
    poi: input.poi,
    profile,
    sessionMemory: input.sessionMemory,
    mode: 'arrival',
    timeoutMs: 22000,
  });
}

export async function* streamHookResolvingNarration(input: {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
  tourBrief?: FindusStoryBrief | null;
}): AsyncGenerator<string, void, unknown> {
  const started = await beginHookResolvingStream(input);
  if (started.hook) yield started.hook;
  for await (const s of started.bodySentenceStream) {
    yield s;
  }
}

/** Offline-Notiz: nur general_info / Erzählung. */
export function buildOfflineDeepStory(
  input: StoryStreamInput,
  _filteredPoi?: PoiWithFacts,
  _profile?: UserProfile | null,
): string {
  return (
    extractOfflineGeneralInfo(input.poi) ||
    'Offline liegt für diesen Ort keine fertige Erzählung vor.'
  );
}

export function toStampBullets(texts: string[], max = 3): string[] {
  return texts
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, max);
}

export function buildVisitedMemoryEntry(
  poi: PoiWithFacts,
  keyFacts: string[],
): {
  poiId: number;
  name: string;
  kind: ReturnType<typeof classifyPoiHookKind>;
  keyFacts: string[];
  visitedAt: number;
} {
  return {
    poiId: poi.id,
    name: poi.name,
    kind: classifyPoiHookKind(poi),
    keyFacts,
    visitedAt: Date.now(),
  };
}

/** @deprecated Alias — Single-Shot. */
export const beginChainedStoryStream = beginHookResolvingStream;

export {
  extractOfflineGeneralInfo,
  streamFindusStorySentences,
  beginSingleShotStoryStream,
};
