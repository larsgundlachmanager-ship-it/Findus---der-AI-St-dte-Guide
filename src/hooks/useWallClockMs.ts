/**
 * Wanduhr ohne Sekunden-Polling:
 * - Sofort Date.now() (echte Systemzeit)
 * - Nächstes Update exakt zur nächsten vollen Minute
 * - Danach 1×/Minute + Sync bei App-Foreground
 *
 * Kein setInterval(1000/5000) — die Anzeige hängt an der Systemuhr.
 */

import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

function msUntilNextMinute(now = Date.now()): number {
  return Math.max(50, 60_000 - (now % 60_000));
}

/**
 * @param enabled false = kein Timer (z. B. Modal zu)
 * @returns Wanduhr-ms als Re-Render-Trigger; Werte kommen immer aus Date.now()
 */
export function useWallClockMs(enabled = true): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let minuteTimer: ReturnType<typeof setTimeout> | null = null;
    let minuteInterval: ReturnType<typeof setInterval> | null = null;

    const sync = () => {
      if (!cancelled) setNowMs(Date.now());
    };

    const armMinuteClock = () => {
      if (minuteTimer) clearTimeout(minuteTimer);
      if (minuteInterval) clearInterval(minuteInterval);
      minuteInterval = null;
      // Auf volle Minute der Systemuhr ausrichten — nicht „alle 60s ab jetzt“
      minuteTimer = setTimeout(() => {
        sync();
        minuteInterval = setInterval(sync, 60_000);
      }, msUntilNextMinute());
    };

    // Sofort echte Uhr beim Öffnen / App-Start
    sync();
    armMinuteClock();

    const onAppState = (state: AppStateStatus) => {
      if (state !== 'active') return;
      sync();
      armMinuteClock();
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      cancelled = true;
      if (minuteTimer) clearTimeout(minuteTimer);
      if (minuteInterval) clearInterval(minuteInterval);
      sub.remove();
    };
  }, [enabled]);

  return nowMs;
}
