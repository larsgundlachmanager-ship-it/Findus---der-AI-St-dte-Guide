/**
 * topicScope — Historie-Block für Call 2.
 * Call 1 ist SSOT: turnsForCall2=0 ⇒ gar kein Verlauf; sonst hart begrenzt.
 */

import type { TopicScope } from './topicScopeParse';
export { parseTopicScope, type TopicScope } from './topicScopeParse';

export function buildCall2HistoryBlock(opts: {
  topicScope: TopicScope;
  cityKey?: string | null;
}): string {
  const n = Math.max(0, Math.min(10, opts.topicScope.turnsForCall2 | 0));
  if (n <= 0 || opts.topicScope.mode === 'new') {
    return [
      'HISTORIE: KEIN Verlauf für Call-2.',
      'Nur der aktuelle USER-Satz + Fakten aus DIESEM Turn.',
      'Kein Sticky-Ort, kein geparkter Thread, kein voriges Thema.',
    ].join(' ');
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
    base,
    `HISTORIE-LIMIT HART: höchstens die letzten ${n} Turn-Paare (User+Antwort). Älteres ignorieren. Nicht mischen.`,
  ].join('\n');
}
