/**
 * Doppelte Plan-Punkte erkennen & bündeln.
 * Ausnahme: bewusst getrennte Besuche (morgens Strand / abends Strand,
 * Hotel Check-in vs. Checkout, Sport-Slots).
 */

import type { DayPlanItem } from '../../types/dayPlan';

function normPlace(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(zum|zur|am|an|im|in|den|die|das|der)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function daypart(ms: number | null | undefined): 'morning' | 'midday' | 'evening' | 'night' | 'untimed' {
  if (ms == null) return 'untimed';
  const h = new Date(ms).getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'midday';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

function isProtectedPair(a: DayPlanItem, b: DayPlanItem): boolean {
  const kinds = new Set([a.kind, b.kind]);
  if (kinds.has('checkin') || kinds.has('checkout') || kinds.has('hotel')) {
    return true;
  }
  if (kinds.has('wake') || kinds.has('pack') || kinds.has('breakfast')) {
    return a.kind !== b.kind;
  }
  // Sport / Strand bewusst zwei Slots an einem Tag
  const blob = `${a.title} ${b.title} ${a.placeName ?? ''} ${b.placeName ?? ''}`.toLowerCase();
  const sporty =
    /\b(strand|schwimmen|surf|joggen|lauf|sport|fitness|yoga|baden)\b/i.test(
      blob,
    );
  if (sporty) {
    const pa = daypart(a.startMs);
    const pb = daypart(b.startMs);
    if (pa !== 'untimed' && pb !== 'untimed' && pa !== pb) return true;
  }
  return false;
}

function scoreItem(it: DayPlanItem): number {
  let s = 0;
  if (it.hardDeadline) s += 50;
  if (it.timed && it.startMs != null) s += 20;
  if (it.meta?.confidence === 'high') s += 10;
  if (it.meta?.userRequested) s += 8;
  if (it.meta?.voice) s += 5;
  if (it.notes && it.notes.length > 10) s += 3;
  if (it.durationMin != null) s += 2;
  if (it.status === 'done' || it.status === 'in_progress') s += 100;
  return s;
}

function samePlace(a: DayPlanItem, b: DayPlanItem): boolean {
  const na = normPlace(a.placeName || a.title);
  const nb = normPlace(b.placeName || b.title);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na))) {
    return true;
  }
  return false;
}

function tooClose(a: DayPlanItem, b: DayPlanItem): boolean {
  if (a.startMs == null || b.startMs == null) {
    // beide untimed am selben Ort → bündeln
    return a.startMs == null && b.startMs == null;
  }
  return Math.abs(a.startMs - b.startMs) <= 45 * 60_000;
}

/**
 * Behält den „besseren“ Punkt, entfernt Duplikate.
 */
export function dedupeDayPlanItems(items: DayPlanItem[]): {
  items: DayPlanItem[];
  removedIds: string[];
  mergedNotes: string[];
} {
  const removedIds: string[] = [];
  const mergedNotes: string[] = [];
  const keep = [...items];

  for (let i = 0; i < keep.length; i++) {
    const a = keep[i];
    if (!a || removedIds.includes(a.id)) continue;
    for (let j = i + 1; j < keep.length; j++) {
      const b = keep[j];
      if (!b || removedIds.includes(b.id)) continue;
      if (!samePlace(a, b)) continue;
      if (isProtectedPair(a, b)) continue;
      if (!tooClose(a, b) && daypart(a.startMs) !== daypart(b.startMs)) {
        // gleicher Ort, klar getrennte Tageszeiten → behalten
        if (
          daypart(a.startMs) !== 'untimed' &&
          daypart(b.startMs) !== 'untimed'
        ) {
          continue;
        }
      }
      // Duplikat / zu nah → besseren behalten
      const sa = scoreItem(a);
      const sb = scoreItem(b);
      const winner = sa >= sb ? a : b;
      const loser = sa >= sb ? b : a;
      removedIds.push(loser.id);
      const note = `Gebündelt mit „${winner.title}" (Doppel/ähnliche Zeit)`;
      mergedNotes.push(note);
      const wi = keep.findIndex((x) => x?.id === winner.id);
      if (wi >= 0 && keep[wi]) {
        keep[wi] = {
          ...keep[wi]!,
          notes: [keep[wi]!.notes, note].filter(Boolean).join(' · '),
          meta: {
            ...(keep[wi]!.meta ?? {}),
            dedupedFrom: [
              ...((keep[wi]!.meta?.dedupedFrom as string[]) ?? []),
              loser.id,
            ],
          },
        };
      }
    }
  }

  return {
    items: keep.filter((it) => it && !removedIds.includes(it.id)),
    removedIds,
    mergedNotes,
  };
}

export function applyDedupeToDay(
  dateKey: string,
  replaceItems: (dateKey: string, items: DayPlanItem[]) => void,
  getItems: () => DayPlanItem[],
): { removed: number } {
  const { items, removedIds } = dedupeDayPlanItems(getItems());
  if (removedIds.length) {
    replaceItems(dateKey, items);
  }
  return { removed: removedIds.length };
}
