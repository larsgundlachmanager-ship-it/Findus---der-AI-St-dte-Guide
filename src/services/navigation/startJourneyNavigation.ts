/**
 * ÖPNV-Journey → Multi-Stop-Tour + Timeline (zu Fuß → Bahn → Umstieg → Ziel).
 */

import type { JourneyItinerary, JourneyLeg } from '../transit/journeyPlanner';
import { geocodePlaceName } from './googleMapsNav';
import {
  startMultiStopTour,
  type MultiStopTour,
  type TourStop,
} from './multiStopTour';
import { addPlanStop } from '../../module2/timeline/planLiveEdits';
import { useFinnusStore } from '../../store/useFinnusStore';

function modeEmoji(mode: JourneyLeg['mode']): string {
  switch (mode) {
    case 'WALK':
      return '🚶';
    case 'BIKE':
      return '🚲';
    case 'BUS':
      return '🚌';
    case 'TRAM':
      return '🚊';
    case 'SUBWAY':
      return '🚇';
    case 'RAIL':
    case 'TRANSIT':
      return '🚆';
    case 'FERRY':
      return '⛴️';
    default:
      return '➡️';
  }
}

function clock(d: Date): string {
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

async function resolveLegPoint(
  lat: number | null | undefined,
  lng: number | null | undefined,
  name: string,
  bias: { lat: number; lng: number },
): Promise<{ lat: number; lng: number; name: string } | null> {
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return { lat, lng, name };
  }
  try {
    const g = await geocodePlaceName(name, {
      biasLat: bias.lat,
      biasLng: bias.lng,
    });
    if (g) return { lat: g.lat, lng: g.lng, name: g.label || name };
  } catch {
    /* soft */
  }
  return null;
}

/**
 * Baut Tour-Stops aus Journey-Beinen + Finalziel.
 * Erster Stop = Einstiegshaltestelle (oder erstes geocodiertes Ziel).
 */
export async function buildTourStopsFromJourney(opts: {
  itinerary: JourneyItinerary;
  destName: string;
  destLat: number;
  destLng: number;
  originLat: number;
  originLng: number;
}): Promise<TourStop[]> {
  const bias = { lat: opts.originLat, lng: opts.originLng };
  const stops: TourStop[] = [];
  const seen = new Set<string>();

  const push = (s: TourStop) => {
    const key = `${s.name.toLowerCase()}|${s.lat.toFixed(4)}|${s.lng.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    stops.push(s);
  };

  for (const leg of opts.itinerary.legs) {
    // Einstieg in ÖPNV / Ziel eines Fußwegs zur Haltestelle
    if (leg.mode === 'WALK' || leg.mode === 'BIKE') {
      const to = await resolveLegPoint(leg.toLat, leg.toLng, leg.toName, bias);
      if (to) {
        push({
          poiId: -1,
          name: `${modeEmoji(leg.mode)} ${to.name}`,
          lat: to.lat,
          lng: to.lng,
          done: false,
        });
      }
      continue;
    }
    // Transit: Ausstieg
    const to = await resolveLegPoint(leg.toLat, leg.toLng, leg.toName, bias);
    if (to) {
      const line = leg.line ? ` ${leg.line}` : '';
      push({
        poiId: -1,
        name: `${modeEmoji(leg.mode)}${line} → ${to.name}`,
        lat: to.lat,
        lng: to.lng,
        done: false,
      });
    }
  }

  push({
    poiId: -1,
    name: opts.destName,
    lat: opts.destLat,
    lng: opts.destLng,
    done: false,
  });

  // Mindestens Ziel
  if (!stops.length) {
    push({
      poiId: -1,
      name: opts.destName,
      lat: opts.destLat,
      lng: opts.destLng,
      done: false,
    });
  }

  return stops.slice(0, 8);
}

/** Timeline-Einträge für jedes Bein + Ziel. */
export function addJourneyToTimeline(opts: {
  itinerary: JourneyItinerary;
  destName: string;
  destLat: number;
  destLng: number;
}): void {
  const it = opts.itinerary;
  for (const leg of it.legs) {
    const mins = Math.max(1, Math.round(leg.durationSec / 60));
    const line = leg.line ? ` ${leg.line}` : '';
    const title =
      leg.mode === 'WALK' || leg.mode === 'BIKE'
        ? `${modeEmoji(leg.mode)} → ${leg.toName}`
        : `${modeEmoji(leg.mode)}${line} → ${leg.toName}`;
    addPlanStop({
      title,
      lat: leg.toLat ?? undefined,
      lng: leg.toLng ?? undefined,
      plannedStartMs: leg.startTime.getTime(),
      plannedEndMs: leg.endTime.getTime(),
      kind: 'nav_leg',
      transport:
        leg.mode === 'BIKE'
          ? 'bike'
          : leg.mode === 'WALK'
            ? 'walk'
            : 'transit',
      notes: `${clock(leg.startTime)}–${clock(leg.endTime)} · ~${mins} Min`,
      bufferMin: 0,
      emoji: modeEmoji(leg.mode),
    });
  }
  addPlanStop({
    title: opts.destName,
    lat: opts.destLat,
    lng: opts.destLng,
    plannedStartMs: it.endTime.getTime(),
    plannedEndMs: it.endTime.getTime() + 45 * 60_000,
    kind: 'stop',
    transport: 'walk',
    notes: `Ankunft ~${clock(it.endTime)}`,
    bufferMin: 5,
  });
}

/**
 * Startet Navigation zum ersten Bein (meist Bahnhof) + Multi-Stop-Liste.
 * Origin immer Live-GPS.
 */
export async function startJourneyNavigation(opts: {
  itinerary: JourneyItinerary;
  destName: string;
  destLat: number;
  destLng: number;
}): Promise<{ ok: boolean; reply: string }> {
  const store = useFinnusStore.getState();
  const originLat = store.lastGpsLat;
  const originLng = store.lastGpsLng;
  if (originLat == null || originLng == null) {
    return {
      ok: false,
      reply: 'GPS fehlt gerade — kurz ins Freie und nochmal starten.',
    };
  }

  // Dedup: dieselbe Destination + ähnliche Ankunft → nicht nochmal Timeline stopfen
  const arriveKey = `${opts.destName.trim().toLowerCase()}|${Math.round(opts.itinerary.endTime.getTime() / 60_000)}`;
  const recent = (globalThis as { __findusLastJourneyKey?: string; __findusLastJourneyAt?: number })
  if (
    recent.__findusLastJourneyKey === arriveKey &&
    Date.now() - (recent.__findusLastJourneyAt ?? 0) < 3 * 60_000
  ) {
    return {
      ok: true,
      reply: `Route zu ${opts.destName} läuft schon — ich packe sie nicht nochmal neu.`,
    };
  }
  // Wenn schon aktive Nav zum gleichen Ziel → ersetzen statt verdoppeln
  if (
    store.navActive &&
    store.navTargetName &&
    store.navTargetName.toLowerCase().includes(opts.destName.trim().toLowerCase().slice(0, 12))
  ) {
    // Timeline trotzdem nur einmal; Tour neu starten unten
  } else {
    addJourneyToTimeline({
      itinerary: opts.itinerary,
      destName: opts.destName,
      destLat: opts.destLat,
      destLng: opts.destLng,
    });
  }
  recent.__findusLastJourneyKey = arriveKey;
  recent.__findusLastJourneyAt = Date.now();

  const stops = await buildTourStopsFromJourney({
    itinerary: opts.itinerary,
    destName: opts.destName,
    destLat: opts.destLat,
    destLng: opts.destLng,
    originLat,
    originLng,
  });

  const tour: MultiStopTour = {
    kind: 'custom',
    title: `ÖPNV → ${opts.destName}`,
    targetDistanceM: null,
    targetDurationMin: Math.round(opts.itinerary.durationSec / 60),
    estimatedDistanceM: 0,
    stops,
    currentIndex: 0,
  };

  return startMultiStopTour(tour);
}
