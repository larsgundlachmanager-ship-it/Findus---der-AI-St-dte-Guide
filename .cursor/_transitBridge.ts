/**
 * ÖPNV door-to-door: Transitous / db_rest first; Google Directions only emergency
 * (handled inside planJourney as last fallback).
 */

import { planJourney, type JourneyItinerary } from '../../transit/journeyPlanner';
import { startJourneyNavigation } from '../startJourneyNavigation';
import { rememberJourneyForStart } from '../journeyStartCache';

export async function planTransitHandsFree(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  departAt?: Date | null;
  arriveBy?: Date | null;
}): Promise<JourneyItinerary | null> {
  const result = await planJourney({
    from: opts.from,
    to: opts.to,
    travelMode: 'transit',
    arriveBy: opts.arriveBy ?? null,
    departAt: opts.arriveBy ? null : opts.departAt ?? new Date(),
    numItineraries: 5,
  });
  return result.itineraries[0] ?? null;
}

export async function planTransitHandsFreeDetailed(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  departAt?: Date | null;
}): Promise<{ itinerary: JourneyItinerary | null; tight: boolean }> {
  const result = await planJourney({
    from: opts.from,
    to: opts.to,
    travelMode: 'transit',
    departAt: opts.departAt ?? new Date(),
    numItineraries: 5,
  });
  return {
    itinerary: result.itineraries[0] ?? null,
    tight: result.tight === true,
  };
}

/**
 * Plan + remember + start journey nav (walk → transit → walk).
 */
export async function startTransitHandsFree(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  destName: string;
  /** Fußroute ersetzen — explizite ÖPNV-Wahl. */
  replace?: boolean;
  /** Sofort zum Halt, auch wenn die Bahn noch >8 Min hat. */
  forceStart?: boolean;
}): Promise<{ ok: boolean; message?: string; source?: string }> {
  const planned = await planTransitHandsFreeDetailed({
    from: opts.from,
    to: opts.to,
  });
  const best = planned.itinerary;
  if (!best) {
    return {
      ok: false,
      message: 'Keine ÖPNV-Verbindung gefunden (Transitous/DB).',
    };
  }

  rememberJourneyForStart({
    itinerary: best,
    destName: opts.destName,
    destLat: opts.to.lat,
    destLng: opts.to.lng,
  });

  const jr = await startJourneyNavigation({
    itinerary: best,
    destName: opts.destName,
    destLat: opts.to.lat,
    destLng: opts.to.lng,
    tight: planned.tight,
    replace: opts.replace === true,
    forceStart: opts.forceStart === true,
  });
  return {
    ok: jr.ok,
    message: jr.reply,
    source: best.source,
  };
}
