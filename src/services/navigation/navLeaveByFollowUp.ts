/**
 * Nach Route-Ready: ab >~20 Min Fuß → Live-Guard (Fuß vs ÖPNV), nicht still umschalten.
 *
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf. Übernimm niemals
 * den genauen Wortlaut. Passe deine Antwort immer dynamisch und organisch an
 * den aktuellen Kontext und die aktuelle Stadt an.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import {
  airNeedsTransitLookahead,
  decideAirMobility,
  PLAN_SOFT_MODE_MAX_MIN,
  readTaxiPref,
} from '../../module2/planning/planMobilityPolicy';
import { rememberJourneyForStart } from './journeyStartCache';
import { haversineMeters } from '../../db/database';

export type MobilityChoiceResult = {
  /** true = Walk-Opening überspringen (Auswahl spricht / Route schon da). */
  deferredWalkSpeech: boolean;
  walkMin: number;
  transitMin: number | null;
  taxiMin: number | null;
  /** @deprecated Auto-Start gibt es nicht mehr — nur Live-Guard. */
  autoStartedTransit?: boolean;
};

function approxTaxiMin(walkMin: number, distM: number): number {
  const driveMin = Math.max(4, Math.round(distM / 450));
  return Math.max(5, Math.min(walkMin, driveMin + 3));
}

let skipMobilityChoiceOnce = false;

/** Nächster Nav-Start: kein zweites Live-Guard (User hat „Zu Fuß“ gewählt). */
export function armSkipMobilityChoiceOnce(): void {
  skipMobilityChoiceOnce = true;
}

function consumeSkipMobilityChoice(): boolean {
  if (!skipMobilityChoiceOnce) return false;
  skipMobilityChoiceOnce = false;
  return true;
}

/**
 * Lange Strecke: ÖPNV zuerst planen, nicht erst 9s Fußroute zeigen.
 * true = Journey läuft, Fuß-Enrich überspringen.
 */
export async function tryAutoTransitBeforeWalk(opts: {
  destName: string;
  destLat: number;
  destLng: number;
  fromLat: number;
  fromLng: number;
  airMeters: number;
}): Promise<boolean> {
  if (skipMobilityChoiceOnce) return false;
  if (preferBikeActive()) return false;
  if (
    !airNeedsTransitLookahead({
      airMeters: opts.airMeters,
      preferBike: false,
    })
  ) {
    return false;
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
  try {
    const { planTransitHandsFree, startTransitHandsFree } = await import(
      './handsFreeNav/transitBridge'
    );
    const best = await Promise.race([
      planTransitHandsFree({
        from: { lat: opts.fromLat, lng: opts.fromLng },
        to: { lat: opts.destLat, lng: opts.destLng },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 7000)),
    ]);
    if (!best) return false;
    const transitMin = Math.max(1, Math.round(best.durationSec / 60));
    const walkMin = Math.max(1, Math.round(opts.airMeters / 70));
    rememberJourneyForStart({
      itinerary: best,
      destName: opts.destName,
      destLat: opts.destLat,
      destLng: opts.destLng,
    });
    const decision = decideAirMobility({
      airMeters: opts.airMeters,
      walkMin,
      transitMin,
      preferBike: false,
      taxiPref,
    });
    if (decision.kind !== 'auto_transit' || decision.includeTaxi) return false;
    const { setPreferredTravelMode } = require('./travelModeContext') as {
      setPreferredTravelMode: (m: 'transit' | 'foot' | 'bike' | null) => void;
    };
    setPreferredTravelMode('transit');
    const tr = await startTransitHandsFree({
      from: { lat: opts.fromLat, lng: opts.fromLng },
      to: { lat: opts.destLat, lng: opts.destLng },
      destName: opts.destName,
    });
    return Boolean(tr.ok);
  } catch {
    return false;
  }
}

function preferBikeActive(): boolean {
  try {
    const { resolveActiveTravelMode } = require('./travelModeContext') as {
      resolveActiveTravelMode: () => { mode: string };
    };
    return resolveActiveTravelMode().mode === 'bike';
  } catch {
    return false;
  }
}

/**
 * @returns deferredWalkSpeech wenn Walk-Opening entfallen soll.
 */
export async function offerMobilityChoiceAfterRouteReady(opts: {
  destName: string;
  destLat: number;
  destLng: number;
  walkMin: number;
  walkDistanceM: number;
  /** Expliziter Start (Nav-Origin) — robuster als nur Store-GPS. */
  fromLat?: number | null;
  fromLng?: number | null;
}): Promise<MobilityChoiceResult> {
  const walkMin = Math.max(1, Math.round(opts.walkMin));
  const empty: MobilityChoiceResult = {
    deferredWalkSpeech: false,
    walkMin,
    transitMin: null,
    taxiMin: null,
  };
  const skipArmed = skipMobilityChoiceOnce;
  const bike = preferBikeActive();
  const skipped = consumeSkipMobilityChoice();
  const store = useFinnusStore.getState();
  const lat =
    opts.fromLat != null && Number.isFinite(opts.fromLat)
      ? opts.fromLat
      : store.lastGpsLat;
  const lng =
    opts.fromLng != null && Number.isFinite(opts.fromLng)
      ? opts.fromLng
      : store.lastGpsLng;
  const airM =
    lat != null && lng != null
      ? haversineMeters(lat, lng, opts.destLat, opts.destLng)
      : opts.walkDistanceM;
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
  const lookahead = airNeedsTransitLookahead({
    airMeters: airM,
    preferBike: bike,
  });
  let reason = 'offer';
  if (skipped) reason = 'skip_armed';
  else if (!lookahead && walkMin <= PLAN_SOFT_MODE_MAX_MIN) reason = 'short';
  else if (lat == null || lng == null) reason = 'no_gps';
  if (skipped) return empty;
  if (!lookahead && walkMin <= PLAN_SOFT_MODE_MAX_MIN) return empty;
  if (lat == null || lng == null) return empty;

  let transitMin: number | null = null;
  try {
    const { planTransitHandsFree } = await import('./handsFreeNav/transitBridge');
    const TRANSIT_ASK_MS = 4500;
    const best = await Promise.race([
      planTransitHandsFree({
        from: { lat, lng },
        to: { lat: opts.destLat, lng: opts.destLng },
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), TRANSIT_ASK_MS),
      ),
    ]);
    if (best) {
      transitMin = Math.max(1, Math.round(best.durationSec / 60));
      rememberJourneyForStart({
        itinerary: best,
        destName: opts.destName,
        destLat: opts.destLat,
        destLng: opts.destLng,
      });
    }
  } catch {
    /* soft */
  }

  const taxiMin = approxTaxiMin(walkMin, opts.walkDistanceM);
  const decision = decideAirMobility({
    airMeters: airM,
    walkMin,
    transitMin,
    preferBike: bike,
    taxiPref,
  });

  if (decision.kind === 'walk' || decision.kind === 'bike') return empty;

  if (decision.kind === 'auto_transit' && !decision.includeTaxi) {
    try {
      const { setPreferredTravelMode } = require('./travelModeContext') as {
        setPreferredTravelMode: (m: 'transit' | 'foot' | 'bike' | null) => void;
      };
      setPreferredTravelMode('transit');
      const { startTransitHandsFree } = await import('./handsFreeNav/transitBridge');
      const tr = await startTransitHandsFree({
        from: { lat, lng },
        to: { lat: opts.destLat, lng: opts.destLng },
        destName: opts.destName,
      });
      if (tr.ok) {
        return {
          deferredWalkSpeech: true,
          walkMin,
          transitMin,
          taxiMin,
          autoStartedTransit: true,
        };
      }
    } catch {
      /* fall through to Live-Guard */
    }
  }

  try {
    const { presentMapNavMobilityAsk } = await import(
      '../homeMap/homeMapNavMobilityAsk'
    );
    void presentMapNavMobilityAsk({
      dest: {
        name: opts.destName,
        lat: opts.destLat,
        lng: opts.destLng,
      },
      origin: { lat, lng },
      walkMin,
      transitMin,
      airMeters: airM,
      includeTaxi: decision.includeTaxi,
      hideWalk: decision.kind === 'auto_transit',
      preferBike: bike,
    });
    return {
      deferredWalkSpeech: true,
      walkMin,
      transitMin,
      taxiMin,
    };
  } catch (err) {
    return empty;
  }
}
