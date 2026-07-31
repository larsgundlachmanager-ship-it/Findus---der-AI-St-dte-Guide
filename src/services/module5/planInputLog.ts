/**
 * Persistentes Log aller Planungs-Eingaben (Sprachnachrichten etc.) — nachschlagbar.
 */

import * as FileSystem from 'expo-file-system';
import { todayDateKey } from '../../types/dayPlan';

const PATH = `${FileSystem.documentDirectory}findus-plan-input-log.json`;
const MAX_ENTRIES = 200;

export type PlanInputLogEntry = {
  id: string;
  atMs: number;
  dateKey: string;
  source: 'voice' | 'text' | 'module2' | 'other';
  transcript: string;
  summary?: string;
  extractSummary?: string;
  itemLabels?: string[];
};

type Disk = { entries: PlanInputLogEntry[] };

let cache: PlanInputLogEntry[] | null = null;

async function load(): Promise<PlanInputLogEntry[]> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = JSON.parse(await FileSystem.readAsStringAsync(PATH)) as Disk;
      cache = Array.isArray(raw.entries) ? raw.entries : [];
      return cache;
    }
  } catch {
    /* soft */
  }
  cache = [];
  return cache;
}

async function persist(entries: PlanInputLogEntry[]): Promise<void> {
  cache = entries.slice(0, MAX_ENTRIES);
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ entries: cache, savedAt: Date.now() }),
    );
  } catch {
    /* soft */
  }
}

export async function appendPlanInput(
  entry: Omit<PlanInputLogEntry, 'id' | 'atMs'> & { atMs?: number },
): Promise<PlanInputLogEntry> {
  const list = await load();
  const full: PlanInputLogEntry = {
    id: `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    atMs: entry.atMs ?? Date.now(),
    dateKey: entry.dateKey || todayDateKey(),
    source: entry.source,
    transcript: entry.transcript.trim().slice(0, 4000),
    summary: entry.summary?.slice(0, 400),
    extractSummary: entry.extractSummary?.slice(0, 400),
    itemLabels: entry.itemLabels?.slice(0, 40),
  };
  await persist([full, ...list]);
  return full;
}

export async function getPlanInputLog(opts?: {
  dateKey?: string;
  limit?: number;
}): Promise<PlanInputLogEntry[]> {
  const list = await load();
  const filtered = opts?.dateKey
    ? list.filter((e) => e.dateKey === opts.dateKey)
    : list;
  return filtered.slice(0, opts?.limit ?? 50);
}

/** Für LLM-Prompt / Nachschauen. */
export async function formatPlanInputLogForPrompt(
  dateKey?: string,
): Promise<string> {
  const entries = await getPlanInputLog({ dateKey, limit: 12 });
  if (!entries.length) return '';
  return [
    '=== FRÜHERE PLANUNGS-EINGABEN (User) ===',
    ...entries.map((e) => {
      const t = new Date(e.atMs).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `- ${t}: ${e.transcript.slice(0, 220)}${
        e.summary ? ` → ${e.summary}` : ''
      }`;
    }),
  ].join('\n');
}
