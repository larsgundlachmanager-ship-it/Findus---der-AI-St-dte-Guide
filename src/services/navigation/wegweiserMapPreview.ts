/**
 * Modul-1 Wegweiser: Route + ETA vorbereiten, Navigation erst nach Tap.
 * Kein Auto-Start — Karte zeigt blaues Ziel + Walk-Linie (gestrichelt).
 */

import { haversineMeters } from '../../db/database';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useGpsStore } from '../../store/useGpsStore';
import { useMapRouteStore } from '../../store/useMapRouteStore';
import { getCachedUserProfile } from '../userProfileService';
import { fetchRouteDirectionsResult } from './googleMapsNav';
import type { NavRouteMapPayload } from './navRouteMapPayload';
import { formatDurationMinutesDe } from './travelEtaFormat';

export function wegweiserMapPreviewEnabled(): boolean {
  const p = getCachedUserProfile();
  return p?.wegweiserMapPreview !== false;
}

function fallbackWalkMinutes(originLat: number, originLng: number, destLat: number, destLng: number): number {
  const m = haversineMeters(originLat, originLng, destLat, destLng);
  return Math.max(1, Math.round(m / 80));
}

function buildPreviewPayload(opts: {
  name: string;
  lat: number;
  lng: number;
  route: Array<{ lat: number; lng: number }>;
}): NavRouteMapPayload {
  // Wegweiser: echte Walk-Polyline wenn ≥3 Punkte, sonst nur Pin (keine Luftlinie).
  const street =
    opts.route.length >= 3
      ? opts.route
      : [];
  return {
    current: street,
    ahead: [],
    pins: [
      {
        lat: opts.lat,
        lng: opts.lng,
        n: 1,
        name: opts.name,
        current: false,
      },
    ],
    arrows: [],
    fitWide: false,
    previewPin: { lat: opts.lat, lng: opts.lng },
    preview: street.length < 3,
  };
}

/** Nach Wegweiser: pendingNavOffer + optional Karten-Preview (ETA, Walk-Linie). */
export async function armWegweiserMapPreview(opts: {
  poiId: number;
  name: string;
  lat: number;
  lng: number;
}): Promise<void> {
  const store = useFinnusStore.getState();
  store.setPendingNavOffer({
    poiId: opts.poiId,
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    awaitConfirm: true,
    source: 'wegweiser',
  });

  if (!wegweiserMapPreviewEnabled()) {
    scheduleWegweiserApproachCardRefresh();
    return;
  }
  if (!Number.isFinite(opts.lat) || !Number.isFinite(opts.lng)) {
    scheduleWegweiserApproachCardRefresh();
    return;
  }

  const gps = useGpsStore.getState();
  const userLat = gps.lat ?? store.lastGpsLat;
  const userLng = gps.lng ?? store.lastGpsLng;
  if (userLat == null || userLng == null) {
    scheduleWegweiserApproachCardRefresh();
    return;
  }

  let previewRoute: Array<{ lat: number; lng: number }> = [
    { lat: userLat, lng: userLng },
    { lat: opts.lat, lng: opts.lng },
  ];
  let etaMin = fallbackWalkMinutes(userLat, userLng, opts.lat, opts.lng);

  try {
    const routed = await fetchRouteDirectionsResult(
      { lat: userLat, lng: userLng },
      { lat: opts.lat, lng: opts.lng },
      'walking',
    );
    if (routed?.pathPoints?.length >= 2) {
      previewRoute = routed.pathPoints.map((p) => ({ lat: p.lat, lng: p.lng }));
    }
    if (typeof routed?.durationSec === 'number' && routed.durationSec > 0) {
      etaMin = Math.max(1, Math.round(routed.durationSec / 60));
    }
  } catch {
    /* OSRM/Google soft-fail → Luftlinie + Pace */
  }

  store.setPendingNavOffer({
    poiId: opts.poiId,
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    awaitConfirm: true,
    source: 'wegweiser',
    etaMin,
    previewRoute,
  });

  if (store.navActive) {
    scheduleWegweiserApproachCardRefresh();
    return;
  }
  const payload = buildPreviewPayload({
    name: opts.name,
    lat: opts.lat,
    lng: opts.lng,
    route: previewRoute,
  });
  useMapRouteStore.getState().setRoute(payload);
  scheduleWegweiserApproachCardRefresh();
}

/** Überschreibt die Legacy-Approach-Karte mit ETA + Preview-Hinweis. */
export function scheduleWegweiserApproachCardRefresh(delayMs = 120): void {
  setTimeout(() => {
    void refreshWegweiserApproachCard();
  }, delayMs);
}

export async function refreshWegweiserApproachCard(): Promise<void> {
  const offer = useFinnusStore.getState().pendingNavOffer;
  if (
    offer?.source !== 'wegweiser' ||
    offer.awaitConfirm !== true ||
    !offer.name?.trim()
  ) {
    return;
  }
  const lat = offer.lat;
  const lng = offer.lng;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }
  useFinnusStore.getState().setActiveConciergeCard({
    id: `wegweiser_nav_${offer.poiId}_${Date.now()}`,
    createdAtMs: Date.now(),
    speechText: '',
    visualBullets: [
      formatWegweiserDistHint(offer.etaMin, offer.name),
      'Ziel blau auf der Karte — ein Tap startet die Route',
    ].slice(0, 2),
    quickActions: [
      {
        type: 'START_NAVIGATION',
        label: formatWegweiserNavLabel(offer.etaMin),
        payload: {
          destLat: lat,
          destLng: lng,
          destName: offer.name,
          targetPoiId: offer.poiId,
          preferWalk: true,
          skipDestVerify: true,
          skipClosingGate: true,
          keepCard: true,
        },
      },
      {
        type: 'START_NAVIGATION',
        label: 'ÖPNV',
        payload: {
          destLat: lat,
          destLng: lng,
          destName: offer.name,
          targetPoiId: offer.poiId,
          preferTransit: true,
          journeyNav: true,
          skipDestVerify: true,
          skipClosingGate: true,
          keepCard: true,
        },
      },
    ],
    cardTitle: offer.name,
  });
}

export function clearWegweiserMapPreviewIfIdle(): void {
  const store = useFinnusStore.getState();
  if (store.navActive) return;
  const offer = store.pendingNavOffer;
  if (offer?.source === 'wegweiser' && offer.awaitConfirm) {
    store.setPendingNavOffer(null);
  }
  const route = useMapRouteStore.getState().route;
  if (route?.preview) {
    useMapRouteStore.getState().setRoute(null);
  }
}

export function formatWegweiserNavLabel(
  etaMin?: number | null,
  fallback = '📍 Route hin',
): string {
  if (etaMin != null && etaMin > 0) {
    return `${formatDurationMinutesDe(etaMin, 'short')} · Navigation`;
  }
  return fallback;
}

export function formatWegweiserDistHint(
  etaMin?: number | null,
  title?: string | null,
  distM?: number | null,
): string {
  const name = (title || 'Ziel').trim();
  if (etaMin != null && etaMin > 0) {
    return `Route zu ${name} (${formatDurationMinutesDe(etaMin, 'short')} zu Fuß)`;
  }
  if (distM != null && distM > 0 && distM < 5000) {
    return `Route zu ${name} (ca. ${distM} m)`;
  }
  return `Route zu ${name}`;
}
