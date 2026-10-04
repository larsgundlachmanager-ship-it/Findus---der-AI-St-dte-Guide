/**
 * Run: npx --yes tsx src/services/boot/interactiveBootGate.smoke.test.ts
 */

import {
  INTERACTIVE_WINDOW_MS,
  MAP_LIGHT_PINS_GRACE_MS,
  DEFERRED_JOB_GAP_MS,
  DEFERRED_POLISH_GAP_MS,
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
  assert(MAP_LIGHT_PINS_GRACE_MS < INTERACTIVE_WINDOW_MS, 'Light-Pins früher als Orte');
  assert(DEFERRED_POLISH_GAP_MS < DEFERRED_JOB_GAP_MS, 'Polish-Gap kleiner als Hydrate');
  assert(DEFERRED_POLISH_GAP_MS >= 80 && DEFERRED_POLISH_GAP_MS <= 120, 'Polish-Gap 80–120');

  resetInteractiveBootGate();
  assert(isLaneFree('mapCore'), 'mapCore immer frei');
  assert(isLaneFree('mic'), 'mic immer frei');
  assert(!isLaneFree('mapLightPins'), 'mapLightPins vor Splash-Interactive gesperrt');
  assert(!isLaneFree('mapPolish'), 'mapPolish vor Splash-Interactive gesperrt');
  assert(!isLaneFree('hydrate'), 'hydrate vor Splash-Interactive gesperrt');

  markSplashInteractive(Date.now());
  assert(!isLaneFree('mapLightPins'), 'light pins im ersten Fenster gesperrt');
  assert(!isLaneFree('mapPolish'), 'polish im Interactive Window gesperrt');
  assert(!isLaneFree('hydrate'), 'hydrate im Interactive Window gesperrt');

  noteMicActive(true);
  assert(!isLaneFree('mapLightPins'), 'mic aktiv → light pins weg');
  assert(!isLaneFree('mapPolish'), 'mic aktiv → polish weg');
  noteMicActive(false);

  noteOverlayBusy(true);
  assert(!isLaneFree('hydrate'), 'overlay busy → hydrate weg');
  noteOverlayBusy(false);

  noteInteractiveSettled();
  assert(
    !isLaneFree('hydrate'),
    'settle allein öffnet hydrate nicht während Interactive Window',
  );

  // Window abgelaufen → Hydrate/Idle dürfen drainen
  resetInteractiveBootGate();
  markSplashInteractive(Date.now() - INTERACTIVE_WINDOW_MS - 10);
  noteInteractiveSettled();
  let ran = false;
  runWhenLaneFree('hydrate', () => {
    ran = true;
  });
  await sleep(DEFERRED_JOB_GAP_MS + 80);
  assert(ran, 'nach Window + settle + drain läuft hydrate waiter');
  assert(isLaneFree('hydrate'), 'hydrate frei nach Window');

  noteMicPipelineReady();
  assert(isMicPipelineReady(), 'mic pipeline flag');

  resetInteractiveBootGate();
  markSplashInteractive(Date.now() - INTERACTIVE_WINDOW_MS - 10);
  assert(isLaneFree('hydrate'), 'window abgelaufen → hydrate frei');

  // Light-Pins nach ~1 s frei, volle Orte noch gesperrt
  resetInteractiveBootGate();
  markSplashInteractive(Date.now() - MAP_LIGHT_PINS_GRACE_MS - 10);
  assert(isLaneFree('mapLightPins'), 'nach Light-Grace → Pins frei');
  assert(!isLaneFree('mapPolish'), 'nach Light-Grace → Orte noch gesperrt');
  assert(!isLaneFree('hydrate'), 'nach Light-Grace → hydrate noch gesperrt');

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
    splash.includes('warmActiveVoice') && splash.includes('waitForSplashReveal'),
    'Splash: Voice-Warm parallel zum Reveal-Gate',
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
    idle.includes('CHROME_PREMOUNT_AFTER_SPLASH_MS') &&
      idle.includes('prefetchOverlayBundles()'),
    'Bundle früh; Chrome-Premount nach Splash-Interactive',
  );
  assert(
    /CHROME_PREMOUNT_AFTER_SPLASH_MS\s*=\s*(\d{1,3})\b/.test(idle),
    'Chrome-Premount kurz nach Splash (≤160 ms)',
  );
  {
    const m = idle.match(/CHROME_PREMOUNT_AFTER_SPLASH_MS\s*=\s*(\d+)/);
    const ms = m ? Number(m[1]) : -1;
    assert(ms >= 0 && ms <= 160, 'Premount-Delay 0–160 ms');
  }
  assert(
    !/handleSplashFinish[\s\S]{0,500}noteInteractiveSettled\(/.test(app),
    'Kein early noteInteractiveSettled im Splash-Finish',
  );
  const host = readFileSync(
    join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
    'utf8',
  );
  assert(host.includes('placesBootCommittedRef'), 'atomic places commit');
  assert(host.includes('Nur aktive Stadt vorwärmen'), 'kein Parallel-Prefetch aller Packs');
  assert(host.includes('runMapIdleWhenFree'), 'map idle lane für Prefetch/Fog');
  assert(host.includes('runMapLightPinsWhenFree'), 'Light-Pins eigene Lane');
  assert(host.includes('armPostSplashLadder'), 'Leiter erst nach Splash-Interactive');
  assert(
    host.includes('placesPaintMustYield'),
    'Orte-Paint weicht Interactive Window / Mic',
  );
  assert(
    host.includes('chromeHoldsLoad()') &&
      host.includes('isInMapPolishTouchGrace()'),
    'Orte-Paint weicht Chrome (Mic/Overlay/Zurück) + Polish-Grace',
  );
  assert(
    host.includes('Immer über Polish-Lane'),
    'Heavy Overlays nie sync gegen Chrome',
  );
  assert(
    !host.includes('prefetchNext') || !host.includes('others[i++]'),
    'keine serielle Prefetch-Kette aller Offline-Städte',
  );

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
  assert(gate.includes('DEFERRED_POLISH_GAP_MS'), 'Polish-Gap getrennt');
  assert(gate.includes('mapIdle'), 'mapIdle Lane');
  assert(gate.includes('mapLightPins'), 'mapLightPins Lane');
  assert(gate.includes('runMapIdleWhenFree'), 'runMapIdleWhenFree export');
  assert(gate.includes('runMapLightPinsWhenFree'), 'runMapLightPinsWhenFree export');
  assert(
    gate.includes('chromeHoldsLoad') &&
      gate.includes('liveOverlayOwns') &&
      gate.includes('liveVoiceOwns'),
    'Chrome-Hold: Mic/Timeline/Settings halten Laden verpflichtend',
  );
  assert(
    gate.includes('if (liveVoiceOwns())') &&
      gate.includes('if (liveOverlayOwns() || liveVoiceOwns())'),
    'Failsafe renewt Hold solange Mic/Overlay live',
  );
  assert(gate.includes('OVERLAY_IDLE_BUSY_MAX_MS'), 'Overlay Idle Failsafe kurz');
  assert(gate.includes('scheduleWakeWhileBlocked'), 'Timer-Wake wenn blocked');
  assert(
    gate.includes('park polish/lightPins/idle/hydrate') ||
      gate.includes('Map-Polish weicht'),
    'Overlay parkt Polish (Chrome zuerst)',
  );
  assert(
    gate.includes('MAP_POLISH_TOUCH_GRACE_MS = INTERACTIVE_WINDOW_MS'),
    'Polish-Grace = Interactive Window (Pan zuerst)',
  );
  assert(
    gate.includes('MAP_LIGHT_PINS_GRACE_MS = 1_000') ||
      gate.includes('MAP_LIGHT_PINS_GRACE_MS = 1000'),
    'Light-Pins-Grace ~1s',
  );
  assert(
    gate.includes('defer polish/idle — user gesturing'),
    'Drain weicht Finger aus',
  );

  assert(
    gate.includes('Interactive Window gilt auch wenn settle zu früh') ||
      /splashInteractiveAt[\s\S]{0,120}INTERACTIVE_WINDOW_MS/.test(gate),
    'Hydrate/Idle hart hinter Interactive Window',
  );
  assert(
    /INTERACTIVE_WINDOW_MS\s*=\s*10_?000/.test(gate) ||
      /INTERACTIVE_WINDOW_MS\s*=\s*10000/.test(gate),
    'Interactive Window ≥10s für Chrome/Mic',
  );


  const schedule = readFileSync(
    join(process.cwd(), 'src/services/homeMap/homeMapBootSchedule.ts'),
    'utf8',
  );
  assert(schedule.includes('MAP_LIGHT_PINS_GRACE_MS'), 'Schedule an Light-Grace');
  assert(schedule.includes('MAP_POLISH_TOUCH_GRACE_MS'), 'Schedule an Polish-Grace');

  // Overlay offen → Chrome zuerst: Polish/LightPins weichen, mapCore bleibt
  resetInteractiveBootGate();
  markSplashInteractive(Date.now() - INTERACTIVE_WINDOW_MS - 10);
  noteInteractiveSettled();
  noteOverlayBusy(true);
  assert(!isLaneFree('mapLightPins'), 'overlay → mapLightPins geparkt');
  assert(!isLaneFree('mapPolish'), 'overlay → mapPolish geparkt');
  assert(isLaneFree('mapCore'), 'overlay → mapCore frei');
  assert(!isLaneFree('mapIdle'), 'overlay → mapIdle geparkt');
  assert(!isLaneFree('hydrate'), 'overlay → hydrate geparkt');
  noteOverlayBusy(false);

  console.log('interactiveBootGate.smoke.test.ts OK');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
