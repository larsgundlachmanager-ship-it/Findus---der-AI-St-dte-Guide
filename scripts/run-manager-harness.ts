/**
 * Lightweight harness for manager pace / blueprints / staging (no live Gemini).
 */
import assert from 'node:assert';
import {
  resolvePaceBudget,
  clipBridgeToWordLimit,
  estimateBridgeMs,
} from '../src/module2/router/paceBudget';
import {
  getBlueprintContract,
  composeBlueprintOnMiss,
} from '../src/module2/blueprints/registry';
import {
  classifyBlueprintClarity,
  autoGateBlueprintPatch,
  shouldAutoPublish,
  buildReviewBrief,
  type BlueprintStagingDraft,
} from '../src/module2/blueprints/staging';
import { mergeCorrectionUtterance } from '../src/module2/router/correctionMerge';

function testPace() {
  const instant = resolvePaceBudget({ pace: 'instant' });
  assert.equal(instant.fastDeadlineMs, 1500);
  assert.ok(instant.bridgeMaxWords <= 10);
  const cover = resolvePaceBudget({ pace: 'cover', fastDeadlineMs: 9000 });
  assert.ok(cover.fastDeadlineMs <= 5000);
  const clipped = clipBridgeToWordLimit(
    'Eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf',
    8,
  );
  assert.ok((clipped || '').split(/\s+/).length <= 9);
  assert.ok(estimateBridgeMs(10) > 2000);
  console.log('ok pace');
}

function testBlueprints() {
  const c = getBlueprintContract('cinema', 'cinema_orient');
  assert.ok(c && c.defaultTasks.length >= 2);
  const g = composeBlueprintOnMiss({
    userText: 'Wir wollen grillen im Park',
  });
  assert.equal(g.id, 'compound_evening_goal');
  console.log('ok blueprints');
}

function testStaging() {
  assert.equal(
    classifyBlueprintClarity({ factCount: 1 }),
    'clear',
  );
  assert.equal(
    classifyBlueprintClarity({ isNewBlueprint: true }),
    'unclear',
  );
  assert.equal(
    autoGateBlueprintPatch({ addFastFacts: ['Popcorn-Preis grob nennen'] }),
    'pass',
  );
  assert.equal(
    autoGateBlueprintPatch({ addFastFacts: ['x'] }),
    'fail',
  );
  const draft: BlueprintStagingDraft = {
    id: 't1',
    createdAt: new Date().toISOString(),
    clarity: 'clear',
    autoGate: 'pass',
    signal: 'test',
    patch: {
      blueprintId: 'cinema',
      addFastFacts: ['Popcorn-Richtpreis wenn bekannt'],
    },
    reviewBrief: 'test',
  };
  assert.equal(shouldAutoPublish(draft), true);
  assert.ok(buildReviewBrief(draft).includes('Auto-publish'));
  console.log('ok staging');
}

function testCorrection() {
  const m = mergeCorrectionUtterance({
    previousUserText: 'Morgen Abend ins Kino Spider-Man',
    newUserText: 'Ich meine übermorgen',
  });
  assert.equal(m.isCorrection, true);
  assert.ok(m.mergedUserText.includes('Korrektur'));
  console.log('ok correction');
}

testPace();
testBlueprints();
testStaging();
testCorrection();
console.log('manager harness ok');
