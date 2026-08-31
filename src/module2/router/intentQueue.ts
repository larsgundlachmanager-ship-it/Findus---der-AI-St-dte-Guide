/**
 * Multi-Intent Queue — Teilfragen der Reihe nach, nichts verwerfen.
 */

import type { RouterIntentItem, ChatLane } from '../router/routeAllowlist';

export type QueuedIntent = RouterIntentItem & {
  status: 'pending' | 'active' | 'done' | 'deferred';
};

const MAX = 8;
let queue: QueuedIntent[] = [];

export function clearIntentQueue(): void {
  queue = [];
}

export function seedIntentQueue(items: RouterIntentItem[]): QueuedIntent[] {
  queue = items.slice(0, MAX).map((i, idx) => ({
    ...i,
    id: i.id || `i${idx + 1}`,
    status: idx === 0 ? 'active' : 'pending',
  }));
  return [...queue];
}

export function getIntentQueue(): QueuedIntent[] {
  return [...queue];
}

export function peekActiveIntent(): QueuedIntent | null {
  return queue.find((q) => q.status === 'active' || q.status === 'pending') ?? null;
}

export function completeActiveIntent(): QueuedIntent | null {
  const i = queue.findIndex((q) => q.status === 'active' || q.status === 'pending');
  if (i < 0) return null;
  queue[i] = { ...queue[i]!, status: 'done' };
  const next = queue.find((q) => q.status === 'pending');
  if (next) {
    next.status = 'active';
  }
  return next ? { ...next } : null;
}

/** Zwischenfrage: aktuellen Intent parken, Einschub vorne. */
export function parkAndInsertInterrupt(item: RouterIntentItem): void {
  queue = queue.map((q) =>
    q.status === 'active' ? { ...q, status: 'pending' } : q,
  );
  queue.unshift({
    ...item,
    id: item.id || `intr_${Date.now()}`,
    status: 'active',
  });
  if (queue.length > MAX) queue = queue.slice(0, MAX);
}

export function hasPendingIntents(): boolean {
  return queue.some((q) => q.status === 'pending' || q.status === 'active');
}

export function summarizeOpenIntents(): string {
  return queue
    .filter((q) => q.status === 'pending' || q.status === 'active')
    .map((q) => `[${q.lane}] ${q.brief}`)
    .join(' | ');
}

export function laneNeedsModule(lane: ChatLane): boolean {
  return lane === 'nav' || lane === 'm1' || lane === 'plan' || lane === 'pitch';
}
