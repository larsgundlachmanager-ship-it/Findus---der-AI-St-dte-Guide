/**
 * Learn-path wiring (exports only — no RN).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/m2LearnWire.smoke.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const files = [
  'services/memory/correctionLearning.ts',
  'services/memory/collectiveLearning.ts',
  'module2/blueprints/ownerGold.ts',
  'module2/blueprints/ownerGold.pack.json',
  'module2/router/call1OwnerGoldCatalog.ts',
  'services/research/persistDiscoveredPoi.ts',
  'services/research/packSpotInbox.ts',
];
for (const f of files) {
  assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
}

const coll = fs.readFileSync(
  path.join(root, 'services/memory/collectiveLearning.ts'),
  'utf8',
);
assert.ok(/AUTO_USERS\s*=\s*3/.test(coll), 'collective threshold 3');
assert.ok(/collectiveLearningPromptBlock/.test(coll), 'collective prompt');

const analyze = fs.readFileSync(
  path.join(root, 'module2/router/analyzeTurn.ts'),
  'utf8',
);
assert.ok(/matchLearnedRules/.test(analyze), 'correction in Call1');
assert.ok(/collectiveLearningPromptBlock/.test(analyze), 'collective in Call1');

const pitch = fs.readFileSync(
  path.join(root, 'module2/pitch/runPitchModule.ts'),
  'utf8',
);
assert.ok(/persistDiscoveredPoiIntoDataset/.test(pitch), 'pack-learn in pitch');
assert.ok(
  !/!ranked\.softFail && options\.length/.test(pitch),
  'persist not gated on softFail',
);

const persistLive = fs.readFileSync(
  path.join(root, 'services/research/persistLiveResearch.ts'),
  'utf8',
);
assert.ok(/planLivePitchPersistDrafts/.test(persistLive), 'persist plan export');
assert.ok(
  !/if \(req\.kind === 'hotel'\) return 0/.test(persistLive),
  'hotel persist enabled',
);
assert.ok(/persistActivitySportHits/.test(persistLive), 'activity persist');

const checklist = fs.readFileSync(
  path.join(root, 'module2/mission/buildMissionChecklist.ts'),
  'utf8',
);
assert.ok(
  /mergePromotedSlotsIntoMission/.test(checklist),
  'promoted slots in checklist',
);

console.log('m2LearnWire.smoke.test.ts OK');
