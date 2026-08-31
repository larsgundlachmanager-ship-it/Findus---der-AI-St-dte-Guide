/**
 * Live-Pitch (split UI): gewählte Option still in die Timeline — ohne Kalender.
 * SSOT futurePlanState; User sieht den Eintrag erst bei manuellem Timeline-Öffnen.
 */

import type { QuickAction } from '../../types/concierge';
import { dateKeyFromMs, todayDateKey } from '../../utils/dateKeys';
import { useFuturePlanStore, type FuturePlanStop } from '../timeline/futurePlanState';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import { mergePlaceActionUrls } from '../timeline/placeActionUrls';
import type { PitchKind, PitchOptionCard } from './types';

function resolvePitchDayKey(anchorTimeMs?: number | null): string {
  if (anchorTimeMs != null && Number.isFinite(anchorTimeMs)) {
    try {
      return dateKeyFromMs(anchorTimeMs);
    } catch {
      /* soft */
    }
  }
  const requested = usePlanCalendarUiStore.getState().requestedDayKey;
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested;
  const active = useFuturePlanStore.getState().plan.dayKey;
  if (active && /^\d{4}-\d{2}-\d{2}$/.test(active)) return active;
  return todayDateKey();
}

function durationMsForKind(kind: PitchKind | null | undefined): number | null {
  switch (kind) {
    case 'cinema':
      return 120 * 60_000;
    case 'tour':
    case 'sight':
      return 90 * 60_000;
    case 'hotel':
      return null;
    default:
      return 75 * 60_000;
  }
}

function urlFromAction(act: QuickAction): string | null {
  const p = act.payload;
  if (p && typeof p === 'object' && 'url' in p) {
    const u = String((p as { url?: string }).url ?? '').trim();
    return /^https?:\/\//i.test(u) ? u : null;
  }
  return null;
}

function urlsFromOption(opt: PitchOptionCard): ReturnType<typeof mergePlaceActionUrls> {
  let reserveUrl: string | null = null;
  for (const a of opt.actions ?? []) {
    if (a.type !== 'OPEN_URL') continue;
    const u = urlFromAction(a);
    if (!u) continue;
    if (/reserv|tisch|book/i.test(a.label)) reserveUrl = u;
  }
  return mergePlaceActionUrls({
    mapsUrl: opt.mapsUrl,
    menuUrl: opt.menuUrl ?? null,
    websiteUrl: opt.websiteUrl ?? null,
    reserveUrl,
  });
}

function userFixedTimeFromContext(context: string | null | undefined): boolean {
  const t = (context || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(\d{1,2}([:.]\d{2})?\s*uhr|um\s+\d{1,2}|gegen\s+\d{1,2}|mittags|mittagessen|abendessen|frühstück|fruehstueck)\b/iu.test(
      t,
    ) || /\b(morgen|heute)\s+(mittag|abend|früh|frueh)/iu.test(t)
  );
}

function planPriorityForKind(kind: PitchKind | null | undefined): FuturePlanStop['planPriority'] {
  if (kind === 'hotel') return 2;
  if (kind === 'cinema') return 3;
  return 4;
}

/** Nach Tap auf Live-Pitch-Karte — kein requestOpenPlanCalendar. */
export function mirrorLivePitchChoiceToTimeline(opts: {
  requestId: string;
  option: PitchOptionCard;
  visitAtMs?: number | null;
  pitchKind?: PitchKind | null;
  pitchContext?: string | null;
}): void {
  const requestId = String(opts.requestId || '').trim();
  if (!requestId || requestId.startsWith('map_nav_mobility_')) return;
  const name = String(opts.option.name || '').trim();
  if (!name) return;

  const visitAtMs =
    opts.visitAtMs != null && Number.isFinite(opts.visitAtMs)
      ? opts.visitAtMs
      : null;
  const dayKey = resolvePitchDayKey(visitAtMs);
  const dur = durationMsForKind(opts.pitchKind);
  const startMs = visitAtMs;
  const endMs =
    startMs != null && dur != null ? startMs + dur : startMs != null ? startMs + 60 * 60_000 : null;
  const urls = urlsFromOption(opts.option);
  const notes = (opts.option.bullets ?? []).slice(0, 3).join('\n').trim() || undefined;
  const fixed = userFixedTimeFromContext(opts.pitchContext);

  useFuturePlanStore.getState().ensureDay(dayKey);
  const stop: FuturePlanStop = {
    id: `live_pitch_${requestId}`,
    title: name.slice(0, 80),
    lat: Number.isFinite(opts.option.lat) ? opts.option.lat : undefined,
    lng: Number.isFinite(opts.option.lng) ? opts.option.lng : undefined,
    plannedStartMs: startMs,
    plannedEndMs: endMs,
    bufferMin: 10,
    transport: 'walk',
    kind: 'stop',
    status: 'planned',
    planPriority: planPriorityForKind(opts.pitchKind),
    planTaskId: requestId,
    notes,
    mapsUrl: urls.mapsUrl ?? opts.option.mapsUrl ?? null,
    menuUrl: urls.menuUrl ?? null,
    reserveUrl: urls.reserveUrl ?? null,
    websiteUrl: urls.websiteUrl ?? null,
    userFixedTime: fixed && startMs != null,
  };

  useFuturePlanStore.getState().upsertStopOnDay(dayKey, stop);
  try {
    const { markFresh } = require('../timeline/planLiveEdits') as {
      markFresh: (dayKey: string) => void;
    };
    markFresh(dayKey);
  } catch {
    /* soft — Node smoke */
  }
}
