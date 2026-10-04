/**
 * Cold-start Interactive Window + Prioritäts-Lanes.
 * mic > overlays > mapCore > mapLightPins > mapPolish > mapIdle > hydrate
 *
 * Sofort-Feedback-Vertrag:
 * - mic / overlays / mapCore laufen immer sofort (nie Queue).
 * - Overlay blockiert nur mapIdle + hydrate (Prefetch/Fog) — nie Map-Paint.
 * - Light-Pins früher (~1 s); volle Orte hinter Polish-Grace (~2 s).
 * - Waiter einzeln mit Yield; bei Block Timer-Wake (kein stiller Tod).
 */

export type BootLane =
  | 'mic'
  | 'overlays'
  | 'mapCore'
  | 'mapLightPins'
  | 'mapPolish'
  | 'mapIdle'
  | 'hydrate';

const LANE_RANK: Record<BootLane, number> = {
  mic: 0,
  overlays: 1,
  mapCore: 2,
  mapLightPins: 3,
  mapPolish: 4,
  mapIdle: 5,
  hydrate: 6,
};

/**
 * Nach Splash: Chrome/Mic/Pan haben Vorfahrt — kein schwerer JS.
 * Früher 2–3.5 s + Orte-Sync-Paint → Mic tot; Fenster länger + Places hinter Grace.
 */
export const INTERACTIVE_WINDOW_MS = 10_000;
/**
 * Warm Pin-Index (leicht): früher als volle Orte.
 * ~1 s — Pins sichtbar, Pan bleibt flüssig.
 */
export const MAP_LIGHT_PINS_GRACE_MS = 1_000;
/**
 * Volle Orte/ShapeSource: gleiches Fenster wie Interactive.
 * Früher nur ~280 ms → Orte-Paint hat Pan direkt nach Splash eingefroren.
 */
export const MAP_POLISH_TOUCH_GRACE_MS = INTERACTIVE_WINDOW_MS;
/** Gap zwischen Light-Pins / mapPolish Jobs (schneller als Hydrate). */
export const DEFERRED_POLISH_GAP_MS = 100;
/** Abstand zwischen mapIdle / hydrate Jobs (JS-Thread atmen lassen). */
export const DEFERRED_JOB_GAP_MS = 280;
/** Wenn Lane busy: trotzdem wecken (sonst stirbt die Queue still). */
export const BLOCKED_WAKE_MS = 500;
/** Mic-Active Safety: nie ewig Polish/Idle blockieren. */
const MIC_ACTIVE_MAX_MS = 45_000;
/**
 * Overlay pausiert nur Idle/Hydrate.
 * Kurz — Settings darf Map-Paint nicht minutenlang parken.
 */
export const OVERLAY_IDLE_BUSY_MAX_MS = 30_000;
export const MODULE2_TURN_BUSY_MAX_MS = 45_000;
/** Zurück-Tap: Laden kurz parken, damit die Geste zuerst zeichnet. */
export const CHROME_TAP_PULSE_MS = 480;
let chromePulseUntil = 0;

export function isChromePriority(): boolean {
  return Date.now() < chromePulseUntil;
}

/** Zurück: Fog und Karten-Nachladen für einen kurzen Moment aus. */
export function noteChromePriority(ms: number = CHROME_TAP_PULSE_MS): void {
  chromePulseUntil = Math.max(chromePulseUntil, Date.now() + ms);
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  draining = false;
  try {
    const { pauseFogHotPath } = require('../homeMap/fogTrackEngine') as {
      pauseFogHotPath: () => void;
    };
    pauseFogHotPath();
  } catch {
    /* soft */
  }
  scheduleWakeWhileBlocked();
}

type GateState = {
  splashInteractiveAt: number;
  interactiveSettled: boolean;
  micPipelineReady: boolean;
  micActive: boolean;
  overlayBusy: boolean;
  overlayBusySince: number;
  /** Call-1→Call-2 Speech — Map-Polish weicht (eigener Takt). */
  module2TurnBusy: boolean;
  micActiveSince: number;
};

const state: GateState = {
  splashInteractiveAt: 0,
  interactiveSettled: false,
  micPipelineReady: false,
  micActive: false,
  overlayBusy: false,
  overlayBusySince: 0,
  module2TurnBusy: false,
  micActiveSince: 0,
};

type Waiter = {
  lane: BootLane;
  resolve: () => void;
  enqueuedAt: number;
  /** Wie oft wegen Finger zurückgestellt — Failsafe gegen klemmende Gesture-Flags. */
  deferCount?: number;
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

function gapForLane(lane: BootLane): number {
  if (lane === 'mapLightPins' || lane === 'mapPolish') {
    return DEFERRED_POLISH_GAP_MS;
  }
  return DEFERRED_JOB_GAP_MS;
}

function scheduleDrain(gapMs?: number): void {
  if (draining || drainTimer) return;
  const nextGap =
    gapMs ??
    (waiters[0] ? gapForLane(waiters[0].lane) : DEFERRED_JOB_GAP_MS);
  drainTimer = setTimeout(() => {
    drainTimer = null;
    drainOne();
  }, nextGap);
}

function isUserMapGesturingSoft(): boolean {
  try {
    const { isMapUserGesturing } = require('../homeMap/mapGestureLane') as {
      isMapUserGesturing?: () => boolean;
    };
    return !!isMapUserGesturing?.();
  } catch {
    return false;
  }
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
  // Während Finger auf der Karte: Pins/Orte/Idle nicht gegen Pan rammen.
  // Max 6× zurückstellen — klemmendes Gesture-Flag darf Orte nicht ewig blocken.
  const deferCount = w.deferCount ?? 0;
  if (
    (w.lane === 'mapLightPins' ||
      w.lane === 'mapPolish' ||
      w.lane === 'mapIdle') &&
    isUserMapGesturingSoft() &&
    deferCount < 6
  ) {
    waiters.push({ ...w, enqueuedAt: Date.now(), deferCount: deferCount + 1 });
    draining = false;
    gateLog('defer polish/idle — user gesturing', {
      left: waiters.length,
      deferCount: deferCount + 1,
    });
    scheduleWakeWhileBlocked();
    return;
  }
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
    scheduleDrain(gapForLane(waiters[0]!.lane));
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
  state.module2TurnBusy = false;
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


/** True während der ersten Sekunden nach Splash-Lift — Chrome/Mic/Pan haben Vorfahrt. */
export function isInSplashInteractiveWindow(now = Date.now()): boolean {
  if (!state.splashInteractiveAt) return false;
  return now - state.splashInteractiveAt < INTERACTIVE_WINDOW_MS;
}

/** True solange auch Light-Pins nach Splash noch warten. */
export function isInMapLightPinsGrace(now = Date.now()): boolean {
  if (!state.splashInteractiveAt) return false;
  return now - state.splashInteractiveAt < MAP_LIGHT_PINS_GRACE_MS;
}

/** True solange volle Orte-Paint nach Splash noch warten (Pan-Vorfahrt). */
export function isInMapPolishTouchGrace(now = Date.now()): boolean {
  if (!state.splashInteractiveAt) return false;
  return now - state.splashInteractiveAt < MAP_POLISH_TOUCH_GRACE_MS;
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

/** True while Mic-Press / Listening — Fog/Polish deferred. */
export function isMicActive(): boolean {
  return state.micActive;
}

/**
 * Lane B owns the JS thread while the user listens/speaks or Module 2 works.
 * Read the live store as well as the explicit gate flags so map jobs also
 * yield during STT finalization and TTS playback.
 */
export function isVoiceLaneBusy(): boolean {
  if (state.micActive || state.module2TurnBusy) return true;
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore?: {
        getState?: () => {
          isListening?: boolean;
          isGenerating?: boolean;
          isPlayingAudio?: boolean;
          isAudiblySpeaking?: boolean;
        };
      };
    };
    const live = useFinnusStore?.getState?.();
    return Boolean(
      live?.isListening ||
        live?.isGenerating ||
        live?.isPlayingAudio ||
        live?.isAudiblySpeaking,
    );
  } catch {
    return false;
  }
}

/** Timeline/Settings/Seek offen — Soft-Pause für Fog/Ambient/Heading. */
export function isOverlayBusy(): boolean {
  return state.overlayBusy || liveOverlayOwns();
}

function liveVoiceOwns(): boolean {
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore?: {
        getState?: () => {
          isListening?: boolean;
          isGenerating?: boolean;
          isPlayingAudio?: boolean;
          isAudiblySpeaking?: boolean;
        };
      };
    };
    const live = useFinnusStore?.getState?.();
    return Boolean(
      live?.isListening ||
        live?.isGenerating ||
        live?.isPlayingAudio ||
        live?.isAudiblySpeaking,
    );
  } catch {
    return false;
  }
}

function liveOverlayOwns(): boolean {
  try {
    const { useHomeOverlayStore } = require('../../store/useHomeOverlayStore') as {
      useHomeOverlayStore: {
        getState: () => {
          settingsVisible?: boolean;
          seekVisible?: boolean;
          questionVisible?: boolean;
        };
      };
    };
    const o = useHomeOverlayStore.getState();
    if (o.settingsVisible || o.seekVisible || o.questionVisible) return true;
  } catch {
    /* soft */
  }
  try {
    const { usePlanCalendarUiStore } = require('../../module2/timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: { getState: () => { calendarVisible?: boolean } };
    };
    if (usePlanCalendarUiStore.getState().calendarVisible) return true;
  } catch {
    /* soft */
  }
  return false;
}

/**
 * Laden (Fog, Orte, Hydrate) bleibt aus, solange Mic, Zurück, Timeline
 * oder Einstellungen den Faden haben. Kein Timeout hebt das auf.
 */
export function chromeHoldsLoad(): boolean {
  if (state.micActive || state.overlayBusy || state.module2TurnBusy) return true;
  if (isChromePriority()) return true;
  if (liveVoiceOwns()) return true;
  if (liveOverlayOwns()) return true;
  return false;
}

/** Mic-Press / Listening — Light-Pins + Polish + Idle + Hydrate pausieren. */
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
    // Fog sofort pausieren — Mic/Timeline/Settings nicht hinter ShapeSource.
    try {
      const { pauseFogHotPath } = require('../homeMap/fogTrackEngine') as {
        pauseFogHotPath: () => void;
      };
      pauseFogHotPath();
    } catch {
      /* soft */
    }
    micSafetyTimer = setTimeout(() => {
      micSafetyTimer = null;
      if (!state.micActive) return;
      if (liveVoiceOwns()) {
        noteMicActive(true);
        return;
      }
      state.micActive = false;
      state.micActiveSince = 0;
      gateLog('mic failsafe clear');
      flushWaiters();
    }, MIC_ACTIVE_MAX_MS);
    scheduleWakeWhileBlocked();
  } else if (was) {
    flushWaiters();
  }
}

/**
 * Timeline/Settings/Seek/Popup offen — Map-Polish weicht (Chrome-Priorität).
 * mapCore bleibt frei (bereits geladene Karte pannt weiter).
 * Idle/Hydrate ebenfalls geparkt.
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
    gateLog('overlay busy — park polish/lightPins/idle/hydrate', {
      waiters: waiters.length,
    });
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    draining = false;
    try {
      const { pauseFogHotPath } = require('../homeMap/fogTrackEngine') as {
        pauseFogHotPath: () => void;
      };
      pauseFogHotPath();
    } catch {
      /* soft */
    }
    overlaySafetyTimer = setTimeout(() => {
      overlaySafetyTimer = null;
      if (!state.overlayBusy) return;
      if (liveOverlayOwns() || liveVoiceOwns()) {
        noteOverlayBusy(true);
        return;
      }
      state.overlayBusy = false;
      state.overlayBusySince = 0;
      gateLog('overlay failsafe clear');
      if (!state.micActive) flushWaiters();
    }, OVERLAY_IDLE_BUSY_MAX_MS);
    scheduleWakeWhileBlocked();
  } else if (was && !state.micActive) {
    flushWaiters();
  }
}


let module2SafetyTimer: ReturnType<typeof setTimeout> | null = null;

export function noteModule2TurnBusy(busy: boolean): void {
  state.module2TurnBusy = busy;
  if (module2SafetyTimer) {
    clearTimeout(module2SafetyTimer);
    module2SafetyTimer = null;
  }
  if (busy) {
    // Route/Puck (mapCore) bleiben frei; ShapeSource-/Extract-Polish weicht.
    gateLog('module2 turn busy — park polish/idle/hydrate', {
      waiters: waiters.length,
    });
    try {
      const { pauseFogHotPath } = require('../homeMap/fogTrackEngine') as {
        pauseFogHotPath: () => void;
      };
      pauseFogHotPath();
    } catch {
      /* soft */
    }
    module2SafetyTimer = setTimeout(() => {
      module2SafetyTimer = null;
      if (!state.module2TurnBusy) return;
      if (liveVoiceOwns() || liveOverlayOwns()) {
        noteModule2TurnBusy(true);
        return;
      }
      state.module2TurnBusy = false;
      gateLog('module2 turn failsafe clear');
      if (!state.micActive && !state.overlayBusy) flushWaiters();
    }, MODULE2_TURN_BUSY_MAX_MS);
    scheduleWakeWhileBlocked();
  } else if (!state.micActive && !state.overlayBusy) {
    flushWaiters();
  }
}

export function isLaneFree(lane: BootLane): boolean {
  if (lane === 'mic' || lane === 'overlays' || lane === 'mapCore') return true;
  // Mic, Zurück, Timeline, Einstellungen: Laden bleibt aus, solange sie offen sind.
  if (chromeHoldsLoad()) return false;

  // Light-Pins: Mic + Overlay + kurze Grace (~1 s).
  if (lane === 'mapLightPins') {
    if (state.micActive) return false;
    if (state.overlayBusy || isChromePriority()) return false;
    if (state.splashInteractiveAt) {
      if (Date.now() - state.splashInteractiveAt < MAP_LIGHT_PINS_GRACE_MS) {
        return false;
      }
    } else if (!state.interactiveSettled) {
      return false;
    }
    return true;
  }

  // Volle Orte: Mic + Overlay + Polish-Grace (~2 s, Pan darf nicht sterben).
  if (lane === 'mapPolish') {
    if (isVoiceLaneBusy()) return false;
    if (state.overlayBusy || isChromePriority()) return false;
    if (state.splashInteractiveAt) {
      if (Date.now() - state.splashInteractiveAt < MAP_POLISH_TOUCH_GRACE_MS) {
        return false;
      }
    } else if (!state.interactiveSettled) {
      return false;
    }
    return true;
  }

  // mapIdle + hydrate: Mic + Modul-2-Turn + Overlay + Interactive Window
  if (isVoiceLaneBusy()) return false;
  if (state.overlayBusy || isChromePriority()) return false;

  // Hart: Interactive Window gilt auch wenn settle zu früh gefeuert wurde.
  if (!state.splashInteractiveAt) return false;
  if (Date.now() - state.splashInteractiveAt < INTERACTIVE_WINDOW_MS) {
    return false;
  }
  if (!state.interactiveSettled) {
    state.interactiveSettled = true;
  }
  return true;
}

/**
 * Führt fn aus, sobald die Lane frei ist.
 * mapCore / mic / overlays laufen immer sofort.
 * mapLightPins / mapPolish / mapIdle / hydrate über Drain-Queue.
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

/** Warm Pin-Index — früher als volle Orte (~1 s Grace). */
export function runMapLightPinsWhenFree(fn: () => void): void {
  runWhenLaneFree('mapLightPins', fn);
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
