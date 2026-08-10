/**
 * Daily cap for Flash→Pro escalations — closes the Pro cost trap.
 * In-memory + FileSystem; fail-open if storage unavailable.
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-pro-escalate-budget.json`;
/** Soft daily ceiling for auto Pro assists (field-test safe). */
export const PRO_ESCALATE_DAILY_CAP = 8;

type DayBucket = { day: string; count: number };

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

let memory: DayBucket = { day: utcDay(), count: 0 };
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as DayBucket;
    if (parsed?.day === utcDay() && typeof parsed.count === 'number') {
      memory = { day: parsed.day, count: Math.max(0, parsed.count | 0) };
    }
  } catch {
    /* ignore */
  }
}

async function persist(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(memory));
  } catch {
    /* ignore */
  }
}

function rollDay(): void {
  const d = utcDay();
  if (memory.day !== d) memory = { day: d, count: 0 };
}

/** True if another Pro auto-escalation is allowed today. */
export async function canAutoEscalateToPro(): Promise<boolean> {
  await hydrate();
  rollDay();
  return memory.count < PRO_ESCALATE_DAILY_CAP;
}

/** Record one Pro auto-escalation (call only when actually requesting Pro). */
export async function recordProEscalation(): Promise<void> {
  await hydrate();
  rollDay();
  memory.count += 1;
  void persist();
}

export function getProEscalateCountSync(): number {
  rollDay();
  return memory.count;
}
