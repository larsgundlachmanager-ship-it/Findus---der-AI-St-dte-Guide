/**
 * Just-in-Time ÖPNV-Live — nur Items mit harten Transit-Metadaten.
 * Checks: 24h · 4h · ab 30 Min vor Leave-by.
 */

import { useDayPlanStore } from '../../store/useDayPlanStore';
import { todayDateKey } from '../../types/dayPlan';
import { checkDeadlineTrainDelay } from './liveTransitPlan';
import { enqueueProactiveSpeech } from './proactiveSpeechQueue';
import { isTransitWatchItem, readTransitWatchFields } from './transitHardMeta';

type TransitWatch = {
  itemId: string;
  stationName: string;
  stationId: string | null;
  trainHint: string | null;
  leaveByMs: number;
  plannedDepartMs: number;
  polled24h: boolean;
  polled4h: boolean;
  polled30m: boolean;
  lastPollAtMs: number;
};

const watches = new Map<string, TransitWatch>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function due(w: TransitWatch, now: number): '24h' | '4h' | '30m' | null {
  const until = w.leaveByMs - now;
  if (until < -15 * 60_000) return null;
  if (until <= 30 * 60_000 && !w.polled30m) return '30m';
  if (until <= 4 * 60 * 60_000 && !w.polled4h) return '4h';
  if (until <= 24 * 60 * 60_000 && !w.polled24h) return '24h';
  return null;
}

/** Sync Watches — 100 % Hard-Metadata, kein Title-Regex. */
export function refreshTransitWatchesFromDayPlan(dateKey = todayDateKey()): void {
  const day = useDayPlanStore.getState().getDay(dateKey);
  const keep = new Set<string>();
  for (const it of day.items) {
    if (it.status === 'done' || it.status === 'skipped') continue;
    if (!isTransitWatchItem(it)) continue;
    const fields = readTransitWatchFields(it);
    if (!fields) continue;
    keep.add(it.id);
    const prev = watches.get(it.id);
    watches.set(it.id, {
      itemId: it.id,
      stationName: fields.stationName,
      stationId: fields.stationId,
      trainHint: fields.trainHint,
      leaveByMs: fields.leaveByMs,
      plannedDepartMs: fields.plannedDepartMs,
      polled24h: prev?.polled24h ?? false,
      polled4h: prev?.polled4h ?? false,
      polled30m: prev?.polled30m ?? false,
      lastPollAtMs: prev?.lastPollAtMs ?? 0,
    });
  }
  for (const id of [...watches.keys()]) {
    if (!keep.has(id)) watches.delete(id);
  }
  if (watches.size) ensureTicker();
}

async function pollOne(
  w: TransitWatch,
  kind: '24h' | '4h' | '30m',
): Promise<void> {
  const note = await checkDeadlineTrainDelay({
    stationName: w.stationName,
    trainHint: w.trainHint,
    plannedMs: w.plannedDepartMs,
  });
  w.lastPollAtMs = Date.now();
  if (kind === '24h') w.polled24h = true;
  if (kind === '4h') w.polled4h = true;
  if (kind === '30m') w.polled30m = true;

  if (!note) return;
  const dateKey = todayDateKey();
  useDayPlanStore.getState().addChange(dateKey, {
    summary: note,
    reason: `transit_live_${kind}`,
    significant: kind === '30m' || /ausfällt|fällt aus|\+\d+\s*Min/i.test(note),
  });
  if (kind === '30m') {
    enqueueProactiveSpeech({
      kind: 'transit',
      speech: `Kurz zum Zug: ${note}`,
      id: `transit:${w.itemId}`,
    });
  }
}

export async function tickLeaveByTransitPolls(): Promise<void> {
  refreshTransitWatchesFromDayPlan();
  const now = Date.now();
  for (const w of watches.values()) {
    const kind = due(w, now);
    if (!kind) continue;
    try {
      await pollOne(w, kind);
    } catch {
      w.lastPollAtMs = now;
      if (kind === '24h') w.polled24h = true;
      if (kind === '4h') w.polled4h = true;
      if (kind === '30m') w.polled30m = true;
    }
  }
}

function ensureTicker(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    void tickLeaveByTransitPolls();
  }, 60_000);
}

export function startLeaveByTransitPolls(): () => void {
  void tickLeaveByTransitPolls();
  ensureTicker();
  return () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  };
}
