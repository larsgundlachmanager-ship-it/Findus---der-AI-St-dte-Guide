/**
 * Boot-Gate Queue — Overlay parked nur Idle; Wake bei Block.
 * Run: npx --yes tsx src/services/boot/bootGate.queue.smoke.test.ts
 */

import {
  DEFERRED_JOB_GAP_MS,
  INTERACTIVE_WINDOW_MS,
  OVERLAY_IDLE_BUSY_MAX_MS,
  isLaneFree,
  markSplashInteractive,
  noteInteractiveSettled,
  noteOverlayBusy,
  peekBootGateWaiters,
  resetInteractiveBootGate,
  runMapIdleWhenFree,
  runMapPolishWhenFree,
} from './interactiveBootGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  assert(OVERLAY_IDLE_BUSY_MAX_MS <= 30_000, 'Overlay Idle Failsafe ≤30s');

  resetInteractiveBootGate();
  markSplashInteractive(Date.now() - INTERACTIVE_WINDOW_MS - 10);
  noteInteractiveSettled();

  let polish = false;
  let idle = false;
  noteOverlayBusy(true);
  runMapPolishWhenFree(() => {
    polish = true;
  });
  runMapIdleWhenFree(() => {
    idle = true;
  });
  await sleep(DEFERRED_JOB_GAP_MS + 50);
  assert(polish, 'mapPolish läuft trotz Overlay');
  assert(!idle, 'mapIdle wartet hinter Overlay');
  assert(peekBootGateWaiters() >= 1, 'Idle in Queue');
  noteOverlayBusy(false);
  await sleep(DEFERRED_JOB_GAP_MS + 80);
  assert(idle, 'mapIdle nach Overlay-Close');
  assert(peekBootGateWaiters() === 0, 'Queue leer');

  console.log('bootGate.queue.smoke.test.ts OK');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
