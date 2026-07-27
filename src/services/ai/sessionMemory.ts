/**
 * Session-Gedächtnis einer Tour: besuchte Orte + genannte Kernfakten.
 */

import type { PoiHookKind } from './fastHook';

export type VisitedPlaceMemory = {
  poiId: number;
  name: string;
  kind: PoiHookKind;
  keyFacts: string[];
  visitedAt: number;
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

  return `Frühere Stopps (NUR als optionale Recherche — NICHT erwähnen ohne echte inhaltliche Schnittmenge!):
${list}

Bereits gesagte Fakten NIEMALS wiederholen — der User soll nichts zweimal hören.
Default: KEIN Wort über frühere Orte. Nur bei Aha-Bezug (gleiche Person, Baumeister, Motiv, Handwerk, klarer Fakt-Link) eine Brücke. Reine Routen-Sätze sind verboten.`;
}
