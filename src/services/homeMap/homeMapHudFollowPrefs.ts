/**
 * Letzter Homescreen-HUD-Follow-Modus (GPS-Fix + Blickrichtung).
 * Nur über GPS-/Kompass-Tap — Navigation startet immer freies Überblick-Pan.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@yorro/home_map_hud_follow_v1';

export type HomeMapHudFollowPrefs = {
  /** GPS-Punkt bleibt Mitte, Karte folgt Bewegung. */
  locationFollow: boolean;
  /** Karte dreht mit Blickrichtung. */
  headingFollow: boolean;
};

const DEFAULT_PREFS: HomeMapHudFollowPrefs = {
  locationFollow: false,
  headingFollow: false,
};

let mem: HomeMapHudFollowPrefs = { ...DEFAULT_PREFS };
let hydrated = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

export function peekHomeMapHudFollowPrefs(): HomeMapHudFollowPrefs {
  return { ...mem };
}

export async function hydrateHomeMapHudFollowPrefs(): Promise<HomeMapHudFollowPrefs> {
  if (hydrated) return peekHomeMapHudFollowPrefs();
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<HomeMapHudFollowPrefs>;
      mem = {
        locationFollow: parsed.locationFollow === true,
        headingFollow: parsed.headingFollow === true,
      };
    }
  } catch {
    /* soft */
  }
  hydrated = true;
  return peekHomeMapHudFollowPrefs();
}

export function noteHomeMapHudFollowPrefs(
  patch: Partial<HomeMapHudFollowPrefs>,
): void {
  mem = {
    locationFollow:
      patch.locationFollow !== undefined
        ? !!patch.locationFollow
        : mem.locationFollow,
    headingFollow:
      patch.headingFollow !== undefined
        ? !!patch.headingFollow
        : mem.headingFollow,
  };
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void AsyncStorage.setItem(KEY, JSON.stringify(mem)).catch(() => undefined);
  }, 120);
}
