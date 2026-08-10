/**
 * Optional step counting for user-requested stats.
 * Separate from GPS pedometer-sleep (battery wake only).
 */

import { Pedometer } from 'expo-sensors';
import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-step-stats.json`;

type DayBucket = { date: string; steps: number };
type Store = {
  enabled: boolean;
  days: DayBucket[];
  sessionStartMs: number | null;
  sessionSteps: number;
};

let memory: Store = {
  enabled: false,
  days: [],
  sessionStartMs: null,
  sessionSteps: 0,
};
let sub: { remove: () => void } | null = null;
let hydrated = false;

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const data = JSON.parse(raw) as Partial<Store>;
    memory = {
      enabled: Boolean(data.enabled),
      days: Array.isArray(data.days) ? data.days.slice(-14) : [],
      sessionStartMs: null,
      sessionSteps: 0,
    };
    if (memory.enabled) await startWatching();
  } catch {
    /* ignore */
  }
}

function persist(): void {
  void FileSystem.writeAsStringAsync(PATH, JSON.stringify(memory)).catch(
    () => {},
  );
}

function bumpToday(n: number): void {
  if (n <= 0) return;
  const d = todayYmd();
  const row = memory.days.find((x) => x.date === d);
  if (row) row.steps += n;
  else memory.days.push({ date: d, steps: n });
  memory.days = memory.days.slice(-14);
  memory.sessionSteps += n;
  persist();
}

async function startWatching(): Promise<void> {
  try {
    const ok = await Pedometer.isAvailableAsync();
    if (!ok) return;
    sub?.remove();
    memory.sessionStartMs = Date.now();
    memory.sessionSteps = 0;
    sub = Pedometer.watchStepCount((r) => {
      bumpToday(r.steps ?? 0);
    });
  } catch {
    /* optional */
  }
}

function stopWatching(): void {
  sub?.remove();
  sub = null;
}

export async function enableStepStats(): Promise<boolean> {
  await hydrate();
  memory.enabled = true;
  persist();
  await startWatching();
  return true;
}

export async function disableStepStats(): Promise<void> {
  await hydrate();
  memory.enabled = false;
  stopWatching();
  persist();
}

export function isStepStatsEnabled(): boolean {
  return memory.enabled;
}

export async function getTodayStepCount(): Promise<number> {
  await hydrate();
  const d = todayYmd();
  const fromWatch = memory.days.find((x) => x.date === d)?.steps ?? 0;

  // Prefer system day total when available (more accurate than session deltas)
  try {
    const ok = await Pedometer.isAvailableAsync();
    if (ok && typeof Pedometer.getStepCountAsync === 'function') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      const result = await Pedometer.getStepCountAsync(start, end);
      if (result?.steps != null && Number.isFinite(result.steps)) {
        return Math.max(result.steps, fromWatch);
      }
    }
  } catch {
    /* fall through */
  }
  return fromWatch;
}

export function isStepStatsQuery(text: string): boolean {
  return /\b(schritte?|schrittzähler|schrittzaehler|wie\s+viele\s+schritte|schrittestatistik|fußweg.?statistik|fitness.?schritte)\b/iu.test(
    text.replace(/\s+/g, ' ').trim(),
  );
}

export function wantsEnableStepStats(text: string): boolean {
  return /\b(zähl|zaehl|track|aktivier|anmachen|einschalten|starten).{0,20}\bschritte?\b|\bschritte?\s+(zählen|zaehlen|tracken)\b/iu.test(
    text,
  );
}

export function wantsDisableStepStats(text: string): boolean {
  return /\b(stopp|aus|deaktiv|nicht\s+mehr).{0,20}\bschritte?\b/iu.test(text);
}

export async function prepareStepStatsFollowUp(
  text: string,
): Promise<{ reply: string } | null> {
  if (!isStepStatsQuery(text) && !wantsEnableStepStats(text) && !wantsDisableStepStats(text)) {
    return null;
  }
  await hydrate();

  if (wantsDisableStepStats(text)) {
    await disableStepStats();
    return { reply: 'Alles klar — Schrittzählung ist aus.' };
  }

  if (wantsEnableStepStats(text) || (!memory.enabled && isStepStatsQuery(text))) {
    const ok = await enableStepStats();
    if (!ok) {
      return {
        reply:
          'Auf dem Gerät ist gerade kein Schrittzähler verfügbar. Wenn du magst, schau in den System-Einstellungen nach Bewegungs- und Fitness-Zugriff.',
      };
    }
  }

  if (!memory.enabled) {
    return {
      reply:
        'Ich kann deine Schritte zählen, wenn du willst — sag einfach „zähl meine Schritte“. Dann bekommst du auf Nachfrage die Statistik.',
    };
  }

  const steps = await getTodayStepCount();
  const km = (steps * 0.00075).toFixed(1); // ~0.75 m/step rough
  return {
    reply: `Heute hast du etwa ${steps.toLocaleString('de-DE')} Schritte — grob ${km} km. Sag Bescheid, wenn ich das Zählen wieder ausschalten soll.`,
  };
}
