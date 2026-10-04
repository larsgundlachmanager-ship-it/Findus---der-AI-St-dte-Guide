from pathlib import Path

content = r'''/**
 * Survival Mode: battery ≤ 20 % → still GPS economy (Akku schonen).
 * Beim Laden oder >20 %: vorheriges GPS-Profil zurück (wie pedometerSleep).
 * Keine ungefragten Lade-Vorschläge / Speech / Cards —
 * Powerbank/Steckdose nur wenn der User danach fragt.
 */

import * as Battery from 'expo-battery';
import { AppState, type NativeEventSubscription } from 'react-native';
import {
  getGpsStreamProfile,
  setGpsStreamProfile,
  type GpsStreamProfile,
} from '../locationService';

const SURVIVAL_PCT = 20;

let lastEconomyAtMs = 0;
let lastRestoreAtMs = 0;
let started = false;
let survivalActive = false;
let profileBeforeSurvival: GpsStreamProfile | null = null;
let batterySub: { remove: () => void } | null = null;
let batteryStateSub: { remove: () => void } | null = null;
let appSub: NativeEventSubscription | null = null;

function navOwnsGps(): boolean {
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navActive?: boolean } };
    };
    return Boolean(useFinnusStore.getState().navActive);
  } catch {
    return false;
  }
}

async function maybeRestoreFromSurvival(reason: string): Promise<void> {
  if (!survivalActive) return;
  const now = Date.now();
  if (now - lastRestoreAtMs < 3_000) return;
  lastRestoreAtMs = now;
  survivalActive = false;
  lastEconomyAtMs = 0;

  const restore = profileBeforeSurvival;
  profileBeforeSurvival = null;

  // Nav / Deep-Sleep besitzen den Watcher — nicht überschreiben.
  if (navOwnsGps()) {
    if (__DEV__) console.log(`[battery] survival exit (${reason}) — nav owns GPS`);
    return;
  }
  const current = getGpsStreamProfile();
  if (
    current === 'sleep' ||
    current === 'realtime' ||
    current === 'realtime-bike'
  ) {
    if (__DEV__) {
      console.log(`[battery] survival exit (${reason}) — leave ${current}`);
    }
    return;
  }

  const target = restore && restore !== 'economy' ? restore : null;
  if (target && target !== current) {
    try {
      await setGpsStreamProfile(target);
      if (__DEV__) {
        console.log(`[battery] survival exit (${reason}) → ${target}`);
      }
    } catch {
      /* ignore */
    }
  } else if (__DEV__) {
    console.log(`[battery] survival exit (${reason}) — stay ${current}`);
  }
}

async function enterSurvivalEconomy(): Promise<void> {
  if (navOwnsGps()) {
    // Nav braucht Genauigkeit — Survival erst nach Nav.
    return;
  }
  const current = getGpsStreamProfile();
  if (current === 'sleep') return;

  const now = Date.now();
  if (survivalActive) {
    // Profil nur alle 10 Min erneut auf economy ziehen (falls woanders hochgedreht).
    if (now - lastEconomyAtMs < 10 * 60_000) return;
    lastEconomyAtMs = now;
    if (current !== 'economy') {
      try {
        void setGpsStreamProfile('economy');
      } catch {
        /* ignore */
      }
    }
    return;
  }

  survivalActive = true;
  lastEconomyAtMs = now;
  if (current !== 'economy') {
    profileBeforeSurvival = current;
  }
  try {
    void setGpsStreamProfile('economy');
    if (__DEV__) {
      console.log(
        `[battery] survival GPS economy (≤${SURVIVAL_PCT}%) was=${current}`,
      );
    }
  } catch {
    /* ignore */
  }
}

async function maybeApplySurvivalEconomy(
  level: number | null,
  opts?: { charging?: boolean },
): Promise<void> {
  if (level == null || !Number.isFinite(level)) return;
  const pct = Math.round(level * 100);
  const charging = opts?.charging === true;

  // Laden oder Akku wieder drüber → Economy zurücknehmen.
  if (charging || pct > SURVIVAL_PCT) {
    await maybeRestoreFromSurvival(
      charging ? `charging@${pct}%` : `recovered@${pct}%`,
    );
    return;
  }

  await enterSurvivalEconomy();
}

async function readCharging(): Promise<boolean> {
  try {
    const state = await Battery.getBatteryStateAsync();
    return (
      state === Battery.BatteryState.CHARGING ||
      state === Battery.BatteryState.FULL
    );
  } catch {
    return false;
  }
}

async function pollOnce(): Promise<void> {
  try {
    const [level, charging] = await Promise.all([
      Battery.getBatteryLevelAsync(),
      readCharging(),
    ]);
    await maybeApplySurvivalEconomy(level, { charging });
  } catch {
    /* battery API unavailable */
  }
}

/** Start battery watcher. Returns unsubscribe. */
export function startSurvivalModeMonitor(): () => void {
  if (started) {
    return () => undefined;
  }
  started = true;

  void pollOnce();

  try {
    batterySub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      void (async () => {
        const charging = await readCharging();
        await maybeApplySurvivalEconomy(batteryLevel, { charging });
      })();
    });
  } catch {
    batterySub = null;
  }

  try {
    batteryStateSub = Battery.addBatteryStateListener(({ batteryState }) => {
      const charging =
        batteryState === Battery.BatteryState.CHARGING ||
        batteryState === Battery.BatteryState.FULL;
      void (async () => {
        try {
          const level = await Battery.getBatteryLevelAsync();
          await maybeApplySurvivalEconomy(level, { charging });
        } catch {
          if (charging) await maybeRestoreFromSurvival('state-charging');
        }
      })();
    });
  } catch {
    batteryStateSub = null;
  }

  appSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void pollOnce();
  });

  const interval = setInterval(() => {
    void pollOnce();
  }, 3 * 60_000);

  return () => {
    started = false;
    clearInterval(interval);
    batterySub?.remove();
    batterySub = null;
    batteryStateSub?.remove();
    batteryStateSub = null;
    appSub?.remove();
    appSub = null;
  };
}

export function isSurvivalBatteryLevel(level01: number | null): boolean {
  if (level01 == null || !Number.isFinite(level01)) return false;
  return Math.round(level01 * 100) <= SURVIVAL_PCT;
}

/** true solange Survival Economy aktiv (noch nicht restored). */
export function isSurvivalGpsEconomyActive(): boolean {
  return survivalActive;
}

/** Test/Dev: Zustand zurücksetzen. */
export function __resetSurvivalModeForTests(): void {
  survivalActive = false;
  profileBeforeSurvival = null;
  lastEconomyAtMs = 0;
  lastRestoreAtMs = 0;
}
'''

p = Path(r"C:\Users\larsf\Findus 2.0\src\services\battery\survivalMode.ts")
tmp = p.with_suffix(".ts.new")
tmp.write_text(content, encoding="utf-8", newline="\n")
tmp.replace(p)
print("wrote", p.stat().st_size)
