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

/**
 * Natürliche Überleitung zum nächsten offenen Intent (kein Permission-Ritual).
 * Call-1/Present kann das als Soft-CTA nutzen.
 */
export function naturalNextIntentBrief(): string | null {
  const next = queue.find((q) => q.status === 'pending' || q.status === 'active');
  if (!next?.brief?.trim()) return null;
  const brief = next.brief.replace(/\s+/g, ' ').trim().slice(0, 120);
  const lane = String(next.lane || 'chat');
  if (lane === 'nav') {
    return `Als Nächstes: ${brief}`;
  }
  if (lane === 'pitch' || lane === 'chat') {
    return `Dann kümmern wir uns um: ${brief}`;
  }
  if (lane === 'plan') {
    return `Weiter im Plan: ${brief}`;
  }
  return `Als Nächstes: ${brief}`;
}

/** Nach User-Entscheidung: aktiven Intent done, optional Soft-Brief für den nächsten. */
export function completeActiveAndPeekNatural(): {
  next: QueuedIntent | null;
  softBrief: string | null;
} {
  const next = completeActiveIntent();
  return { next, softBrief: naturalNextIntentBrief() };
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
