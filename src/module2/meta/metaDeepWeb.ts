/**
 * Meta: Deep-Web — dünner Wrapper um call1DeepWebWorker (kein Rewrite).
 */

export {
  researchDeepWebBooking,
  refineDeepWebQuery,
  deepWebNeedsAnotherPass,
  deepWebTaskBudgetMs,
  looksLikeDeepWebManagerTask,
  wantsDeepWebBooking,
} from '../router/call1DeepWebWorker';

export type { DeepWebResearchResult } from '../router/call1DeepWebWorker';

export async function runMetaDeepWeb(opts: {
  userText: string;
  cityHint?: string | null;
  wantBookingLink?: boolean;
  budgetMs?: number;
  signal?: AbortSignal;
}): Promise<import('../router/call1DeepWebWorker').DeepWebResearchResult> {
  const { researchDeepWebBooking } = require('../router/call1DeepWebWorker') as typeof import('../router/call1DeepWebWorker');
  return researchDeepWebBooking({
    userText: opts.userText,
    cityHint: opts.cityHint ?? null,
    wantBookingLink: opts.wantBookingLink ?? true,
    budgetMs: opts.budgetMs,
    signal: opts.signal,
  });
}
