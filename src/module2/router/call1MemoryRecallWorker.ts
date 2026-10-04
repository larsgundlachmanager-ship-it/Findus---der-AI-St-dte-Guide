/**
 * Memory-Recall Worker — „Wo waren wir gestern essen?“
 * SSOT: timeline/visitLog + Thread-Fallback. Kein Frisch-Pitch.
 */

import type { VisitLogEntry } from '../../services/timeline/visitLog';

export type MemoryRecallHit = {
  label: string;
  whenLabel?: string | null;
  city?: string | null;
  kind?: string | null;
};

export type MemoryRecallResult = {
  ok: boolean;
  hits: MemoryRecallHit[];
  spokenDraft: string;
  bullets: string[];
  promptBlock: string;
};

const FOOD_NAME_RE =
  /\b(restaurant|ristorante|trattoria|pizzeria|café|cafe|bistro|bar|brauhaus|gasthaus|wirtshaus|imbiss|kebab|döner|doener|sushi|steak|burger|asia|thai|india|china|ramen|noodle|pasta|seafood|fisch|brasserie|taverne|kneipe|lounge|bakery|bäckerei|baeckerei|eis|gelato|ice\s*cream)\b/iu;

export function wantsMemoryRecall(text: string): boolean {
  return /\b(wo\s+waren\s+wir|gestern\s+(?:essen|gewesen|restaurant)|letzte[nr]?\s+(?:restaurant|besuch)|erinnerst\s+du\s+dich|wo\s+haben\s+wir\s+(?:gegessen|gesessen)|welches\s+restaurant)\b/iu.test(
    text || '',
  );
}

export function wantsFoodVisitFilter(text: string): boolean {
  return /\b(essen|restaurant|gastro|abendessen|mittag|café|cafe|imbiss|sushi|pizza)\b/iu.test(
    text || '',
  );
}

function whenLabelForKey(dateKey: string, nowMs: number): string {
  try {
    const { offsetDateKey, dateKeyFromMs } = require('../../utils/dateKeys') as {
      offsetDateKey: (days: number, nowMs?: number) => string;
      dateKeyFromMs: (ms: number, tz?: string) => string;
    };
    if (dateKey === offsetDateKey(-1, nowMs)) return 'gestern';
    if (dateKey === dateKeyFromMs(nowMs)) return 'heute';
    return dateKey;
  } catch {
    return dateKey;
  }
}

function resolveTargetDateKeys(userText: string, nowMs: number): string[] {
  try {
    const {
      offsetDateKey,
      dateKeyFromMs,
      tryResolveDateKeyFromUserText,
    } = require('../../utils/dateKeys') as {
      offsetDateKey: (days: number, nowMs?: number) => string;
      dateKeyFromMs: (ms: number, tz?: string) => string;
      tryResolveDateKeyFromUserText: (
        text: string,
        nowMs?: number,
      ) => string | null;
    };
    const resolved = tryResolveDateKeyFromUserText(userText, nowMs);
    if (resolved) return [resolved];
    if (/\bgestern\b/iu.test(userText)) return [offsetDateKey(-1, nowMs)];
    if (/\bheute\b/iu.test(userText)) return [dateKeyFromMs(nowMs)];
    // Default: gestern + heute (Recall oft relativ)
    return [offsetDateKey(-1, nowMs), dateKeyFromMs(nowMs)];
  } catch {
    return [];
  }
}

function entryLooksFood(e: VisitLogEntry): boolean {
  return FOOD_NAME_RE.test(e.name || '');
}

function hitFromEntry(
  e: VisitLogEntry,
  nowMs: number,
): MemoryRecallHit {
  return {
    label: (e.name || '').trim().slice(0, 64),
    whenLabel: whenLabelForKey(e.dateKey, nowMs),
    city: e.cityId ?? null,
    kind: e.source ?? null,
  };
}

/**
 * Pure filter for smokes — visit rows → hits.
 */
export function pickMemoryRecallHits(opts: {
  entries: VisitLogEntry[];
  userText: string;
  nowMs?: number;
  limit?: number;
}): MemoryRecallHit[] {
  const nowMs = opts.nowMs ?? Date.now();
  const limit = opts.limit ?? 3;
  const wantFood = wantsFoodVisitFilter(opts.userText);
  const keys = new Set(resolveTargetDateKeys(opts.userText, nowMs));
  const scoped = keys.size
    ? opts.entries.filter((e) => keys.has(e.dateKey))
    : opts.entries.slice();
  scoped.sort((a, b) => b.arrivedAtMs - a.arrivedAtMs);

  const hits: MemoryRecallHit[] = [];
  const push = (e: VisitLogEntry) => {
    const name = (e.name || '').trim();
    if (!name) return;
    if (hits.some((h) => h.label.toLowerCase() === name.toLowerCase())) return;
    hits.push(hitFromEntry(e, nowMs));
  };

  if (wantFood) {
    for (const e of scoped) {
      if (entryLooksFood(e)) push(e);
      if (hits.length >= limit) break;
    }
    // Soft: wenn kein Name-Food-Match, trotzdem Tagesbesuche zeigen (ehrlich)
    if (!hits.length) {
      for (const e of scoped) {
        push(e);
        if (hits.length >= limit) break;
      }
    }
  } else {
    for (const e of scoped) {
      push(e);
      if (hits.length >= limit) break;
    }
  }
  return hits.slice(0, limit);
}

function draftFromHits(hits: MemoryRecallHit[]): MemoryRecallResult {
  const spokenDraft = hits.length
    ? [
        'FAKTEN Memory-Recall (nicht wörtlich):',
        ...hits.map(
          (h, i) =>
            `${i + 1}) ${h.label}${h.whenLabel ? ` (${h.whenLabel})` : ''}${h.city ? ` · ${h.city}` : ''}`,
        ),
        'FLOW: klar sagen wo/wann; bei Unsicherheit ehrlich; kein neues Pitch-Restaurant erfinden.',
      ].join('\n')
    : [
        'FAKTEN Memory-Recall: kein belegter Besuch gefunden.',
        'FLOW: ehrlich sagen; optional nach Stadt/Name fragen — kein Fake-Restaurant.',
      ].join('\n');

  return {
    ok: hits.length > 0,
    hits,
    spokenDraft,
    bullets: hits.map((h) => h.label.slice(0, 72)).slice(0, 3),
    promptBlock: spokenDraft,
  };
}

export async function researchMemoryRecall(opts: {
  userText: string;
  signal?: AbortSignal;
}): Promise<MemoryRecallResult> {
  if (opts.signal?.aborted) {
    return draftFromHits([]);
  }

  let hits: MemoryRecallHit[] = [];
  try {
    const {
      hydrateVisitLog,
      getVisitLogSnapshot,
    } = require('../../services/timeline/visitLog') as {
      hydrateVisitLog: () => Promise<void>;
      getVisitLogSnapshot: () => VisitLogEntry[];
    };
    await hydrateVisitLog();
    hits = pickMemoryRecallHits({
      entries: getVisitLogSnapshot() ?? [],
      userText: opts.userText,
    });
  } catch {
    hits = [];
  }

  if (!hits.length) {
    try {
      const {
        threadPlaceHint,
        formatThreadContextForPrompt,
      } = require('../../services/memory/conversationThreads') as {
        threadPlaceHint: () => string | null;
        formatThreadContextForPrompt: (o?: {
          maxRecentTurns?: number;
        }) => string;
      };
      const place = threadPlaceHint()?.trim();
      if (place) {
        hits.push({ label: place.slice(0, 64), whenLabel: 'aus dem Chat' });
      } else {
        const blob = formatThreadContextForPrompt({ maxRecentTurns: 6 }) || '';
        const m = blob.match(
          /(?:Restaurant|Essen|bei|im)\s+([A-ZÄÖÜ][\wÄÖÜäöüß'\- ]{2,40})/,
        );
        if (m?.[1]) {
          hits.push({
            label: m[1].trim().slice(0, 64),
            whenLabel: 'aus dem Chat',
          });
        }
      }
    } catch {
      /* soft */
    }
  }

  return draftFromHits(hits);
}
