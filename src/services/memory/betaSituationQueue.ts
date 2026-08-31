/**
 * Local queue + contributor id for beta situation learning.
 */

import * as FileSystem from 'expo-file-system';
import type { BetaSituationEvent } from '../../types/situationBlueprints';
import type { LearnedRule } from '../../types/learnedRules';
import { getCachedUserProfile } from '../userProfileService';
import { mergeOwnerGoldIntoPack } from '../../module2/blueprints/ownerGold';

const QUEUE_PATH = `${FileSystem.documentDirectory}findus-beta-situation-queue.json`;
const CONTRIBUTOR_PATH = `${FileSystem.documentDirectory}findus-beta-contributor.json`;
const PACK_PATH = `${FileSystem.documentDirectory}findus-situation-blueprints.json`;

type QueueFile = {
  pending: BetaSituationEvent[];
  uploadedIds: string[];
};

type ContributorFile = {
  id: string;
  hash: string;
};

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function newId(): string {
  return `bse_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSituationKey(rule: {
  intentFamily: string;
  expect: string[];
  avoid: string[];
}): string {
  const exp = [...rule.expect].map((x) => x.toLowerCase()).sort().join('+') || 'none';
  const av = [...rule.avoid].map((x) => x.toLowerCase()).sort().join('+') || 'none';
  return `${rule.intentFamily}::${exp}::${av}`.slice(0, 180);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return fallback;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await FileSystem.writeAsStringAsync(path, JSON.stringify(value));
}

export async function getOrCreateContributorHash(): Promise<string> {
  const existing = await readJson<ContributorFile | null>(CONTRIBUTOR_PATH, null);
  if (existing?.hash) return existing.hash;
  const id = newId();
  const hash = `c_${simpleHash(id)}`;
  await writeJson(CONTRIBUTOR_PATH, { id, hash });
  return hash;
}

export async function enqueueBetaSituationFromRule(input: {
  rule: LearnedRule;
  correctionText: string;
  priorUserText?: string | null;
}): Promise<BetaSituationEvent | null> {
  const { rule, correctionText, priorUserText } = input;
  if (!rule.expect.length && !rule.avoid.length && !rule.summary.trim()) {
    return null;
  }

  const profile = getCachedUserProfile();
  const contributorHash = await getOrCreateContributorHash();
  const situationKey = buildSituationKey(rule);

  const event: BetaSituationEvent = {
    eventId: newId(),
    contributorHash,
    situationKey,
    intentFamily: rule.intentFamily,
    tags: rule.tags.slice(0, 8),
    expect: rule.expect,
    avoid: rule.avoid,
    summary: rule.summary.slice(0, 200),
    userTypeHint: {
      answerStyle: profile?.answerStyle ?? null,
      diningLevel: profile?.diningLevel ?? null,
      persona: profile?.personaEngine?.persona ?? profile?.coreRole ?? null,
    },
    correctionDigest: correctionText.replace(/\s+/g, ' ').trim().slice(0, 160),
    priorUserDigest: (priorUserText ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || undefined,
    createdAt: new Date().toISOString(),
  };

  const queue = await readJson<QueueFile>(QUEUE_PATH, {
    pending: [],
    uploadedIds: [],
  });
  // Dedup same situation same day from same contributor locally
  const day = event.createdAt.slice(0, 10);
  const dup = queue.pending.some(
    (e) =>
      e.situationKey === event.situationKey &&
      e.contributorHash === event.contributorHash &&
      e.createdAt.startsWith(day),
  );
  if (dup) return event;

  queue.pending = [...queue.pending, event].slice(-80);
  await writeJson(QUEUE_PATH, queue);
  return event;
}

export async function listPendingBetaSituationEvents(): Promise<BetaSituationEvent[]> {
  const queue = await readJson<QueueFile>(QUEUE_PATH, {
    pending: [],
    uploadedIds: [],
  });
  return queue.pending;
}

export async function markBetaSituationEventsUploaded(
  eventIds: string[],
): Promise<void> {
  if (!eventIds.length) return;
  const queue = await readJson<QueueFile>(QUEUE_PATH, {
    pending: [],
    uploadedIds: [],
  });
  const idSet = new Set(eventIds);
  queue.pending = queue.pending.filter((e) => !idSet.has(e.eventId));
  queue.uploadedIds = [...queue.uploadedIds, ...eventIds].slice(-200);
  await writeJson(QUEUE_PATH, queue);
}

export async function saveActiveSituationBlueprintsPack(
  blueprints: import('../../types/situationBlueprints').SituationBlueprint[],
): Promise<void> {
  await writeJson(PACK_PATH, {
    updatedAt: new Date().toISOString(),
    blueprints,
  });
}

export async function loadActiveSituationBlueprintsPack(): Promise<
  import('../../types/situationBlueprints').SituationBlueprint[]
> {
  const pack = await readJson<{
    blueprints?: import('../../types/situationBlueprints').SituationBlueprint[];
  }>(PACK_PATH, { blueprints: [] });
  return Array.isArray(pack.blueprints) ? pack.blueprints : [];
}

let cachedPack: import('../../types/situationBlueprints').SituationBlueprint[] | null =
  null;

/** Sync read for master prompt (downloaded pack + Owner-Gold). */
export function getCachedSituationBlueprintsSync(): import('../../types/situationBlueprints').SituationBlueprint[] {
  return mergeOwnerGoldIntoPack(cachedPack ?? []);
}

export async function getActiveSituationBlueprintsCached(
  forceReload = false,
): Promise<import('../../types/situationBlueprints').SituationBlueprint[]> {
  if (!forceReload && cachedPack) return mergeOwnerGoldIntoPack(cachedPack);
  cachedPack = await loadActiveSituationBlueprintsPack();
  return mergeOwnerGoldIntoPack(cachedPack);
}

export function invalidateSituationBlueprintCache(): void {
  cachedPack = null;
}
