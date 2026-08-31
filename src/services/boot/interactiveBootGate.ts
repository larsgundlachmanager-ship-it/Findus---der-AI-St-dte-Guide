/**
 * Cold-start Interactive Window + Prioritäts-Lanes.
 * mic > overlays > mapCore > mapPolish > hydrate
 *
 * Wichtig: Waiter werden EINzeln mit Yield drained — nie alle Hydrate/Polish
 * synchron hintereinander (sonst friert Mic/Timeline 30–60 s ein).
 */

export type BootLane = 'mic' | 'overlays' | 'mapCore' | 'mapPolish' | 'hydrate';

const LANE_RANK: Record<BootLane, number> = {
  mic: 0,
  overlays: 1,
  mapCore: 2,
  mapPolish: 3,
  hydrate: 4,
};

/** Nach Splash: Mic/UI haben Vorfahrt. */
export const INTERACTIVE_WINDOW_MS = 3_500;
/** Abstand zwischen zwei deferred Jobs (JS-Thread atmen lassen). */
export const DEFERRED_JOB_GAP_MS = 200;
/** Mic-Active Safety: nie ewig Polish blockieren. */
const MIC_ACTIVE_MAX_MS = 45_000;
/**
 * Overlay offen = Background pausiert die ganze Zeit.
 * Nur Failsafe falls Close verloren geht (nicht 2 s — sonst friert Settings ein).
 */
const OVERLAY_BUSY_MAX_MS = 10 * 60_000;

type GateState = {
  splashInteractiveAt: number;
  interactiveSettled: boolean;
  micPipelineReady: boolean;
  micActive: boolean;
  overlayBusy: boolean;
};

const state: GateState = {
  splashInteractiveAt: 0,
  interactiveSettled: false,
  micPipelineReady: false,
  micActive: false,
  overlayBusy: false,
};

type Waiter = {
  lane: BootLane;
  resolve: () => void;
};

const waiters: Waiter[] = [];
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let draining = false;
let micSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let overlaySafetyTimer: ReturnType<typeof setTimeout> | null = null;

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
    return;
  }
  draining = true;
  const idx = waiters.findIndex((w) => isLaneFree(w.lane));
  if (idx < 0) {
    draining = false;
    return;
  }
  const [w] = waiters.splice(idx, 1);
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
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
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

export function noteMicPipelineReady(): void {
  state.micPipelineReady = true;
}

export function isMicPipelineReady(): boolean {
  return state.micPipelineReady;
}

/** Mic-Press / Listening aktiv — mapPolish + hydrate pausieren. Höchste Prio. */
export function noteMicActive(active: boolean): void {
  const was = state.micActive;
  state.micActive = active;
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
    micSafetyTimer = setTimeout(() => {
      micSafetyTimer = null;
      if (state.micActive) {
        state.micActive = false;
        flushWaiters();
      }
    }, MIC_ACTIVE_MAX_MS);
  } else if (was) {
    flushWaiters();
  }
}

/** Timeline/Settings/Seek offen — Background komplett pausieren bis Close. */
export function noteOverlayBusy(busy: boolean): void {
  const was = state.overlayBusy;
  state.overlayBusy = busy;
  if (overlaySafetyTimer) {
    clearTimeout(overlaySafetyTimer);
    overlaySafetyTimer = null;
  }
  if (busy) {
    // Laufenden Drain abbrechen — UI zuerst.
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    draining = false;
    overlaySafetyTimer = setTimeout(() => {
      overlaySafetyTimer = null;
      if (state.overlayBusy) {
        state.overlayBusy = false;
        if (!state.micActive) flushWaiters();
      }
    }, OVERLAY_BUSY_MAX_MS);
  } else if (was && !state.micActive) {
    flushWaiters();
  }
}

export function isLaneFree(lane: BootLane): boolean {
  if (lane === 'mic' || lane === 'overlays' || lane === 'mapCore') return true;

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
 * mapPolish / hydrate immer über Drain-Queue (nie Burst).
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
    });
    armSettleTimer();
    scheduleDrain();
  });
}

export function runMapPolishWhenFree(fn: () => void): void {
  runWhenLaneFree('mapPolish', fn);
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
