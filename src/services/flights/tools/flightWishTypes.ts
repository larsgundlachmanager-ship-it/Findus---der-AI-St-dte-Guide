/**
 * Thin flight-wish tool types — used by wishPitch executor (P4 harden).
 */

export type FlightWishCandidate = {
  id: string;
  outboundDateKey: string;
  returnDateKey?: string | null;
  originIata: string;
  destIata: string;
  priceEur?: number | null;
  departAt?: string | null;
  returnAt?: string | null;
  transfers?: number | null;
  durationMin?: number | null;
  carrier?: string | null;
  source: 'calendar' | 'synthetic';
};

export type FlightWishToolResult = {
  candidates: FlightWishCandidate[];
  ranked: FlightWishCandidate[];
  provisionActions: import('../../../types/concierge').QuickAction[];
  speech: string;
  bullets: string[];
  bestOutboundDateKey: string | null;
  bestReturnDateKey: string | null;
};
