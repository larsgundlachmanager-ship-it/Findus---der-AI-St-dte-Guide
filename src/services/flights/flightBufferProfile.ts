/**
 * Flughafen-Puffer-Profil — gelernt, nicht hart für alle.
 * Default konservativ (normal). Fast ≈ 10 Min am Gate, Fanatic ≈ 3 h am Airport.
 * Pure Logik ohne RN; Persistenz optional.
 */

export type FlightBufferStyle = 'fast' | 'normal' | 'fanatic';

export type FlightPacingMins = {
  boardingWindowMin: number;
  gateBufferMin: number;
  securityWaitMin: number;
  checkinMin: number;
  arriveToDeskMin: number;
};

const ORDER: FlightBufferStyle[] = ['fast', 'normal', 'fanatic'];

/** fast: 12:00 Abflug → ~11:00 am Terminal ohne Koffer. fanatic: ~3 h. */
export const FLIGHT_BUFFER_BY_STYLE: Record<FlightBufferStyle, FlightPacingMins> = {
  fast: {
    boardingWindowMin: 30,
    gateBufferMin: 10,
    securityWaitMin: 10,
    checkinMin: 20,
    arriveToDeskMin: 5,
  },
  normal: {
    boardingWindowMin: 40,
    gateBufferMin: 20,
    securityWaitMin: 20,
    checkinMin: 30,
    arriveToDeskMin: 5,
  },
  fanatic: {
    boardingWindowMin: 45,
    gateBufferMin: 60,
    securityWaitMin: 25,
    checkinMin: 40,
    arriveToDeskMin: 10,
  },
};

let style: FlightBufferStyle = 'normal';

export function getFlightBufferStyle(): FlightBufferStyle {
  return style;
}

export function setFlightBufferStyle(next: FlightBufferStyle): void {
  style = next;
  persistSoft();
}

export function resetFlightBufferStyleForTests(): void {
  style = 'normal';
}

export function stepFlightBufferStyle(
  dir: 'less' | 'more' | 'keep',
): FlightBufferStyle {
  if (dir === 'keep') {
    persistSoft();
    return style;
  }
  const i = ORDER.indexOf(style);
  const next =
    dir === 'less'
      ? ORDER[Math.max(0, i - 1)]!
      : ORDER[Math.min(ORDER.length - 1, i + 1)]!;
  style = next;
  persistSoft();
  return style;
}

export function pacingMinsForStyle(
  chosen: FlightBufferStyle = style,
  liveSecurityWaitMin?: number | null,
): FlightPacingMins {
  const base = FLIGHT_BUFFER_BY_STYLE[chosen];
  const security =
    liveSecurityWaitMin != null && liveSecurityWaitMin > 0
      ? Math.max(chosen === 'fast' ? 8 : 12, Math.min(40, Math.round(liveSecurityWaitMin)))
      : base.securityWaitMin;
  return { ...base, securityWaitMin: security };
}

/** Minuten vor Abflug am Terminal (ohne Anreise). */
export function airportLeadMin(
  mins: FlightPacingMins,
  luggage: 'carry' | 'checked' | 'unknown',
): number {
  const checkin = luggage === 'checked' ? mins.checkinMin : 0;
  return (
    mins.boardingWindowMin +
    mins.gateBufferMin +
    mins.securityWaitMin +
    checkin +
    mins.arriveToDeskMin
  );
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
      `${dir}findus-flight-buffer.json`,
      JSON.stringify({ style }),
    );
  } catch {
    /* node / tests */
  }
}

export async function hydrateFlightBufferStyle(): Promise<void> {
  try {
    const FS = require('expo-file-system') as {
      documentDirectory: string | null;
      getInfoAsync: (p: string) => Promise<{ exists: boolean }>;
      readAsStringAsync: (p: string) => Promise<string>;
    };
    const dir = FS.documentDirectory;
    if (!dir) return;
    const path = `${dir}findus-flight-buffer.json`;
    const info = await FS.getInfoAsync(path);
    if (!info.exists) return;
    const raw = JSON.parse(await FS.readAsStringAsync(path)) as {
      style?: string;
    };
    if (raw.style === 'fast' || raw.style === 'normal' || raw.style === 'fanatic') {
      style = raw.style;
    }
  } catch {
    /* soft */
  }
}
