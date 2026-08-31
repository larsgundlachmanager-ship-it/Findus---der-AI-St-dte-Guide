/**
 * Smoke: Leave-Cadence 60/40/35/30/15/7/5/0 · Wake silent · Soft 5.
 * Run: npx --yes tsx src/services/logistics/logisticsTriggerMath.smoke.ts
 */
import { buildCheckSchedule } from './logisticsTriggerMath';

const now = Date.now();
const leaveIn2h = now + 2 * 60 * 60_000;
const wakeIn8h = now + 8 * 60 * 60_000;

let failed = 0;

function offsetMin(anchor: number, at: number): number {
  return Math.round((anchor - at) / 60_000);
}

const leave30 = buildCheckSchedule(leaveIn2h, now, 'leave', { warnLeadMin: 30 });
const roles = leave30.map((p) => `${offsetMin(leaveIn2h, p.atMs)}:${p.role}`);
const expect = ['60:micro', '40:micro', '35:micro', '30:warn', '15:micro', '7:micro', '5:warn', '0:hard'];
for (const e of expect) {
  if (!roles.includes(e)) {
    console.error('FAIL missing', e, 'got', roles);
    failed += 1;
  }
}
if (leave30.filter((p) => p.role === 'warn').length !== 2) {
  console.error('FAIL need exactly 2 warn (30+5)');
  failed += 1;
}

const leave5 = buildCheckSchedule(leaveIn2h, now, 'leave', { warnLeadMin: 5 });
if (leave5.some((p) => p.role === 'warn' && leaveIn2h - p.atMs > 5 * 60_000 + 1000)) {
  console.error('FAIL soft leave warn > 5');
  failed += 1;
}

const wake = buildCheckSchedule(wakeIn8h, now, 'wake');
if (wake.some((p) => p.role === 'warn' || p.role === 'hard')) {
  console.error('FAIL wake must not have warn/hard', wake);
  failed += 1;
}

const capped = buildCheckSchedule(leaveIn2h, now, 'leave', { warnLeadMin: 90 });
if (!capped.some((p) => p.role === 'warn' && Math.abs(offsetMin(leaveIn2h, p.atMs) - 30) < 2)) {
  console.error('FAIL warnLeadMin not capped to full 30-cadence');
  failed += 1;
}

if (failed) {
  console.error(`logisticsTriggerMath smoke: ${failed} failed`);
  process.exit(1);
}
console.log('logisticsTriggerMath smoke: ok', roles.join(' · '));
