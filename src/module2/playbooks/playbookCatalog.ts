/**
 * Facade: Owner-Gold + Beta + LearnedRules → unified playbook catalog.
 */

import type { LearnedRule } from '../../types/learnedRules';
import type { SituationBlueprint } from '../../types/situationBlueprints';
import type { PlaybookRecord } from './playbookTypes';

function blueprintToPlaybook(
  b: SituationBlueprint,
  layer: PlaybookRecord['sourceLayer'],
  shadow = false,
): PlaybookRecord {
  return {
    ...b,
    sourceLayer: layer,
    shadow,
  };
}

export function collectPlaybookCatalog(): PlaybookRecord[] {
  const out: PlaybookRecord[] = [];
  const seen = new Set<string>();

  const push = (p: PlaybookRecord) => {
    if (seen.has(p.situationKey)) return;
    seen.add(p.situationKey);
    out.push(p);
  };

  try {
    const { getOwnerGoldBlueprints } = require('../blueprints/ownerGold') as {
      getOwnerGoldBlueprints: () => SituationBlueprint[];
    };
    for (const b of getOwnerGoldBlueprints()) {
      push(blueprintToPlaybook({ ...b, source: b.source || 'manual' }, 'owner_gold'));
    }
  } catch {
    /* soft */
  }

  try {
    const { getCachedSituationBlueprintsSync } = require('../../services/memory/betaSituationQueue') as {
      getCachedSituationBlueprintsSync: () => SituationBlueprint[];
    };
    for (const b of getCachedSituationBlueprintsSync() || []) {
      push(
        blueprintToPlaybook(
          { ...b, source: b.source || 'auto_3plus' },
          'beta',
          false,
        ),
      );
    }
  } catch {
    /* soft */
  }

  try {
    const { getLearnedRules } = require('../../services/memory/correctionLearning') as {
      getLearnedRules: () => LearnedRule[];
    };
    const { buildSituationKey } = require('../../services/memory/betaSituationQueue') as {
      buildSituationKey: (r: {
        intentFamily: string;
        expect: string[];
        avoid: string[];
      }) => string;
    };
    for (const r of getLearnedRules()) {
      if ((r.strength ?? 0) < 0.55) continue;
      const key = buildSituationKey(r);
      push({
        situationKey: key,
        intentFamily: r.intentFamily,
        tags: r.tags ?? [],
        expect: r.expect ?? [],
        avoid: r.avoid ?? [],
        summary: r.summary || 'Learned correction',
        source: 'learned_rule',
        version: 1,
        sourceLayer: 'learned',
        shadow: true,
      });
    }
  } catch {
    /* soft */
  }

  return out;
}
