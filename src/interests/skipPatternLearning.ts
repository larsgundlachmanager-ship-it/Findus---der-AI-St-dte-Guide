/**
 * Learn skip patterns when user repeatedly ignores POI types after Wegweiser.
 */

import type { Poi } from '../db/types';
import { getPoiWithFacts } from '../db/database';
import { useUserProfileStore } from '../store/useUserProfileStore';
import { skipPatternFactForPoi } from './relevanceBridge';

const ignoreCounts = new Map<string, number>();
const REPEAT_THRESHOLD = 2;

export async function recordPoiIgnoreIfRepeated(poiId: number): Promise<void> {
  const poi = await getPoiWithFacts(poiId);
  if (!poi) return;
  await recordPoiIgnoreIfRepeatedFromPoi(poi);
}

export async function recordPoiIgnoreIfRepeatedFromPoi(poi: Poi): Promise<void> {
  const fact = skipPatternFactForPoi(poi);
  if (!fact) return;

  const count = (ignoreCounts.get(fact) ?? 0) + 1;
  ignoreCounts.set(fact, count);
  if (count < REPEAT_THRESHOLD) return;

  const profile = useUserProfileStore.getState().profile;
  const existing = profile?.learnedFacts ?? [];
  if (existing.some((f: string) => f.toLowerCase() === fact.toLowerCase())) return;

  await useUserProfileStore.getState().addLearnedFact(fact);
}
