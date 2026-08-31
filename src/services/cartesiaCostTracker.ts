/**
 * Persistenter Cartesia-Cost-Tracker (Zeichen / € pro Kalendertag).
 * Rate: CARTESIA_EUR_PER_1K_CHARS (Pro-Overage SSOT).
 */

import * as FileSystem from 'expo-file-system';
import { CARTESIA_EUR_PER_1K_CHARS } from '../constants/cartesiaVoices';

const STORAGE_PATH = `${FileSystem.documentDirectory}cartesia-cost-v1.json`;

type DayBucket = {
  /** YYYY-MM-DD (local) */
  day: string;
  chars: number;
};

let memory: DayBucket = { day: localDayKey(), chars: 0 };
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function localDayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureToday(): void {
  const today = localDayKey();
  if (memory.day !== today) {
    memory = { day: today, chars: 0 };
  }
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(STORAGE_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(STORAGE_PATH);
        const parsed = JSON.parse(raw) as DayBucket;
        if (
          parsed &&
          typeof parsed.day === 'string' &&
          typeof parsed.chars === 'number'
        ) {
          memory = { day: parsed.day, chars: Math.max(0, parsed.chars) };
        }
      }
    } catch {
      /* ignore */
    } finally {
      ensureToday();
      hydrated = true;
    }
  })();
  return hydratePromise;
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void FileSystem.writeAsStringAsync(
      STORAGE_PATH,
      JSON.stringify(memory),
    ).catch(() => undefined);
  }, 400);
}

/** Call once at app boot (optional — lazy hydrate also works). */
export function bootstrapCartesiaCostTracker(): void {
  void hydrate();
}

export function trackCartesiaChars(chars: number): void {
  const n = Math.max(0, Math.floor(chars));
  if (n <= 0) return;
  ensureToday();
  memory.chars += n;
  schedulePersist();
  void hydrate();
}

export type CartesiaCostSnapshot = {
  day: string;
  charsToday: number;
  costEurToday: number;
};

export function getCartesiaCostSnapshot(): CartesiaCostSnapshot {
  ensureToday();
  return {
    day: memory.day,
    charsToday: memory.chars,
    costEurToday: (memory.chars / 1000) * CARTESIA_EUR_PER_1K_CHARS,
  };
}

export async function getCartesiaCostSnapshotAsync(): Promise<CartesiaCostSnapshot> {
  await hydrate();
  return getCartesiaCostSnapshot();
}

export async function resetCartesiaCostToday(): Promise<void> {
  await hydrate();
  memory = { day: localDayKey(), chars: 0 };
  schedulePersist();
}
