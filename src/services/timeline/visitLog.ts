/**
 * Persistentes Visit-Log (Plan vs. Ist / Städte-Zeitachse).
 * Quellen: Nav-Hooks, Dwell, Passport-Stempel.
 */

import * as FileSystem from 'expo-file-system';
import { dateKeyFromMs, todayDateKey, uid } from '../../utils/dateKeys';

export type VisitLogSource = 'nav' | 'dwell' | 'stamp' | 'plan' | 'manual';

export type VisitLogEntry = {
  id: string;
  /** YYYY-MM-DD lokal */
  dateKey: string;
  name: string;
  lat: number | null;
  lng: number | null;
  poiId: number | null;
  arrivedAtMs: number;
  leftAtMs: number | null;
  dwellMin: number | null;
  source: VisitLogSource;
  cityId?: string | null;
  /** Geplante Ankunft (falls bekannt) */
  plannedArriveMs?: number | null;
  /** Verzug ms = arrived − planned */
  delayMs?: number | null;
  /** Zeitachse freigeben (Modul-1 / ≥2 Min) */
  onTimeline?: boolean;
};

const PATH = `${FileSystem.documentDirectory}findus-visit-log-v1.json`;
/**
 * Zeitachse / Visit-Log: langfristig behalten.
 * ≥ 3 Jahre (über 2 Jahre), hoher Cap — nicht aggressiv löschen.
 */
export const VISIT_LOG_RETENTION_DAYS = 1_100; // ~3 Jahre
export const VISIT_LOG_MAX_ENTRIES = 50_000;

let entries: VisitLogEntry[] = [];
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function prune(list: VisitLogEntry[]): VisitLogEntry[] {
  const cutoff = Date.now() - VISIT_LOG_RETENTION_DAYS * 24 * 60 * 60_000;
  // Nur echte Ausreißer jenseits Retention + Cap — sonst nie kürzen
  return list
    .filter((e) => e.arrivedAtMs >= cutoff)
    .sort((a, b) => a.arrivedAtMs - b.arrivedAtMs)
    .slice(-VISIT_LOG_MAX_ENTRIES);
}

function persistSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ entries: prune(entries), savedAt: Date.now() }),
    )
      .then(() => notifyCloudSoon())
      .catch(() => undefined);
  }, 1_200);
}

function notifyCloudSoon(): void {
  void import('../account/userCloudSync')
    .then((m) => m.scheduleUserCloudPush())
    .catch(() => undefined);
}

export function snapshotVisitLogForCloud(): VisitLogEntry[] {
  return entries.slice(-8_000);
}

export async function applyVisitLogFromCloud(
  remote: VisitLogEntry[],
): Promise<void> {
  await hydrateVisitLog();
  if (!Array.isArray(remote) || remote.length === 0) return;
  const map = new Map<string, VisitLogEntry>();
  for (const e of remote) {
    if (e?.id) map.set(e.id, e);
  }
  for (const e of entries) {
    const cur = map.get(e.id);
    if (!cur) {
      map.set(e.id, e);
      continue;
    }
    const score = (x: VisitLogEntry) => (x.leftAtMs ?? 0) + x.arrivedAtMs;
    map.set(e.id, score(e) >= score(cur) ? e : cur);
  }
  entries = prune([...map.values()]);
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({ entries, savedAt: Date.now() }),
    );
  } catch {
    /* soft */
  }
}

export async function hydrateVisitLog(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(PATH);
        const parsed = JSON.parse(raw) as { entries?: VisitLogEntry[] };
        if (Array.isArray(parsed.entries)) {
          entries = prune(parsed.entries);
        }
      }
    } catch {
      entries = [];
    } finally {
      hydrated = true;
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

export function getVisitLogSnapshot(): VisitLogEntry[] {
  void hydrateVisitLog();
  return entries;
}

export function getVisitsForDate(dateKey: string): VisitLogEntry[] {
  void hydrateVisitLog();
  return entries.filter((e) => e.dateKey === dateKey);
}

/** Entfernt Visits by id (Timeline-Aufräumen). */
export function removeVisitIds(ids: string[]): void {
  void hydrateVisitLog();
  if (!ids.length) return;
  const set = new Set(ids);
  const next = entries.filter((e) => !set.has(e.id));
  if (next.length === entries.length) return;
  entries = prune(next);
  persistSoon();
}

export function listVisitDateKeys(): string[] {
  void hydrateVisitLog();
  const keys = new Set(entries.map((e) => e.dateKey));
  return [...keys].sort();
}

export function listVisitMonthKeys(): string[] {
  return [
    ...new Set(listVisitDateKeys().map((k) => k.slice(0, 7))),
  ].sort();
}

function findOpenVisit(name: string, poiId?: number | null): VisitLogEntry | null {
  const open = [...entries]
    .reverse()
    .find(
      (e) =>
        e.leftAtMs == null &&
        (poiId != null
          ? e.poiId === poiId
          : e.name.toLowerCase() === name.toLowerCase()),
    );
  return open ?? null;
}

export function recordVisitArrival(opts: {
  name: string;
  lat?: number | null;
  lng?: number | null;
  poiId?: number | null;
  atMs?: number;
  source: VisitLogSource;
  cityId?: string | null;
  plannedArriveMs?: number | null;
}): VisitLogEntry {
  void hydrateVisitLog();
  const at = opts.atMs ?? Date.now();
  const existing = findOpenVisit(opts.name, opts.poiId);
  if (existing) {
    return existing;
  }
  const delayMs =
    opts.plannedArriveMs != null ? at - opts.plannedArriveMs : null;
  const entry: VisitLogEntry = {
    id: uid('vis'),
    dateKey: dateKeyFromMs(at),
    name: opts.name.trim(),
    lat: opts.lat ?? null,
    lng: opts.lng ?? null,
    poiId: opts.poiId ?? null,
    arrivedAtMs: at,
    leftAtMs: null,
    dwellMin: null,
    source: opts.source,
    cityId: opts.cityId,
    plannedArriveMs: opts.plannedArriveMs ?? null,
    delayMs,
    // Nav-Ankunft allein → noch nicht Zeitachse (≥2 Min oder Modul 1)
    onTimeline: false,
  };
  entries = prune([...entries, entry]);
  persistSoon();
  return entry;
}

export function recordVisitDeparture(opts: {
  name: string;
  poiId?: number | null;
  atMs?: number;
}): VisitLogEntry | null {
  void hydrateVisitLog();
  const at = opts.atMs ?? Date.now();
  const open = findOpenVisit(opts.name, opts.poiId);
  if (!open) return null;
  const dwellMin = Math.max(0, Math.round((at - open.arrivedAtMs) / 60_000));
  const updated: VisitLogEntry = {
    ...open,
    leftAtMs: at,
    dwellMin,
    onTimeline: open.onTimeline === true || dwellMin >= 2,
  };
  entries = prune(entries.map((e) => (e.id === open.id ? updated : e)));
  persistSoon();
  return updated;
}

/** Stempel/Dwell: Ankunft + Verweildauer — Ende erst beim Verlassen (bis jetzt). */
export function upsertVisitFromStamp(opts: {
  name: string;
  lat?: number | null;
  lng?: number | null;
  poiId?: number | null;
  arrivedAtMs: number;
  dwellMin?: number | null;
  source?: VisitLogSource;
  onTimeline?: boolean;
}): VisitLogEntry {
  void hydrateVisitLog();
  const name = opts.name.trim();

  const liveDwell = (arrivedAtMs: number, prev: number | null | undefined) =>
    Math.max(
      prev ?? 0,
      opts.dwellMin ?? 0,
      Math.round((Date.now() - arrivedAtMs) / 60_000),
    );

  // Dwell: nur mit dem letzten Eintrag des Tages mergen (Bar→Döner→Bar ok)
  if (opts.source === 'dwell') {
    const dayKey = dateKeyFromMs(opts.arrivedAtMs);
    const daySorted = entries
      .filter((e) => e.dateKey === dayKey)
      .sort((a, b) => a.arrivedAtMs - b.arrivedAtMs);
    const last = daySorted[daySorted.length - 1];
    const sameLast =
      last != null &&
      ((opts.poiId != null && last.poiId === opts.poiId) ||
        last.name.toLowerCase() === name.toLowerCase() ||
        (opts.lat != null &&
          opts.lng != null &&
          last.lat != null &&
          last.lng != null &&
          Math.abs(last.lat - opts.lat) < 0.0004 &&
          Math.abs(last.lng - opts.lng) < 0.0004));
    if (sameLast && last) {
      const updated = {
        ...last,
        dwellMin: liveDwell(last.arrivedAtMs, last.dwellMin),
        leftAtMs: null,
        lat: opts.lat ?? last.lat,
        lng: opts.lng ?? last.lng,
        onTimeline: opts.onTimeline ?? last.onTimeline ?? true,
      };
      entries = prune(entries.map((e) => (e.id === last.id ? updated : e)));
      persistSoon();
      return updated;
    }
  } else {
    const open = findOpenVisit(name, opts.poiId);
    if (open) {
      const updated = {
        ...open,
        dwellMin: liveDwell(open.arrivedAtMs, open.dwellMin),
        leftAtMs: null,
        lat: opts.lat ?? open.lat,
        lng: opts.lng ?? open.lng,
        onTimeline: opts.onTimeline ?? open.onTimeline ?? true,
      };
      entries = prune(entries.map((e) => (e.id === open.id ? updated : e)));
      persistSoon();
      return updated;
    }
    const dup = entries.find(
      (e) =>
        ((opts.poiId != null && e.poiId === opts.poiId) ||
          e.name.toLowerCase() === name.toLowerCase()) &&
        Math.abs(e.arrivedAtMs - opts.arrivedAtMs) < 30 * 60_000,
    );
    if (dup) {
      const stillHere = dup.leftAtMs == null;
      const updated = {
        ...dup,
        dwellMin: liveDwell(dup.arrivedAtMs, dup.dwellMin),
        leftAtMs: stillHere ? null : dup.leftAtMs,
        lat: opts.lat ?? dup.lat,
        lng: opts.lng ?? dup.lng,
        onTimeline: opts.onTimeline ?? dup.onTimeline ?? true,
      };
      entries = prune(entries.map((e) => (e.id === dup.id ? updated : e)));
      persistSoon();
      return updated;
    }
  }

  const entry: VisitLogEntry = {
    id: uid('vis'),
    dateKey: dateKeyFromMs(opts.arrivedAtMs),
    name,
    lat: opts.lat ?? null,
    lng: opts.lng ?? null,
    poiId: opts.poiId ?? null,
    arrivedAtMs: opts.arrivedAtMs,
    leftAtMs: null,
    dwellMin: opts.dwellMin ?? null,
    source: opts.source ?? 'stamp',
    onTimeline: opts.onTimeline ?? true,
  };
  entries = prune([...entries, entry]);
  persistSoon();
  return entry;
}

export function visitNodesForMap(dateKey: string): Array<{
  id: string;
  name: string;
  lat: number;
  lng: number;
  arrivedAtMs: number;
  dwellMin: number | null;
}> {
  return getVisitsForDate(dateKey)
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => ({
      id: v.id,
      name: v.name,
      lat: v.lat!,
      lng: v.lng!,
      arrivedAtMs: v.arrivedAtMs,
      dwellMin: v.dwellMin,
    }));
}

/** Bootstrap: Stempel-Historie → Visit-Log (einmalig soft-merge). */
export function importStampsIntoVisitLog(
  stamps: Array<{
    poiId: number;
    name: string;
    visitedAt: number;
    keyFacts?: string[];
    lat?: number | null;
    lng?: number | null;
    onTimeline?: boolean;
  }>,
  resolveCoords?: (poiId: number) => { lat: number; lng: number } | null,
): number {
  void hydrateVisitLog();
  let n = 0;
  for (const s of stamps) {
    const dwellFact = s.keyFacts?.find((f) => /verweilt\s+(\d+)/i.test(f));
    const dwellMin = dwellFact
      ? Number(dwellFact.match(/verweilt\s+(\d+)/i)?.[1] ?? NaN)
      : null;
    const fromStamp =
      s.lat != null &&
      s.lng != null &&
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng)
        ? { lat: s.lat, lng: s.lng }
        : null;
    const coords = fromStamp ?? resolveCoords?.(s.poiId) ?? null;
    const before = entries.length;
    upsertVisitFromStamp({
      name: s.name,
      poiId: s.poiId,
      arrivedAtMs: s.visitedAt,
      lat: coords?.lat,
      lng: coords?.lng,
      dwellMin: Number.isFinite(dwellMin) ? dwellMin : null,
      source: 'stamp',
      onTimeline: s.onTimeline,
    });
    if (entries.length > before || entries.some((e) => e.poiId === s.poiId)) {
      n += 1;
    }
  }
  return n;
}

export function formatDelayLabel(delayMs: number | null | undefined): string | null {
  if (delayMs == null || Math.abs(delayMs) < 3 * 60_000) return null;
  const mins = Math.round(delayMs / 60_000);
  if (mins > 0) return `+${mins} Min Verzug`;
  return `${mins} Min früher`;
}

export function todayVisitSummary(dateKey = todayDateKey()): string {
  const list = getVisitsForDate(dateKey);
  if (!list.length) return 'Heute noch keine Besuche im Visit-Log.';
  const dwell = list.reduce((a, v) => a + (v.dwellMin ?? 0), 0);
  return `${list.length} Besuche · ${dwell} Min verweilt`;
}
