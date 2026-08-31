/**
 * Modul 5 — Tool-Runtime für Plan-Agent (Timeline nur hier ändern).
 */

import { Linking } from 'react-native';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import {
  removePlanStop,
  reschedulePlanStop,
  setStopTransport,
  markFresh,
} from '../timeline/planLiveEdits';
import { applyGapFillTravelLegs } from '../timeline/gapFillTravel';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';
import {
  inferTripPrefsFromText,
  savePlanTripPrefs,
} from './planTripPrefs';
import type { FuturePlanTransport } from '../timeline/futurePlanState';

export type PlanAgentToolCall = {
  name: string;
  args: Record<string, unknown>;
};

function findStop(idOrTitle: string) {
  const q = idOrTitle.trim().toLowerCase();
  const stops = useFuturePlanStore.getState().plan.stops;
  return (
    stops.find((s) => s.id === idOrTitle) ||
    stops.find((s) => s.title.toLowerCase().includes(q.slice(0, 24))) ||
    null
  );
}

async function startNavToStop(stopId: string): Promise<string> {
  const stop = findStop(stopId);
  if (!stop || stop.lat == null || stop.lng == null) {
    return 'Für die Navigation fehlt noch der Ort.';
  }
  try {
    const { handleQuickAction } = await import('../../services/actionHandlerService');
    await handleQuickAction({
      type: 'START_NAVIGATION',
      label: `🧭 ${stop.title}`.slice(0, 28),
      payload: {
        destName: stop.title,
        destLat: stop.lat,
        destLng: stop.lng,
      },
    });
    return `Navigation zu ${stop.title} startet.`;
  } catch {
    return 'Navigation konnte nicht starten.';
  }
}

export async function executePlanAgentTools(
  calls: PlanAgentToolCall[],
  defaultDayKey: string,
): Promise<string> {
  const notes: string[] = [];
  for (const call of calls.slice(0, 8)) {
    const name = call.name;
    const args = call.args ?? {};
    const dayKey = String(args.dayKey ?? defaultDayKey);
    try {
      useFuturePlanStore.getState().ensureDay(dayKey);
    } catch {
      /* soft */
    }

    if (name === 'remove_stop') {
      const id = String(args.stopId ?? args.title ?? '');
      const stop = findStop(id);
      if (stop?.reserveUrl) {
        notes.push(
          `Hinweis: Bei „${stop.title}“ hing eine Reservierung — ggf. mitverschieben/stornieren.`,
        );
        usePlanCalendarUiStore.getState().setMirroredActions([
          {
            type: 'OPEN_URL',
            label: '🍽 Reservierung',
            payload: { url: stop.reserveUrl, destination: stop.title },
          },
        ]);
      }
      if (stop) {
        removePlanStop(stop.id);
        notes.push(`„${stop.title}“ ist raus.`);
      }
      continue;
    }

    if (name === 'move_stop') {
      const id = String(args.stopId ?? args.title ?? '');
      const deltaMin = Number(args.deltaMin);
      const stop = findStop(id);
      if (!stop) continue;
      try {
        const { isHardFixedStop } = await import('./planHardLock');
        if (isHardFixedStop(stop) && args.allowHardMove !== true) {
          notes.push(
            `„${stop.title}“ ist fest — nur mit klarer neuer Uhrzeit vom User verschieben.`,
          );
          continue;
        }
      } catch {
        /* soft */
      }
      const allowHard = args.allowHardMove === true;
      if (Number.isFinite(deltaMin) && deltaMin !== 0) {
        if (!reschedulePlanStop(stop.id, { deltaMin, allowHardMove: allowHard })) {
          notes.push(`„${stop.title}“ konnte nicht verschoben werden.`);
          continue;
        }
      } else if (typeof args.newTimeHm === 'string' && stop.plannedStartMs) {
        const m = String(args.newTimeHm).match(/^(\d{1,2}):(\d{2})$/);
        if (m) {
          const d = new Date(stop.plannedStartMs);
          d.setHours(Number(m[1]), Number(m[2]), 0, 0);
          if (
            !reschedulePlanStop(stop.id, {
              plannedStartMs: d.getTime(),
              allowHardMove: true,
            })
          ) {
            notes.push(`„${stop.title}“ konnte nicht verschoben werden.`);
            continue;
          }
        }
      }
      if (stop.reserveUrl) {
        notes.push(
          `Tischreservierung bei „${stop.title}“ — soll die mit verschoben werden?`,
        );
        usePlanCalendarUiStore.getState().setMirroredActions([
          {
            type: 'OPEN_URL',
            label: '🍽 Reservierung anpassen',
            payload: { url: stop.reserveUrl, destination: stop.title },
          },
        ]);
      }
      notes.push(`Zeit für „${stop.title}“ angepasst.`);
      continue;
    }

    if (name === 'set_leg_transport') {
      const id = String(args.stopId ?? '');
      const transport = String(args.transport ?? 'walk') as FuturePlanTransport;
      if (id && setStopTransport(id, transport)) {
        notes.push(`Transport: ${transport}`);
        if (transport === 'taxi' || transport === 'car') {
          const stop = findStop(id);
          usePlanCalendarUiStore.getState().setMirroredActions([
            {
              type: 'BOOK_UBER',
              label: '🚕 Taxi',
              payload: {
                destName: stop?.title,
                destLat: stop?.lat ?? undefined,
                destLng: stop?.lng ?? undefined,
              },
            },
          ]);
        }
      }
      continue;
    }

    if (name === 'start_navigation') {
      const id = String(args.stopId ?? args.title ?? '');
      notes.push(await startNavToStop(id));
      continue;
    }

    if (name === 'clear_soft_day') {
      const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
      for (const s of [...plan.stops]) {
        if (s.hardAnchor || (s.planPriority != null && s.planPriority <= 2)) {
          continue;
        }
        if (s.kind === 'wish' || !s.hardAnchor) {
          if (s.planPriority != null && s.planPriority <= 3) continue;
          removePlanStop(s.id);
        }
      }
      notes.push('Weiche Stops geräumt — Fixes bleiben.');
      continue;
    }

    if (name === 'flag_reservation_side_effect') {
      const id = String(args.stopId ?? '');
      const stop = findStop(id);
      if (stop?.reserveUrl) {
        try {
          await Linking.openURL(stop.reserveUrl);
        } catch {
          /* soft */
        }
      }
      continue;
    }

    if (name === 'remember_pref') {
      const key = String(args.key ?? '');
      const value = String(args.value ?? '');
      const patch = inferTripPrefsFromText(`${key} ${value}`);
      if (Object.keys(patch).length) void savePlanTripPrefs(patch);
      continue;
    }

    if (name === 'ask_clarify') {
      const options = Array.isArray(args.options) ? args.options : [];
      const labels = options
        .map((o) => {
          if (!o || typeof o !== 'object') return null;
          const lab = String((o as { label?: string }).label ?? '').trim();
          return lab ? lab.slice(0, 22) : null;
        })
        .filter(Boolean) as string[];
      if (labels.length) {
        const answers = labels.slice(0, 4).map((label, i) => ({
          id: `clarify_${i}`,
          label,
          action: 'prompt' as const,
          prompt: label,
        }));
        usePlanCalendarUiStore.getState().setShortAnswers(answers);
      }
      continue;
    }

    if (name === 'fill_tour_gaps' || name === 'propose_actions') {
      try {
        applyGapFillTravelLegs();
      } catch {
        /* soft */
      }
      continue;
    }

    if (name === 'resolve_conflict') {
      // args.fixes optional — move/remove already covered; refresh legs
      try {
        applyGapFillTravelLegs();
      } catch {
        /* soft */
      }
      const stopId = String(args.stopId ?? '');
      if (stopId) markFresh([stopId]);
      continue;
    }
  }

  try {
    applyGapFillTravelLegs();
  } catch {
    /* soft */
  }
  return notes.filter(Boolean).join(' ');
}

/** UI: Navigation zu Stop starten. */
export async function startNavigationToPlanStop(
  stopId: string,
): Promise<string> {
  return startNavToStop(stopId);
}
