/**
 * Story-Engine: leitet auf Modul-1-POI-Chat um (Reboot).
 * Kein Legacy-Single-Shot mehr im Live-Pfad.
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
import { shortPoiDisplayName } from '../../utils/poiDisplayName';

export type StoryStreamInput = {
  poi: PoiWithFacts;
  /** @deprecated Ignoriert â€” Single-Shot schreibt die ganze Story. */
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
 * PrimÃ¤rer Einstieg fÃ¼r POI-Trigger / speakTwoPhase.
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
    storyBriefBlock: input.tourBrief?.promptBlock ?? null,
    // Ein Call braucht Luft â€” keine 2.5s-Kette mehr
    timeoutMs: 22000,
  });

  return {
    hook: started.hook,
    bodySentenceStream: started.bodySentenceStream,
    usedLlmHook: started.usedLlm,
    pipeline: 'module1-poi-chat-v1' as 'single-shot-v1',
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
    storyBriefBlock: input.tourBrief?.promptBlock ?? null,
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

/** Offline-Notiz: nur general_info / ErzÃ¤hlung. */
export function buildOfflineDeepStory(
  input: StoryStreamInput,
  _filteredPoi?: PoiWithFacts,
  _profile?: UserProfile | null,
): string {
  return (
    extractOfflineGeneralInfo(input.poi) ||
    'Offline liegt fÃ¼r diesen Ort keine fertige ErzÃ¤hlung vor.'
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
  opts?: { onTimeline?: boolean },
): {
  poiId: number;
  name: string;
  kind: ReturnType<typeof classifyPoiHookKind>;
  keyFacts: string[];
  visitedAt: number;
  onTimeline?: boolean;
  lat?: number | null;
  lng?: number | null;
} {
  return {
    poiId: poi.id,
    name: shortPoiDisplayName(poi.name),
    kind: classifyPoiHookKind(poi),
    keyFacts,
    visitedAt: Date.now(),
    onTimeline: opts?.onTimeline ?? true,
    lat: Number.isFinite(poi.lat) ? poi.lat : null,
    lng: Number.isFinite(poi.lng) ? poi.lng : null,
  };
}

/** @deprecated Alias â€” Single-Shot. */
export const beginChainedStoryStream = beginHookResolvingStream;

export {
  extractOfflineGeneralInfo,
  streamFindusStorySentences,
  beginSingleShotStoryStream,
};

