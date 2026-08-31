/**
 * Run: npx --yes tsx src/services/transit/collectUntilUseful.smoke.test.ts
 */

import { collectUntilUseful } from './collectUntilUseful';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main(): Promise<void> {
  const slowHang = new Promise<string[]>((resolve) => {
    setTimeout(() => resolve(['late']), 8_000);
  });
  const fast = Promise.resolve(['fast']);
  const t0 = Date.now();
  const got = await collectUntilUseful([fast, slowHang], {
    graceMs: 80,
    hardMs: 5_000,
  });
  const dt = Date.now() - t0;
  assert(got.includes('fast'), 'fast result kept');
  assert(!got.includes('late'), 'must not wait for hung provider');
  assert(dt < 600, `should return quickly (${dt}ms)`);

  const t1 = Date.now();
  const empty = await collectUntilUseful(
    [Promise.resolve([]), Promise.resolve([])],
    { graceMs: 200, hardMs: 4_000 },
  );
  assert(empty.length === 0, 'empty stays empty');
  assert(Date.now() - t1 < 400, 'empty providers return immediately');

  console.log('collectUntilUseful.smoke.test.ts OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
