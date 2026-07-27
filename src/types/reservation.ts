/**
 * 3-Tier Tischreservierung: Partner-API → E-Mail → KI-Anruf.
 */

export type ReservationTier = 'API' | 'EMAIL' | 'AI_CALL' | 'DIAL_ONLY';

export type ReservationProvider =
  | 'opentable'
  | 'quandoo'
  | 'resmio'
  | 'dish'
  | 'none';

/** Routing-Ziele pro Restaurant/POI. */
export type PoiReservationInfo = {
  poiId?: number;
  spotKey?: string | null;
  name: string;
  openTableId?: string;
  quandooId?: string;
  resmioId?: string;
  reservationEmail?: string;
  phoneNumber?: string;
  bookingUrl?: string;
  provider: ReservationProvider;
  supportsDirectApi: boolean;
};

export type ReservationRequestDetails = {
  partySize: number;
  /** ISO oder „heute 19:00“ */
  timeLabel: string;
  dateIso?: string;
  notes?: string;
};

export type ReservationExecuteResult = {
  ok: boolean;
  tier: ReservationTier;
  /** User-freundliche Kurzmeldung für TTS/Chat */
  message: string;
  /** Optional: Webview/Browser öffnen */
  openUrl?: string;
  /** true = noch Backend/Keys nötig — keine Fake-Bestätigung */
  pendingSetup?: boolean;
};
