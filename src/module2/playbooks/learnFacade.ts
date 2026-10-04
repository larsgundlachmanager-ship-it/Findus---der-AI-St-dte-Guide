/**
 * Unified LearnedRule + Beta + Gold facade for prompts (P6).
 */

import { blueprintsToPseudoRules } from '../../services/memory/betaSituationSync';
import type { UnifiedLearnFacade } from './playbookTypes';
import { collectPlaybookCatalog } from './playbookCatalog';
import {
  formatPlaybookPromptBlock,
  matchPlaybooksBeforeTurn,
} from './matchPlaybooks';

export async function buildUnifiedLearnFacade(opts: {
  userText: string;
  intentFamily?: string | null;
}): Promise<UnifiedLearnFacade> {
  const matches = matchPlaybooksBeforeTurn({
    userText: opts.userText,
    intentFamily: opts.intentFamily,
    limit: 4,
  });
  const playbookBlock = formatPlaybookPromptBlock(matches);
  const rules = blueprintsToPseudoRules(
    matches.filter((m) => !m.playbook.shadow).map((m) => m.playbook),
  );

  let learnedBlock = '';
  try {
    const { matchLearnedRules, formatLearnedRulesPromptBlock } = require('../../services/memory/correctionLearning') as {
      matchLearnedRules: (o: { userText: string; limit?: number }) => import('../../types/learnedRules').LearnedRule[];
      formatLearnedRulesPromptBlock: (r: import('../../types/learnedRules').LearnedRule[]) => string;
    };
    const local = matchLearnedRules({ userText: opts.userText, limit: 3 });
    learnedBlock = formatLearnedRulesPromptBlock(local);
    for (const r of local) {
      if (!rules.some((x) => x.id === r.id)) rules.push(r);
    }
  } catch {
    /* soft */
  }

  const promptBlock = [playbookBlock, learnedBlock].filter(Boolean).join('\n\n');
  return {
    rules,
    playbooks: collectPlaybookCatalog(),
    promptBlock,
  };
}
