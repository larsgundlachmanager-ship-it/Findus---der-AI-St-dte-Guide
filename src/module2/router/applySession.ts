/**
 * Session from Manager: apply new/continue/resume + correction merge.
 * Call-1 session/topicScope ist SSOT — bei new kein Resume geparkter Threads.
 */

import {
  routeConversationTopic,
  type TopicRouteDecision,
} from '../../services/memory/conversationThreads';
import type { ManagerAnalysis } from './types';
export {
  mergeCorrectionUtterance,
  type CorrectionMerge,
} from './correctionMerge';

export function applyManagerSession(opts: {
  analysis: ManagerAnalysis;
  userText: string;
  intent?: string | null;
  cityHint?: string | null;
  cityKey?: string | null;
}): TopicRouteDecision {
  const forceNew =
    opts.analysis.session === 'new' ||
    opts.analysis.topicScope?.mode === 'new' ||
    opts.analysis.topicScope?.turnsForCall2 === 0;
  return routeConversationTopic({
    userText: opts.userText,
    intent: opts.intent ?? opts.analysis.jobHint,
    subject: forceNew ? null : opts.analysis.subject,
    cityHint: opts.cityHint,
    cityKey: opts.cityKey,
    forceNew,
  });
}
