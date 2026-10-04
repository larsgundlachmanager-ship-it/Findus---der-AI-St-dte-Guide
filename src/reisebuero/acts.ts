/**
 * Yorros Reisebüro — 5-Akt-Vertrag (Produkt-SSOT).
 * Struktur, kein Wortlaut. Live-Chat ist der Motor in Akt 1 + 4.
 */

import { isBriefComplete } from './completeness';
import type { ReiseLedger, ReisePhase } from './types';

/** Die fünf Akte — UI und Speech folgen diesem Vertrag. */
export type ReiseAct =
  | 'collect' // 1 — Live-Gespräch, Flipchart, Rechercheplan
  | 'confirm' // 2 — Zusammenfassung, User bestätigt / ändert
  | 'research' // 3 — Live-Recherche-Theater, Preise vergleichen
  | 'present' // 4 — Optionen + Detail + Refine per Live-Chat
  | 'commit'; // 5 — Timeline übernehmen

/**
 * Nach Refine/Patch: bei fertigem Brief → Akt 2 (Recap), sonst Akt 1.
 * Kein Pflicht-Bounce von Akt 2 zurück auf Akt 1 bei additiven Edits.
 */
export function phaseAfterBumpRefine(trip: {
  searchReadySticky?: boolean;
  ledger: ReiseLedger;
}): ReisePhase {
  return trip.searchReadySticky || isBriefComplete(trip.ledger) ? 'recap' : 'briefing';
}

export const REISE_ACT_ORDER: ReiseAct[] = [
  'collect',
  'confirm',
  'research',
  'present',
  'commit',
];

export const REISE_ACT_LABEL: Record<ReiseAct, string> = {
  collect: 'Planen',
  confirm: 'Akt 2',
  research: 'Recherche',
  present: 'Optionen',
  commit: 'Timeline',
};

/** Interne Phasen → Akt (verify/detail gehören zu present). */
export function phaseToAct(phase: ReisePhase): ReiseAct {
  if (phase === 'briefing') return 'collect';
  if (phase === 'recap') return 'confirm';
  if (phase === 'research') return 'research';
  if (phase === 'results' || phase === 'detail' || phase === 'verify') return 'present';
  return 'collect';
}

export function actToPrimaryPhase(act: ReiseAct): ReisePhase {
  if (act === 'collect') return 'briefing';
  if (act === 'confirm') return 'recap';
  if (act === 'research') return 'research';
  if (act === 'present') return 'results';
  return 'results'; // commit bleibt in present/detail bis Timeline-Push
}

/**
 * Produkt-Blaupause — was jeder Akt tun muss.
 * Keine Dialog-Skripte; Wortlaut immer frei aus Kontext.
 */
export const REISEBUERO_FIVE_ACT_DOCTRINE = `YORROS REISEBÜRO — FÜNF AKTE (SSOT, Wortlaut frei):

AKT 1 COLLECT — der Brief für den perfekten Plan:
- Ziel: User wird gehört, alle Wünsche raus, Yorro hat danach genug für ein stimmiges Gesamtpaket. Noch keine Suche.
- Härte/Ranking: Erstspur/must · Geilste/wish · Optional/nice · Notfall/fallback-Spur · No-Go. AI ohne Hotel gibt's nicht — AI-Erstspur, Apartment parallel als Notfall wenn AI leer/teuer.
- Katalog Master + Branches (Party/Spa/Cruise/Event/Turnier/Familie/Stadt/Mode-Tiefe) nur wenn relevant; Tiefe statt Einzeiler (Musikrichtung, Seetage, Kids-Club vs. zusammen, Museen…).
- Bahncard nur wenn Bahn/FlixTrain wirklich im Plan. Alter einzeln. Max-Zeiten pro Modus getrennt (Auto/Bahn/Flug/Umstieg). FlixTrain≠FlixBus merken.
- Flipchart-Sticker: **nur LLM-Text** — Code führt aus, schreibt keine Label-Sätze. Offene Frage als klarer Fragesatz (❓).
- Frühere Trips: schon Geklärtes abhaken. Inventar (schon gebucht / Lücke) scoped fragen.
- Fertig-Signal „Suche starten?“ erst ab hartem Brief (grün).

AKT 2 CONFIRM — eine menschliche Zusammenfassung, letzte Chance:
- Flüssig die wichtigsten Härten + Erst-/Zweit-Spur + Inventar — kein Sticker-Ablesen. Close: passt / fehlt noch?
- Additive Patches bleiben Akt 2. Kein Bounce zu Akt 1 außer explizit von vorne.

AKT 3 RESEARCH — offen → eng (**Theater** = Warte-Checkliste, kein Tagesplan):
- Stages: Brief-Plan → Optionenraum → Zugang-Filter → Shortlist → Stay-Spuren → Flug-Matrix (Prefer-Fenster scorren) → Compare → Zubringer → **2–4 Pakete** (offen immer 4, spez. mind. 2).
- Zeitwertigkeit: Prefer-Tag > Soft; gleicher Preis + Prefer gewinnt; früher Rück vs. mehr Zeit am Ziel als Trade-off erklären / zweite Option.
- Multi-City Hop: Stops + Züge dazwischen step-by-step.
- Lead dynamisch. Optional droppen wenn zu teuer/leer.

AKT 4 PRESENT — Magazin + **Tages-Timetable** + Karte:
- 2–4 Optionen (Städte, Lodging-Spuren oder Flugfenster). Pro Tag: Datum, Wochentag, Uhrzeit, Blocks, Links.
- Karte: Stay, Hub, Tages-Spots mit Nummern. Mic-Feinschliff. Buy-in = Wohnen+Fortbewegung.

AKT 5 COMMIT:
- Timetable → Yorro-Timeline mit allen Partner-Links (Flug, Stay, Tickets, Events).

LIVE-CHAT (Akt 1 + 4): Katalog + Verstehen + Ranking; Mic geduldig; Prefs aus Shelf wiederverwenden.`;
