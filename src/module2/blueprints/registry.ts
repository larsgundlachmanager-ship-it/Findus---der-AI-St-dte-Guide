/**
 * Blaupausen-Verträge — Struktur, keine Scripts.
 */

import type { ManagerTask } from '../router/types';

export type BlueprintContract = {
  id: string;
  stage: string;
  label: string;
  description: string;
  defaultTasks: ManagerTask[];
  actionRules: string[];
};

const T = (
  partial: Omit<ManagerTask, 'affectsSpeech'> & { affectsSpeech?: boolean },
): ManagerTask => ({
  affectsSpeech: partial.priority !== 'silent_slow',
  ...partial,
});

const BLUEPRINTS: BlueprintContract[] = [
  {
    id: 'cinema',
    stage: 'cinema_orient',
    label: 'Kino allgemein',
    description: 'Kinos + Genres/Beispielfilme, dann Rückfrage',
    defaultTasks: [
      T({
        id: 'cinema_venues',
        lane: 'cinema',
        brief: 'Nahe Kinos: 1 vorstellen oder beste 2 mit Charakter/Distanz',
        priority: 'fast',
      }),
      T({
        id: 'cinema_genres',
        lane: 'cinema',
        brief: 'Pro Genre ein populäres Beispiel + kurzer Teaser (ohne Showtime-Dump)',
        priority: 'fast',
      }),
      T({
        id: 'cinema_program_links',
        lane: 'cinema',
        brief: 'Programm-Seiten-URLs für heute/morgen als Buttons',
        priority: 'silent_slow',
        affectsSpeech: false,
      }),
    ],
    actionRules: [
      'Buttons = Programmseiten (Tag korrekt)',
      'Keine Showtimes bis User Film/Genre wählt',
    ],
  },
  {
    id: 'cinema',
    stage: 'cinema_film',
    label: 'Kino konkreter Film',
    description: 'Wo läuft der Film, Zeiten, Preisunterschiede',
    defaultTasks: [
      T({
        id: 'film_showtimes',
        lane: 'cinema',
        brief: 'Spielzeiten + Kinos für den genannten Film',
        priority: 'fast',
      }),
      T({
        id: 'film_booking',
        lane: 'cinema',
        brief: 'Buchungs-/Spielzeiten-Deep-Links',
        priority: 'silent_slow',
        affectsSpeech: false,
      }),
    ],
    actionRules: ['Buttons = Buchungs-/Spielzeiten-Seiten'],
  },
  {
    id: 'cinema',
    stage: 'cinema_booking',
    label: 'Kino Termin',
    description: 'Film + Uhrzeit → möglichst nah am Checkout',
    defaultTasks: [
      T({
        id: 'slot_lock',
        lane: 'cinema',
        brief: 'Einen Termin festnageln + tiefster stabiler Buchungslink',
        priority: 'fast',
      }),
    ],
    actionRules: ['Ein klarer Buchungs-Button'],
  },
  {
    id: 'dining',
    stage: 'dining_choice',
    label: 'Restaurant-Wahl',
    description: '2 Optionen + Prefs-Filter',
    defaultTasks: [
      T({
        id: 'dining_two',
        lane: 'dining',
        brief: 'Genau 2 Restaurants passend zu Prefs/Filtern; Pitch je Option',
        priority: 'fast',
      }),
      T({
        id: 'dining_maps',
        lane: 'dining',
        brief: 'Google-Maps-Links beider Orte',
        priority: 'silent_slow',
        affectsSpeech: false,
      }),
      T({
        id: 'dining_menus',
        lane: 'dining',
        brief: 'Speisekarten-URLs wenn möglich',
        priority: 'silent_slow',
        affectsSpeech: false,
      }),
    ],
    actionRules: ['Maps + Speisekarte als Buttons; Speisekarte pending ok'],
  },
  {
    id: 'dining',
    stage: 'dining_dish',
    label: 'Gericht + Preis',
    description: '2 Treffer + Live-Preis aus Speisekarte',
    defaultTasks: [
      T({
        id: 'dish_places',
        lane: 'dining',
        brief: '2 Orte die das Gericht führen; Pitch',
        priority: 'fast',
      }),
      T({
        id: 'dish_prices',
        lane: 'dining',
        brief: 'Live-Preise aus Speisekarte parsen',
        priority: 'spoken_slow',
        affectsSpeech: true,
      }),
    ],
    actionRules: ['Preis in Speech nur belegt; sonst ehrlich nachliefern'],
  },
  {
    id: 'compound_evening_goal',
    stage: 'grill',
    label: 'Abendziel Grillen',
    description: 'Ein Ziel, viele Constraints',
    defaultTasks: [
      T({
        id: 'weather',
        lane: 'weather',
        brief: 'Wetter heute Abend + Regenzeit',
        priority: 'fast',
        thinkAhead: true,
      }),
      T({
        id: 'bbq_places',
        lane: 'places',
        brief: 'Legale Grillplätze / Parks in Reichweite',
        priority: 'fast',
      }),
      T({
        id: 'walk',
        lane: 'walk_eta',
        brief: 'Fußweg-Filter (z.B. ≤30 Min) zu den Kandidaten',
        priority: 'fast',
      }),
      T({
        id: 'hours',
        lane: 'hours',
        brief: 'Öffnungs-/Park-Regeln vs. Regenzeit',
        priority: 'fast',
        thinkAhead: true,
      }),
      T({
        id: 'grocery',
        lane: 'grocery_on_way',
        brief: 'Supermarkt auf dem Weg wenn Fleisch/Einkauf implizit',
        priority: 'fast',
        thinkAhead: true,
      }),
    ],
    actionRules: ['2 Optionen mit Trade-offs; Route-Buttons'],
  },
  {
    id: 'live_events',
    stage: 'today',
    label: 'Was geht heute',
    description: 'Live-Programm Recherche',
    defaultTasks: [
      T({
        id: 'events_web',
        lane: 'web_events',
        brief: 'Heutige Events: 2–3 Quellen, Ort/Zeit/Pitch, Pref-Filter',
        priority: 'spoken_slow',
        affectsSpeech: true,
        searchHints: ['stadt events heute', 'rausgegangen', 'veranstaltungskalender'],
      }),
      T({
        id: 'events_ig',
        lane: 'instagram',
        brief: 'Nur wenn Web dünn: öffentliche IG Beiträge/Stories zum Event',
        priority: 'spoken_slow',
        affectsSpeech: true,
      }),
    ],
    actionRules: ['Buttons Route/PDF/Tickets; IG nur Fallback'],
  },
  {
    id: 'research_choice',
    stage: 'compare',
    label: 'Zwei Optionen vergleichen',
    description: 'Research-Choice',
    defaultTasks: [
      T({
        id: 'opt_a',
        lane: 'places',
        brief: 'Option A recherchieren + Pitch',
        priority: 'fast',
      }),
      T({
        id: 'opt_b',
        lane: 'places',
        brief: 'Option B recherchieren + Pitch',
        priority: 'fast',
      }),
    ],
    actionRules: ['Genau 2 Optionen + Buttons'],
  },
];

export function getBlueprintContract(
  id: string | null | undefined,
  stage?: string | null,
): BlueprintContract | null {
  if (!id) return null;
  const sid = id.toLowerCase();
  const st = (stage || '').toLowerCase();
  const exact = BLUEPRINTS.find(
    (b) => b.id === sid && (!st || b.stage === st),
  );
  if (exact) return exact;
  return BLUEPRINTS.find((b) => b.id === sid) ?? null;
}

export function listBlueprints(): BlueprintContract[] {
  return [...BLUEPRINTS];
}

/** Compose ephemeral blueprint from similar stages when missing. */
export function composeBlueprintOnMiss(opts: {
  userText: string;
  hintId?: string | null;
}): BlueprintContract {
  const t = opts.userText.toLowerCase();
  if (/\bkino|film\b/.test(t)) {
    return getBlueprintContract('cinema', 'cinema_orient')!;
  }
  if (/\b(essen|restaurant|croque|burger|pizza)\b/.test(t)) {
    return (
      getBlueprintContract(
        'dining',
        /\b(croque|burger|pizza|preis)\b/.test(t)
          ? 'dining_dish'
          : 'dining_choice',
      ) ?? getBlueprintContract('dining', 'dining_choice')!
    );
  }
  if (/\b(grill|grillen|bbq)\b/.test(t)) {
    return getBlueprintContract('compound_evening_goal', 'grill')!;
  }
  if (/\b(was geht|events?|party|heute abend)\b/.test(t)) {
    return getBlueprintContract('live_events', 'today')!;
  }
  const base = getBlueprintContract('research_choice', 'compare')!;
  return {
    ...base,
    id: opts.hintId || 'composed',
    stage: 'ephemeral',
    label: 'Compose on miss',
    description: `Ephemeral for: ${opts.userText.slice(0, 80)}`,
  };
}
