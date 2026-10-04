/**
 * Pure helpers: pitch-card → committed timeline stop (URLs) + reject same-slot.
 * Node-smoke-safe — no RN stores.
 */

import { mergePlaceActionUrls } from '../timeline/placeActionUrls';
import type { IngestOpenWish } from './planningTypes';
import { looksLikeBreakfastWishText } from './planWalkOrder';

export type PitchCommitCardUrls = {
  name: string;
  lat: number;
  lng: number;
  placeId?: string | null;
  mapsUrl?: string | null;
  menuUrl?: string | null;
  websiteUrl?: string | null;
  reserveUrl?: string | null;
  notes?: string | null;
  bullets?: string[] | null;
};

export type CommittedPlanStopDraft = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  plannedStartMs: number | null;
  plannedEndMs: number | null;
  bufferMin: number;
  transport: 'walk';
  kind: 'stop';
  status: 'planned';
  planPriority: 1 | 2 | 3 | 4 | 5 | 6;
  mapsUrl: string | null;
  menuUrl: string | null;
  websiteUrl: string | null;
  reserveUrl: string | null;
  notes?: string;
  emoji: string;
  planTaskId: string | null;
  userFixedTime: boolean;
};

function firstHttp(...xs: Array<string | null | undefined>): string | null {
  for (const x of xs) {
    const s = String(x ?? '').trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return null;
}

/**
 * Commit 🥇/🥈 / passt → Timeline-Stop mit Maps/Menü/Website aus der Pitch-Karte.
 */
export function buildCommittedPlanStopFromPitchCard(
  card: PitchCommitCardUrls,
  wish: {
    id?: string | null;
    title: string;
    priority?: 1 | 2 | 3 | 4 | 5 | 6 | null;
    estimatedTime?: string | null;
  },
  dayKey: string,
  opts?: {
    committedId?: string;
    startMs?: number | null;
    endMs?: number | null;
    isHotel?: boolean;
    cleanTitle?: string;
  },
): CommittedPlanStopDraft {
  const urls = mergePlaceActionUrls({
    mapsUrl: card.mapsUrl,
    menuUrl: card.menuUrl,
    websiteUrl: card.websiteUrl,
    reserveUrl: card.reserveUrl,
  });
  const title = (opts?.cleanTitle || card.name || wish.title || 'Ort')
    .replace(/^[🥇🥈]\s*/u, '')
    .trim()
    .slice(0, 48);
  const groupId = wish.id ?? wish.title;
  const startMs = opts?.startMs ?? null;
  const isHotel =
    opts?.isHotel === true ||
    /\b(hotel|bude|hostel|pension|motel|inn\b|superbude)\b/i.test(title);
  const endMs =
    opts?.endMs ??
    (isHotel || startMs == null ? null : startMs + 60 * 60_000);
  const prio = (wish.priority ?? 4) as 1 | 2 | 3 | 4 | 5 | 6;
  const notes =
    card.notes?.trim() ||
    (Array.isArray(card.bullets)
      ? card.bullets.filter(Boolean).slice(0, 3).join('\n')
      : undefined);

  return {
    id: opts?.committedId ?? `stop_${groupId}_${dayKey}`,
    title,
    lat: card.lat,
    lng: card.lng,
    plannedStartMs: startMs,
    plannedEndMs: endMs,
    bufferMin: 10,
    transport: 'walk',
    kind: 'stop',
    status: 'planned',
    planPriority: prio >= 1 && prio <= 6 ? prio : 4,
    mapsUrl: firstHttp(urls.mapsUrl),
    menuUrl: firstHttp(urls.menuUrl),
    websiteUrl: firstHttp(urls.websiteUrl),
    reserveUrl: firstHttp(urls.reserveUrl),
    notes: notes || undefined,
    emoji: '📍',
    planTaskId: groupId,
    userFixedTime: Boolean(wish.estimatedTime) && (wish.priority ?? 5) <= 2,
  };
}

/**
 * Reject / „neu suchen“ / „beides nicht“ → dieselbe Wish-Identität behalten.
 * Kein zweites Frühstück-/Meal-Slot in der Queue.
 */
export function openWishesQueueAfterPitchReject(
  openWishesQueue: IngestOpenWish[],
  rejectedWish: IngestOpenWish,
): IngestOpenWish[] {
  const key = (w: IngestOpenWish) =>
    String(w.id || w.title || '')
      .trim()
      .toLowerCase();
  const want = key(rejectedWish);
  if (!want) return [...openWishesQueue];
  const has = openWishesQueue.some((w) => key(w) === want);
  if (has) return [...openWishesQueue];
  // Wish fehlt (nur Timeline) → zurück in die Queue, nicht klonen
  return [...openWishesQueue, { ...rejectedWish }];
}

export function countBreakfastWishes(queue: IngestOpenWish[]): number {
  return queue.filter((w) =>
    looksLikeBreakfastWishText(`${w.title} ${w.context}`),
  ).length;
}

/** Reject darf den Step-Index nicht vorschieben — Re-Pitch derselben Slot-Wish. */
export function shouldAdvancePlanStepAfterReject(): boolean {
  return false;
}
