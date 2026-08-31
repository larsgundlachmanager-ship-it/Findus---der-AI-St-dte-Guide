/**
 * Flug-/Reise-Trip Session — TTL fürs Sammeln, Commit-Snapshot für Chips nach Restart.
 */

import {
  sessionIsFresh,
  type TripSlotState,
} from '../travel/tripSlotMerge';

const FILE = 'findus-flight-trip-session.json';

export type FlightCommitSnapshot = {
  ident: string;
  userText: string;
  destCity: string;
  destIata: string;
  originIata: string;
  originName: string;
  originLat: number;
  originLng: number;
  dateKey: string;
  clockHm: string | null;
  luggage: 'carry' | 'checked' | 'unknown';
  leaveByAsk: boolean;
};

let state: TripSlotState | null = null;
let lastCommit: FlightCommitSnapshot | null = null;
let sessionHydrated = false;

export function setFlightTripSessionActive(on: boolean): void {
  if (!on) state = null;
  persistSoft();
}

export function hasFlightTripSession(nowMs = Date.now()): boolean {
  if (!state) return false;
  if (!sessionIsFresh(state, nowMs)) {
    state = null;
    persistSoft();
    return false;
  }
  return Boolean(
    state.destIata ||
      state.destCity ||
      state.clockHm ||
      state.selectedIdent ||
      state.dateLocked,
  );
}

export function getFlightTripSession(nowMs = Date.now()): TripSlotState | null {
  if (!hasFlightTripSession(nowMs)) return null;
  return state;
}

export function setFlightTripSession(next: TripSlotState | null): void {
  state = next;
  persistSoft();
}

export function resetFlightTripSession(): void {
  state = null;
  lastCommit = null;
  persistSoft();
}

/** Topic-Cut: toter Flug raus, HUD „Wann fliegst du?“ nicht stehen lassen. */
export function scrubDeadFlightThread(): void {
  resetFlightTripSession();
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          activeConciergeCard?: { cardTitle?: string | null } | null;
          setActiveConciergeCard: (c: null) => void;
        };
      };
    };
    const title = useFinnusStore.getState().activeConciergeCard?.cardTitle || '';
    if (
      title === 'Wann fliegst du?' ||
      title === 'Welche Uhrzeit?' ||
      title === 'Aufgabegepäck?' ||
      title === 'Günstige Flieger'
    ) {
      useFinnusStore.getState().setActiveConciergeCard(null);
    }
  } catch {
    /* soft — Node-Smoke ohne Store */
  }
}

export function getLastFlightCommit(): FlightCommitSnapshot | null {
  return lastCommit;
}

export function setLastFlightCommit(next: FlightCommitSnapshot | null): void {
  lastCommit = next;
  persistSoft();
}

function persistSoft(): void {
  try {
    const FS = require('expo-file-system') as {
      documentDirectory: string | null;
      writeAsStringAsync: (p: string, s: string) => Promise<void>;
    };
    const dir = FS.documentDirectory;
    if (!dir) return;
    void FS.writeAsStringAsync(
      `${dir}${FILE}`,
      JSON.stringify({ gathering: state, lastCommit }),
    );
  } catch {
    /* node / tests */
  }
}

export async function hydrateFlightTripSession(): Promise<void> {
  if (sessionHydrated) return;
  sessionHydrated = true;
  try {
    const FS = require('expo-file-system') as {
      documentDirectory: string | null;
      getInfoAsync: (p: string) => Promise<{ exists: boolean }>;
      readAsStringAsync: (p: string) => Promise<string>;
    };
    const dir = FS.documentDirectory;
    if (!dir) return;
    const path = `${dir}${FILE}`;
    const info = await FS.getInfoAsync(path);
    if (!info.exists) return;
    const raw = JSON.parse(await FS.readAsStringAsync(path)) as {
      gathering?: TripSlotState | null;
      lastCommit?: FlightCommitSnapshot | null;
    };
    if (raw.gathering && typeof raw.gathering === 'object') {
      state = raw.gathering;
    }
    if (raw.lastCommit && typeof raw.lastCommit.ident === 'string') {
      lastCommit = raw.lastCommit;
    }
  } catch {
    /* soft */
  }
}

export function resetFlightTripSessionForTests(): void {
  state = null;
  lastCommit = null;
  sessionHydrated = true;
}
