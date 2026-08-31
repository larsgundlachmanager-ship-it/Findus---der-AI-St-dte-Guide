/**
 * Session-Gedächtnis einer Tour: besuchte Orte + genannte Kernfakten.
 */

import type { PoiHookKind } from './fastHook';
import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';
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
  /**
   * Stadt beim Stempel (profile.cityId) — Explore-Progress & Passport
   * bleiben beim Stadtwechsel getrennt und restaurierbar.
   */
  cityId?: string | null;
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
 * Holistic day context for every Gemini turn: Timeline + offene Tasks.
 * Gelöschtes/Erledigtes gehört nicht hierher — sonst belebt die KI Ghosts.
 */
export function formatHolisticDayContextForPrompt(): string {
  const future = useFuturePlanStore.getState().plan;
  const tasks = useShoppingTaskStore.getState().getOpenTasks();

  const lines: string[] = [];

  if (future?.stops?.length) {
    for (const stop of future.stops.filter(
      (s) => s.status !== 'done' && s.kind !== 'nav_leg',
    )) {
      const when =
        stop.plannedStartMs != null
          ? ` bis ${formatClockLocal(stop.plannedStartMs)}`
          : '';
      lines.push(`- Timeline „${stop.title}“ (${stop.kind ?? 'stop'})${when}`);
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
    return 'Keine offenen Deadlines oder Tasks. Gelöschte Timeline-Punkte, erledigte Einkäufe und alte Fäden NICHT wieder aufgreifen.';
  }

  return `Offene Deadlines, Stops und Tasks (nur was JETZT auf der Timeline / Taskliste steht):
${lines.join('\n')}

Regel: Was nicht in dieser Liste steht, ist tot — gelöschte Timeline-Punkte, erledigte Einkäufe, gestrichene Bahn/Flug und alte Fäden nicht wieder aufgreifen.`;
}
