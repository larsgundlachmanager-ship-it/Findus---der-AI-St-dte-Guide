/**
 * Regression Gate — Call-1/2 Pipeline + Kernel + TTS (RFC).
 * Ausführung: npm run test:regression-gate
 */

import { execSync } from 'node:child_process';

const steps: Array<{ name: string; cmd: string }> = [
  { name: 'turn-kernel', cmd: 'npm run test:turn-kernel' },
  { name: 'tts-pipeline', cmd: 'npm run test:tts-pipeline' },
  { name: 'call-pipeline', cmd: 'npm run test:call-pipeline' },
  { name: 'wiring-battery', cmd: 'npm run test:wiring-battery' },
  { name: 'live-replay', cmd: 'npm run test:live-replay' },
  { name: 'live-quality', cmd: 'npm run test:live-quality' },
  { name: 'pitch-gate', cmd: 'npm run test:pitch-gate' },
  { name: 'tour-gate', cmd: 'npm run test:tour-gate' },
  { name: 'luebeck-preflight', cmd: 'npm run test:luebeck-feld-preflight' },
  {
    name: 'unseen-auto-tour',
    cmd: 'npx --yes --package tsx@4.19.4 tsx src/module2/tour/unseenAutoTour.smoke.test.ts',
  },
  {
    name: 'island-access-compare',
    cmd: 'npx --yes --package tsx@4.19.4 tsx src/services/flights/islandAccessCompare.smoke.test.ts',
  },
  {
    name: 'niche-gastro',
    cmd: 'npx --yes --package tsx@4.19.4 tsx src/module2/pitch/nicheGastro.smoke.test.ts',
  },
  {
    name: 'plan-step-loop',
    cmd: 'npx --yes --package tsx@4.19.4 tsx src/module2/planning/planStepLoop.smoke.test.ts',
  },
  {
    name: 'help-first-partner',
    cmd: 'npx --yes --package tsx@4.19.4 tsx src/services/affiliate/helpFirstMonetization.smoke.test.ts',
  },
  {
    name: 'owner-gold',
    cmd: 'npx --yes --package tsx@4.19.4 tsx src/module2/blueprints/ownerGold.smoke.test.ts',
  },
];

for (const step of steps) {
  process.stdout.write(`[regression-gate] ${step.name}…\n`);
  execSync(step.cmd, { stdio: 'inherit', cwd: process.cwd() });
}

console.log('[regression-gate] ALL GREEN');
