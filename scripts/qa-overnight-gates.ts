/**
 * Offline QA for overnight quality gates (no RN imports).
 */
import assert from 'node:assert/strict';
import { shouldSuppressNavActions } from '../src/module2/pitch/navActionPolicy';

function testNavPolicy() {
  const now = Date.now();
  assert.equal(
    shouldSuppressNavActions({
      visitAtMs: now + 5 * 60_000,
      timelineStack: true,
      planningActive: true,
    }),
    false,
    '≤10min → Route erlaubt',
  );
  assert.equal(
    shouldSuppressNavActions({
      visitAtMs: now + 45 * 60_000,
      timelineStack: true,
      planningActive: true,
    }),
    true,
    '>10min Timeline → keine Route',
  );
  assert.equal(
    shouldSuppressNavActions({
      visitAtMs: now + 2 * 60_000,
      planningActive: false,
    }),
    false,
    'bald live → Route ok',
  );
  assert.equal(
    shouldSuppressNavActions({
      visitAtMs: now + 2 * 60 * 60_000,
      planningActive: false,
    }),
    true,
    'in 2h live → keine Route',
  );
}

testNavPolicy();

void import('../src/module2/kernel/turnKernel.smoke.test.ts')
  .then(() => import('../src/services/audio/ttsPipeline.contract.test.ts'))
  .then(() => {
    console.log('qa-overnight-gates: OK');
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
