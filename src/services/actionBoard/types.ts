/**
 * ActionBoard — SSOT Types.
 * Buttons laufen getrennt vom Speech-Prompt (Fastline + Deep Recharge).
 */

import type { QuickAction, QuickActionType } from '../../types/concierge';

/** Opportunity-Intents aus dem Scan (Hilfe zuerst). */
export type ActionOpportunityKind =
  | 'route'
  | 'maps'
  | 'menu_food'
  | 'menu_drinks'
  | 'reserve_table'
  | 'tickets'
  | 'tour_guide'
  | 'hotel_book'
  | 'esim'
  | 'wifi_place'
  | 'expand'
  | 'weather'
  | 'transit'
  | 'taxi'
  | 'parking'
  | 'luggage'
  | 'phone'
  | 'website'
  | 'shopping';

export type ActionEntity = {
  name: string;
  rank: 1 | 2;
  lat?: number;
  lng?: number;
  placeId?: string | null;
  websiteUrl?: string | null;
  /** Live-Buchungs-Deeplink (Stay22/Expedia/…) — vor generischer Suche */
  bookUrl?: string | null;
  checkin?: string;
  checkout?: string;
  adults?: number;
  /** hotel | restaurant | bar | museum | attraction | shop | other */
  category?: string | null;
  poiId?: number | string | null;
};

export type ActionOpportunity = {
  kind: ActionOpportunityKind;
  entity?: ActionEntity;
  /** 0–100 — unter Schwelle → kein Button */
  score: number;
  reason: string;
};

export type DeepJobKind =
  | 'menu_food'
  | 'menu_drinks'
  | 'tickets'
  | 'reserve_table'
  | 'hotel_prefill'
  | 'website_deep';

export type DeepJob = {
  id: string;
  kind: DeepJobKind;
  entity: ActionEntity;
  websiteUrl?: string | null;
  /** ms — Speisekarte 45s, komplex 80s */
  timeoutMs: number;
  /** Pending-Chip-Label während Suche */
  pendingLabel: string;
  /** Ersetzt diesen actionBoardId-Slot wenn fertig */
  slotId: string;
};

export type ActionBoardInput = {
  speechText: string;
  userText?: string;
  /** Seed aus Agents / Modul-1 — werden gefiltert + relabelt */
  seedActions?: QuickAction[];
  entities?: ActionEntity[];
  /** Modul-1 POI-Kontext */
  module1?: {
    poiId: number | string;
    name: string;
    lat: number;
    lng: number;
    activity?: boolean;
    hotel?: boolean;
    category?: string | null;
    websiteUrl?: string | null;
  };
  /** Card-ID für Deep-Patch */
  cardId?: string;
  maxActions?: number;
};

export type ActionBoardResult = {
  actions: QuickAction[];
  deepJobs: DeepJob[];
  opportunities: ActionOpportunity[];
};

export type ActionBoardMeta = {
  actionBoardId?: string;
  pending?: boolean;
  pendingKind?: DeepJobKind | ActionOpportunityKind;
  entityName?: string;
  entityRank?: 1 | 2;
  expandKind?: 'poi_history' | 'activity' | 'knowledge' | 'offer';
  /** Affiliate-Kennzeichnung * / Anzeige */
  affiliateMarked?: boolean;
};

/** System-Actions die ActionBoard nie verwirft. */
export const PRESERVED_ACTION_TYPES: ReadonlySet<QuickActionType> = new Set([
  'SET_WAKE_ALARM',
  'SET_TIMER',
  'SET_DEPARTURE_REMINDER',
  'COMPLETE_SHOPPING_TASK',
  'SNOOZE_SHOPPING_TASK',
  'CONFIRM_API_RESERVATION',
  'SEND_RESERVATION_EMAIL',
  'TRIGGER_AI_CALL',
  'DIAL_PHONE',
  'SHOW_STREET_VIEW',
  'BOOK_UBER',
  'BOOK_CAR_RENTAL',
  'BOOK_BOUNCE_LUGGAGE',
  'BOOK_ESIM',
  'OPEN_GYG_WIDGET',
]);

export const MENU_DEEP_TIMEOUT_MS = 45_000;
export const COMPLEX_DEEP_TIMEOUT_MS = 80_000;
export const OPPORTUNITY_SCORE_MIN = 55;
