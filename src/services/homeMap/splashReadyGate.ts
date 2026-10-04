/**
 * Splash = Vorhang bis First-Look: Straßen-Kern + Fog-of-War + GPS.
 * Wetter/Forecast ist kein Splash-Blocker. Places/Icons optional (nachziehen).
 *
 * Soft-Ziel / Hard-Cap ~5 s Branding — Vorhang nie länger (Failsafe auch ohne Boot).
 * First-Look früher → sofort heben.
 *
 * Vector (Protomaps): Core = Style + Map fully rendered (Kacheln).
 * Legacy: Core = 5-km-Extract mit Straßen.
 */

/** Aufbau der Stadt / des Y. */
export const SPLASH_BUILD_MS = 2_400;
/**
 * Fertiges Endbild (Logo + Yorro + Tagline) — Animation, kein Lift-Blocker mehr.
 */
export const SPLASH_HOLD_AFTER_BUILD_MS = 2_600;
export const SPLASH_MIN_BRANDING_MS =
  SPLASH_BUILD_MS + SPLASH_HOLD_AFTER_BUILD_MS;
/** Soft-Ziel + Hard-Cap für Branding / UI-Copy. */
export const SPLASH_TARGET_MS = 5_000;
/** Alias — Splash hebt spätestens hier, auch ohne First-Look. */
export const SPLASH_MAX_MS = 5_000;
/**
 * Hartes Failsafe: ohne mapCoreReady trotzdem heben (Netz tot / Offline).
 * = Soft-Ziel (5 s) — Vorhang nie länger halten.
 */
export const SPLASH_HARD_FAILSAFE_MS = 5_000;

type SplashSignals = {
  startedAt: number;
  bootMinimal: boolean;
  mapInteractive: boolean;
  /** Straßen-Kern bereit (Vector: gerendert; Legacy: Near-Extract). */
  mapCoreReady: boolean;
  /** Fog/Reveal für ersten Blick bereit. */
  mapFogReady: boolean;
  /** Places für ersten Blick bereit (oder bewusst leer). */
  mapPlacesReady: boolean;
  gpsLive: boolean;
  skipMap: boolean;
  lifted: boolean;
};

const signals: SplashSignals = {
  startedAt: 0,
  bootMinimal: false,
  mapInteractive: false,
  mapCoreReady: false,
  mapFogReady: false,
  mapPlacesReady: false,
  gpsLive: false,
  skipMap: false,
  lifted: false,
};

const waiters: Array<() => void> = [];

/** Basiskarte + Fog-of-War + GPS — First-Look (kein Wetter, Places optional). */
export function firstLookReady(): boolean {
  return (
    signals.mapCoreReady && signals.mapFogReady && signals.gpsLive
  );
}

function flushWaiters(now = Date.now()): void {
  if (!canLiftSplash(now)) return;
  signals.lifted = true;
  while (waiters.length) waiters.pop()?.();
}

export function resetSplashReadyGate(now = Date.now()): void {
  signals.startedAt = now;
  signals.bootMinimal = false;
  signals.mapInteractive = false;
  signals.mapCoreReady = false;
  signals.mapFogReady = false;
  signals.mapPlacesReady = false;
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

/** Straßen-Kern sichtbar (Vector fully rendered / Legacy Near-Extract). */
export function noteSplashMapCoreReady(): void {
  signals.mapCoreReady = true;
  flushWaiters();
}

/** Fog/Reveal für den ersten Blick gezeichnet (oder bewusst leer). */
export function noteSplashMapFogReady(): void {
  signals.mapFogReady = true;
  flushWaiters();
}

/** Places für den ersten Blick gesetzt (auch 0 Treffer = ready). */
export function noteSplashMapPlacesReady(): void {
  signals.mapPlacesReady = true;
  flushWaiters();
}

/**
 * Komplette Splash-Vision: Kern + Fog + Places + GPS.
 * Alias für Boot-Pfade, die alles auf einmal freigeben.
 */
export function noteSplashMapVisionReady(): void {
  signals.mapCoreReady = true;
  signals.mapFogReady = true;
  signals.mapPlacesReady = true;
  signals.gpsLive = true;
  flushWaiters();
}

/** GPS-Punkt nutzbar (Live-Fix oder Boot-Seed / Last-Known). */
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
  return { ...signals };
}

export function canLiftSplash(now = Date.now()): boolean {
  if (!signals.startedAt) return false;
  const elapsed = now - signals.startedAt;
  // Hard-Cap ZUERST — auch ohne bootMinimal (sonst hält langsamer Boot den Vorhang >5 s).
  if (elapsed >= SPLASH_HARD_FAILSAFE_MS) return true;
  if (!signals.bootMinimal) return false;
  if (signals.skipMap) {
    return elapsed >= SPLASH_MIN_BRANDING_MS;
  }
  // First-Look: Places optional — sofort heben sobald Straßen+Fog+GPS da.
  if (firstLookReady()) return true;
  return false;
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
      const elapsed = Date.now() - signals.startedAt;
      const remain = Math.max(40, SPLASH_HARD_FAILSAFE_MS - elapsed);
      setTimeout(tick, Math.min(120, remain));
    };
    waiters.push(resolve);
    tick();
  });
}
