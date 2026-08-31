/**
 * Run: npx --yes tsx src/services/boot/interactiveBootGate.smoke.test.ts
 */

import {
  INTERACTIVE_WINDOW_MS,
  DEFERRED_JOB_GAP_MS,
  isLaneFree,
  markSplashInteractive,
  noteInteractiveSettled,
  noteMicActive,
  noteMicPipelineReady,
  noteOverlayBusy,
  peekInteractiveBootGate,
  resetInteractiveBootGate,
  runWhenLaneFree,
  waitUntilInteractiveSettled,
  isMicPipelineReady,
} from './interactiveBootGate';
import { readFileSync } from 'fs';
import { join } from 'path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  resetInteractiveBootGate();
  assert(isLaneFree('mapCore'), 'mapCore immer frei');
  assert(isLaneFree('mic'), 'mic immer frei');
  assert(!isLaneFree('mapPolish'), 'mapPolish vor Splash-Interactive gesperrt');
  assert(!isLaneFree('hydrate'), 'hydrate vor Splash-Interactive gesperrt');

  markSplashInteractive(Date.now());
  assert(!isLaneFree('hydrate'), 'hydrate im Interactive Window gesperrt');

  noteMicActive(true);
  assert(!isLaneFree('mapPolish'), 'mic aktiv → polish weg');
  noteMicActive(false);

  noteOverlayBusy(true);
  assert(!isLaneFree('hydrate'), 'overlay busy → hydrate weg');
  noteOverlayBusy(false);

  let ran = false;
  runWhenLaneFree('hydrate', () => {
    ran = true;
  });
  assert(!ran, 'hydrate waiter wartet noch');
  noteInteractiveSettled();
  // Drain ist async (Gap) — nicht synchron flushen
  await sleep(DEFERRED_JOB_GAP_MS + 80);
  assert(ran, 'nach settle + drain läuft hydrate waiter');
  assert(isLaneFree('hydrate'), 'hydrate frei nach settle');

  noteMicPipelineReady();
  assert(isMicPipelineReady(), 'mic pipeline flag');

  resetInteractiveBootGate();
  markSplashInteractive(Date.now() - INTERACTIVE_WINDOW_MS - 10);
  assert(isLaneFree('hydrate'), 'window abgelaufen → hydrate frei');

  // Mehrere Waiter: einzeln drainen, nicht alle auf einmal
  resetInteractiveBootGate();
  markSplashInteractive(Date.now() - INTERACTIVE_WINDOW_MS - 10);
  noteInteractiveSettled();
  const order: number[] = [];
  runWhenLaneFree('hydrate', () => {
    order.push(1);
  });
  runWhenLaneFree('mapPolish', () => {
    order.push(2);
  });
  runWhenLaneFree('hydrate', () => {
    order.push(3);
  });
  await sleep(DEFERRED_JOB_GAP_MS * 4 + 100);
  assert(order.length === 3, `alle 3 Jobs: ${order.join(',')}`);
  assert(order[0] === 1 && order[1] === 2 && order[2] === 3, 'Reihenfolge FIFO drain');

  resetInteractiveBootGate();
  let settledOk = false;
  void waitUntilInteractiveSettled().then(() => {
    settledOk = true;
  });
  markSplashInteractive(Date.now() - INTERACTIVE_WINDOW_MS - 5);
  noteInteractiveSettled();
  await sleep(DEFERRED_JOB_GAP_MS + 80);
  assert(
    settledOk || peekInteractiveBootGate().interactiveSettled,
    'waitUntil resolved oder settled',
  );

  // Source contracts
  const splash = readFileSync(
    join(process.cwd(), 'src/components/SplashScreenController.tsx'),
    'utf8',
  );
  assert(
    splash.includes('Voice-Warm parallel zum Reveal'),
    'Splash: Voice parallel, nicht serial await',
  );

  const stt = readFileSync(join(process.cwd(), 'src/services/sttService.ts'), 'utf8');
  assert(stt.includes('warmMicrophonePipeline'), 'STT Boot-Prewarm');

  const app = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
  assert(app.includes('waitUntilInteractiveSettled'), 'App defer hinter Interactive Window');
  assert(app.includes('runHydrateSteps'), 'App Hydrate gestaffelt');
  assert(app.includes('scheduleIdleUiPrefetch()'), 'Premount schon bei bootReady');
  assert(app.includes('early pois'), 'lokale POIs früh');

  const idle = readFileSync(
    join(process.cwd(), 'src/services/ui/idlePrefetch.ts'),
    'utf8',
  );
  assert(
    idle.includes('setTimeout(() => premountOverlayHosts(), 0)'),
    'Premount sofort per setTimeout',
  );

  const host = readFileSync(
    join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
    'utf8',
  );
  assert(host.includes('placesBootCommittedRef'), 'atomic places commit');
  assert(host.includes('Nur aktive Stadt vorwärmen'), 'kein Parallel-Prefetch aller Packs');
  assert(host.includes('runMapPolishWhenFree'), 'map polish lane');

  const view = readFileSync(
    join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
    'utf8',
  );
  assert(view.includes('layerApplyQuietUntil'), 'Kamera-Quiet während Apply');

  const gate = readFileSync(
    join(process.cwd(), 'src/services/boot/interactiveBootGate.ts'),
    'utf8',
  );
  assert(gate.includes('drainOne'), 'Waiter einzeln drainen');
  assert(gate.includes('DEFERRED_JOB_GAP_MS'), 'Gap zwischen Jobs');

  console.log('interactiveBootGate.smoke.test.ts OK');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
