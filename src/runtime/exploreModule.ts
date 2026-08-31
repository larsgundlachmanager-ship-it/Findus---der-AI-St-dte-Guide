/**
 * Modul 1 — Freies Erkunden (Phase 11 cutover).
 * GPS tick → TriggerEngine → Orchestrator → NarrationPipeline (Flows A/B/C).
 */

import { getPoiWithFacts, haversineMeters } from '../db/database';
import { effectiveTriggerRadiusM } from '../services/geo/triggerRadius';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from '../services/userProfileService';
import { getTideState } from '../services/geo/tideService';
import { env } from '../config/env';
import { tickDwellTracking } from '../services/locationTracker';
import { tickShoppingReminders } from '../services/shopping/tickShoppingReminders';
import { planFindusTrigger } from '../services/ai/findusTourDirector';
import {
  getCurrentTransportMode,
  getTrackMovementBearingDeg,
  tickFreeRoamMotion,
  tickNavigation,
  isNavigatingToPoi,
  shouldPauseExploreStoryForNavTurn,
  getDeviceHeadingDeg,
} from '../services/navigation';
import { thresholdsForMode } from '../services/navigation/transportMode';
import {
  isActiveBicycleMode,
  isDriveByTransitMode,
} from '../services/navigation/contextPitches';
import {
  clearApproachSpokenMemory,
  clearInterestWatch,
  getPendingInterestWatch,
  startInterestWatch,
  tickInterestWatch,
} from '../services/interestPatternDetector';
import { canSpeakExploreEvent } from '../services/navigation/modulePriorityPolicy';
import { isAheadOfMovement } from '../services/navigation/spatialOrientation';
import { bearingDegrees } from '../services/navigation/bearing';
import { resolveFacingBearingDeg } from '../services/navigation/facingReference';
import { getSmoothedSpeedMs } from '../services/navigation/transportMode';
import { recordPoiIgnoreIfRepeated } from '../interests/skipPatternLearning';
import { syncRuntimeFromFinnusStore } from './runtimeSync';
import { onGpsPoiCandidate } from './orchestrator';
import {
  clearTriggerSession,
  evaluateGpsTrigger,
  getTriggerSession,
  hasVisitedSpot,
  markTriggerSpoken,
  noteUserPosition,
  TRIGGER_UI_CLEAR_AFTER_MS,
  unmarkTriggerSpoken,
} from './triggerEngine';
import {
  executeNarrationPlan,
  interruptNarrationForForce,
  isNarrationBusy,
  runAwaitInterestNarration,
  runDriveByNarration,
  runTeaserWithInterestWatch,
  speakTeaserOnly,
} from './narrationPipeline';
import { resolveExploreDepth } from './exploreTriggerPolicy';
import {
  registerExploreDeferHandler,
  scheduleExploreDefer,
} from './exploreDeferQueue';
import { tickMobilityOnGps } from './mobilityModule';
import { tickGrowthOnGps } from './growthModule';

/**
 * Ambient „was heute geht“ (10 Min App offen + 60 s Stille → Events ~5 km;
 * max. 1 Ansage / 8 h).
 */
async function tickTemporaryLiveSpots(lat: number, lng: number): Promise<void> {
  try {
    const { tickAmbientEventPitch } = await import(
      '../services/research/ambientEventPitch'
    );
    await tickAmbientEventPitch(lat, lng);
  } catch (err) {
    if (__DEV__) console.warn('[explore] ambient event pitch', err);
  }
}
export { isNarrationBusy };

registerExploreDeferHandler((poiId) => {
  void triggerPoiArrival(poiId);
});

export function clearSpokenPoiSession(poiId?: number): void {
  clearTriggerSession(poiId);
  if (poiId == null) {
    clearInterestWatch();
    clearApproachSpokenMemory();
    return;
  }
  const pending = getPendingInterestWatch();
  if (pending?.poiId === poiId) clearInterestWatch();
}

function queueNextPoi(poiId: number): void {
  void triggerPoiArrival(poiId);
}

export async function triggerPoiArrival(
  poiId: number,
  opts?: {
    force?: boolean;
    interestDeepDive?: boolean;
    /** Nav-Arrival: kein Wegweiser, direkt Modul-1 Story */
    skipWegweiser?: boolean;
    /** Weitere Orte im 50-m-Bundle (max 1 Peer → 2 Audio total). */
    bundlePeerPois?: import('../db/types').Poi[];
    silentBundlePois?: import('../db/types').Poi[];
  },
): Promise<void> {
  // V2: Modul 3 Vorfahrt — Story lautlos pausieren wenn Abbiegehinweis ≤50 m
  // Simulation force (ohne interestDeepDive) darf trotzdem.
  if (shouldPauseExploreStoryForNavTurn()) {
    const hardForce = Boolean(opts?.force) && !opts?.interestDeepDive;
    if (!hardForce) {
      if (__DEV__) {
        console.log(
          `[geofence] pause explore #${poiId} — nav turn within 50m`,
        );
      }
      return;
    }
  }

  const pendingWatch = getPendingInterestWatch();
  if (
    pendingWatch?.poiId === poiId &&
    !opts?.force &&
    !opts?.interestDeepDive
  ) {
    return;
  }

  if (isNarrationBusy() && !opts?.force && !opts?.interestDeepDive) {
    if (__DEV__) {
      console.log(`[geofence] busy — defer POI #${poiId}`);
    }
    return;
  }

  if (opts?.force || opts?.interestDeepDive) {
    await interruptNarrationForForce();
  }

  const store = useFinnusStore.getState();
  const loaded = await getPoiWithFacts(poiId);
  if (!loaded) {
    console.warn('[geofence] POI not found:', poiId);
    return;
  }
  const poi = loaded;

  const kind = poi.kind ?? 'legacy';

  // Nav zu diesem Ort / Parent: Approach-Wegweiser unterdrücken (geotrigger)
  if (
    kind === 'approach' &&
    !opts?.force &&
    !opts?.interestDeepDive
  ) {
    try {
      const parentId = poi.parent_poi_id;
      if (
        (parentId != null && isNavigatingToPoi(parentId)) ||
        isNavigatingToPoi(poiId)
      ) {
        if (__DEV__) {
          console.log(`[geofence] skip approach #${poiId} — nav destination`);
        }
        return;
      }
    } catch {
      /* soft */
    }
  }

  const profile = getCachedUserProfile();
  if (!opts?.force && profile?.notificationsEnabled === false) {
    if (__DEV__) {
      console.log('[geofence] skip — Nutzer hat Hinweise zu Orten aus');
    }
    return;
  }

  const condition = poi.condition_rule ?? 'always';
  const tide =
    condition === 'tide_low'
      ? await getTideState(profile?.cityId || env.cityId() || 'wangerooge')
      : undefined;

  const heardApproach =
    !!poi.spot_key &&
    (store.heardApproachSpotKeys.includes(poi.spot_key) ||
      hasVisitedSpot(`${poi.spot_key}__approach`));

  const trig = getTriggerSession();
  const skipWeg = Boolean(opts?.skipWegweiser) || (
    Boolean(opts?.force) && isNavigatingToPoi(poiId)
  );
  let plan = await planFindusTrigger({
    poi,
    profile,
    spokenAreaIds: trig.spokenAreaIds,
    spokenApproachIds: trig.spokenApproachIds,
    spokenSubIds: trig.spokenSubIds,
    userLat: trig.lastLat,
    userLng: trig.lastLng,
    force: opts?.force,
    approachAlreadyHeard: heardApproach || skipWeg,
    policyCtx: {
      profile,
      lastMealHintAtMs: store.lastMealHintAtMs,
      softPitchedSpotKeys: new Set(store.softPitchedSpotKeys),
      firstName: profile?.firstName,
      tide,
    },
  });
  // Nav-Arrival: flüssig Welcome → Modul-1 Story (kein Wegweiser)
  if (
    skipWeg &&
    (plan.action === 'approach_hook' || kind === 'approach')
  ) {
    if (kind === 'approach' && poi.parent_poi_id != null) {
      await triggerPoiArrival(poi.parent_poi_id, {
        ...opts,
        force: true,
        skipWegweiser: true,
      });
      return;
    }
    plan = { action: 'full_story', reason: 'nav_arrival_skip_wegweiser' };
  }

  if (plan.action === 'redirect_sub') {
    if (__DEV__) {
      console.log(
        `[geofence] redirect → Sub #${plan.subPoiId} (${plan.reason})`,
      );
    }
    await triggerPoiArrival(plan.subPoiId, opts);
    return;
  }

  if (plan.action === 'skip') {
    if (__DEV__) {
      console.log(`[geofence] skip ${poi.name} (${plan.reason})`);
    }
    const transient =
      /tide_not_low|already_spoken|cooldown|defer|neutral_cooldown|moving_away|sibling_approach_soft_lock/.test(
        plan.reason,
      );
    if (!transient) {
      markTriggerSpoken(poiId, kind);
    }
    return;
  }

  // Modul-1 Pausen — Defer + Recheck, kein permanentes Skip
  if (!opts?.force && !opts?.interestDeepDive) {
    const exploreKind =
      plan.action === 'approach_hook' || kind === 'approach'
        ? 'approach'
        : 'main';
    const gate = canSpeakExploreEvent(exploreKind, {
      spotKey: poi.spot_key,
      relatedToLastWegweiser: heardApproach,
    });
    if (!gate.ok) {
      if (__DEV__) {
        console.log(`[geofence] cooldown defer #${poiId} (${gate.reason})`);
      }
      scheduleExploreDefer({
        poiId,
        lat: poi.lat,
        lng: poi.lng,
        radiusM: effectiveTriggerRadiusM(poi),
        cooldownRemainingMs: gate.remainingMs ?? 10_000,
        reason: gate.reason ?? 'cooldown',
      });
      return;
    }
  }

  // Wegweiser nicht auslösen, wenn der Ort hinter dem User liegt (weglaufen)
  if (
    (plan.action === 'approach_hook' || kind === 'approach') &&
    !opts?.force &&
    trig.lastLat != null &&
    trig.lastLng != null
  ) {
    const targetBearing = bearingDegrees(
      trig.lastLat,
      trig.lastLng,
      poi.lat,
      poi.lng,
    );
    const facing = resolveFacingBearingDeg({
      speedMs: getSmoothedSpeedMs(),
      movementBearingDeg: getTrackMovementBearingDeg(),
      deviceHeadingDeg: getDeviceHeadingDeg(),
    });
    if (
      !isAheadOfMovement(
        facing.bearingDeg,
        facing.bearingDeg,
        targetBearing,
        95,
      )
    ) {
      if (__DEV__) {
        console.log(
          `[geofence] skip approach #${poiId} — target behind movement`,
        );
      }
      return;
    }
  }

  if (opts?.force) {
    unmarkTriggerSpoken(poiId, kind);
    if (kind !== 'approach') store.setLastVisitedPoiId(null);
  }

  const tideSoftPitch =
    plan.action === 'soft_pitch' && plan.reason === 'tide_unknown';

  const motionMode = getCurrentTransportMode();
  const navigatingHere = isNavigatingToPoi(poiId);
  const storeNav = useFinnusStore.getState();
  const trigPos = getTriggerSession();

  const depthAction =
    plan.action === 'interest_override' ? 'full_story' : plan.action;

  const depthResult = await resolveExploreDepth({
    navActive: storeNav.navActive,
    lat: trigPos.lastLat ?? poi.lat,
    lng: trigPos.lastLng ?? poi.lng,
    poiId: poi.id,
    poiLat: poi.lat,
    poiLng: poi.lng,
    planAction: depthAction,
    speedMs: opts?.force ? 0 : getSmoothedSpeedMs(),
    radiusScale: thresholdsForMode(motionMode).geofenceRadiusScale,
    force: opts?.force,
    interestDeepDive: opts?.interestDeepDive,
    navExploreMode: profile?.navExploreMode ?? 'quiet',
    isNavDestination: navigatingHere,
    spotKey: poi.spot_key,
  });

  if (depthResult.depth === 'skip') {
    if (__DEV__) {
      console.log(
        `[geofence] depth=skip #${poiId} (${depthResult.reason})`,
      );
    }
    // mute_until_dest etc. — kein Defer
    return;
  }

  const transitDriveBy =
    isDriveByTransitMode(motionMode) && !navigatingHere && kind !== 'sub';
  const bicyclePass =
    isActiveBicycleMode(motionMode) && !navigatingHere && kind !== 'sub';

  const narrationCtx = {
    poi,
    plan,
    profile,
    kind,
    heardApproach,
    motionMode,
    tideSoftPitch,
    opts,
    onQueuedPoi: queueNextPoi,
    bundlePeerPois: opts?.bundlePeerPois,
    silentBundlePois: opts?.silentBundlePois,
  };

  if (
    (transitDriveBy || bicyclePass) &&
    !opts?.force &&
    !opts?.interestDeepDive
  ) {
    await runDriveByNarration(narrationCtx);
    return;
  }

  // Teaser-Tiefe: Wegweiser-Hook + Interest-Watch (User stoppt → Vollerzählung)
  if (
    depthResult.depth === 'teaser' &&
    !opts?.force &&
    !opts?.interestDeepDive
  ) {
    if (plan.action === 'approach_hook' || kind === 'approach') {
      await executeNarrationPlan(narrationCtx);
      return;
    }
    if (__DEV__) {
      console.log(
        `[geofence] depth=teaser #${poiId} (${depthResult.reason})`,
      );
    }
    await runTeaserWithInterestWatch(narrationCtx);
    return;
  }

  // Interest-Override: voller Story-Pfad mit Hook-Fokus (kein Approach-Vorlauf)
  if (plan.action === 'interest_override') {
    await executeNarrationPlan(narrationCtx);
    return;
  }

  // Volle Tiefe: Story direkt (Approach schon gehört oder Hauptort ohne Warten)
  if (
    plan.action === 'full_story' &&
    !opts?.force &&
    !opts?.interestDeepDive &&
    !heardApproach &&
    kind !== 'sub'
  ) {
    const approachPlan = { ...plan, action: 'approach_hook' as const, reason: 'teaser_before_full' };
    await executeNarrationPlan({ ...narrationCtx, plan: approachPlan });
    startInterestWatch({
      poiId: poi.id,
      name: poi.name,
      lat: poi.lat,
      lng: poi.lng,
      transportHint: motionMode,
    });
    return;
  }

  await executeNarrationPlan(narrationCtx);
}

/** Main GPS entry — geofence match → explore trigger → narration. */
export async function handleLocationUpdate(
  lat: number,
  lng: number,
  opts?: { speedMs?: number | null; headingDeg?: number | null },
): Promise<void> {
  try {
    const { isExploreHeld } = require('./exploreHold') as {
      isExploreHeld: () => boolean;
    };
    if (isExploreHeld()) {
      const storeEarly = useFinnusStore.getState();
      if (storeEarly.navActive) {
        tickNavigation(
          lat,
          lng,
          typeof opts?.headingDeg === 'number' ? opts.headingDeg : undefined,
          opts?.speedMs ?? null,
        );
      }
      return;
    }
  } catch {
    /* soft */
  }
  const motionMode = tickFreeRoamMotion(opts?.speedMs ?? null);
  const radiusScale = thresholdsForMode(motionMode).geofenceRadiusScale;

  const storeEarly = useFinnusStore.getState();
  if (storeEarly.navActive) {
    tickNavigation(
      lat,
      lng,
      typeof opts?.headingDeg === 'number' ? opts.headingDeg : undefined,
      opts?.speedMs ?? null,
    );
  }

  void tickMobilityOnGps(lat, lng, {
    speedMs: opts?.speedMs ?? null,
    headingDeg: opts?.headingDeg ?? null,
    transportMode: motionMode,
    audioBusy: storeEarly.isPlayingAudio || isNarrationBusy(),
  });
  void tickGrowthOnGps(lat, lng, {
    headingDeg: opts?.headingDeg ?? null,
  });
  void tickTemporaryLiveSpots(lat, lng);

  void tickDwellTracking(lat, lng).catch((err) =>
    console.warn('[dwell] tick failed:', err),
  );

  const pending = getPendingInterestWatch();
  if (pending && !isNarrationBusy()) {
    const reason = tickInterestWatch({
      lat,
      lng,
      speedMs: opts?.speedMs ?? null,
      headingDeg: opts?.headingDeg ?? null,
      transportMode: motionMode,
    });
    if (reason === 'abandoned') {
      void recordPoiIgnoreIfRepeated(pending.poiId);
      noteUserPosition(lat, lng);
      return;
    }
    if (reason) {
      if (__DEV__) {
        console.log(
          `[geofence] interest=${reason} → deep-dive #${pending.poiId}`,
        );
      }
      noteUserPosition(lat, lng);
      await triggerPoiArrival(pending.poiId, {
        force: true,
        interestDeepDive: true,
      });
      return;
    }
    if (
      haversineMeters(lat, lng, pending.lat, pending.lng) <=
      pending.zoneM * 1.5
    ) {
      noteUserPosition(lat, lng);
      return;
    }
  }

  syncRuntimeFromFinnusStore();
  const store = useFinnusStore.getState();
  if (store.isListening) {
    noteUserPosition(lat, lng);
    return;
  }

  // Modul 1 / auto-triggers: only active selected (or in-focus) pack via SQLite.
  // Other downloaded cities stay on disk for Q&A but never fire geofence stories here.
  try {
    const { isPackSpeechAllowed } = require('../services/softWorkingCity') as {
      isPackSpeechAllowed: () => boolean;
    };
    if (!isPackSpeechAllowed()) {
      noteUserPosition(lat, lng);
      return;
    }
  } catch {
    /* soft */
  }

  const engineResult = await evaluateGpsTrigger({
    lat,
    lng,
    speedMs: opts?.speedMs ?? null,
    headingDeg: opts?.headingDeg ?? null,
    radiusScale,
    transportMode:
      motionMode === 'bicycle'
        ? 'bicycle'
        : motionMode === 'walk' || motionMode === 'jog'
          ? 'walk'
          : motionMode === 'transit_bus' || motionMode === 'transit_train'
            ? 'transit'
            : 'unknown',
  });

  if (engineResult.action === 'none') {
    const { lastVisitedPoiId, setCurrentLocationName, setCurrentPoiId } =
      useFinnusStore.getState();

    if (
      lastVisitedPoiId !== null &&
      engineResult.outsideSinceMs != null &&
      Date.now() - engineResult.outsideSinceMs >= TRIGGER_UI_CLEAR_AFTER_MS
    ) {
      setCurrentLocationName(null);
      setCurrentPoiId(null);
    }

    void tickShoppingReminders(lat, lng).catch((err) =>
      console.warn('[shopping] tick failed:', err),
    );
    return;
  }

  if (engineResult.action === 'skip') {
    if (engineResult.persistSpoken) {
      markTriggerSpoken(
        engineResult.poiId,
        engineResult.reason === 'teaser_locked' ? 'approach' : undefined,
      );
    }
    if (__DEV__) {
      console.log(
        `[geofence] triggerEngine skip #${engineResult.poiId} (${engineResult.reason})`,
      );
    }
    return;
  }

  const match = engineResult.match;
  const decision = onGpsPoiCandidate(match.poi.id);

  if (decision.action === 'queue_gps_trigger') {
    if (__DEV__) {
      console.log(`[geofence] queued POI #${decision.poiId} (Yorro spricht)`);
    }
    return;
  }

  if (decision.action === 'skip_gps_trigger') {
    if (
      decision.reason === 'after_poi_complete' ||
      decision.reason === 'after_user_question' ||
      decision.reason === 'during_navigation'
    ) {
      scheduleExploreDefer({
        poiId: match.poi.id,
        lat: match.poi.lat,
        lng: match.poi.lng,
        radiusM: effectiveTriggerRadiusM(match.poi),
        cooldownRemainingMs: decision.remainingMs ?? 10_000,
        reason: decision.reason,
      });
    }
    if (__DEV__) {
      console.log(
        `[geofence] skip ${match.poi.name} (runtime: ${decision.reason})`,
      );
    }
    return;
  }

  if (isNarrationBusy()) {
    if (__DEV__) {
      console.log(`[geofence] busy — defer POI #${match.poi.id}`);
    }
    return;
  }

  if (shouldPauseExploreStoryForNavTurn()) {
    if (__DEV__) {
      console.log(
        `[geofence] pause explore #${match.poi.id} — nav turn within 50m`,
      );
    }
    return;
  }

  await triggerPoiArrival(match.poi.id, {
    bundlePeerPois: engineResult.bundlePeerPois,
    silentBundlePois: engineResult.silentBundlePois,
  });
}
