/**
 * Modul 5 — Puffer & adaptive Tempo (paceProfile).
 * Defaults: Gehen 3,5 km/h · Rad 13 km/h. Nach 1-km-Segmenten: Mittel letzter 5.
 */

import type { BufferKind } from '../planning/timeBufferPolicy';
import { assessTimeBuffer } from '../planning/timeBufferPolicy';
import { defaultDwellMinForLabel } from '../planning/dwellTiming';
import {
  getPlanBikeMPerMin,
  getPlanWalkMPerMin,
  getPlanWalkKmh,
  getPlanBikeKmh,
} from './paceProfile';

/** @deprecated use getPlanWalkMPerMin() — kept for call-site clarity */
export const PLAN_WALK_M_PER_MIN = (3.5 * 1000) / 60;
export const PLAN_BIKE_M_PER_MIN = (13 * 1000) / 60;
export const PLAN_CAR_M_PER_MIN = 500;

/** Aufrunden auf nächste 5 Min (mehr Zeit = sicherer). */
export function roundUpTo5Min(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 5;
  return Math.ceil(minutes / 5) * 5;
}

/** Ankunftszeit abrunden auf :00/:05/:10… (früher da). */
export function floorMsTo5Min(ms: number): number {
  const d = new Date(ms);
  const m = d.getMinutes();
  const floored = Math.floor(m / 5) * 5;
  d.setMinutes(floored, 0, 0);
  return d.getTime();
}

/**
 * Soft-Planzeiten auf 5-Min-Raster.
 * Harte Inputs (Zug/Flug 13:07) nicht anfassen — Caller entscheidet.
 */
export function snapMsTo5Min(
  ms: number,
  mode: 'nearest' | 'floor' | 'ceil' = 'nearest',
): number {
  const d = new Date(ms);
  const totalMin = d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60_000;
  let snapped: number;
  if (mode === 'floor') snapped = Math.floor(totalMin / 5) * 5;
  else if (mode === 'ceil') snapped = Math.ceil(totalMin / 5) * 5;
  else snapped = Math.round(totalMin / 5) * 5;
  if (snapped >= 60) {
    d.setHours(d.getHours() + 1);
    snapped = 0;
  }
  if (snapped < 0) {
    d.setHours(d.getHours() - 1);
    snapped = 55;
  }
  d.setMinutes(snapped, 0, 0);
  return d.getTime();
}

export function walkMinutesPlan(distanceM: number): number {
  return roundUpTo5Min(Math.max(5, distanceM / getPlanWalkMPerMin()));
}

export function bikeMinutesPlan(distanceM: number): number {
  return roundUpTo5Min(Math.max(5, distanceM / getPlanBikeMPerMin()));
}

export function carMinutesPlan(distanceM: number): number {
  return roundUpTo5Min(Math.max(5, (distanceM / PLAN_CAR_M_PER_MIN) * 1.15));
}

export function describeCurrentPace(): string {
  return `Fuß ${getPlanWalkKmh().toFixed(1)} km/h · Rad ${getPlanBikeKmh().toFixed(1)} km/h`;
}

/**
 * Puffer vor hartem Event (Bahnhof/Flug/Reservation).
 * Ergebnis bereits auf 5 Min gerundet.
 */
export function bufferMinutesForKind(
  kind: BufferKind | 'train_hbf' | 'train_small' | 'checkout' | 'restaurant',
  text?: string,
): number {
  if (kind === 'train_hbf') return 10;
  if (kind === 'train_small') return 5;
  if (kind === 'checkout') return 10;
  if (kind === 'restaurant') return 5;

  const mapped: BufferKind =
    kind === 'flight_island' ||
    kind === 'flight_commercial' ||
    kind === 'hotel_checkout' ||
    kind === 'reservation' ||
    kind === 'sport' ||
    kind === 'appointment' ||
    kind === 'meetup' ||
    kind === 'generic'
      ? kind
      : 'generic';

  const a = assessTimeBuffer({ kind: mapped, text });
  return roundUpTo5Min(Math.max(5, a.minutes));
}

/** Wann muss ich am Ziel sein = Event − Puffer, auf 5 Min abgerundet. */
export function arriveByFromDeadline(
  deadlineMs: number,
  bufferMin: number,
): number {
  return floorMsTo5Min(deadlineMs - bufferMin * 60_000);
}

/** Wann losgehen = arriveBy − travelMin (travel schon gerundet). */
export function leaveByFromArrive(
  arriveByMs: number,
  travelMin: number,
): number {
  return floorMsTo5Min(arriveByMs - travelMin * 60_000);
}

export function defaultStayMinutes(kind: string, name?: string): number {
  const label = `${kind} ${name ?? ''}`.trim();
  const n = label.toLowerCase();
  let upper = 60;
  if (/minigolf|bowling|escape/.test(n)) upper = 90;
  else if (/museum|galerie|ausstellung/.test(n)) upper = 90;
  else if (/restaurant|essen|burger|schnitzel|abendessen|mittag/.test(n))
    upper = 120;
  else if (/café|cafe|kaffee|frühstück|fruehstueck/.test(n)) upper = 45;
  else if (/strand|picknick|sunset|sonnenuntergang|aussicht/.test(n))
    upper = 45;
  else if (/supermarkt|einkauf|drogerie/.test(n)) upper = 30;

  return Math.max(upper, defaultDwellMinForLabel(label));
}
