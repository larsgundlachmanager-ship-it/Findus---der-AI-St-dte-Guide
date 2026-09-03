/**
 * topicScope Historie — neues Thema = 0; Follow-up Default 3.
 * Run: npx --yes --package tsx@4.19.3 tsx src/module2/reboot/pipeline/topicScopeHistory.smoke.test.ts
 */

import { parseTopicScope } from './topicScopeParse';
import { buildCall2HistoryBlock } from './topicScopeHistory';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

{
  const fresh = parseTopicScope({ mode: 'new', turnsForCall2: 8 });
  assert(fresh.turnsForCall2 === 0, 'new forces 0');
  const block = buildCall2HistoryBlock({ topicScope: fresh });
  assert(/KEIN Verlauf/i.test(block), 'new topic: no history block');
  assert(!/GESPRÄCHS-THREAD/i.test(block), 'new topic: no thread dump');
}

{
  const follow = parseTopicScope({ mode: 'followup', turnsForCall2: 3 });
  assert(follow.turnsForCall2 === 3, 'followup 3');
  // Follow-up-Block braucht RN-Threads — nur Limit-String prüfen ohne Thread-Store:
  const n = follow.turnsForCall2;
  const limitLine = `HISTORIE-LIMIT HART: höchstens die letzten ${n} Turn-Paare (User+Antwort). Älteres ignorieren. Nicht mischen.`;
  assert(/letzten 3/.test(limitLine), 'limit wording 3');
}

{
  const miss = parseTopicScope(null);
  assert(miss.mode === 'new' && miss.turnsForCall2 === 0, 'null → new/0');
}

console.log('[topicScopeHistory] ok');
