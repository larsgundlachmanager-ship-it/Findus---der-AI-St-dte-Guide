/**
 * Run: npx --yes tsx src/services/persona/matrixSpeechStyle.smoke.test.ts
 */

import {
  buildCompactBridgeVoiceHint,
  buildMatrixSpeechStyleBlock,
} from './matrixSpeechStyle';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const classic = buildMatrixSpeechStyleBlock({
  coreRole: 'classic_guide',
  vibeTone: 'balanced',
  knowledgeStyle: 'clear_essence',
});
assert(/MÜNDLICH & MENSCHLICH/i.test(classic), 'universal human mouth');
assert(/Classic Guide/i.test(classic), 'classic role hint');
assert(!/Sag genau/i.test(classic), 'no scripts');

const seriousFacts = buildMatrixSpeechStyleBlock({
  coreRole: 'classic_guide',
  vibeTone: 'serious',
  knowledgeStyle: 'fact_focus',
});
assert(/Ernst/i.test(seriousFacts), 'serious vibe');
assert(/Fakten-Fokus/i.test(seriousFacts), 'fact focus');
assert(/warme, gesprochene Sätze/i.test(seriousFacts), 'still human not lexicon');

const oldie = buildMatrixSpeechStyleBlock({
  coreRole: 'heartfelt_oldie',
  vibeTone: 'nostalgic',
  knowledgeStyle: 'storyteller',
});
assert(/Oldie/i.test(oldie), 'oldie role');
assert(/Storyteller/i.test(oldie), 'storyteller');

const bridge = buildCompactBridgeVoiceHint({
  coreRole: 'buddy',
  vibeTone: 'humorous',
  knowledgeStyle: 'clear_essence',
});
assert(/Bridge-Stimme/i.test(bridge), 'bridge hint');
assert(/Kumpel|Augenhöhe/i.test(bridge), 'buddy tone in bridge');

console.log('matrixSpeechStyle.smoke.test.ts OK');
