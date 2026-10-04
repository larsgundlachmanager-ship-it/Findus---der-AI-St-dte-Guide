/**
 * Leftover audit for Ideal Refresh banned patterns.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/m2LeftoverAudit.smoke.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const files = [
  'router/call1Dispatch.ts',
  'router/call1OpenWorldContract.ts',
  'pitch/hardMatchVerify.ts',
  'pitch/publishPitchUi.ts',
  'pitch/runPitchModule.ts',
  'context/shortTermContext.ts',
  'pitch/pitchStartNav.ts',
];

for (const f of files) {
  const abs = path.join(root, f);
  assert.ok(fs.existsSync(abs), f);
  const t = fs.readFileSync(abs, 'utf8');
  if (f.includes('call1Dispatch')) {
    assert.ok(/ayce_blocks_events_soft|dining_blocks_events_soft/.test(t));
    assert.ok(/package_quick_soft/.test(t));
    assert.ok(/taxi_soft/.test(t));
  }
  if (f.includes('publishPitchUi')) {
    assert.ok(/openCalendar === true/.test(t));
  }
  if (f.includes('shortTermContext')) {
    assert.ok(/looksLikeAyceQuery\(text\) && !namedHint/.test(t));
  }
  if (f.includes('hardMatchVerify')) {
    assert.ok(/Kein belegtes All-you-can-eat/.test(t));
  }
  if (f.includes('pitchStartNav')) {
    assert.ok(/resolveActiveTravelMode/.test(t));
  }
  if (f.includes('runPitchModule')) {
    assert.ok(/Open-World: zweiter Web-Harvest|harvest2:/.test(t));
    assert.ok(/persistDiscoveredPoiIntoDataset/.test(t));
  }
}

console.log('m2LeftoverAudit.smoke.test.ts OK');
