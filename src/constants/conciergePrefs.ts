/**
 * Concierge-Präferenzen — First-Class Felder für Personalisierung.
 */

import type {
  AnswerStyle,
  BudgetCategory,
  EnergyLevel,
  MobilityMode,
  TouristVsInsider,
  TravelParty,
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
  { id: 'public_transit', label: 'ÖPNV', hint: 'Bahn, Bus, Tram' },
  { id: 'bike', label: 'Fahrrad', hint: 'Rad / Leihrad' },
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
    hint: BUDGET_AMOUNT_HINT.sparsam,
  },
  {
    id: 'mittel',
    label: 'Mittel',
    hint: BUDGET_AMOUNT_HINT.mittel,
  },
  {
    id: 'komfort',
    label: 'Komfort',
    hint: BUDGET_AMOUNT_HINT.komfort,
  },
];

export const TOURIST_MODE_OPTIONS: PrefOption<TouristVsInsider>[] = [
  { id: 'tourist', label: 'Typisch Touri', hint: 'Klassiker & Highlights' },
  { id: 'mix', label: 'Mix', hint: 'Beides' },
  { id: 'insider', label: 'Weg vom Trubel', hint: 'Lokal & abseits' },
];

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
  { id: 'kein_fisch', label: 'Kein Fisch', hint: '' },
  { id: 'kein_fleisch', label: 'Kein Fleisch', hint: '' },
];
