/**
 * Phase 9 runner — all Mission-Loop smokes + locked gates (offline).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/mission/missionLoopPhase9.run.ts
 * Or:  npm run test:mission-loop
 */
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

const suite = [
  'src/module2/mission/missionChecklist.smoke.test.ts',
  'src/module2/mission/missionAskBack.smoke.test.ts',
  'src/module2/mission/missionStages.smoke.test.ts',
  'src/module2/mission/verifyMissionPass.smoke.test.ts',
  'src/module2/mission/missionFamilies.smoke.test.ts',
  'src/module2/mission/missionLearn.smoke.test.ts',
  'src/module2/mission/missionLoopPhase9.smoke.test.ts',
  'src/services/research/activityPrefetch.smoke.test.ts',
  'src/module2/pitch/pitchAmenityUi.smoke.test.ts',
  'src/module2/pitch/ayceIntent.smoke.test.ts',
  'src/module2/pitch/ayceSoftFillBelt.smoke.test.ts',
  'src/module2/pitch/hardMatch.smoke.test.ts',
  'src/module2/router/liveInventoryGate.smoke.test.ts',
  'src/module2/router/m2LearnWire.smoke.test.ts',
  'src/module2/kernel/turnKernel.smoke.test.ts',
  'src/services/audio/ttsPipeline.contract.test.ts',
  'src/services/audio/liveSentencePump.smoke.test.ts',
  'src/services/audio/punctuationChunker.smoke.test.ts',
];

let failed = 0;
for (const rel of suite) {
  process.stdout.write(`→ ${rel} … `);
  const cmd = `npx --yes --package tsx@4.19.4 tsx "${rel}"`;
  try {
    execSync(cmd, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
      windowsHide: true,
    });
    console.log('ok');
  } catch (err: unknown) {
    failed += 1;
    console.log('FAIL');
    const e = err as { stdout?: string; stderr?: string };
    const blob = `${e.stderr || ''}\n${e.stdout || ''}`.trim();
    const lines = blob.split(/\r?\n/).slice(-14);
    for (const line of lines) console.log('  ', line);
  }
}

if (failed) {
  console.error(`\nmissionLoopPhase9.run: ${failed}/${suite.length} failed`);
  process.exit(1);
}
console.log(`\nmissionLoopPhase9.run: ${suite.length}/${suite.length} ok`);
