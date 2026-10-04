/**
 * Akt-3 Stage-Meta + Checklisten-Fokus — pure (ohne Store/RN).
 */

import type { ResearchStep } from '../types';
import { RESEARCH_STATUS_RAIL } from './progressPace';

export const STAGE_META: Record<
  string,
  { emoji: string; title: string; vibe: string }
> = {
  climate: {
    emoji: '🌤️',
    title: 'Wetter & Klima',
    vibe: 'Jetzt hol ich die Wetterlage für euer Fenster…',
  },
  soft: {
    emoji: '✨',
    title: 'Wünsche & Prefs',
    vibe: 'Jetzt match ich Party, Pool, Clubs…',
  },
  discover: {
    emoji: '🗺️',
    title: 'Orte finden',
    vibe: 'Wo könnte das hinpassen — erst die warmen Gegenden…',
  },
  events: { emoji: '🎟️', title: 'Events', vibe: 'Was geht in der Zeit vor Ort?' },
  flights: {
    emoji: '✈️',
    title: 'Flüge / Anreise',
    vibe: 'Als Nächstes die Flüge — Preise und Starts…',
  },
  calendar: {
    emoji: '📅',
    title: 'Kalender',
    vibe: 'Beste Zeitfenster gegen Preise legen…',
  },
  pivot: { emoji: '🔄', title: 'Budget-Filter', vibe: 'Zu teuer? Neuer Ansatz.' },
  stay: {
    emoji: '🏡',
    title: 'Unterkünfte',
    vibe: 'Jetzt die Unterkünfte vor Ort…',
  },
  transfer: {
    emoji: '🚕',
    title: 'Transfer',
    vibe: 'Wie kommt ihr vom Airport zum Bett?',
  },
  compare: {
    emoji: '⚖️',
    title: 'Vergleich',
    vibe: 'Jetzt die Pakete gegeneinander…',
  },
  qa: {
    emoji: '✅',
    title: 'Doppel-Check',
    vibe: 'Paket komplett? Wünsche erfüllt?',
  },
  // Masterplan-Aliase (Theater-Checkliste offen→eng)
  brief_plan: {
    emoji: '📋',
    title: 'Brief-Plan',
    vibe: 'Kurz den Suchplan aus eurem Brief bauen…',
  },
  open_space: {
    emoji: '🌍',
    title: 'Optionenraum',
    vibe: 'Erst den weiten Raum öffnen — dann eng machen…',
  },
  access_filter: {
    emoji: '🧭',
    title: 'Zugang-Filter',
    vibe: 'Was erreichbar ist aus eurem Start…',
  },
  shortlist: {
    emoji: '✂️',
    title: 'Shortlist',
    vibe: 'Jetzt auf die echten Kandidaten…',
  },
  stay_tracks: {
    emoji: '🏡',
    title: 'Stay-Spuren',
    vibe: 'Erstspur und Notfall-Spur parallel…',
  },
  flight_matrix: {
    emoji: '✈️',
    title: 'Flug-Matrix',
    vibe: 'Prefer-Fenster gegen Soft scoren…',
  },
  score_compare: {
    emoji: '⚖️',
    title: 'Score-Compare',
    vibe: 'Pakete gegeneinander legen…',
  },
  feeder: {
    emoji: '🚆',
    title: 'Zubringer',
    vibe: 'Heimat → Hub → Ziel…',
  },
  package_pick: {
    emoji: '📦',
    title: '2–4 Pakete',
    vibe: 'Mindestens zwei starke Optionen rausziehen…',
  },
};

/**
 * Welcher Checklisten-Schritt läuft + kurzer Status.
 * Kein Kategorie-Hero (kein gelbes „Unterkünfte“-Banner).
 */
export function theaterChecklistFocus(steps: ResearchStep[]): {
  stepTitle: string;
  statusLine: string;
  stage: string | null;
  showComparePalette: boolean;
} {
  const active =
    steps.find((s) => s.status === 'active') || steps.find((s) => s.status === 'pivot');
  const stage = active?.stage || null;
  const rail = RESEARCH_STATUS_RAIL.find((r) => r.stage === stage);
  const meta = stage ? STAGE_META[stage] : null;
  const stepTitle = rail?.title || active?.title || meta?.title || 'Recherche';
  const statusLine = (active?.detail || meta?.vibe || 'Ich suche eure Reise…').trim();
  return {
    stepTitle,
    statusLine,
    stage,
    showComparePalette: stage === 'compare' || stage === 'score_compare' || stage === 'package_pick',
  };
}
