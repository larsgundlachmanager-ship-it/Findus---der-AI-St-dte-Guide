/**
 * Pedometer / stillness sleep for GPS battery saver.
 * Speed 0 + no steps for 2 min → deep sleep GPS.
 * Continuous steps → instant wake.
 */

import { Pedometer } from 'expo-sensors';
import {
  getGpsStreamProfile,
  setGpsStreamProfile,
  type GpsStreamProfile,
} from '../locationService';
import { useFinnusStore } from '../../store/useFinnusStore';

const STILLNESS_SLEEP_MS = 2 * 60 * 1000;
const STEP_WAKE_WINDOW_MS = 4_000;
const STEP_WAKE_COUNT = 3;
const POLL_MS = 5_000;

let started = false;
let stillnessSinceMs: number | null = null;
let recentSteps = 0;
let lastStepAtMs = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let stepSub: { remove: () => void } | null = null;
let profileBeforeSleep: GpsStreamProfile | null = null;
let sleeping = false;

function isMovingByGps(speedMs: number | null | undefined): boolean {
  return typeof speedMs === 'number' && Number.isFinite(speedMs) && speedMs > 0.35;
}

async function enterDeepSleep(): Promise<void> {
  if (sleeping) return;
  const store = useFinnusStore.getState();
  if (store.navActive) return; // never sleep mid-navigation
  sleeping = true;
  profileBeforeSleep = getGpsStreamProfile();
  await setGpsStreamProfile('sleep');
  if (__DEV__) {
    console.log('[battery] GPS deep sleep (2 min stillness)');
  }
}

async function wakeFromSleep(reason: string): Promise<void> {
  if (!sleeping) return;
  sleeping = false;
  stillnessSinceMs = null;
  const restore = profileBeforeSleep ?? 'economy';
  profileBeforeSleep = null;
  await setGpsStreamProfile(restore);
  if (__DEV__) {
    console.log(`[battery] GPS wake (${reason}) → ${restore}`);
  }
}

/**
 * Call on each GPS tick with speed. Tracks stillness clock.
 */
export function tickStillnessFromGps(speedMs: number | null | undefined): void {
  const now = Date.now();
  if (isMovingByGps(speedMs)) {
    stillnessSinceMs = null;
    if (sleeping) void wakeFromSleep('gps-speed');
    return;
  }
  // Steps recently → not still
  if (now - lastStepAtMs < STEP_WAKE_WINDOW_MS && recentSteps >= 1) {
    stillnessSinceMs = null;
    if (sleeping) void wakeFromSleep('steps');
    return;
  }
  if (stillnessSinceMs == null) {
    stillnessSinceMs = now;
    return;
  }
  if (!sleeping && now - stillnessSinceMs >= STILLNESS_SLEEP_MS) {
    void enterDeepSleep();
  }
}

function onStepEvent(result: { steps: number }): void {
  const n = result.steps ?? 0;
  if (n <= 0) return;
  recentSteps += n;
  lastStepAtMs = Date.now();
  if (recentSteps >= STEP_WAKE_COUNT) {
    void wakeFromSleep('continuous-steps');
    recentSteps = 0;
  }
}

async function attachPedometer(): Promise<void> {
  try {
    const available = await Pedometer.isAvailableAsync();
    if (!available) {
      if (__DEV__) console.log('[battery] Pedometer unavailable');
      return;
    }
    stepSub?.remove();
    stepSub = Pedometer.watchStepCount(onStepEvent);
  } catch (err) {
    if (__DEV__) console.warn('[battery] Pedometer start failed:', err);
  }
}

export function startPedometerSleepMonitor(): void {
  if (started) return;
  started = true;
  void attachPedometer();
  pollTimer = setInterval(() => {
    // Decay step burst counter
    if (Date.now() - lastStepAtMs > STEP_WAKE_WINDOW_MS) {
      recentSteps = 0;
    }
  }, POLL_MS);
}

export function stopPedometerSleepMonitor(): void {
  started = false;
  stepSub?.remove();
  stepSub = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  sleeping = false;
  stillnessSinceMs = null;
}

export function isGpsDeepSleeping(): boolean {
  return sleeping;
}
