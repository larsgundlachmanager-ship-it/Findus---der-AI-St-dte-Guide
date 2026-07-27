/**
 * Strukturierte Concierge-Antwort: Ohr (speech) + Display (bullets/actions).
 */

export type QuickActionType =
  | 'START_NAVIGATION'
  | 'DIAL_PHONE'
  | 'OPEN_URL'
  | 'SHOW_MORE'
  | 'CONFIRM_API_RESERVATION'
  | 'SEND_RESERVATION_EMAIL'
  | 'TRIGGER_AI_CALL'
  | 'OPEN_GYG_WIDGET'
  | 'BOOK_UBER'
  | 'BOOK_CAR_RENTAL'
  | 'BOOK_BOUNCE_LUGGAGE'
  | 'BOOK_STAY22';

export type QuickActionPayload = {
  /** Numerische DB-ID oder spot_key */
  targetPoiId?: string | number;
  phoneNumber?: string;
  url?: string;
  textPrompt?: string;
  partySize?: number;
  timeLabel?: string;
  dateIso?: string;
  /** GetYourGuide Tour-Slug oder Pfad */
  gygTourSlug?: string;
  /** GetYourGuide Location-ID */
  gygLocationId?: string;
  /** Uber Dropoff */
  destLat?: number;
  destLng?: number;
  destName?: string;
  /** Stay22 Zielstadt / Adresse */
  destination?: string;
};

export type QuickAction = {
  type: QuickActionType;
  label: string;
  payload: QuickActionPayload;
};

export type GeminiConciergeResponse = {
  speechText: string;
  visualBullets: string[];
  quickActions: QuickAction[];
  /** Optionaler Kartentitel */
  cardTitle?: string;
};

export type ConciergeCardState = GeminiConciergeResponse & {
  id: string;
  createdAtMs: number;
};
