/**
 * Modul 5 — Mobility SSOT (Fuß / Rad / ÖPNV / Taxi).
 *
 * Luftlinie (Karten-Tap / Nav-Start):
 * - ≥ 1,4 km Fuß: ÖPNV als Option
 * - ≥ 3 km Fuß: ÖPNV direkt, wenn schneller — niemand läuft 3 km.
 *   Taxi nur extra, wenn Pref ja; Pref nein → ÖPNV ohne Auswahl.
 * - Rad: bis ~6 km ok; ≥ 10 km Option, ≥ 15 km direkt — nur wenn ÖPNV schneller.
 */

import type { FuturePlanTransport } from '../timeline/futurePlanState';
import type { TransportMode } from './planningTypes';

export const PLAN_SOFT_MODE_MAX_MIN = 20;
export const PLAN_FORCE_TRANSIT_WALK_MIN = 30;
export const PLAN_TRANSIT_MIN_SAVINGS_MIN = 5;
/** Ab hier Luftlinie: ÖPNV als Option (nicht erst 20-Min-Fuß). */
export const PLAN_AIR_OFFER_TRANSIT_M = 1_400;
/** Ab hier zu Fuß: ÖPNV direkt, wenn schneller — niemand läuft 3 km. */
export const PLAN_AIR_FORCE_TRANSIT_M = 3_000;
/** Rad bleibt bis hier Luftlinie alltagstauglich. */
export const PLAN_AIR_BIKE_OK_M = 6_000;
/** Rad: ÖPNV anbieten, wenn schneller. */
export const PLAN_AIR_BIKE_OFFER_TRANSIT_M = 10_000;
/** Rad: ÖPNV direkt, wenn schneller. */
export const PLAN_AIR_BIKE_FORCE_TRANSIT_M = 15_000;
/** Alias: Force-Schwelle (früher 7 km). */
export const PLAN_AIRLINE_LONG_WALK_M = PLAN_AIR_FORCE_TRANSIT_M;

export type TaxiPref = 'love' | 'if_saves_time' | 'no' | null;

export type AirMobilityDecision =
  | { kind: 'walk' }
  | { kind: 'bike' }
  | { kind: 'ask_transit'; includeTaxi: boolean }
  | { kind: 'auto_transit'; includeTaxi: boolean };

function transitBeats(transitMin: number | null, otherMin: number): boolean {
  if (transitMin == null || !Number.isFinite(transitMin) || transitMin <= 0) {
    return false;
  }
  return otherMin - transitMin >= PLAN_TRANSIT_MIN_SAVINGS_MIN;
}

function includeTaxi(pref: TaxiPref | undefined): boolean {
  return pref === 'love' || pref === 'if_saves_time';
}

/** Settings-Taxi plus Legacy-car-Spiegel. */
export function readTaxiPref(profile?: {
  mobilityPrefs?: { taxi?: TaxiPref; car?: string | null };
} | null): TaxiPref {
  const taxi = profile?.mobilityPrefs?.taxi;
  if (taxi === 'love' || taxi === 'if_saves_time' || taxi === 'no') return taxi;
  const car = profile?.mobilityPrefs?.car;
  if (car === 'taxi_love') return 'love';
  if (car === 'taxi_saves_time') return 'if_saves_time';
  if (car === 'none') return 'no';
  return null;
}

/** Luftlinie groß genug, dass wir ÖPNV prüfen (nicht still zu Fuß starten). */
export function airNeedsTransitLookahead(opts: {
  airMeters: number;
  preferBike?: boolean;
}): boolean {
  const m = Math.max(0, opts.airMeters);
  if (opts.preferBike) return m >= PLAN_AIR_BIKE_OFFER_TRANSIT_M;
  return m >= PLAN_AIR_OFFER_TRANSIT_M;
}

/**
 * Karten-Tap / Nav-Start: Luftlinie, nicht erst 4 h OSRM.
 * 1,4 km → Option. 3 km → ÖPNV wenn schneller (Taxi extra, wenn Pref ja).
 * Rad: bis ~6 km ok, ab 10 km Option, ab 15 km direkt — jeweils nur wenn ÖPNV schneller.
 */
export function decideAirMobility(opts: {
  airMeters: number;
  walkMin: number;
  transitMin?: number | null;
  bikeMin?: number | null;
  preferBike?: boolean;
  taxiPref?: TaxiPref;
}): AirMobilityDecision {
  const air = Math.max(0, opts.airMeters);
  const walk = Math.max(1, Math.round(opts.walkMin));
  const bike = Math.max(1, Math.round(opts.bikeMin ?? walk * 0.4));
  const transit = opts.transitMin ?? null;
  const taxi = includeTaxi(opts.taxiPref);

  if (opts.preferBike) {
    if (air < PLAN_AIR_BIKE_OFFER_TRANSIT_M) return { kind: 'bike' };
    if (!transitBeats(transit, bike)) return { kind: 'bike' };
    if (air >= PLAN_AIR_BIKE_FORCE_TRANSIT_M) {
      return { kind: 'auto_transit', includeTaxi: taxi };
    }
    return { kind: 'ask_transit', includeTaxi: taxi };
  }

  if (air < PLAN_AIR_OFFER_TRANSIT_M) return { kind: 'walk' };
  if (air < PLAN_AIR_FORCE_TRANSIT_M) {
    return { kind: 'ask_transit', includeTaxi: taxi };
  }
  // ≥ 3 km: zu Fuß raus, wenn ÖPNV schneller (oder Zeit noch unbekannt → direkt).
  if (transit != null && !transitBeats(transit, walk)) {
    return { kind: 'ask_transit', includeTaxi: taxi };
  }
  return {
    kind: 'auto_transit',
    includeTaxi: opts.taxiPref === 'no' ? false : taxi,
  };
}

/**
 * Karten-Tap: schon die Luftlinie sagt „ÖPNV prüfen“.
 */
export function shouldAskTransitFromAirline(opts: {
  airMeters: number;
  walkMPerMin?: number;
  preferBike?: boolean;
}): boolean {
  return airNeedsTransitLookahead({
    airMeters: opts.airMeters,
    preferBike: opts.preferBike,
  });
}

export type MobilityDurations = {
  walkMin: number;
  bikeMin: number;
  transitMin: number;
  taxiMin?: number;
};

export type MobilityPickInput = MobilityDurations & {
  /** User hat Fahrrad-Modus aktiv. */
  preferBike?: boolean;
  /** User hat explizit Taxi/Auto gewählt. */
  forceTaxiOrCar?: boolean;
  preferred?: FuturePlanTransport | null;
};

/**
 * Wählt Transport für eine Leg zwischen zwei Stops.
 */
export function pickPlanMobilityMode(
  input: MobilityPickInput,
): FuturePlanTransport {
  const walk = Math.max(1, Math.round(input.walkMin));
  const bike = Math.max(1, Math.round(input.bikeMin || walk * 0.4));
  const transit = Math.max(1, Math.round(input.transitMin));
  const preferred = input.preferred ?? null;

  if (input.forceTaxiOrCar || preferred === 'taxi' || preferred === 'car') {
    return preferred === 'car' ? 'car' : 'taxi';
  }
  if (preferred === 'flight') return 'flight';

  // Explizit Transit
  if (preferred === 'transit') return 'transit';

  // Rad-Modus: bis 20 Min Rad ok
  if (input.preferBike || preferred === 'bike') {
    if (bike <= PLAN_SOFT_MODE_MAX_MIN) return 'bike';
    // Länger: ÖPNV nur wenn spürbar schneller
    if (
      walk >= PLAN_FORCE_TRANSIT_WALK_MIN ||
      walk - transit >= PLAN_TRANSIT_MIN_SAVINGS_MIN
    ) {
      return 'transit';
    }
    return 'bike';
  }

  // Fuß ≤ 20 → Fuß
  if (walk <= PLAN_SOFT_MODE_MAX_MIN) return 'walk';

  // Ab 30 Min Fuß → immer ÖPNV
  if (walk >= PLAN_FORCE_TRANSIT_WALK_MIN) return 'transit';

  // 20–30 Min: ÖPNV nur wenn ≥5 Min schneller
  if (walk - transit >= PLAN_TRANSIT_MIN_SAVINGS_MIN) return 'transit';

  return 'walk';
}

/** Mapping auf planMobilityEngine TransportMode. */
export function toEngineTransportMode(
  t: FuturePlanTransport,
): TransportMode {
  switch (t) {
    case 'bike':
      return 'BICYCLE';
    case 'transit':
      return 'TRANSIT';
    case 'taxi':
    case 'car':
      return 'TAXI';
    default:
      return 'WALKING';
  }
}

/**
 * Vorschlag wenn's knapp wird (Speech-Hinweis, kein Auto-Zwang).
 */
export function shouldSuggestFasterRide(opts: {
  walkMin: number;
  transitMin: number;
  slackMinUntilNext?: number | null;
}): boolean {
  const slack = opts.slackMinUntilNext;
  if (slack == null || !Number.isFinite(slack)) return false;
  const need = Math.min(opts.walkMin, opts.transitMin) + 10;
  return slack < need && opts.walkMin > PLAN_SOFT_MODE_MAX_MIN;
}
