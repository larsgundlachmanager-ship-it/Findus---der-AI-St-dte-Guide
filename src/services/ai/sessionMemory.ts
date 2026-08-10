/**
 * Session-Gedächtnis einer Tour: besuchte Orte + genannte Kernfakten.
 */

import type { PoiHookKind } from './fastHook';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';

export type VisitedPlaceMemory = {
  poiId: number;
  name: string;
  kind: PoiHookKind;
  keyFacts: string[];
  visitedAt: number;
  /**
   * Zeitachse: nur true bei Modul-1-Hauptpunkt oder ≥2 Min Dwell.
   * false = nur Stempelkarte / Fog (z. B. GPS-Vorbeilaufen).
   */
  onTimeline?: boolean;
  /** Gespeicherte Position — Stempel bleiben sichtbar auch wenn Pack-POI-IDs wechseln. */
  lat?: number | null;
  lng?: number | null;
};

export type SessionMemory = {
  entries: VisitedPlaceMemory[];
};

export function emptySessionMemory(): SessionMemory {
  return { entries: [] };
}

export function lastVisitedPlace(
  memory?: SessionMemory | null,
): VisitedPlaceMemory | null {
  if (!memory?.entries?.length) return null;
  return memory.entries[memory.entries.length - 1] ?? null;
}

export function formatSessionMemoryForPrompt(memory?: SessionMemory | null): string {
  if (!memory?.entries?.length) {
    return 'Noch keine vorherigen Stopps in dieser Tour.';
  }
  const list = memory.entries
    .slice(-8)
    .map((e) => {
      const facts =
        e.keyFacts.length > 0
          ? ` — Kernfakten: ${e.keyFacts.slice(0, 4).join('; ')}`
          : ' — (keine Kernfakten)';
      return `- ${e.name} (${e.kind})${facts}`;
    })
    .join('\n');

  return `Frühere Stopps (für Bezüge & Orientierung — nur bei echtem inhaltlichen Link erwähnen):
${list}

Bereits gesagte Fakten NIEMALS wörtlich wiederholen.
Bezüge ausdrücklich ERLAUBT wenn sie helfen: „Eben am alten Leuchtturm … jetzt der neue …“, Richtung („du kamst aus dem Osten“), oder offene Zeitlücken.
Default: kurz und relevant — keine Tour-Zusammenfassung ohne Mehrwert.`;
}

function formatClockLocal(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Holistic day context for every Gemini turn: open deadlines + errands.
 * Chat history is passed separately as message list (full session).
 */
export function formatHolisticDayContextForPrompt(): string {
  const plan =
    useSessionPlanStore.getState().getActivePlan() ??
    useSessionPlanStore.getState().plan;
  const tasks = useShoppingTaskStore.getState().getOpenTasks();

  const lines: string[] = [];

  if (plan?.active) {
    if (plan.leaveByMs != null) {
      lines.push(
        `- Leave-by / Puffer: spätestens ${formatClockLocal(plan.leaveByMs)} los (Buffer ${plan.bufferMinutes} Min)`,
      );
    }
    for (const stop of plan.stops.filter((s) => !s.done)) {
      const when =
        stop.arriveByMs != null
          ? ` bis ${formatClockLocal(stop.arriveByMs)}`
          : '';
      const items =
        stop.items.length > 0 ? ` · Items: ${stop.items.join(', ')}` : '';
      lines.push(`- Stop „${stop.label}“ (${stop.kind})${when}${items}`);
    }
    if (plan.boostPlaceTypes.length) {
      lines.push(
        `- Free-Roam Boost-Kategorien: ${plan.boostPlaceTypes.slice(0, 8).join(', ')}`,
      );
    }
  }

  if (tasks.length) {
    for (const t of tasks.slice(0, 12)) {
      const due =
        t.dueAtMs != null ? ` · fällig ${formatClockLocal(t.dueAtMs)}` : '';
      const anchor = t.anchor ? ` · Anker: ${t.anchor}` : '';
      lines.push(`- Task: ${t.itemLabel}${anchor}${due}`);
    }
  }

  if (!lines.length) {
    return 'Keine offenen Deadlines oder Tasks in dieser Session.';
  }

  return `Offene Deadlines, Stops und Tasks (IMMER im Blick behalten — wie ein menschlicher Begleiter):
${lines.join('\n')}

Wenn der User abends nach Zielen fragt: Zusammenhänge zu morgens besprochenen Themen und Terminen selbst herstellen.`;
}
