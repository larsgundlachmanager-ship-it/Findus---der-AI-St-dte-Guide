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
    description: 'Filme zuerst (schaffbar inkl. Geh-ETA), Kinos als Träger',
    defaultTasks: [
      T({
        id: 'cinema_genres',
        lane: 'cinema',
        brief: 'Filme/Genres die der User zeitlich schaffen kann — Prio 1, ohne Showtime-Dump',
        priority: 'fast',
      }),
      T({
        id: 'cinema_venues',
        lane: 'cinema',
        brief: 'Nahe Kinos als Träger: Distanz/Charakter, nur wo die Filme laufen',
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
    id: 'sky_phenomenon',
    stage: 'observe',
    label: 'Himmelsphänomen',
    description:
      'Sonnenfinsternis/Sternschnuppen/Nordlicht: Fakten + Sichtbarkeit + optional Erinnern',
    defaultTasks: [
      T({
        id: 'sky_when_where',
        lane: 'knowledge',
        brief:
          'Wann (Start/Max/Ende wenn belegt), wo sichtbar, kurz erklären — Answer-First',
        priority: 'fast',
      }),
      T({
        id: 'sky_weather',
        lane: 'weather',
        brief:
          'Kurz Wolken/Sicht vor Ort wenn Wetter belegt — ehrlich wenn bedeckt',
        priority: 'fast',
      }),
      T({
        id: 'sky_remind',
        lane: 'other',
        brief:
          'Offer: rechtzeitig erinnern / kurz einplanen — Button Erinnern nur wenn Zeitpunkt ODER Ort klar; sonst kein Soft-Offer',
        priority: 'silent_slow',
        affectsSpeech: false,
      }),
    ],
    actionRules: [
      'Button Erinnern wenn Zeitpunkt klar',
      'Keine Fake-Zeiten; Wolken nur mit Wetterbeleg',
      'Nicht Nightlife/Party-Kalender',
    ],
  },
  {
    id: 'hotel',
    stage: 'hotel_choice',
    label: 'Hotel / Übernachtung',
    description:
      'IMMER genau 2 live bepreisbare Optionen (Stay22). Pro Hotel: Name, warum, Gesamtpreis + ca. Preis/Nacht, Partner-Buchungslink. Nie Namen ohne Preis erfinden, nie „soll ich raussuchen?“.',
    defaultTasks: [
      T({
        id: 'hotel_options',
        lane: 'places',
        brief:
          'Zwei live bepreisbare Hotels/Unterkünfte (Stay22) — günstigste zuerst wenn User günstig will',
        priority: 'fast',
      }),
      T({
        id: 'hotel_links',
        lane: 'places',
        brief: 'Partner-Buchungs-URLs mit checkin/checkout an beide Optionen',
        priority: 'fast',
        affectsSpeech: false,
      }),
    ],
    actionRules: [
      'OPEN_URL Partnerlink Pflicht sobald Stay22-Preis da',
      'Keine Fake-Preise; ohne Live-Preis ehrlich + Stay22-Suche statt erfundene Namen',
      'Keine Permission-Fragen',
    ],
  },
  {
    id: 'theater',
    stage: 'theater_orient',
    label: 'Theater / Musical',
    description: 'Stücke zuerst (schaffbar inkl. Geh-ETA), Häuser als Träger — Snacks wie Kino',
    defaultTasks: [
      T({
        id: 'theater_program',
        lane: 'cinema',
        brief: 'Stücke/Programm die der User zeitlich schaffen kann — Prio 1',
        priority: 'fast',
      }),
      T({
        id: 'theater_venues',
        lane: 'cinema',
        brief: 'Nahe Theater/Musical-Häuser als Träger, Distanz/Charakter',
        priority: 'fast',
      }),
      T({
        id: 'theater_snacks',
        lane: 'cinema',
        brief: 'Snack-/Pausen-Preise nur wenn Crowd-Slot oder User fragt, nur belegt',
        priority: 'silent_slow',
        affectsSpeech: false,
      }),
    ],
    actionRules: [
      'Buttons = Programm/Tickets; keine Fake-Zeiten',
      'Theater ≈ Kino für Showtimes/Snacks/Tickets',
    ],
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
  {
    id: 'flight_leave_by',
    stage: 'leave_by',
    label: 'Flug Rückwärtsplan',
    description:
      'Slots mergen, Lücken fragen (wann genau), nächsten Verkehrsflughafen, Rückwärts-Timeline. Uber zuerst mit Vorbestellen, ÖPNV als zweite Option mit Live-Zeiten. Wecker nur nach Frage. Nach Hinflug-Bestätigung Hotel im Ziel. Kein Nacht-aktuell für morgige Abfahrt.',
    defaultTasks: [
      T({
        id: 'flight_slots',
        lane: 'combo',
        brief:
          'Ziel, Tag, Uhr; nächsten Commercial-Airport; Live-Tafel wenn belegt',
        priority: 'fast',
      }),
      T({
        id: 'flight_reverse',
        lane: 'combo',
        brief:
          'Rückwärts: Boarding → Gate → Security → Check-in → Terminal. Taxi-ETA zur geplanten Los-Zeit, nicht jetzt.',
        priority: 'fast',
      }),
      T({
        id: 'flight_access',
        lane: 'walk_eta',
        brief:
          'Zwei Optionen unter Offene Pläne: Uber/Taxi mit Los-Uhr, ÖPNV-Akkordeon mit Live-Preis. Max 4 Transfer-Partner.',
        priority: 'fast',
      }),
    ],
    actionRules: [
      'Ausführung bleibt der Flug-Advisor',
      'Uber-Partnerlink zuerst, ÖPNV separat',
      'Wecker-Chip fragen, nicht auto-stellen',
      'Nach Bestätigung der Hinfahrt Hotel-Frage im Ziel',
    ],
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

/** Compose blueprint from aliases — NEVER default to research_choice. */
export function composeBlueprintOnMiss(opts: {
  userText: string;
  hintId?: string | null;
}): BlueprintContract | null {
  try {
    const { classifyUtteranceFamily } = require('../kernel/utteranceFamily') as {
      classifyUtteranceFamily: (s: string) => { family: string };
    };
    if (classifyUtteranceFamily(opts.userText || '').family === 'flight') {
      // Advisor bleibt Executor — Vertrag nur Think-Ahead, nicht Chat-Lane.
      return null;
    }
  } catch {
    /* soft */
  }
  try {
    const { resolveBlueprintForText } = require('./aliases') as {
      resolveBlueprintForText: (o: {
        userText: string;
        blueprintId?: string | null;
      }) => { contract: BlueprintContract | null };
    };
    const hit = resolveBlueprintForText({
      userText: opts.userText,
      blueprintId: opts.hintId,
    });
    if (hit.contract) return hit.contract;
  } catch {
    /* fall through */
  }
  const t = opts.userText.toLowerCase();
  if (/\bkino|film\b/.test(t)) {
    return getBlueprintContract('cinema', 'cinema_orient');
  }
  if (/\b(theater|theatre|schauspiel|musical)\b/.test(t)) {
    return (
      getBlueprintContract('theater', 'theater_orient') ||
      getBlueprintContract('cinema', 'cinema_orient')
    );
  }
  if (/\b(essen|restaurant|croque|burger|pizza)\b/.test(t)) {
    return getBlueprintContract('dining', 'dining_choice');
  }
  if (/\b(hotel|übernacht|uebernacht)\b/.test(t)) {
    return getBlueprintContract('hotel', 'hotel_choice');
  }
  if (/\b(grill|grillen|bbq)\b/.test(t)) {
    return getBlueprintContract('compound_evening_goal', 'grill');
  }
  if (/\b(sonnenfinsternis|mondfinsternis|sternschnuppe|sternstunde|meteor|perseiden|nordlicht)\b/.test(t)) {
    return getBlueprintContract('sky_phenomenon', 'observe');
  }
  if (
    /\b(was geht|events?|party|heute abend)\b/.test(t) &&
    !/\b(sonnenfinsternis|mondfinsternis|sternschnuppe|sternstunde|meteor|perseiden|nordlicht|polarlicht|aurora|vollmond|supermond|komet|eclipse)\b/.test(
      t,
    )
  ) {
    return getBlueprintContract('live_events', 'today');
  }
  // Miss → plain chat (null), not research_choice
  return null;
}
