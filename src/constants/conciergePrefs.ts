/**
 * Concierge-Präferenzen — First-Class Felder für Personalisierung.
 */

import type {
  AnswerStyle,
  BudgetCategory,
  EnergyLevel,
  MobilityMode,
  MustHaveStyleId,
  TouristVsInsider,
  TravelParty,
  UserProfile,
} from '../types/userProfile';
import { BUDGET_AMOUNT_HINT } from './budgetHints';

export type PrefOption<T extends string> = {
  id: T;
  label: string;
  hint: string;
};

export const TRAVEL_PARTY_OPTIONS: PrefOption<TravelParty>[] = [
  { id: 'solo', label: 'Allein', hint: 'Solo unterwegs' },
  { id: 'couple', label: 'Zu zweit', hint: 'Paar / Partner' },
  { id: 'date', label: 'Date', hint: 'Romantisch zu zweit' },
  { id: 'family', label: 'Familie', hint: 'Mit Kindern' },
  { id: 'friends', label: 'Freundesgruppe', hint: 'Kleine Gruppe' },
];

export const MOBILITY_OPTIONS: PrefOption<MobilityMode>[] = [
  { id: 'foot', label: 'Zu Fuß', hint: 'Stadt zu Fuß entdecken' },
  { id: 'bike', label: 'Zweirad', hint: 'Fahrrad / E-Scooter' },
  { id: 'public_transit', label: 'Öffis', hint: 'Bahn, Bus, Tram' },
  { id: 'car', label: 'Auto', hint: 'Mietwagen / eigenes Auto' },
];

export const ENERGY_OPTIONS: PrefOption<EnergyLevel>[] = [
  { id: 'low', label: 'Ruhig', hint: 'Viele Pausen, wenig Hetze' },
  { id: 'medium', label: 'Ausgewogen', hint: 'Klassisches Tempo' },
  { id: 'high', label: 'Aktiv', hint: 'Viel sehen, wenig Leerlauf' },
];

export const BUDGET_OPTIONS: PrefOption<BudgetCategory>[] = [
  {
    id: 'sparsam',
    label: 'Sparsam',
    hint: `${BUDGET_AMOUNT_HINT.sparsam} — Imbiss, Eigeninitiative`,
  },
  {
    id: 'mittel',
    label: 'Mittel',
    hint: `${BUDGET_AMOUNT_HINT.mittel} — Café & normale Restaurants`,
  },
  {
    id: 'komfort',
    label: 'Komfort',
    hint: `${BUDGET_AMOUNT_HINT.komfort} — gern auch feiner`,
  },
];

/** @deprecated Single-select Mix — Prefer MUST_HAVE_STYLE_OPTIONS (Mehrfach). */
export const TOURIST_MODE_OPTIONS: PrefOption<TouristVsInsider>[] = [
  { id: 'tourist', label: 'Typisch Touri', hint: 'Klassiker & Highlights' },
  { id: 'mix', label: 'Mix', hint: 'Beides' },
  { id: 'insider', label: 'Weg vom Trubel', hint: 'Lokal & abseits' },
  {
    id: 'local_gems',
    label: 'Einheimisch versteckt',
    hint: 'Geheimtipps wie Locals',
  },
];

/** Must-haves: Mehrfachauswahl — Findus mixt die gewählten Stile. */
export const MUST_HAVE_STYLE_OPTIONS: PrefOption<MustHaveStyleId>[] = [
  { id: 'tourist', label: 'Typisch Touri', hint: 'Klassiker & Highlights' },
  { id: 'insider', label: 'Weg vom Trubel', hint: 'Lokal & abseits' },
  {
    id: 'local_gems',
    label: 'Einheimisch versteckt',
    hint: 'Geheimtipps wie Locals',
  },
  { id: 'nightlife', label: 'Nachtleben', hint: 'Bars, Clubs, Abende' },
];

/** Sync Must-have-Chips → touristMode + experiencePrefs. */
export function patchFromMustHaveStyles(
  tags: MustHaveStyleId[],
  draft: UserProfile,
): Partial<UserProfile> {
  const uniq = [...new Set(tags)];
  const placeTags = uniq.filter((t) => t !== 'nightlife');
  let touristMode: TouristVsInsider = 'mix';
  if (placeTags.length === 1) {
    touristMode = placeTags[0] as TouristVsInsider;
  } else if (placeTags.length > 1) {
    touristMode = 'mix';
  } else if (uniq.includes('nightlife')) {
    touristMode = 'mix';
  }

  return {
    mustHaveStyles: uniq,
    touristMode: uniq.length ? touristMode : draft.touristMode ?? null,
    experiencePrefs: {
      ...draft.experiencePrefs,
      typisch_touri: uniq.includes('tourist') ? 'yes' : 'neutral',
      weg_vom_trubel: uniq.includes('insider') ? 'yes' : 'neutral',
      geheimtipps: uniq.includes('local_gems') ? 'yes' : 'neutral',
      nachtleben: uniq.includes('nightlife') ? 'yes' : 'neutral',
    },
  };
}

export const ANSWER_STYLE_OPTIONS: PrefOption<AnswerStyle>[] = [
  { id: 'short', label: 'Kurz', hint: 'Knapp und auf den Punkt' },
  { id: 'detailed', label: 'Ausführlich', hint: 'Mehr Kontext & Story' },
];

export const DIETARY_OPTIONS: PrefOption<string>[] = [
  { id: 'vegetarisch', label: 'Vegetarisch', hint: '' },
  { id: 'vegan', label: 'Vegan', hint: '' },
  { id: 'glutenfrei', label: 'Glutenfrei', hint: '' },
  { id: 'halal', label: 'Halal', hint: '' },
  { id: 'koscher', label: 'Koscher', hint: '' },
  { id: 'kein_schwein', label: 'Kein Schwein', hint: '' },
  /** Positiv: mag Fisch / Fisch-Tipps. Vermeidung nur über Allergie „Fisch“. */
  { id: 'fisch', label: 'Fisch', hint: '' },
  { id: 'kein_fleisch', label: 'Kein Fleisch', hint: '' },
];

/** Wie reist du? (Mehrfach) — Einstellungen / Rahmen. */
export type TravelModeId =
  | 'auto'
  | 'bahn'
  | 'flieger'
  | 'fahrrad'
  | 'wandern'
  | 'reisebus';

export const TRAVEL_MODE_OPTIONS: PrefOption<TravelModeId>[] = [
  { id: 'auto', label: 'Auto', hint: '' },
  { id: 'bahn', label: 'Bahn', hint: '' },
  { id: 'flieger', label: 'Flieger', hint: '' },
  { id: 'fahrrad', label: 'Fahrrad', hint: '' },
  { id: 'wandern', label: 'Wandern', hint: '' },
  { id: 'reisebus', label: 'Reisebus', hint: '' },
];

/** Taxi-Prefs (Ja / nur notfalls / Nein). */
export const TAXI_PREF_OPTIONS: {
  id: NonNullable<import('../types/userProfile').MobilityPrefs['taxi']>;
  label: string;
  car: NonNullable<import('../types/userProfile').MobilityPrefs['car']>;
}[] = [
  { id: 'love', label: 'Ja', car: 'taxi_love' },
  { id: 'if_saves_time', label: 'Nur notfalls', car: 'taxi_saves_time' },
  { id: 'no', label: 'Nein', car: 'none' },
];

/** Allergien & Unverträglichkeiten (Chips + optional Freitext). Ohne „Keine“ — das steuert das Ja/Nein-Klappfeld. */
export const ALLERGY_INTOLERANCE_OPTIONS: PrefOption<string>[] = [
  { id: 'nuesse', label: 'Nüsse', hint: '' },
  { id: 'erdnuesse', label: 'Erdnüsse', hint: '' },
  { id: 'laktose', label: 'Laktose', hint: '' },
  { id: 'milchprotein', label: 'Milchprotein', hint: '' },
  { id: 'gluten_zoeliakie', label: 'Gluten / Zöliakie', hint: '' },
  { id: 'ei', label: 'Ei', hint: '' },
  { id: 'soja', label: 'Soja', hint: '' },
  { id: 'fisch', label: 'Fisch', hint: '' },
  { id: 'schalentiere', label: 'Schalentiere', hint: '' },
  { id: 'sesam', label: 'Sesam', hint: '' },
  { id: 'sellerie', label: 'Sellerie', hint: '' },
  { id: 'senf', label: 'Senf', hint: '' },
  { id: 'sulfite', label: 'Sulfite', hint: '' },
  { id: 'histamin', label: 'Histamin', hint: '' },
  { id: 'fructose', label: 'Fructose', hint: '' },
  { id: 'lupinen', label: 'Lupinen', hint: '' },
  { id: 'weichtiere', label: 'Weichtiere', hint: '' },
  { id: 'schwein', label: 'Schwein / Gelatine', hint: '' },
  { id: 'alkohol', label: 'Alkohol', hint: '' },
  { id: 'pollen', label: 'Pollen', hint: '' },
  { id: 'hausstaub', label: 'Hausstaub', hint: '' },
];

/** Barriere / besondere Bedürfnisse (Mehrfach nach Ja). */
export const ACCESSIBILITY_NEED_OPTIONS: PrefOption<string>[] = [
  { id: 'rollstuhl', label: 'Rollstuhl', hint: 'Stufenfreie Wege' },
  { id: 'sehen', label: 'Sehen', hint: 'Sehbehindert / mehr Audio' },
  { id: 'hoeren', label: 'Hören', hint: 'Hörbehindert / klarer Text' },
  { id: 'kinderwagen', label: 'Kinderwagen', hint: 'Rampen & Aufzüge' },
  { id: 'gehbehindert', label: 'Gehbehindert', hint: 'Kürzere Distanzen' },
  { id: 'ausdauer', label: 'Wenig Ausdauer', hint: 'Mehr Pausen' },
  { id: 'kruecke', label: 'Krücke / Gehhilfe', hint: 'Sitzplätze, Aufzüge' },
  { id: 'schwanger', label: 'Schwanger', hint: 'Pausen & Toiletten' },
  { id: 'neuro', label: 'Neurodivergent', hint: 'Weniger Reiz-Overload' },
  { id: 'lautstaerke', label: 'Lärmempfindlich', hint: 'Laute Hotspots meiden' },
  { id: 'hunde', label: 'Hund dabei', hint: 'Hundefreundlich' },
];
