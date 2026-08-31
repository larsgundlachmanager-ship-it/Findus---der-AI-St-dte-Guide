/**
 * Splash = Vorhang, nicht Warteschleife.
 * UI (Mic/Dock/Settings) zuerst — Karte füllt sich darunter.
 *
 * Frühestens ~1,2 s Branding. Nach Boot nicht auf Map-Ready warten.
 * Hartes Max 4 s.
 */

export const SPLASH_MIN_BRANDING_MS = 1_200;
export const SPLASH_TARGET_MS = 2_400;
export const SPLASH_MAX_MS = 4_000;

type SplashSignals = {
  startedAt: number;
  bootMinimal: boolean;
  mapInteractive: boolean;
  gpsLive: boolean;
  skipMap: boolean;
  lifted: boolean;
};

const signals: SplashSignals = {
  startedAt: 0,
  bootMinimal: false,
  mapInteractive: false,
  gpsLive: false,
  skipMap: false,
  lifted: false,
};

const waiters: Array<() => void> = [];

function flushWaiters(now = Date.now()): void {
  if (!canLiftSplash(now)) return;
  signals.lifted = true;
  while (waiters.length) waiters.pop()?.();
}

export function resetSplashReadyGate(now = Date.now()): void {
  signals.startedAt = now;
  signals.bootMinimal = false;
  signals.mapInteractive = false;
  signals.gpsLive = false;
  signals.skipMap = false;
  signals.lifted = false;
}

export function noteSplashStarted(now = Date.now()): void {
  if (!signals.startedAt) signals.startedAt = now;
}

export function noteSplashBootMinimal(): void {
  signals.bootMinimal = true;
  flushWaiters();
}

export function noteSplashMapInteractive(): void {
  signals.mapInteractive = true;
  flushWaiters();
}

export function noteSplashGpsLive(): void {
  signals.gpsLive = true;
  flushWaiters();
}

/** Onboarding / Fehler — keine Home-Karte unter dem Vorhang. */
export function noteSplashSkipMap(): void {
  signals.skipMap = true;
  flushWaiters();
}

export function isSplashCurtainUp(): boolean {
  return signals.lifted;
}

export function peekSplashSignals(): Readonly<SplashSignals> {
  return signals;
}

export function canLiftSplash(now = Date.now()): boolean {
  if (!signals.startedAt) return false;
  const elapsed = now - signals.startedAt;
  if (elapsed >= SPLASH_MAX_MS) return true;
  if (elapsed < SPLASH_MIN_BRANDING_MS) return false;
  if (!signals.bootMinimal) return false;
  // UI-first: Mic/Settings/Timeline dürfen nicht auf Map-Parse warten.
  return true;
}

export function waitForSplashReveal(): Promise<void> {
  noteSplashStarted();
  if (canLiftSplash()) {
    signals.lifted = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const tick = () => {
      if (canLiftSplash()) {
        signals.lifted = true;
        resolve();
        return;
      }
      const elapsed = Date.now() - (signals.startedAt || Date.now());
      const remain = Math.max(40, SPLASH_MAX_MS - elapsed);
      setTimeout(tick, Math.min(80, remain));
    };
    waiters.push(resolve);
    tick();
  });
}
