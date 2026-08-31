/**
 * topicScope — Historie-Block für Call 2.
 */

import { formatThreadContextForPrompt } from '../../../services/memory/conversationThreads';
import type { TopicScope } from './topicScopeParse';
export { parseTopicScope, type TopicScope } from './topicScopeParse';

export function buildCall2HistoryBlock(opts: {
  topicScope: TopicScope;
  cityKey?: string | null;
}): string {
  if (opts.topicScope.turnsForCall2 <= 0) {
    return 'HISTORIE: kein Verlauf für Call-2 — nur dieser Satz.';
  }
  const base = formatThreadContextForPrompt({
    includeParkedIndex: opts.topicScope.mode === 'followup',
    maxParked: opts.topicScope.mode === 'followup' ? 3 : 1,
    cityKey: opts.cityKey ?? null,
  });
  return `${base}\nHISTORIE-LIMIT: max ${opts.topicScope.turnsForCall2} Turn-Paare für Call-2 nutzen.`;
}
