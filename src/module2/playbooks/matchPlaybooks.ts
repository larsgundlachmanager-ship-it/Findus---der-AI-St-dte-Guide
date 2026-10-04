/**
 * Match playbooks before turn — score like product situations (P6).
 */

import type { PlaybookMatch } from './playbookTypes';
import { collectPlaybookCatalog } from './playbookCatalog';
import {
  LEARNED_RULE_AVOID_LABELS,
  LEARNED_RULE_EXPECT_LABELS,
} from '../../types/learnedRules';

function inferFamilyFromText(text: string): import('../../types/learnedRules').LearnedRuleIntentFamily {
  const t = text.toLowerCase();
  if (/\b(restaurant|essen|pizza|speisekarte|cafe|café)\b/iu.test(t)) return 'dining';
  if (/\b(hotel|unterkunft|zimmer)\b/iu.test(t)) return 'hotel';
  if (/\b(flug|fliegen|flughafen|leave[\s-]?by)\b/iu.test(t)) return 'booking';
  if (/\b(route|navigation|fahr|anreise)\b/iu.test(t)) return 'navigation';
  if (/\b(fest|event|konzert|messe)\b/iu.test(t)) return 'events';
  return 'general';
}

export function matchPlaybooksBeforeTurn(opts: {
  userText: string;
  intentFamily?: string | null;
  limit?: number;
  catalog?: ReturnType<typeof collectPlaybookCatalog>;
}): PlaybookMatch[] {
  const pack = opts.catalog ?? collectPlaybookCatalog();
  if (!pack.length) return [];
  const family =
    (opts.intentFamily as import('../../types/learnedRules').LearnedRuleIntentFamily) ||
    inferFamilyFromText(opts.userText);
  const text = opts.userText.toLowerCase();

  return pack
    .map((b) => {
      let score = 0.45;
      if (b.intentFamily === family) score += 0.38;
      else if (b.intentFamily === 'general' || family === 'general') score += 0.08;
      else score -= 0.15;
      if (!b.shadow) score += 0.06;
      if (b.sourceLayer === 'owner_gold') score += 0.12;
      for (const tag of b.tags) {
        if (tag && text.includes(tag.toLowerCase())) score += 0.07;
      }
      for (const e of b.expect) {
        const label = LEARNED_RULE_EXPECT_LABELS[e] ?? e;
        if (text.includes(String(e)) || text.includes(label.slice(0, 8).toLowerCase())) {
          score += 0.04;
        }
      }
      void LEARNED_RULE_AVOID_LABELS;
      return { playbook: b, score };
    })
    .filter((x) => x.score >= 0.48)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 3);
}

export function formatPlaybookPromptBlock(matches: PlaybookMatch[]): string {
  if (!matches.length) return '';
  const lines = [
    '=== PLAYBOOK-BLAUPAUSEN (Gold/Beta/Learned — Struktur, Wortlaut frei) ===',
  ];
  for (const m of matches) {
    const b = m.playbook;
    const exp = b.expect.map((e) => LEARNED_RULE_EXPECT_LABELS[e] ?? e).join('; ');
    const av = b.avoid.map((a) => LEARNED_RULE_AVOID_LABELS[a] ?? a).join('; ');
    lines.push(
      `- [${b.intentFamily}/${b.sourceLayer}] ${b.summary}` +
        (exp ? ` | erwarte: ${exp}` : '') +
        (av ? ` | vermeide: ${av}` : ''),
    );
  }
  return lines.join('\n');
}
