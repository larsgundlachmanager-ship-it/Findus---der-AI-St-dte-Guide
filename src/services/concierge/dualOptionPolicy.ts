/**
 * Dual-Option / Auswahl — SSOT.
 * Offene 2er-Auswahl (Essen, Sight, Bar, Kino, Hotel-Choice) läuft nur über
 * `src/module2/pitch` (Auswahl-Pitch v4). Kein Legacy-Agent-Dual-Pitch.
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
 * Buttons 1:1 zu den gesprochenen Optionen — nur noch Infra/Toilette/Tour-Hilfen.
 * Food/Sight/Hotel-Choice → Pitch-Modul (nicht diese Helper).
 */
export function buildDualOptionActions(
  kind: DualOptionKind,
  places: DualOptionPlace[],
): QuickAction[] {
  if (kind === 'food' || kind === 'hotel' || kind === 'sight') {
    return [];
  }
  const top = places.filter((p) => p.name?.trim()).slice(0, DUAL_OPTION_MAX);
  const actions: QuickAction[] = [];

  for (const p of top) {
    if (kind === 'tour' && p.tourUrl) {
      actions.push({
        type: 'OPEN_URL',
        label: clampDualLabel(`🎫 ${p.name}`),
        payload: { url: p.tourUrl, destName: p.name },
      });
      continue;
    }
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

export function stripLeadingPlaceName(pitch: string, name: string): string {
  let p = (pitch ?? '').replace(/\s+/g, ' ').trim();
  const n = (name ?? '').trim();
  if (!p || !n) return p;
  if (p.toLowerCase().startsWith(n.toLowerCase())) {
    p = p.slice(n.length).replace(/^[\s:,.\-–—]+/u, '').trim();
  }
  return p;
}

function ensureSpokenSentence(s: string): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/[.!?…]$/u.test(t)) return t;
  return `${t}.`;
}

/**
 * Zwei Orte als ein mündlicher Fließtext — Struktur, kein Script.
 * LLM-Pitches werden hier nur zusammengeführt; Wortlaut der Pitches bleibt.
 */
export function weaveDualOptionSpoken(opts: {
  intro?: string | null;
  continueFromBridge?: boolean;
  aName: string;
  aPitch: string;
  bName: string;
  bPitch: string;
  ask?: string | null;
}): string {
  const aFacts = ensureSpokenSentence(stripLeadingPlaceName(opts.aPitch, opts.aName));
  const bFacts = ensureSpokenSentence(stripLeadingPlaceName(opts.bPitch, opts.bName));
  const lead = opts.continueFromBridge ? '' : (opts.intro || '').trim();
  const ask = (opts.ask || 'Was hört sich für dich besser an?').trim();
  const aBit = aFacts ? `${opts.aName} — ${aFacts}` : `${opts.aName}.`;
  const bBit = bFacts ? `${opts.bName} — ${bFacts}` : `${opts.bName}.`;
  const body = `Entweder ${aBit} Oder ${bBit} ${ask}`;
  return [lead, body].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Prompt-Block — Auswahl-Pitch ist Modul-SSOT, nicht LLM-Dual-Inventur. */
export const FINDUS_DUAL_OPTION_BLOCK = `AUSWAHL / DUAL-OPTION (SSOT):
- Offene 2er-Auswahl (Essen, Bar, Kino, Sight, Hotel-Choice, Events/Festivals) kommt NUR vom Auswahl-Pitch-Modul — niemals selbst zwei Orte erfinden oder Medaillen-Ranking im Speech improvisieren.
- Infra/Toilette/ATM: weiterhin kurz 2 konkrete Optionen + START_NAVIGATION mit Differenzgrund (näher/sauberer) — ohne „Favorit“/„Alternative“-Wortlaut.
- Nach Pitch: User wählt in der UI (A|B oder Timeline). Speisekarte/Deep/Tickets erst nach Wahl oder als Pitch-Append.
- Tap auf Option: kurz bestätigen + Buttons „buchen/Ticket“ (falls Link) und „Navigation starten“ zeigen — nicht stumm sofort navigieren.
- Labels klar (Maps / Web / Ticket / Route), max ~22–28 Zeichen. Bindendes (Tisch/Buchung/Nav-Start) nur mit Confirm — nie vortäuschen.
- Nav jetzt vs. später: Zukunftstermine → Leave-by-Reminder, nicht sofort Navigation. Bei Nav-Start und >~20 Min Fuß: ÖPNV automatisch starten wenn schneller (+ Timeline), keine Wahl-Nachfrage.
- Speech = ein Fließtext: nach der Bridge (Wetter/Wunsch schon gesagt) sofort Entweder Ort A mit gepackten Fakten — Oder Ort B ebenso — dann kurze Wahlfrage. Kein Katalog, kein „Erstens / Und falls der nicht sitzt“.
Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an den aktuellen Kontext und die aktuelle Stadt an.`;
