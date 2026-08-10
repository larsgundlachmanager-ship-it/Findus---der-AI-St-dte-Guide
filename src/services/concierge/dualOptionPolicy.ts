/**
 * Dual-Option SSOT — Ranking mit 🥇🥈🥉 (max 3), kontextuelle Buttons.
 */

import type { QuickAction } from '../../types/concierge';
import {
  ACTION_LABEL_MAX_CHARS,
  shortenActionLabel,
} from './actionLabelShorten';

export const DUAL_OPTION_MAX = 3;
export const ACTION_LABEL_MAX_DUAL = ACTION_LABEL_MAX_CHARS;

export type DualOptionKind =
  | 'food'
  | 'hotel'
  | 'tour'
  | 'sight'
  | 'toilet'
  | 'infra'
  | 'generic';

export type DualOptionPlace = {
  name: string;
  lat?: number | null;
  lng?: number | null;
  poiId?: number | null;
  menuUrl?: string | null;
  bookingUrl?: string | null;
  tourUrl?: string | null;
  /** Kurzgrund für Toilette/Infra („näher“, „sauberer“) */
  diffReason?: string | null;
  specialties?: string[];
  rating?: number | null;
  walkMin?: number | null;
};

export function clampDualLabel(label: string, max = ACTION_LABEL_MAX_DUAL): string {
  return shortenActionLabel(label, max);
}

/**
 * Buttons 1:1 zu den gesprochenen Optionen — Intent bestimmt Priorität.
 */
export function buildDualOptionActions(
  kind: DualOptionKind,
  places: DualOptionPlace[],
): QuickAction[] {
  const top = places.filter((p) => p.name?.trim()).slice(0, DUAL_OPTION_MAX);
  const actions: QuickAction[] = [];

  for (const p of top) {
    if (kind === 'food' && p.menuUrl) {
      actions.push({
        type: 'OPEN_URL',
        label: clampDualLabel(`🍽 ${p.name}`),
        payload: { url: p.menuUrl, destName: p.name },
      });
      continue;
    }
    if (kind === 'hotel' && p.bookingUrl) {
      actions.push({
        type: 'OPEN_URL',
        label: clampDualLabel(`🏨 ${p.name}`),
        payload: { url: p.bookingUrl, destName: p.name },
      });
      continue;
    }
    if (kind === 'tour' && p.tourUrl) {
      actions.push({
        type: 'OPEN_URL',
        label: clampDualLabel(`🎫 ${p.name}`),
        payload: { url: p.tourUrl, destName: p.name },
      });
      continue;
    }
    // Sight / Toilette / Fallback → Route
    if (p.lat != null && p.lng != null) {
      actions.push({
        type: 'START_NAVIGATION',
        label: clampDualLabel(`📍 ${p.name}`),
        payload: {
          destName: p.name,
          destLat: p.lat,
          destLng: p.lng,
          targetPoiId: p.poiId ?? undefined,
        },
      });
    }
  }

  return actions.slice(0, DUAL_OPTION_MAX);
}

/** Prompt-Block für Dual-Option + Confirm-Gates. */
export const FINDUS_DUAL_OPTION_BLOCK = `DUAL-OPTION (SSOT):
- Ranking mit 🥇🥈🥉 (selten 3, nie mehr). Nie „Favorit“ / „Alternative“ sagen — Medaillen.
- Bei Essen/Food: pro Ort immer Top-2 Gerichte + eine Spezialität nennen; Schließzeit vs. Aufenthaltsdauer (~75 Min) prüfen.
- Buttons 1:1: Restaurant→Speisekarte, Tour→Ticket/Link, Hotel→beide Buchungslinks, Sight/ungesehen→2 Routen, Toilette→2 Routen + Differenzgrund. Labels mit 🥇🥈🥉 wenn Ranking.
- Labels max 30 Zeichen (Emoji + Kurzform: Route, Karte, Web, Buch, Termin, Wahl). User bestätigt Bindendes (Tisch/Buchung/Nav-Start) — nie vortäuschen.
- Ort + Uhrzeit prüfen und gegen Venue (offen, Schließung, Verweildauer) validieren bevor Reservierung.
- Nav jetzt vs. später: Zukunftstermine → Leave-by-Reminder, nicht sofort Navigation starten.`;
