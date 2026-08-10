/**
 * Letzte Nav-Suchanfragen / Ziele (Quick-Add + Verlauf).
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-nav-search-history.json`;
const MAX = 8;

const DEFAULT_QUICK = [
  { label: 'Hotel', prompt: 'Bring mich zu meinem Hotel' },
  { label: 'Lieblingscafé', prompt: 'Navigiere zum nächsten guten Café' },
] as const;

let history: string[] = [];
let loaded = false;

async function persist(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify({ history }));
  } catch {
    /* ignore */
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as { history?: string[] };
    if (Array.isArray(parsed.history)) {
      history = parsed.history
        .filter((q) => typeof q === 'string' && q.trim().length >= 2)
        .slice(0, MAX);
    }
  } catch {
    history = [];
  }
}

export async function loadNavSearchHistory(): Promise<string[]> {
  await ensureLoaded();
  return [...history];
}

export async function recordNavSearch(query: string): Promise<void> {
  const q = query.trim();
  if (q.length < 2) return;
  await ensureLoaded();
  history = [q, ...history.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(
    0,
    MAX,
  );
  await persist();
}

export function getNavSearchHistory(): string[] {
  return [...history];
}

export function getTopQuickAddTargets(): Array<{ label: string; prompt: string }> {
  if (history.length === 0) {
    return DEFAULT_QUICK.map((x) => ({ label: x.label, prompt: x.prompt }));
  }

  const freq = new Map<string, number>();
  for (const q of history) {
    const key = q.trim();
    if (!key) continue;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([q]) => q);

  const top = ranked.slice(0, 2);
  while (top.length < 2) {
    const fallback = DEFAULT_QUICK[top.length];
    if (!top.includes(fallback.prompt)) top.push(fallback.prompt);
    else break;
  }

  return top.map((prompt) => ({
    label: prompt.length > 20 ? `${prompt.slice(0, 19)}…` : prompt,
    prompt,
  }));
}
