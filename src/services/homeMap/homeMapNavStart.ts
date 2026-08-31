/**
 * Ort-Popup → Navigation.
 * Button = Koordinaten aus dem Pin → bei kurzer Luftlinie sofort Fuß-/Radroute.
 * ≥1,4 km: ÖPNV-Option. ≥3 km: ÖPNV direkt wenn schneller (Taxi nur bei Pref).
 */

import type { UserProfile } from '../../types/userProfile';
import {
  startNavigationToCoords,
} from '../navigation/navigationService';
import { notifyNavRouteGeometryChanged } from '../navigation/navRouteRev';
import {
  resolveActiveTravelMode,
  setPreferredTravelMode,
} from '../navigation/travelModeContext';
import { useGpsStore } from '../../store/useGpsStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import { isUsableHomeMapNavCoord } from './homeMapNavCoord';
import {
  airNeedsTransitLookahead,
  decideAirMobility,
  PLAN_AIR_BIKE_OFFER_TRANSIT_M,
  readTaxiPref,
} from '../../module2/planning/planMobilityPolicy';
import { haversineMeters } from '../../db/database';

export { isUsableHomeMapNavCoord } from './homeMapNavCoord';

export type HomeMapNavTarget = {
  name: string;
  lat: number;
  lng: number;
  poiId?: number;
  spotKey?: string | null;
};

export type HomeMapNavResult =
  | { ok: true; mode: 'walk' | 'bike' | 'transit' | 'taxi' | 'ask' }
  | { ok: false; reason: string };

export type HomeMapNavStartOpts = {
  replaceRoute?: boolean;
  addStop?: boolean;
  /** User hat schon Fuß/Rad gewählt — kein Live-Guard. */
  commitMode?: 'foot' | 'bike';
};

function navLooksStarted(): boolean {
  try {
    const st = useFinnusStore.getState();
    return st.navActive || st.navRouteLoading;
  } catch {
    return false;
  }
}

async function resolveUserCoords(): Promise<{ lat: number; lng: number } | null> {
  const gps = useGpsStore.getState();
  const st = useFinnusStore.getState();
  const lat = gps.lat ?? st.lastGpsLat;
  const lng = gps.lng ?? st.lastGpsLng;
  if (isUsableHomeMapNavCoord(lat ?? Number.NaN, lng ?? Number.NaN)) {
    return { lat: lat as number, lng: lng as number };
  }
  try {
    const { getCurrentCoords } = await import('../locationService');
    const cur = await getCurrentCoords({ timeoutMs: 2500 });
    if (cur && isUsableHomeMapNavCoord(cur.lat, cur.lng)) return cur;
  } catch {
    /* soft */
  }
  return null;
}

/** Pin-Koordinaten sind SSOT — POI nur wenn der Tap keine brauchbaren hat. */
function resolveDest(target: HomeMapNavTarget): HomeMapNavTarget {
  const named = {
    ...target,
    name: (target.name || 'Ort').trim() || 'Ort',
    lat: Number(target.lat),
    lng: Number(target.lng),
  };
  if (isUsableHomeMapNavCoord(named.lat, named.lng)) return named;
  if (target.poiId == null || target.poiId <= 0 || target.poiId >= 1_000_000_000) {
    return named;
  }
  const poi = useFinnusStore.getState().pois.find((p) => p.id === target.poiId);
  if (!poi || !isUsableHomeMapNavCoord(poi.lat, poi.lng)) return named;
  return {
    ...named,
    lat: Number(poi.lat),
    lng: Number(poi.lng),
    spotKey: target.spotKey ?? poi.spot_key ?? null,
    name: (target.name || poi.name || 'Ort').trim() || 'Ort',
  };
}

function armSkipMobilityOnce(): void {
  try {
    const { armSkipMobilityChoiceOnce } = require('../navigation/navLeaveByFollowUp') as {
      armSkipMobilityChoiceOnce: () => void;
    };
    armSkipMobilityChoiceOnce();
  } catch {
    /* soft */
  }
}

async function commitImmediateNav(
  dest: HomeMapNavTarget,
  mode: 'foot' | 'bike',
  opts?: { skipMobilityAsk?: boolean },
): Promise<HomeMapNavResult> {
  try {
    const st = useFinnusStore.getState();
    st.setNavRouteLoading(true);
    st.setIsGenerating(true);
  } catch {
    /* soft */
  }

  const travelMode = mode === 'bike' ? 'bicycling' : 'walking';
  const origin = await resolveUserCoords();
  // FOSSGIS/Offline parallel zum Start — Karte bekommt Straße sobald da (nicht nach Enrich-Timeout)
  if (origin != null) {
    void (async () => {
      try {
        const { fetchProgressiveRoute } = await import(
          '../navigation/handsFreeNav/routeEngine'
        );
        const progressive = await fetchProgressiveRoute({
          originLat: origin.lat,
          originLng: origin.lng,
          destLat: dest.lat,
          destLng: dest.lng,
          travelMode,
          lightBufferMin: 0,
        });
        if (!progressive?.waypoints || progressive.waypoints.length < 3) return;
        const { seedActiveNavRoute } = require('../navigation/navigationService') as {
          seedActiveNavRoute: (o: {
            waypoints: typeof progressive.waypoints;
            walkingDistanceM?: number;
          }) => boolean;
        };
        seedActiveNavRoute({
          waypoints: progressive.waypoints,
          walkingDistanceM: progressive.distanceM,
        });
        try {
          const { putCachedRoute } = require('../navigation/offlineNavCache') as {
            putCachedRoute: (o: Record<string, unknown>) => Promise<void>;
          };
          void putCachedRoute({
            destName: dest.name,
            destLat: dest.lat,
            destLng: dest.lng,
            waypoints: progressive.waypoints,
            stations: progressive.stations,
            travelMode: progressive.travelMode,
            walkingDistanceM: progressive.distanceM,
          });
        } catch {
          /* soft */
        }
      } catch {
        /* soft */
      }
    })();
  }

  const startOnce = (poiId?: number) =>
    startNavigationToCoords({
      name: dest.name,
      lat: dest.lat,
      lng: dest.lng,
      poiId,
      spotKey: dest.spotKey,
      skipDestVerify: true,
      forceTravelMode: mode,
    });

  try {
    if (opts?.skipMobilityAsk !== false) armSkipMobilityOnce();
    setPreferredTravelMode(mode);
    const poiId =
      dest.poiId != null && dest.poiId > 0 ? dest.poiId : undefined;
    let ok = false;
    try {
      ok = await startOnce(poiId);
    } catch {
      ok = false;
    }
    if (!ok && !navLooksStarted() && poiId != null) {
      try {
        ok = await startOnce(undefined);
      } catch {
        ok = false;
      }
    }

    notifyNavRouteGeometryChanged();
    if (ok || useFinnusStore.getState().navActive) {
      return { ok: true, mode: mode === 'bike' ? 'bike' : 'walk' };
    }
    return { ok: false, reason: 'nav_failed' };
  } catch {
    if (useFinnusStore.getState().navActive) {
      notifyNavRouteGeometryChanged();
      return { ok: true, mode: mode === 'bike' ? 'bike' : 'walk' };
    }
    return { ok: false, reason: 'nav_failed' };
  } finally {
    try {
      const now = useFinnusStore.getState();
      if (!now.navActive) now.setNavRouteLoading(false);
    } catch {
      /* soft */
    }
  }
}

/**
 * Sofort starten. Bei laufender Navigation: `replaceRoute` / `addStop`.
 */
export async function startHomeMapNavigation(
  target: HomeMapNavTarget,
  _profile?: UserProfile | null,
  opts?: HomeMapNavStartOpts,
): Promise<HomeMapNavResult> {
  const dest = resolveDest(target);
  if (!isUsableHomeMapNavCoord(dest.lat, dest.lng) || !dest.name.trim()) {
    return { ok: false, reason: 'bad_dest' };
  }

  // Sofort-Feedback: Mic/Busy-Kreis im selben Frame — vor GPS/Route-I/O.
  try {
    const st = useFinnusStore.getState();
    st.setNavRouteLoading(true);
    st.setIsGenerating(true);
  } catch {
    /* soft */
  }

  const origin = await resolveUserCoords();

  try {
    if (opts?.addStop) {
      try {
        useFinnusStore.getState().setNavRouteLoading(true);
        useFinnusStore.getState().setIsGenerating(false);
        useFinnusStore.getState().setActiveConciergeCard(null);
      } catch {
        /* soft */
      }
      try {
        const { addOptimizedTourStop } = await import(
          '../navigation/multiStopTour'
        );
        const added = await addOptimizedTourStop(
          {
            poiId: dest.poiId ?? -1,
            name: dest.name,
            lat: dest.lat,
            lng: dest.lng,
            done: false,
            priority: 'high',
            remindMinBefore: null,
          },
          { startNow: true },
        );
        if (added) {
          notifyNavRouteGeometryChanged();
          try {
            useFinnusStore.getState().setNavRouteLoading(false);
            useFinnusStore.getState().setIsGenerating(false);
          } catch {
            /* soft */
          }
          return { ok: true, mode: 'walk' };
        }
      } catch (err) {
        console.warn('[nav] addStop failed', err);
      }
      try {
        useFinnusStore.getState().setNavRouteLoading(false);
      } catch {
        /* soft */
      }
      return { ok: false, reason: 'nav_failed' };
    }

    if (opts?.replaceRoute) {
      try {
        useFinnusStore.getState().setIsGenerating(false);
        useFinnusStore.getState().setActiveConciergeCard(null);
      } catch {
        /* soft */
      }
      const { clearMultiStopTour } = await import('../navigation/multiStopTour');
      clearMultiStopTour();
    }

    if (opts?.commitMode === 'foot' || opts?.commitMode === 'bike') {
      return commitImmediateNav(dest, opts.commitMode, { skipMobilityAsk: true });
    }

    const travel = resolveActiveTravelMode();
    let airM = 0;
    let walkMPerMin = 70;
    if (origin) {
      airM = haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng);
      try {
        const { getPlanWalkMPerMin } = require('../mobility/paceProfile') as {
          getPlanWalkMPerMin: () => number;
        };
        walkMPerMin = getPlanWalkMPerMin();
      } catch {
        /* default 70 */
      }
    }
    const airWalkMin = Math.max(
      1,
      Math.round(airM / Math.max(40, walkMPerMin)),
    );
    const preferBike =
      travel.mode === 'bike' &&
      (travel.source === 'speed' || travel.source === 'session');
    if (preferBike && airM < PLAN_AIR_BIKE_OFFER_TRANSIT_M) {
      return commitImmediateNav(dest, 'bike', { skipMobilityAsk: true });
    }

    let taxiPref: ReturnType<typeof readTaxiPref> = null;
    try {
      const { getCachedUserProfile } = require('../userProfileService') as {
        getCachedUserProfile: () => {
          mobilityPrefs?: { taxi?: 'love' | 'if_saves_time' | 'no' | null; car?: string | null };
        } | null;
      };
      taxiPref = readTaxiPref(getCachedUserProfile());
    } catch {
      taxiPref = null;
    }

    const lookahead =
      origin != null &&
      airNeedsTransitLookahead({ airMeters: airM, preferBike });
    if (lookahead && origin) {
      try {
        useFinnusStore.getState().setNavRouteLoading(false);
        useFinnusStore.getState().setIsGenerating(false);
      } catch {
        /* soft */
      }
      const { presentMapNavMobilityAsk } = await import('./homeMapNavMobilityAsk');
      const decision = decideAirMobility({
        airMeters: airM,
        walkMin: airWalkMin,
        transitMin: null,
        preferBike,
        taxiPref,
      });
      if (decision.kind === 'auto_transit' && !decision.includeTaxi) {
        try {
          const { setPreferredTravelMode: setTransit } = await import(
            '../navigation/travelModeContext'
          );
          setTransit('transit');
          const { startTransitHandsFree } = await import(
            '../navigation/handsFreeNav/transitBridge'
          );
          const tr = await startTransitHandsFree({
            from: origin,
            to: { lat: dest.lat, lng: dest.lng },
            destName: dest.name,
          });
          if (tr.ok) return { ok: true, mode: 'transit' };
        } catch {
          /* fall through to ask */
        }
      }
      // Sofort Ask — Prefetch läuft im Hintergrund (kein 4.5s Block).
      void presentMapNavMobilityAsk({
        dest,
        origin,
        walkMin: airWalkMin,
        transitMin: null,
        airMeters: airM,
        includeTaxi:
          decision.kind === 'ask_transit' || decision.kind === 'auto_transit'
            ? decision.includeTaxi
            : false,
        hideWalk: decision.kind === 'auto_transit',
        preferBike,
      });
      return { ok: true, mode: 'ask' };
    }

    // Kurz: sofort Fuß. Live-Guard nach Route-Ready nur falls OSRM doch länger ist.
    const skipMobilityAsk = false;
    return commitImmediateNav(dest, 'foot', { skipMobilityAsk });
  } catch {
    if (navLooksStarted()) {
      notifyNavRouteGeometryChanged();
      return { ok: true, mode: 'walk' };
    }
    return { ok: false, reason: 'nav_failed' };
  } finally {
    if (opts?.addStop) {
      try {
        const now = useFinnusStore.getState();
        if (!now.navActive) now.setNavRouteLoading(false);
        now.setIsGenerating(false);
      } catch {
        /* soft */
      }
    }
  }
}
