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
}): Promise<JourneyItinerary | null> {
  const result = await planJourney({
    from: opts.from,
    to: opts.to,
    travelMode: 'transit',
    departAt: opts.departAt ?? new Date(),
    numItineraries: 3,
  });
  return result.itineraries[0] ?? null;
}

/**
 * Plan + remember + start journey nav (walk → transit → walk).
 */
export async function startTransitHandsFree(opts: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  destName: string;
}): Promise<{ ok: boolean; message?: string; source?: string }> {
  const best = await planTransitHandsFree({
    from: opts.from,
    to: opts.to,
  });
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
  });
  return {
    ok: jr.ok,
    message: jr.reply,
    source: best.source,
  };
}
