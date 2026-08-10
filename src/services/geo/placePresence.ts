/**
 * Place Presence / Geofence Snap — Stillstand ≠ „Unterwegs“.
 * Hotel-Geofence, POI-Dwell, Bewegung.
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';

export type PlacePresence =
  | { role: 'hotel'; label: string; title: string; hotelName: string }
  | { role: 'poi'; label: string; title: string; poiName: string }
  | { role: 'nav'; label: string; title: string; target: string }
  | { role: 'stationary'; label: string; title: string; place: string }
  | { role: 'moving'; label: string; title: string; place: string };

const HOTEL_RADIUS_M = 90;
const STATIONARY_SPEED_MS = 0.55;

export function distanceToConfirmedHotelM(
  lat: number | null,
  lng: number | null,
): number | null {
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  if (
    !hotel ||
    typeof hotel.lat !== 'number' ||
    typeof hotel.lng !== 'number' ||
    lat == null ||
    lng == null
  ) {
    return null;
  }
  return haversineMeters(lat, lng, hotel.lat, hotel.lng);
}

/**
 * Snapped presence for HUD — never show „Unterwegs“ when still at hotel.
 */
export function resolvePlacePresence(opts?: {
  lat?: number | null;
  lng?: number | null;
  speedMs?: number | null;
}): PlacePresence {
  const store = useFinnusStore.getState();
  const lat = opts?.lat ?? store.lastGpsLat;
  const lng = opts?.lng ?? store.lastGpsLng;
  const place = store.currentLocationName?.trim() || 'der Gegend';
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();

  if (store.navActive) {
    const target =
      store.navNextTargetName?.trim() ||
      store.navTargetName?.trim() ||
      'Ziel';
    return {
      role: 'nav',
      label: 'Navigation',
      title: `Navigiere zu: ${target}`,
      target,
    };
  }

  const distHotel = distanceToConfirmedHotelM(lat, lng);
  if (hotel && distHotel != null && distHotel < HOTEL_RADIUS_M) {
    return {
      role: 'hotel',
      label: '📍',
      title: `📍 ${hotel.name}`,
      hotelName: hotel.name,
    };
  }

  if (store.currentPoiId && store.currentLocationName?.trim()) {
    const name = store.currentLocationName.trim();
    return {
      role: 'poi',
      label: '📍',
      title: `📍 ${name}`,
      poiName: name,
    };
  }

  // Speed: if available via store preferredTravelMode / no speed field —
  // treat as stationary when not navigating and no POI (idle at place).
  const speed = opts?.speedMs;
  if (speed != null && speed > STATIONARY_SPEED_MS) {
    return {
      role: 'moving',
      label: '📍',
      title: place === 'der Gegend' ? '📍 Unterwegs' : `📍 ${place}`,
      place,
    };
  }

  return {
    role: 'stationary',
    label: '📍',
    title: place === 'der Gegend' ? '📍 Hier in der Gegend' : `📍 ${place}`,
    place,
  };
}
