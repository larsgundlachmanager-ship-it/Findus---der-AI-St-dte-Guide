/**
 * Dynamische Research-Lead-Priorität — was jetzt zuerst gesucht wird.
 * Struktur-Blaupause: Kreuzfahrt → Kabinen; Villa → Stay; Ort klar → Zugang;
 * Klima/Fenster/Deals wenn das der Brief-Kern ist. Geld oft zweitrangig.
 * Keine Speech-Scripts.
 */

import type { ReiseLedger, ReiseMode } from '../types';
import {
  looksLikeRouteTourBrief,
  looksLikeStayFirstBrief,
  type ResearchPathKind,
} from './researchPath';

export type ResearchLeadKind =
  | 'cruise'
  | 'ferry'
  | 'stay'
  | 'place'
  | 'event'
  | 'climate'
  | 'date_window'
  | 'access'
  | 'route'
  | 'budget_scan';

export type ResearchLead = {
  kind: ResearchLeadKind;
  /** 0–100 — wie klar der Lead ist. */
  weight: number;
  /** Research-Pfad-Empfehlung. */
  path: ResearchPathKind;
  /** Theater-Label (Struktur, kein Dialog-Script). */
  label: string;
  /** Kurze Reihenfolge-Hints für Akt 3. */
  searchOrder: string[];
  /** Geld/Deal nur soft, wenn Lead nicht Budget ist. */
  moneySecondary: boolean;
  /** Preis-Leistungs-Boden: kein Dump unter Budget. */
  valueFloor: boolean;
};

function blob(ledger: ReiseLedger): string {
  return [
    ledger.destinationHint?.value,
    ledger.corridor?.value,
    ledger.highlightWant?.value,
    ledger.purpose?.value,
    ledger.extraWishes?.value,
    ledger.weatherWant?.value,
    ledger.inspiration?.value,
    ledger.tripShape?.value,
    ...(ledger.intentNotes?.value ?? []),
    ...(ledger.mustActivities?.value ?? []),
    ...(ledger.mustHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function namedPlace(ledger: ReiseLedger): string | null {
  const d = (ledger.destinationHint?.value || '').trim();
  if (d && !/^offen$/i.test(d)) return d;
  const c = (ledger.corridor?.value || '').trim();
  // Corridor als klarer Orts-/Insel-Anker (nicht generisch „Europa“)
  if (c && !/^(europa|europe|offen|mittelmeer|mediterran)$/i.test(c)) return c;
  return null;
}

function isCruise(ledger: ReiseLedger): boolean {
  if (ledger.tripShape?.value === 'cruise') return true;
  if ((ledger.mustHaves?.value ?? []).includes('cruise')) return true;
  return /\bkreuzfahrt|cruise\b/i.test(blob(ledger));
}

function isFerry(ledger: ReiseLedger): boolean {
  if (ledger.tripShape?.value === 'ferry') return true;
  if ((ledger.mustHaves?.value ?? []).includes('ferry')) return true;
  return /\bfähre|faehre|ferry\b/i.test(blob(ledger));
}

function isEvent(ledger: ReiseLedger): boolean {
  if (ledger.discoverIntent?.value === 'event_compare') return true;
  return (ledger.intentNotes?.value ?? []).some((n) => /Event-Hook:/i.test(n));
}

function climateLead(ledger: ReiseLedger): boolean {
  const w = ledger.weatherWant?.value;
  const destOpen = !namedPlace(ledger);
  if (!w) return false;
  // Klima-Lead nur wenn Ort offen oder Klima hart/must
  const hard =
    ledger.weatherWant?.hardness === 'must' ||
    ledger.weatherWant?.hardness === 'hard';
  if (hard) return true;
  if (destOpen && /warm|heiß|heiss|sonne|strand/i.test(String(w))) return true;
  if (destOpen && /\bwarm|sonnig|strandwetter\b/i.test(blob(ledger))) return true;
  return false;
}

function dateWindowLead(ledger: ReiseLedger): boolean {
  if (ledger.dateFlex?.value === 'exact' && ledger.dateStart?.value) return true;
  if (ledger.dateWindow?.value && /festival|turnier|finale|oktoberfest|wiesn/i.test(blob(ledger))) {
    return true;
  }
  return false;
}

function accessDealLead(ledger: ReiseLedger): boolean {
  const destOpen = !namedPlace(ledger);
  if (!destOpen) return false;
  if (ledger.dealHunt?.value) return true;
  if (ledger.budgetVibe?.value === 'cheap') return true;
  if (/\begal\s+wo|irgendwo|günstigste|guenstigste|billigste\s+flug/i.test(blob(ledger))) {
    return true;
  }
  // Ort egal + Flug/Mix offen → Fenster-first
  const mode = ledger.mode?.value as ReiseMode | undefined;
  if (destOpen && (mode === 'fly' || mode === 'mix' || !mode)) return true;
  return false;
}

/**
 * Was ist jetzt am wichtigsten? Ein Lead, der die Such-Reihenfolge steuert.
 */
export function resolveResearchLead(ledger: ReiseLedger): ResearchLead {
  const moneySecondaryDefault = !(
    ledger.dealHunt?.value ||
    ledger.budgetVibe?.value === 'cheap' ||
    !ledger.budgetEur?.value
  );
  // Explizites Budget ohne „billig“ → Value-Floor (gute Mischung, kein Dump).
  const valueFloor =
    Boolean(ledger.budgetEur?.value) &&
    ledger.lodgingQuality?.value !== 'cheap_box' &&
    ledger.budgetVibe?.value !== 'cheap';

  if (isCruise(ledger)) {
    return {
      kind: 'cruise',
      weight: 95,
      path: 'flight_first',
      label: 'Kreuzfahrt zuerst',
      searchOrder: [
        'Kreuzfahrt-Optionen belegen',
        'Günstige/logische Einschiff-Flughäfen',
        'Flug + Vornacht am Hafen',
        'Gesamtpaket',
      ],
      moneySecondary: moneySecondaryDefault,
      valueFloor,
    };
  }
  if (isFerry(ledger)) {
    return {
      kind: 'ferry',
      weight: 90,
      path: 'flight_first',
      label: 'Fähre / Insel-Zugang',
      searchOrder: ['Fähr-Slot', 'Zugang zum Hafen', 'Stay am Ziel', 'Gesamtpaket'],
      moneySecondary: moneySecondaryDefault,
      valueFloor,
    };
  }
  if (looksLikeRouteTourBrief(ledger)) {
    return {
      kind: 'route',
      weight: 88,
      path: 'route_tour',
      label: 'Route / Etappen zuerst',
      searchOrder: ['Route + Etappen', 'Lodging auf der Strecke', 'Zugang', 'Gesamtpaket'],
      moneySecondary: true,
      valueFloor,
    };
  }
  if (looksLikeStayFirstBrief(ledger)) {
    return {
      kind: 'stay',
      weight: 92,
      path: 'stay_first',
      label: 'Unterkunft zuerst',
      searchOrder: [
        'Stay mit Must-Amenities',
        'Wie kommt man hin',
        'Preis im Value-Band',
        'Extras hart',
      ],
      moneySecondary: true,
      valueFloor: true,
    };
  }
  if (isEvent(ledger)) {
    return {
      kind: 'event',
      weight: 90,
      path: 'flight_first',
      label: 'Event-Orte vergleichen',
      searchOrder: ['Venue-Orte fix', 'Flug+Stay parallel', 'Gesamtpaket', 'Extras'],
      moneySecondary: moneySecondaryDefault,
      valueFloor,
    };
  }
  if (namedPlace(ledger)) {
    return {
      kind: 'place',
      weight: 85,
      path: 'flight_first',
      label: 'Ort steht — Zugang + Stay',
      searchOrder: [
        'Ort ist gesetzt',
        'Günstigster sinnvoller Zugang',
        'Stay passend zum Niveau',
        'Extras hart',
      ],
      moneySecondary: moneySecondaryDefault,
      valueFloor,
    };
  }
  if (climateLead(ledger)) {
    return {
      kind: 'climate',
      weight: 80,
      path: 'flight_first',
      label: 'Klima / Wetter zuerst',
      searchOrder: [
        'Regionen mit passendem Klima',
        'Flug-Fenster',
        'Stay',
        'Gesamtpaket',
      ],
      moneySecondary: moneySecondaryDefault,
      valueFloor,
    };
  }
  if (dateWindowLead(ledger)) {
    return {
      kind: 'date_window',
      weight: 78,
      path: 'flight_first',
      label: 'Zeitfenster zuerst',
      searchOrder: ['Datum/Fenster fix', 'Was geht dort', 'Zugang + Stay', 'Gesamtpaket'],
      moneySecondary: moneySecondaryDefault,
      valueFloor,
    };
  }
  if (accessDealLead(ledger)) {
    return {
      kind: 'access',
      weight: 75,
      path: 'flight_first',
      label: 'Günstige Anreise / Fenster',
      searchOrder: [
        'Günstige Flug-/Zug-Fenster',
        'Orte die dazu passen',
        'Stay im Value-Band',
        'Extras',
      ],
      moneySecondary: false,
      valueFloor,
    };
  }
  if (ledger.dealHunt?.value || ledger.budgetVibe?.value === 'cheap') {
    return {
      kind: 'budget_scan',
      weight: 70,
      path: 'flight_first',
      label: 'Deal-Scan',
      searchOrder: ['Schnäppchen-Fenster', 'Stay prüfen', 'Musts', 'Gesamtpaket'],
      moneySecondary: false,
      valueFloor: ledger.lodgingQuality?.value !== 'cheap_box',
    };
  }
  return {
    kind: 'access',
    weight: 55,
    path: 'flight_first',
    label: 'Anreise + Stay balancieren',
    searchOrder: ['Orte zum Brief', 'Zugang', 'Stay', 'Extras'],
    moneySecondary: moneySecondaryDefault,
    valueFloor,
  };
}

/** Research-Pfad aus Lead (SSOT für Funnel). */
export function researchPathFromLead(ledger: ReiseLedger): ResearchPathKind {
  return resolveResearchLead(ledger).path;
}

/**
 * Buy-in vs Budget: süßes Band belohnen, Dump unter Budget abstrafen.
 * Ziel: so günstig wie sinnvoll — nicht unnötig billig / Bruchbude.
 */
export function budgetValueScore(opts: {
  buyInEur: number | null;
  budgetEur: number;
  /** Explizit billig / Hostel ok. */
  allowCheapBox?: boolean;
  /** Stay wirkt dünn/dump (kein Name, sehr niedriger Preis). */
  stayLooksDump?: boolean;
}): number {
  const { buyInEur, budgetEur } = opts;
  if (!(budgetEur > 0)) return 12;
  if (buyInEur == null || !(buyInEur > 0)) return 6;
  const ratio = buyInEur / budgetEur;
  // Über Budget klar → schlecht
  if (ratio > 1.2) return 2;
  if (ratio > 1.05) return 7;
  // Sweet spot: ~70–100 % vom Budget
  if (ratio >= 0.7 && ratio <= 1.0) return 15;
  if (ratio >= 0.55 && ratio < 0.7) return 13;
  // Deutlich unter Budget
  if (ratio < 0.45) {
    if (opts.allowCheapBox) return 12;
    if (opts.stayLooksDump) return 4;
    return 8; // verdächtig günstig ohne Dump-Beleg
  }
  if (ratio < 0.55 && opts.stayLooksDump && !opts.allowCheapBox) return 5;
  return 12;
}

export function stayLooksDump(opt: {
  stayName?: string | null;
  stayPriceEur?: number | null;
  buyInEur?: number | null;
  budgetEur?: number | null;
}): boolean {
  const name = (opt.stayName || '').toLowerCase();
  if (!name) return true;
  if (/hostel|dorm|shared|bruch|container|kapsel/i.test(name)) return true;
  if (
    opt.budgetEur != null &&
    opt.budgetEur > 0 &&
    opt.stayPriceEur != null &&
    opt.stayPriceEur > 0 &&
    opt.stayPriceEur < opt.budgetEur * 0.08
  ) {
    return true;
  }
  return false;
}
