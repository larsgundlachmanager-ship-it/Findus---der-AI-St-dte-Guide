/**
 * Cold-start Interactive Window + Prioritäts-Lanes.
 * mic > overlays > mapCore > mapPolish > mapIdle > hydrate
 *
 * Sofort-Feedback-Vertrag:
 * - mic / overlays / mapCore laufen immer sofort (nie Queue).
 * - Overlay blockiert nur mapIdle + hydrate (Prefetch/Fog) — nie Map-Paint.
 * - Waiter einzeln mit Yield; bei Block Timer-Wake (kein stiller Tod).
 */

export type BootLane =
  | 'mic'
  | 'overlays'
  | 'mapCore'
  | 'mapPolish'
  | 'mapIdle'
  | 'hydrate';

const LANE_RANK: Record<BootLane, number> = {
  mic: 0,
  overlays: 1,
  mapCore: 2,
  mapPolish: 3,
  mapIdle: 4,
  hydrate: 5,
};

/** Nach Splash: Mic/UI haben Vorfahrt. */
export const INTERACTIVE_WINDOW_MS = 3_500;
/** Abstand zwischen zwei deferred Jobs (JS-Thread atmen lassen). */
export const DEFERRED_JOB_GAP_MS = 200;
/** Wenn Lane busy: trotzdem wecken (sonst stirbt die Queue still). */
export const BLOCKED_WAKE_MS = 500;
/** Mic-Active Safety: nie ewig Polish/Idle blockieren. */
const MIC_ACTIVE_MAX_MS = 45_000;
/**
 * Overlay pausiert nur Idle/Hydrate.
 * Kurz — Settings darf Map-Paint nicht minutenlang parken.
 */
export const OVERLAY_IDLE_BUSY_MAX_MS = 30_000;

type GateState = {
  splashInteractiveAt: number;
  interactiveSettled: boolean;
  micPipelineReady: boolean;
  micActive: boolean;
  overlayBusy: boolean;
  overlayBusySince: number;
  micActiveSince: number;
};

const state: GateState = {
  splashInteractiveAt: 0,
  interactiveSettled: false,
  micPipelineReady: false,
  micActive: false,
  overlayBusy: false,
  overlayBusySince: 0,
  micActiveSince: 0,
};

type Waiter = {
  lane: BootLane;
  resolve: () => void;
  enqueuedAt: number;
};

const waiters: Waiter[] = [];
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let draining = false;
let micSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let overlaySafetyTimer: ReturnType<typeof setTimeout> | null = null;

function gateLog(msg: string, extra?: Record<string, unknown>): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[boot-gate] ${msg}`, extra ?? '');
  }
}

function clearWake(): void {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
}

function scheduleWakeWhileBlocked(): void {
  if (wakeTimer || waiters.length === 0) return;
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    if (waiters.length === 0) return;
    gateLog('wake while blocked', {
      waiters: waiters.length,
      lanes: waiters.map((w) => w.lane),
      mic: state.micActive,
      overlay: state.overlayBusy,
    });
    scheduleDrain();
  }, BLOCKED_WAKE_MS);
}

function scheduleDrain(): void {
  if (draining || drainTimer) return;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    drainOne();
  }, DEFERRED_JOB_GAP_MS);
}

function drainOne(): void {
  if (waiters.length === 0) {
    draining = false;
    clearWake();
    return;
  }
  draining = true;
  const idx = waiters.findIndex((w) => isLaneFree(w.lane));
  if (idx < 0) {
    draining = false;
    gateLog('drain blocked', {
      waiters: waiters.length,
      oldestMs: Date.now() - (waiters[0]?.enqueuedAt ?? Date.now()),
      mic: state.micActive,
      overlay: state.overlayBusy,
    });
    scheduleWakeWhileBlocked();
    return;
  }
  clearWake();
  const [w] = waiters.splice(idx, 1);
  const waited = Date.now() - w.enqueuedAt;
  if (waited > 400) {
    gateLog('drain job', { lane: w.lane, waitedMs: waited, left: waiters.length });
  }
  try {
    w.resolve();
  } catch {
    /* soft */
  }
  draining = false;
  if (waiters.length > 0) {
    scheduleDrain();
  }
}

function flushWaiters(): void {
  scheduleDrain();
}

function armSettleTimer(): void {
  if (state.interactiveSettled || settleTimer) return;
  if (!state.splashInteractiveAt) return;
  const remain = Math.max(
    0,
    INTERACTIVE_WINDOW_MS - (Date.now() - state.splashInteractiveAt),
  );
  settleTimer = setTimeout(() => {
    settleTimer = null;
    noteInteractiveSettled();
  }, remain);
}

export function resetInteractiveBootGate(): void {
  state.splashInteractiveAt = 0;
  state.interactiveSettled = false;
  state.micPipelineReady = false;
  state.micActive = false;
  state.overlayBusy = false;
  state.overlayBusySince = 0;
  state.micActiveSince = 0;
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  clearWake();
  if (micSafetyTimer) {
    clearTimeout(micSafetyTimer);
    micSafetyTimer = null;
  }
  if (overlaySafetyTimer) {
    clearTimeout(overlaySafetyTimer);
    overlaySafetyTimer = null;
  }
  draining = false;
  waiters.length = 0;
}

/** Splash fade fertig — Interactive Window startet. */
export function markSplashInteractive(now = Date.now()): void {
  if (state.splashInteractiveAt) return;
  state.splashInteractiveAt = now;
  armSettleTimer();
}

export function noteInteractiveSettled(): void {
  state.interactiveSettled = true;
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  flushWaiters();
}

export function isInteractiveSettled(): boolean {
  return state.interactiveSettled;
}

export function peekInteractiveBootGate(): Readonly<GateState> {
  return { ...state };
}

export function peekBootGateWaiters(): number {
  return waiters.length;
}

export function noteMicPipelineReady(): void {
  state.micPipelineReady = true;
}

export function isMicPipelineReady(): boolean {
  return state.micPipelineReady;
}

/** Mic-Press / Listening — mapPolish + mapIdle + hydrate pausieren. */
export function noteMicActive(active: boolean): void {
  const was = state.micActive;
  state.micActive = active;
  state.micActiveSince = active ? Date.now() : 0;
  if (micSafetyTimer) {
    clearTimeout(micSafetyTimer);
    micSafetyTimer = null;
  }
  if (active) {
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    draining = false;
    gateLog('mic active — park idle/polish', { waiters: waiters.length });
    micSafetyTimer = setTimeout(() => {
      micSafetyTimer = null;
      if (state.micActive) {
        state.micActive = false;
        state.micActiveSince = 0;
        gateLog('mic failsafe clear');
        flushWaiters();
      }
    }, MIC_ACTIVE_MAX_MS);
    scheduleWakeWhileBlocked();
  } else if (was) {
    flushWaiters();
  }
}

/**
 * Timeline/Settings/Seek offen — nur Idle/Hydrate pausieren.
 * Map-Paint (mapCore/mapPolish) läuft weiter → Sofort-Feedback-Vertrag.
 */
export function noteOverlayBusy(busy: boolean): void {
  const was = state.overlayBusy;
  state.overlayBusy = busy;
  state.overlayBusySince = busy ? Date.now() : 0;
  if (overlaySafetyTimer) {
    clearTimeout(overlaySafetyTimer);
    overlaySafetyTimer = null;
  }
  if (busy) {
    gateLog('overlay busy — park mapIdle/hydrate only', {
      waiters: waiters.length,
    });
    overlaySafetyTimer = setTimeout(() => {
      overlaySafetyTimer = null;
      if (state.overlayBusy) {
        state.overlayBusy = false;
        state.overlayBusySince = 0;
        gateLog('overlay failsafe clear');
        if (!state.micActive) flushWaiters();
      }
    }, OVERLAY_IDLE_BUSY_MAX_MS);
    scheduleWakeWhileBlocked();
  } else if (was && !state.micActive) {
    flushWaiters();
  }
}

export function isLaneFree(lane: BootLane): boolean {
  if (lane === 'mic' || lane === 'overlays' || lane === 'mapCore') return true;

  // Paint-Polish: nur Mic pausiert — Overlay nicht (Settings darf Karte nicht frieren).
  if (lane === 'mapPolish') {
    if (state.micActive) return false;
    if (!state.interactiveSettled) {
      if (!state.splashInteractiveAt) return false;
      if (Date.now() - state.splashInteractiveAt < INTERACTIVE_WINDOW_MS) {
        return false;
      }
      state.interactiveSettled = true;
    }
    return true;
  }

  // mapIdle + hydrate: Mic + Overlay
  if (state.micActive) return false;
  if (state.overlayBusy) return false;

  if (!state.interactiveSettled) {
    if (!state.splashInteractiveAt) return false;
    if (Date.now() - state.splashInteractiveAt < INTERACTIVE_WINDOW_MS) {
      return false;
    }
    state.interactiveSettled = true;
  }
  return true;
}

/**
 * Führt fn aus, sobald die Lane frei ist.
 * mapCore / mic / overlays laufen immer sofort.
 * mapPolish / mapIdle / hydrate über Drain-Queue.
 */
export function runWhenLaneFree(lane: BootLane, fn: () => void): void {
  if (lane === 'mic' || lane === 'overlays' || lane === 'mapCore') {
    fn();
    return;
  }
  waiters.push({
    lane,
    resolve: () => {
      fn();
    },
    enqueuedAt: Date.now(),
  });
  armSettleTimer();
  scheduleDrain();
}

export function waitUntilInteractiveSettled(): Promise<void> {
  if (isLaneFree('hydrate')) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push({
      lane: 'hydrate',
      resolve: () => resolve(),
      enqueuedAt: Date.now(),
    });
    armSettleTimer();
    scheduleDrain();
  });
}

export function runMapPolishWhenFree(fn: () => void): void {
  runWhenLaneFree('mapPolish', fn);
}

/** Prefetch / Fog / Footprints — nie Chrome, max hinter Mic/Overlay. */
export function runMapIdleWhenFree(fn: () => void): void {
  runWhenLaneFree('mapIdle', fn);
}

export function runHydrateWhenFree(fn: () => void): void {
  runWhenLaneFree('hydrate', fn);
}

/** @deprecated rank helper for tests */
export function laneRank(lane: BootLane): number {
  return LANE_RANK[lane];
}

function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * Hydrate-Schritte einzeln mit Yield — nie einen langen Sync-Block.
 */
export async function runHydrateSteps(
  steps: Array<() => void | Promise<void>>,
): Promise<void> {
  for (const step of steps) {
    while (!isLaneFree('hydrate')) {
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      await step();
    } catch {
      /* soft per step */
    }
    await yieldToUi();
    await new Promise((r) => setTimeout(r, DEFERRED_JOB_GAP_MS));
  }
}
