/**
 * Session from Manager: apply new/continue/resume + correction merge.
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
  return routeConversationTopic({
    userText: opts.userText,
    intent: opts.intent ?? opts.analysis.jobHint,
    subject: opts.analysis.subject,
    cityHint: opts.cityHint,
    cityKey: opts.cityKey,
  });
}
