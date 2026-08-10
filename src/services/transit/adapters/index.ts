/**
 * Wählt den passenden Transit-Adapter für die aktuelle Stadt.
 * Failover: Primary (DB/HAFAS/Delijn/…) → Transitous → GTFS-RT.
 */

import { resolveCityTransitProfile } from './cityProfiles';
import { createDelijnAdapter } from './delijnAdapter';
import { createGtfsRealtimeAdapter } from './gtfsRealtimeAdapter';
import { createHafasRestAdapter } from './hafasRestAdapter';
import { createTransitousAdapter } from './transitousAdapter';
import type { AdapterDeparture, TransitAdapter } from './types';

export type { AdapterDeparture, TransitAdapter };
export { resolveCityTransitProfile } from './cityProfiles';
export { createTransitousAdapter, resolveTransitousStopId } from './transitousAdapter';
export { planJourney, recalculateNextConnection, recalculateMissedConnection } from '../journeyPlanner';
export {
  planDbJourneys,
  searchDbLocations,
  lookupTrainDeparture,
} from '../dbRestJourneys';

export function getTransitAdapterForCity(
  cityId?: string | null,
): TransitAdapter {
  const profile = resolveCityTransitProfile(cityId);

  if (profile.kind === 'transitous') {
    return createTransitousAdapter({ label: profile.label });
  }
  if (profile.kind === 'gtfs_rt' && profile.gtfsRtUrl) {
    return createGtfsRealtimeAdapter({
      feedUrl: profile.gtfsRtUrl,
      label: profile.label,
    });
  }
  if (profile.kind === 'delijn' && profile.delijnBaseUrl) {
    return createDelijnAdapter({
      baseUrl: profile.delijnBaseUrl,
      label: profile.label,
    });
  }
  if (profile.kind === 'takt') {
    return {
      kind: 'takt',
      label: 'Takt-Fallback',
      fetchDepartures: async () => null,
    };
  }

  // db_rest + hafas → transport.rest
  return createHafasRestAdapter({
    baseUrl: profile.hafasBaseUrl || 'https://v6.db.transport.rest',
    label: profile.label,
    kind: profile.kind === 'db_rest' ? 'db_rest' : 'hafas',
  });
}

/**
 * Live-Abfahrten mit Failover.
 * DE db_rest/hafas: Transitous zuerst (transport.rest oft 503), dann HAFAS, dann GTFS-RT.
 */
export async function fetchLiveDeparturesForCity(opts: {
  cityId?: string | null;
  stopId: string;
  directionHint?: string | null;
  limit?: number;
  stationLat?: number | null;
  stationLng?: number | null;
  stationName?: string | null;
  /** MOTIS/DELFI Stop-ID wenn bekannt (überspringt Geocode). */
  transitousStopId?: string | null;
}): Promise<{
  departures: AdapterDeparture[];
  source: 'live' | 'gtfs_rt' | 'transitous' | 'none';
  adapterLabel: string;
} | null> {
  const profile = resolveCityTransitProfile(opts.cityId);
  const primary = getTransitAdapterForCity(opts.cityId);
  const preferTransitousFirst =
    primary.kind === 'db_rest' || primary.kind === 'hafas';

  const tryTransitous = async () => {
    const transitous = createTransitousAdapter({
      label: preferTransitousFirst
        ? 'Transitous (Live GTFS-RT)'
        : 'Transitous Fallback',
      stationLat: opts.stationLat,
      stationLng: opts.stationLng,
      stationName: opts.stationName,
    });
    const stopHint =
      opts.transitousStopId?.trim() ||
      opts.stopId;
    const rows = await transitous.fetchDepartures({
      stopId: stopHint,
      directionHint: opts.directionHint,
      limit: opts.limit,
    });
    if (rows?.length) {
      return {
        departures: rows,
        source: 'transitous' as const,
        adapterLabel: transitous.label,
      };
    }
    return null;
  };

  if (preferTransitousFirst) {
    const viaTransitous = await tryTransitous();
    if (viaTransitous) return viaTransitous;
  }

  const primaryRows = await primary.fetchDepartures({
    stopId: opts.stopId,
    directionHint: opts.directionHint,
    limit: opts.limit,
  });
  if (primaryRows?.length) {
    return {
      departures: primaryRows,
      source:
        primary.kind === 'gtfs_rt'
          ? 'gtfs_rt'
          : primary.kind === 'transitous'
            ? 'transitous'
            : 'live',
      adapterLabel: primary.label,
    };
  }

  // Sekundär: Transitous, falls Primary kein Transitous und noch nicht versucht
  if (primary.kind !== 'transitous' && !preferTransitousFirst) {
    const viaTransitous = await tryTransitous();
    if (viaTransitous) return viaTransitous;
  }

  // Tertiär: GTFS-RT wenn Pack/Env URL hat
  if (profile.gtfsRtUrl && primary.kind !== 'gtfs_rt') {
    const gtfs = createGtfsRealtimeAdapter({ feedUrl: profile.gtfsRtUrl });
    const rows = await gtfs.fetchDepartures({
      stopId: opts.stopId,
      directionHint: opts.directionHint,
      limit: opts.limit,
    });
    if (rows?.length) {
      return {
        departures: rows,
        source: 'gtfs_rt',
        adapterLabel: gtfs.label,
      };
    }
  }

  return null;
}
