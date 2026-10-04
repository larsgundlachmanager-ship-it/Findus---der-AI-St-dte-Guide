/**
 * topicScope — Historie-Block für Call 2.
 * Call 1 ist SSOT: turnsForCall2=0 ⇒ gar kein Verlauf; sonst hart begrenzt.
 */

import type { TopicScope } from './topicScopeParse';
export { parseTopicScope, type TopicScope } from './topicScopeParse';

export function buildCall2HistoryBlock(opts: {
  topicScope: TopicScope;
  cityKey?: string | null;
  /** Call-1 kuratierter Kern — ersetzt/ergänzt Roh-Historie */
  curatedContext?: string[] | null;
}): string {
  const curated = (opts.curatedContext ?? [])
    .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 8);
  const curatedBlock = curated.length
    ? [
        'CALL1_CURATED_CONTEXT (nur das — keine Chat-Archäologie):',
        ...curated.map((c) => `- ${c}`),
      ].join('\n')
    : '';

  const n = Math.max(0, Math.min(10, opts.topicScope.turnsForCall2 | 0));
  if (n <= 0 || opts.topicScope.mode === 'new') {
    return [
      curatedBlock,
      'HISTORIE: KEIN Verlauf für Call-2.',
      'Nur der aktuelle USER-Satz + Fakten aus DIESEM Turn + curatedContext.',
      'Kein Sticky-Ort, kein geparkter Thread, kein voriges Thema.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  // Lazy: conversationThreads zieht RN — nur im Follow-up-Pfad laden.
  const {
    formatThreadContextForPrompt,
  } = require('../../../services/memory/conversationThreads') as {
    formatThreadContextForPrompt: (o?: {
      includeParkedIndex?: boolean;
      maxParked?: number;
      cityKey?: string | null;
      maxRecentTurns?: number;
    }) => string;
  };
  const base = formatThreadContextForPrompt({
    includeParkedIndex: false,
    maxParked: 0,
    cityKey: opts.cityKey ?? null,
    maxRecentTurns: n,
  });
  return [
    curatedBlock,
    base,
    `HISTORIE-LIMIT HART: höchstens die letzten ${n} Turn-Paare (User+Antwort). Älteres ignorieren. Nicht mischen.`,
    curated.length
      ? 'CuratedContext schlägt vagen Thread-Text bei Widerspruch.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
