/**
 * Nach erster App-Erklärung + City-Welcome: 30 Min keine proaktiven Pitches.
 * User-Fragen / Mic bleiben erlaubt.
 */

import * as FileSystem from 'expo-file-system';

const QUIET_MS = 30 * 60_000;
const FLAG_PATH = `${FileSystem.documentDirectory}findus-first-open-quiet.json`;

type QuietState = { untilMs: number };

let quietUntilMs = 0;
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(FLAG_PATH);
    if (!info.exists) return;
    const raw = JSON.parse(
      await FileSystem.readAsStringAsync(FLAG_PATH),
    ) as QuietState;
    const until = Number(raw.untilMs);
    if (Number.isFinite(until) && until > Date.now()) {
      quietUntilMs = until;
    }
  } catch {
    /* soft */
  }
}

async function persist(untilMs: number): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      FLAG_PATH,
      JSON.stringify({ untilMs, at: new Date().toISOString() }),
    );
  } catch {
    /* soft */
  }
}

/** Startet die 30-Min-Ruhe nach der First-Open-Kette. */
export async function startFirstOpenQuietPeriod(
  fromMs = Date.now(),
): Promise<number> {
  quietUntilMs = fromMs + QUIET_MS;
  hydrated = true;
  await persist(quietUntilMs);
  return quietUntilMs;
}

export function getFirstOpenQuietUntilMs(): number {
  return quietUntilMs;
}

/** Sync-Check (nach hydrate / start). Für enge Hot-Paths. */
export function isFirstOpenQuietActive(now = Date.now()): boolean {
  return quietUntilMs > 0 && now < quietUntilMs;
}

/** Async-sicherer Check inkl. Persistenz-Hydration. */
export async function isFirstOpenQuietActiveAsync(
  now = Date.now(),
): Promise<boolean> {
  await hydrate();
  return isFirstOpenQuietActive(now);
}

/** Bootstrap beim App-Start (optional). */
export async function bootstrapFirstOpenQuietPeriod(): Promise<void> {
  await hydrate();
}

/** Tests / Reset. */
export async function clearFirstOpenQuietPeriod(): Promise<void> {
  quietUntilMs = 0;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(FLAG_PATH);
    if (info.exists) await FileSystem.deleteAsync(FLAG_PATH, { idempotent: true });
  } catch {
    /* soft */
  }
}
