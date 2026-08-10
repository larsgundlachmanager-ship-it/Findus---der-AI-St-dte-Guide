/**
 * Probiert Transit- und Mobility-APIs und liefert einen Status-Snapshot.
 */

import { env } from '../../config/env';
import { hasGoogleMapsNavKey } from '../navigation/googleMapsNav';
import {
  fetchLiveDeparturesForCity,
  resolveCityTransitProfile,
} from '../transit/adapters';
import { resolveIbnrForCity } from '../transit/stationRegistry';
import { transitousFetchJson } from '../transit/adapters/transitousClient';
import { hasFlightAwareKey } from '../flights/FlightTrackingService';
import { findNearbyBikeShare } from './bikeShare';
import { findNearbyParking } from './parking';

export type ApiProbeStatus = {
  id: string;
  label: string;
  available: boolean;
  detail: string;
};

export async function probeMobilityApis(opts?: {
  lat?: number;
  lng?: number;
  cityId?: string;
}): Promise<ApiProbeStatus[]> {
  const cityId = opts?.cityId || env.cityId() || 'prisdorf';
  const lat = opts?.lat ?? 53.68;
  const lng = opts?.lng ?? 9.76;
  const profile = resolveCityTransitProfile(cityId);
  const stopId = resolveIbnrForCity(cityId) || profile.defaultStopId || '';

  const results: ApiProbeStatus[] = [];

  results.push({
    id: 'google_maps',
    label: 'Google Maps (Directions/Places)',
    available: hasGoogleMapsNavKey(),
    detail: hasGoogleMapsNavKey()
      ? 'Key gesetzt — Haltestellenkette via Directions transit'
      : 'Kein EXPO_PUBLIC_GOOGLE_MAPS_API_KEY',
  });

  try {
    const health = await transitousFetchJson('/v1/health');
    results.push({
      id: 'transitous',
      label: 'Transitous (MOTIS / EU GTFS-RT)',
      available: !!health,
      detail: health
        ? `API erreichbar (${env.transitousBaseUrl()})`
        : 'Transitous nicht erreichbar — Google Directions Fallback',
    });
  } catch (e) {
    results.push({
      id: 'transitous',
      label: 'Transitous (MOTIS / EU GTFS-RT)',
      available: false,
      detail: e instanceof Error ? e.message : 'Fehler',
    });
  }

  results.push({
    id: 'flightaware',
    label: 'FlightAware AeroAPI',
    available: hasFlightAwareKey(),
    detail: hasFlightAwareKey()
      ? 'Key gesetzt — Flugstatus / Gates / Verspätung'
      : 'Kein EXPO_PUBLIC_FLIGHTAWARE_API_KEY',
  });

  results.push({
    id: 'db_ris',
    label: 'DB Client (RIS)',
    available: !!(env.dbClientId()?.trim() || env.dbApiKey()?.trim()),
    detail:
      env.dbClientId()?.trim() || env.dbApiKey()?.trim()
        ? 'DB Client-ID/Key gesetzt'
        : 'Optional — HAFAS transport.rest läuft ohne Key',
  });

  try {
    const live = stopId
      ? await fetchLiveDeparturesForCity({
          cityId,
          stopId,
          limit: 2,
          stationLat: lat,
          stationLng: lng,
        })
      : null;
    results.push({
      id: 'transit_live',
      label: `ÖPNV Live (${profile.label})`,
      available: !!live?.departures?.length,
      detail: live?.departures?.length
        ? `${live.departures.length} Abfahrten via ${live.adapterLabel}`
        : stopId
          ? `Keine Live-Daten (Stop ${stopId}) — Takt-Fallback aktiv`
          : 'Keine Stop-ID / IBNR konfiguriert',
    });
  } catch (e) {
    results.push({
      id: 'transit_live',
      label: `ÖPNV Live (${profile.label})`,
      available: false,
      detail: e instanceof Error ? e.message : 'Fehler',
    });
  }

  results.push({
    id: 'gtfs_rt',
    label: 'GTFS-Realtime',
    available: !!profile.gtfsRtUrl,
    detail: profile.gtfsRtUrl
      ? `Feed konfiguriert: ${profile.gtfsRtUrl.slice(0, 60)}…`
      : 'Keine EXPO_PUBLIC_GTFS_RT_URL / Pack _transit.gtfs_rt_url',
  });

  const delijnKey = env.get('EXPO_PUBLIC_DELIJN_API_KEY').trim();
  results.push({
    id: 'delijn',
    label: 'De Lijn',
    available: !!(
      delijnKey &&
      !delijnKey.includes('your-') &&
      profile.kind === 'delijn'
    ),
    detail:
      profile.kind === 'delijn'
        ? delijnKey
          ? 'Key gesetzt'
          : 'Stadt delijn, aber kein EXPO_PUBLIC_DELIJN_API_KEY'
        : 'Nur für BE-Städte (z. B. antwerpen) relevant',
  });

  try {
    const bikes = await findNearbyBikeShare({
      lat,
      lng,
      radiusM: 5000,
      limit: 3,
    });
    results.push({
      id: 'nextbike',
      label: 'nextbike / Call a Bike',
      available: bikes.length > 0,
      detail: bikes.length
        ? `${bikes.length} Station(en), nächste ${bikes[0].distanceM} m`
        : 'Keine Stationen in Reichweite (in Prisdorf oft leer — in HH ok)',
    });
  } catch {
    results.push({
      id: 'nextbike',
      label: 'nextbike / Call a Bike',
      available: false,
      detail: 'Abruf fehlgeschlagen',
    });
  }

  const parkopediaKey = env.get('EXPO_PUBLIC_PARKOPEDIA_API_KEY').trim();
  results.push({
    id: 'parkopedia',
    label: 'Parkopedia',
    available: !!(parkopediaKey && !parkopediaKey.includes('your-')),
    detail: parkopediaKey
      ? 'Key gesetzt'
      : 'Kein Key — Fallback Google Places parking + Pack-Hints',
  });

  try {
    const parking = await findNearbyParking({
      lat,
      lng,
      radiusM: 1500,
      limit: 3,
    });
    results.push({
      id: 'parking',
      label: 'Parking gesamt',
      available: parking.length > 0,
      detail: parking.length
        ? `${parking.length} Treffer (${parking[0].source})`
        : 'Keine Parkplätze gefunden',
    });
  } catch {
    results.push({
      id: 'parking',
      label: 'Parking gesamt',
      available: false,
      detail: 'Abruf fehlgeschlagen',
    });
  }

  return results;
}
