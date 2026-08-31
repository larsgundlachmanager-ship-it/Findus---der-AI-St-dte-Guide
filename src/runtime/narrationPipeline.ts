/**
 * Modul 1 Narration Pipeline — Flows A/B/C (Reboot: nur POI-Chat).
 *
 * Flow A — Wegweiser: Code-lookPhrase + 2-Satz-Teaser (module1PoiChat)
 * Flow B — Hauptort: Multi-Turn Chat, Hook mittendrin, LOCK
 * Flow C — Nebenort: gleicher Story-Pfad wie B
 */

import {
  getChildPois,
  getPoiWithFacts,
  getAllPois,
  haversineMeters,
} from '../db/database';
import type { Poi, PoiKind, PoiWithFacts } from '../db/types';
import type { UserProfile } from '../types/userProfile';
import { buildPoiResearchContext } from '../constants/prompts';
import { filterDeepStoryFacts } from '../services/ai/deepStoryFilter';
import { extractOfflineGeneralInfo } from '../services/ai/singleShotStory';
import { commitNarrationFeatureTips } from './featureTipsModule';
import {
  buildFastHook,
  buildWegweiserHook,
  classifyPoiHookKind,
  extractWegweiserDestination,
} from '../services/ai/fastHook';
import { lockPoiTeaser } from '../services/poi/poiTeaserLocks';
import { sentencesFromFullText } from '../services/ai/sentenceStream';
import { getVoiceSettingsForTour, stopSpeaking } from '../services/ttsService';
import { speakRuntimeSentences, speakRuntimeText } from './speechModule';
import { useFinnusStore } from '../store/useFinnusStore';
import { shortPoiDisplayName } from '../utils/poiDisplayName';
import { parseTagsJson } from '../services/geo/triggerPolicy';
import {
  buildFindusStoryBrief,
  type FindusTriggerPlan,
} from '../services/ai/findusTourDirector';
import {
  notifyDestinationAudioStarted,
  notifyDestinationAudioEnded,
  isNavigatingToPoi,
  shouldPauseExploreStoryForNavTurn,
  getDeviceHeadingDeg,
  getMovementBearingDeg,
} from '../services/navigation';
import { toStampSummary } from '../services/navigation/stampBullets';
import { presentModule1LiveCard } from '../services/poi/module1LiveCard';
import {
  buildBicycleContextPitch,
  buildTransitDriveByPitch,
  isActiveBicycleMode,
  isDriveByTransitMode,
  resolveBikeParkHintNear,
} from '../services/navigation/contextPitches';
import { setGpsStreamProfile } from '../services/locationService';
import { updateAdaptiveGpsProfile } from '../services/adaptiveGpsService';
import {
  playPrefetchedPoiIfReady,
  takePrefetchedTeaserText,
} from '../services/navigation/poiPrefetchService';
import { hapticAttentionCue } from '../services/navigation/haptics';
import {
  clearInterestWatch,
  getPendingInterestWatch,
  noteApproachSpoken,
  startInterestWatch,
  softLockSiblingApproaches,
  unlockSiblingApproaches,
  wasApproachSpokenRecently,
} from '../services/interestPatternDetector';
import {
  noteMainPoiSpoken,
  noteWegweiserSpoken,
} from '../services/navigation/modulePriorityPolicy';
import {
  recordApproachFire,
  clearApproachFiresForSpot,
} from '../services/poi/approachFireTracker';
import {
  formatApproachBundleSpeech,
} from '../services/navigation/wegweiserBundlePolicy';
import { getCachedUserProfile } from '../services/userProfileService';
import { useUserMemoryStore } from '../store/useUserMemoryStore';
import { bearingDegrees } from '../services/navigation/bearing';
import { relateFromRelativeBearing } from '../services/navigation/spatialOrientation';
import {
  resolveFacingBearingDeg,
  relateTargetToFacing,
} from '../services/navigation/facingReference';
import { getSmoothedSpeedMs } from '../services/navigation/transportMode';
import { generateApproachVisualCue } from './approachVisualCue';
import { onPoiNarrationComplete } from './orchestrator';
import { condenseForBikeMode } from './mobilityModule';
import {
  warmApproachVisualAssets,
} from './growthModule';
import { fetchNearbyPlaceLandmarks } from '../services/navigation/googleMapsNav';
import {
  getLastUserPosition,
  getTriggerSession,
  hasVisitedSpot,
  markSpotVisited,
  markTriggerSpoken,
  sessionSetForKind,
  unmarkTriggerSpoken,
} from './triggerEngine';
import type { MotionTransportMode } from '../services/navigation/transportMode';

export type NarrationFlowKind = 'approach' | 'main' | 'sub';

export type NarrationRunOpts = {
  force?: boolean;
  interestDeepDive?: boolean;
};

export type NarrationContext = {
  poi: PoiWithFacts;
  plan: FindusTriggerPlan;
  profile: UserProfile | null;
  kind: string;
  heardApproach: boolean;
  motionMode: MotionTransportMode;
  tideSoftPitch: boolean;
  opts?: NarrationRunOpts;
  onQueuedPoi: (poiId: number) => void;
  /** Max 1 Peer (zusammen mit Primary = 2 Audio-Orte). */
  bundlePeerPois?: Poi[];
  silentBundlePois?: Poi[];
};

let narrationBusy = false;
let narrationEpoch = 0;

export function isNarrationBusy(): boolean {
  return narrationBusy;
}

export function tryAcquireNarrationLock(opts?: {
  force?: boolean;
  interestDeepDive?: boolean;
}): number | null {
  if (narrationBusy && !opts?.force && !opts?.interestDeepDive) {
    return null;
  }
  if (opts?.force || opts?.interestDeepDive) {
    narrationBusy = false;
  }
  return ++narrationEpoch;
}

export function releaseNarrationLock(epoch: number): void {
  if (epoch === narrationEpoch) {
    narrationBusy = false;
  }
}

export function displayPoiName(poi: Poi): string {
  return shortPoiDisplayName(poi.name);
}

function buildVisitedMemoryEntry(
  poi: PoiWithFacts,
  keyFacts: string[],
  opts?: { onTimeline?: boolean },
): {
  poiId: number;
  name: string;
  kind: ReturnType<typeof classifyPoiHookKind>;
  keyFacts: string[];
  visitedAt: number;
  onTimeline?: boolean;
  lat?: number | null;
  lng?: number | null;
  cityId?: string | null;
} {
  const cityId =
    (getCachedUserProfile()?.cityId ?? '').trim().toLowerCase() || null;
  return {
    poiId: poi.id,
    name: shortPoiDisplayName(poi.name),
    kind: classifyPoiHookKind(poi),
    keyFacts,
    visitedAt: Date.now(),
    onTimeline: opts?.onTimeline ?? true,
    lat: Number.isFinite(poi.lat) ? poi.lat : null,
    lng: Number.isFinite(poi.lng) ? poi.lng : null,
    cityId,
  };
}

/** 50-m Bundle: max 2 Namen im Audio; Rest bleibt stumm (UI). */
function applyApproachBundleTeaser(
  ctx: NarrationContext,
  teaser: string,
  visualCue: string | null,
): string {
  const peers = (ctx.bundlePeerPois ?? []).slice(0, 1);
  if (!peers.length) return teaser;
  const names = [displayPoiName(ctx.poi), ...peers.map(displayPoiName)];
  const bundled = formatApproachBundleSpeech({
    names,
    visualCue: visualCue || null,
  });
  // Bundle ersetzt Schachtelsätze — kurzer Hook hinten optional
  const hookTail = teaser
    .replace(visualCue ?? '', '')
    .trim()
    .slice(0, 90);
  if (hookTail && hookTail.length > 20 && !bundled.includes(names[1]!)) {
    return `${bundled} ${hookTail}`.trim();
  }
  return bundled || teaser;
}

function markBundlePeersSpoken(ctx: NarrationContext): void {
  const store = useFinnusStore.getState();
  for (const peer of ctx.bundlePeerPois ?? []) {
    markTriggerSpoken(peer.id, (peer.kind as PoiKind) ?? 'approach');
    if (peer.spot_key) {
      store.addHeardApproachSpotKey(peer.spot_key);
      markSpotVisited(`${peer.spot_key}__approach`);
      noteApproachSpoken(peer.spot_key);
      softLockSiblingApproaches(peer.parent_poi_id ?? peer.id);
    }
  }
  // Silent UI peers: optional live card only — not spoken, still soft-lock siblings
  for (const peer of ctx.silentBundlePois ?? []) {
    if (peer.spot_key) {
      softLockSiblingApproaches(peer.parent_poi_id ?? peer.id);
    }
  }
}

function isFoodish(poi: Poi): boolean {
  const tags = parseTagsJson(poi.tags_json);
  const cat = (poi.category ?? '').toLowerCase();
  return (
    tags.some((t) =>
      [
        'fischrestaurant',
        'restaurant',
        'cafe',
        'café',
        'streetfood',
        'food',
        'gastronomie',
        'fruehstueck',
        'mittag',
        'abendessen',
      ].includes(t),
    ) ||
    ['restaurant', 'cafe', 'café', 'streetfood', 'fischrestaurant'].includes(cat)
  );
}

function factKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

async function setPendingOfferFromPoi(poi: PoiWithFacts): Promise<void> {
  let poiId = poi.parent_poi_id ?? poi.id;
  let name = displayPoiName(poi);
  let lat = poi.lat;
  let lng = poi.lng;

  // Wegweiser → Nav zum Haupteingang (Parent), nie zum Approach-Punkt
  if (poi.parent_poi_id != null || poi.kind === 'approach') {
    try {
      const parentId = poi.parent_poi_id ?? poi.id;
      const parent = await getPoiWithFacts(parentId);
      if (parent) {
        poiId = parent.id;
        name = displayPoiName(parent);
        lat = parent.lat;
        lng = parent.lng;
        const kids = await getChildPois(parent.id);
        const entrance =
          kids.find(
            (c) =>
              /eingang|entrance|haupteingang/i.test(c.name || '') ||
              (c.kind === 'sub' && /gps_entrance|eingang/i.test(c.tags_json || '')),
          ) || null;
        if (
          entrance &&
          Number.isFinite(entrance.lat) &&
          Number.isFinite(entrance.lng)
        ) {
          lat = entrance.lat;
          lng = entrance.lng;
          name = displayPoiName(parent);
        }
      }
    } catch {
      /* soft — Fallback Approach-Coords */
    }
  }

  const { armWegweiserMapPreview } = await import(
    '../services/navigation/wegweiserMapPreview'
  );
  await armWegweiserMapPreview({ poiId, name, lat, lng });
}

/** Nach Wegweiser: Route-Button zum Hauptort (Just-Do-It). */
async function presentApproachRouteCard(approachPoi: PoiWithFacts): Promise<void> {
  const parentId = approachPoi.parent_poi_id;
  if (parentId == null) return;
  try {
    const parent = await getPoiWithFacts(parentId);
    if (!parent) return;
    let destLat = parent.lat;
    let destLng = parent.lng;
    const kids = await getChildPois(parent.id);
    const entrance = kids.find((c) =>
      /eingang|haupteingang|entrance/i.test(c.name || ''),
    );
    if (entrance) {
      destLat = entrance.lat;
      destLng = entrance.lng;
    }
    const title = displayPoiName(parent);
    const distHint =
      Number.isFinite(destLat) && Number.isFinite(destLng)
        ? (() => {
            try {
              const { lastGpsLat, lastGpsLng } = useFinnusStore.getState();
              if (
                typeof lastGpsLat === 'number' &&
                typeof lastGpsLng === 'number'
              ) {
                const m = Math.round(
                  haversineMeters(lastGpsLat, lastGpsLng, destLat, destLng),
                );
                if (m > 0 && m < 5000) return `ca. ${m} m`;
              }
            } catch {
              /* soft */
            }
            return null;
          })()
        : null;
    useFinnusStore.getState().setActiveConciergeCard({
      id: `wegweiser_nav_${parent.id}_${Date.now()}`,
      createdAtMs: Date.now(),
      speechText: '',
      visualBullets: [
        distHint ? `Route zu ${title} (${distHint})` : `Route zu ${title}`,
        'Linie auf der Karte — Route starten',
      ].slice(0, 2),
      quickActions: [
        {
          type: 'START_NAVIGATION',
          label: '📍 Route hin',
          payload: {
            destLat,
            destLng,
            destName: title,
            targetPoiId: parent.id,
            keepCard: true,
          },
        },
      ],
      cardTitle: title,
    });
  } catch {
    /* soft */
  }
}

export async function speakTeaserOnly(
  text: string,
  onQueuedPoi: (poiId: number) => void,
): Promise<void> {
  const store = useFinnusStore.getState();
  store.addChatMessage({ role: 'assistant', content: text });
  store.addToldFactKeys([factKey(text)]);
  store.setIsGenerating(false);
  // Kein stopSpeaking — Modul 1 darf Fragen/Navi nicht killen (Priority-Queue).
  const voiceSettings = await getVoiceSettingsForTour();
  try {
    const poiId = store.currentPoiId;
    if (poiId != null) {
      const { beginNarrationResume, completeNarrationResume } = await import(
        '../services/session/narrationResumeState'
      );
      beginNarrationResume({
        poiId,
        poiName: store.currentLocationName || `Ort #${poiId}`,
        kind: 'teaser',
        fullText: text,
      });
      try {
        await speakRuntimeText(
          text,
          {
            voiceId: voiceSettings.voiceId,
            speechRate: voiceSettings.speechRate,
          },
          { priority: 'explore' },
        );
      } finally {
        completeNarrationResume();
      }
    } else {
      await speakRuntimeText(
        text,
        {
          voiceId: voiceSettings.voiceId,
          speechRate: voiceSettings.speechRate,
        },
        { priority: 'explore' },
      );
    }
  } finally {
    store.setIsPlayingAudio(false);
    /* GPS queue flush via AudioVoiceService → notifyRuntimeSpeechEnded */
  }
}

function kickArrivalPrefetch(
  poi: PoiWithFacts,
  profile: UserProfile | null | undefined,
): void {
  void import('../services/ai/module1PoiChat')
    .then(({ prefetchModule1Arrival }) => {
      const brief = buildFindusStoryBrief({
        poi,
        profile,
        sessionMemory: { entries: useFinnusStore.getState().visitedHistory },
      });
      prefetchModule1Arrival({
        poi,
        profile,
        approachAlreadyHeard: true,
        storyBriefBlock: brief.promptBlock,
      });
    })
    .catch(() => {
      /* soft */
    });
}

async function buildSubHintLine(areaPoiId: number): Promise<string | null> {
  const children = await getChildPois(areaPoiId);
  const { spokenSubIds } = getTriggerSession();
  const openSubs = children.filter(
    (c) => c.kind === 'sub' && !spokenSubIds.has(c.id),
  );
  if (openSubs.length === 0) return null;
  const names = openSubs.slice(0, 2).map((s) => shortPoiDisplayName(s.name));
  if (names.length === 1) {
    return `Wenn du magst, können wir noch zu ${names[0]} — liegt direkt hier in der Nähe.`;
  }
  return `Wenn du magst, liegen ${names[0]} und ${names[1]} auch nah — sag Bescheid.`;
}

/** Nähe ≤50 m: Sub oder anderer ungesprochener Anker. */
async function buildNearbyInviteLine(
  poi: PoiWithFacts,
): Promise<string | null> {
  const sub = await buildSubHintLine(poi.id);
  if (sub) return sub;
  const { lastLat, lastLng, spokenAreaIds, spokenSubIds } = getTriggerSession();
  if (lastLat == null || lastLng == null) return null;
  const all = await getAllPois();
  const nearby = all
    .filter((p) => {
      if (p.id === poi.id) return false;
      if (spokenAreaIds.has(p.id) || spokenSubIds.has(p.id)) return false;
      const kind = p.kind ?? 'legacy';
      if (kind === 'approach') return false;
      return haversineMeters(lastLat, lastLng, p.lat, p.lng) <= 50;
    })
    .sort(
      (a, b) =>
        haversineMeters(lastLat, lastLng, a.lat, a.lng) -
        haversineMeters(lastLat, lastLng, b.lat, b.lng),
    );
  const hit = nearby[0];
  if (!hit) return null;
  return `Wenn du magst, ist ${shortPoiDisplayName(hit.name)} auch nur einen Steinwurf entfernt.`;
}

/** Flow A step 1 — offline landmark visual cue before teaser. */
export async function buildApproachVisualCue(
  approachPoi: PoiWithFacts,
): Promise<string | null> {
  const { lastLat, lastLng } = getTriggerSession();
  if (lastLat == null || lastLng == null) return null;

  let targetLat = approachPoi.lat;
  let targetLng = approachPoi.lng;
  if (approachPoi.parent_poi_id != null) {
    const parent = await getPoiWithFacts(approachPoi.parent_poi_id);
    if (parent) {
      targetLat = parent.lat;
      targetLng = parent.lng;
    }
  }

  void warmApproachVisualAssets({
    userLat: lastLat,
    userLng: lastLng,
    targetLat,
    targetLng,
  });

  const destName = extractWegweiserDestination(approachPoi.name);
  const pois = await getAllPois();
  const excludeIds = new Set([approachPoi.id, approachPoi.parent_poi_id ?? -1]);

  let bestLandmark: { name: string; lat: number; lng: number; dist: number } | null =
    null;
  for (const p of pois) {
    if (excludeIds.has(p.id)) continue;
    const d = haversineMeters(lastLat, lastLng, p.lat, p.lng);
    if (d > 85 || d < 8) continue;
    const label = displayPoiName(p);
    if (!label || label.length < 3) continue;
    if (!bestLandmark || d < bestLandmark.dist) {
      bestLandmark = { name: label, lat: p.lat, lng: p.lng, dist: d };
    }
  }

  if (!bestLandmark) {
    try {
      const nearby = await fetchNearbyPlaceLandmarks(lastLat, lastLng, 70);
      const hit = nearby.find((n) => n.name.trim().length >= 3);
      if (hit) {
        bestLandmark = {
          name: hit.name,
          lat: hit.lat,
          lng: hit.lng,
          dist: hit.distanceM,
        };
      }
    } catch {
      /* offline / cache miss */
    }
  }

  const toTarget = bearingDegrees(lastLat, lastLng, targetLat, targetLng);

  // Moving → GPS vector; standing → compass — left/right relative to facing
  const facing = resolveFacingBearingDeg({
    speedMs: getSmoothedSpeedMs(),
    movementBearingDeg: getMovementBearingDeg(),
    deviceHeadingDeg: getDeviceHeadingDeg(),
  });
  const targetRelation = relateTargetToFacing(facing, toTarget);
  // Facing unsicher → keine links/rechts-Rate; Landmarken statt Seite
  const facingUncertain =
    facing.source === 'unknown' || facing.bearingDeg == null;
  const lookSidePhrase = facingUncertain
    ? null
    : (targetRelation?.shortPhrase ?? 'vorne');

  const landmarkRelation = bestLandmark
    ? facingUncertain
      ? 'in der Nähe'
      : relateTargetToFacing(
          facing,
          bearingDegrees(lastLat, lastLng, bestLandmark.lat, bestLandmark.lng),
        )?.sidePhrase ??
        relateFromRelativeBearing(
          ((bearingDegrees(
            lastLat,
            lastLng,
            bestLandmark.lat,
            bestLandmark.lng,
          ) -
            (facing.bearingDeg ?? toTarget) +
            540) %
            360) -
            180,
        ).sidePhrase
    : lookSidePhrase;

  const geminiCue = await generateApproachVisualCue({
    destName,
    landmarkName: bestLandmark?.name ?? null,
    landmarkRelation,
    userLat: lastLat,
    userLng: lastLng,
    targetLat,
    targetLng,
    headingDeg: facing.bearingDeg ?? toTarget,
    lookSidePhrase,
    facingSource: facing.source,
  });
  if (geminiCue) return geminiCue;

  // Offline / no-Gemini fallback — still visual-first
  if (bestLandmark) {
    if (facingUncertain || !lookSidePhrase) {
      return `Richtung ${bestLandmark.name} — dort geht's weiter zu ${destName}.`;
    }
    return `Schau nach ${lookSidePhrase}. Siehst du ${bestLandmark.name}? Genau dahin.`;
  }
  if (facingUncertain || !lookSidePhrase) {
    return `Weiter Richtung ${destName} — folg der Linie auf der Karte.`;
  }
  return `Schau nach ${lookSidePhrase} — dort geht's weiter Richtung ${destName}.`;
}

function resolveFlowKind(kind: string): NarrationFlowKind {
  if (kind === 'approach') return 'approach';
  if (kind === 'sub') return 'sub';
  return 'main';
}

export async function runDriveByNarration(ctx: NarrationContext): Promise<void> {
  const { poi, kind, motionMode, opts, onQueuedPoi } = ctx;
  const poiId = poi.id;
  const store = useFinnusStore.getState();
  const transitDriveBy =
    isDriveByTransitMode(motionMode) &&
    !isNavigatingToPoi(poiId) &&
    kind !== 'sub';

  if (!opts?.force && sessionSetForKind(kind).has(poiId)) {
    return;
  }

  markTriggerSpoken(poiId, kind);
  store.setCurrentPoiId(poi.id);
  store.setCurrentLocationName(displayPoiName(poi));

  const epoch = tryAcquireNarrationLock(opts);
  if (epoch == null) return;
  narrationBusy = true;

  try {
    hapticAttentionCue();
    const pitchRaw = transitDriveBy
      ? buildTransitDriveByPitch(poi, { nextStationHint: store.navTargetName })
      : buildBicycleContextPitch(poi, {
          parkHint: await resolveBikeParkHintNear(poi.lat, poi.lng),
        });
    const pitch =
      !transitDriveBy && isActiveBicycleMode(motionMode)
        ? condenseForBikeMode(pitchRaw)
        : pitchRaw;
    store.setIsGenerating(true);
    try {
      await speakTeaserOnly(pitch, onQueuedPoi);
      await setPendingOfferFromPoi(poi);
    } finally {
      store.setIsGenerating(false);
    }
    setTimeout(() => {
      unmarkTriggerSpoken(poiId, kind);
    }, 90_000);
  } finally {
    releaseNarrationLock(epoch);
  }
}

export async function runTeaserWithInterestWatch(
  ctx: NarrationContext,
): Promise<void> {
  const { poi, profile, motionMode, onQueuedPoi } = ctx;
  const store = useFinnusStore.getState();
  const existing = getPendingInterestWatch();

  if (existing?.poiId !== poi.id) {
    startInterestWatch({
      poiId: poi.id,
      name: poi.name,
      lat: poi.lat,
      lng: poi.lng,
      transportHint: motionMode,
    });
  }

  store.setIsGenerating(true);
  try {
    // Nur neuer POI-Chat — kein Legacy-Teaser, kein Bike-Kürzer, kein Gemini-Facing-Raten
    const { generateModule1ApproachSpeech } = await import(
      '../services/ai/module1PoiChat'
    );
    const pos = getLastUserPosition();
    let teaser = takePrefetchedTeaserText(poi.id) || '';
    if (!teaser) {
      const out = await generateModule1ApproachSpeech({
        poi,
        profile,
        userLat: pos.lat,
        userLng: pos.lng,
        speedMs: getSmoothedSpeedMs(),
        deviceHeadingDeg: getDeviceHeadingDeg(),
      });
      if (out.skipped) {
        if (__DEV__) {
          console.log(
            `[narration] teaser+watch skip #${poi.id} facing behind`,
          );
        }
        return;
      }
      teaser = out.text;
    }
    if (!teaser.trim()) {
      teaser = buildWegweiserHook(poi, profile);
    }
    teaser = applyApproachBundleTeaser(ctx, teaser, null);

    if (__DEV__) {
      console.log(`[narration] teaser+watch(module1) @ ${poi.name}`);
    }

    if (poi.spot_key) {
      store.addHeardApproachSpotKey(poi.spot_key);
      markSpotVisited(`${poi.spot_key}__approach`);
      noteApproachSpoken(poi.spot_key);
      noteWegweiserSpoken(poi.spot_key);
      softLockSiblingApproaches(poi.parent_poi_id ?? poi.id);
    }
    markBundlePeersSpoken(ctx);
    const parentId = poi.parent_poi_id ?? poi.id;
    const mainVisited =
      sessionSetForKind('area').has(parentId) ||
      (poi.spot_key ? hasVisitedSpot(poi.spot_key) : false);
    void recordApproachFire({
      spotKey: poi.spot_key,
      poiId: poi.id,
      mainVisited,
    });

    store.setCurrentPoiId(poi.id);
    store.setCurrentLocationName(displayPoiName(poi));
    kickArrivalPrefetch(poi, profile);

    await speakTeaserOnly(teaser, onQueuedPoi);
    await setPendingOfferFromPoi(poi);
    void presentApproachRouteCard(poi);
  } finally {
    store.setIsGenerating(false);
  }

  store.setCurrentPoiId(poi.id);
  store.setCurrentLocationName(displayPoiName(poi));
}

export async function runAwaitInterestNarration(
  ctx: NarrationContext,
): Promise<void> {
  await runTeaserWithInterestWatch(ctx);
}

export async function runFlowA_Approach(ctx: NarrationContext): Promise<void> {
  const { poi, profile, onQueuedPoi } = ctx;
  const store = useFinnusStore.getState();
  store.setIsGenerating(true);

  try {
    const prefetched = await playPrefetchedPoiIfReady(poi.id);
    if (prefetched) {
      if (poi.spot_key) {
        store.addHeardApproachSpotKey(poi.spot_key);
        markSpotVisited(`${poi.spot_key}__approach`);
        noteApproachSpoken(poi.spot_key);
      noteWegweiserSpoken(poi.spot_key);
      softLockSiblingApproaches(poi.parent_poi_id ?? poi.id);
      }
      startInterestWatch({
        poiId: poi.id,
        name: poi.name,
        lat: poi.lat,
        lng: poi.lng,
      });
      kickArrivalPrefetch(poi, profile);
      await setPendingOfferFromPoi(poi);
      void presentApproachRouteCard(poi);
      return;
    }

    // Nur neuer POI-Chat (Prefetch muss denselben Chat geseedet haben)
    const { generateModule1ApproachSpeech } = await import(
      '../services/ai/module1PoiChat'
    );
    const pos = getLastUserPosition();
    let teaser = takePrefetchedTeaserText(poi.id) || '';
    if (!teaser) {
      try {
        const out = await generateModule1ApproachSpeech({
          poi,
          profile,
          userLat: pos.lat,
          userLng: pos.lng,
          speedMs: getSmoothedSpeedMs(),
          deviceHeadingDeg: getDeviceHeadingDeg(),
        });
        if (out.skipped) {
          if (__DEV__) {
            console.log(
              `[narration] flowA skip #${poi.id} — facing behind (${out.lookCue.lookPhrase})`,
            );
          }
          return;
        }
        teaser = out.text;
      } catch (teaserErr) {
        console.warn('[narration] Approach-Chat fehlgeschlagen:', teaserErr);
        teaser = buildWegweiserHook(poi, profile);
      }
    }
    teaser = applyApproachBundleTeaser(ctx, teaser, null);

    if (__DEV__) {
      console.log(`[narration] flowA teaser="${teaser.slice(0, 72)}"`);
    }

    if (isFoodish(poi)) {
      store.setLastMealHintAtMs(Date.now());
    }
    if (poi.spot_key) {
      store.addHeardApproachSpotKey(poi.spot_key);
      markSpotVisited(`${poi.spot_key}__approach`);
      noteApproachSpoken(poi.spot_key);
      noteWegweiserSpoken(poi.spot_key);
      softLockSiblingApproaches(poi.parent_poi_id ?? poi.id);
    }
    markBundlePeersSpoken(ctx);
    {
      const parentId = poi.parent_poi_id ?? poi.id;
      const mainVisited =
        sessionSetForKind('area').has(parentId) ||
        (poi.spot_key ? hasVisitedSpot(poi.spot_key) : false);
      void recordApproachFire({
        spotKey: poi.spot_key,
        poiId: poi.id,
        mainVisited,
      });
    }

    kickArrivalPrefetch(poi, profile);
    await speakTeaserOnly(teaser, onQueuedPoi);
    await setPendingOfferFromPoi(poi);
    void presentApproachRouteCard(poi);
  } finally {
    store.setIsGenerating(false);
  }
}

export async function runFlowBC_FullStory(ctx: NarrationContext): Promise<void> {
  const { poi, plan, profile, kind, heardApproach, opts, onQueuedPoi } = ctx;
  const store = useFinnusStore.getState();
  const flowKind = resolveFlowKind(kind);

  // 50 m rule: never start Modul-1 story (or throttle GPS) if a turn cue is imminent
  if (shouldPauseExploreStoryForNavTurn() && !opts?.force) {
    if (__DEV__) {
      console.log(
        `[narration] skip flow B/C #${poi.id} — nav turn within 50m`,
      );
    }
    return;
  }

  clearInterestWatch();
  const liveStore = useFinnusStore.getState();
  if (!liveStore.isGenerating && !liveStore.isListening) {
    notifyDestinationAudioStarted(poi.id);
  }
  // GPS throttle OK only when no imminent turn (battery saver + 50 m coexistence)
  void setGpsStreamProfile('throttled');

  if (isFoodish(poi)) {
    store.setLastMealHintAtMs(Date.now());
  }

  store.setIsGenerating(true);
  const sessionMemory = { entries: store.visitedHistory };

  let deep;
  let storyBrief: ReturnType<typeof buildFindusStoryBrief> | null = null;
  try {
    // Brief für Live-Chat + Stempel/Told-Keys
    storyBrief = buildFindusStoryBrief({ poi, profile, sessionMemory });
    deep = filterDeepStoryFacts(poi, { profile, sessionMemory });
    store.addChatMessage({
      role: 'system',
      content: buildPoiResearchContext(poi),
    });
  } catch (prepErr) {
    console.error('[narration] Story-Prep fehlgeschlagen:', prepErr);
    store.setIsGenerating(false);
    const offline = extractOfflineGeneralInfo(poi);
    await speakTeaserOnly(
      offline || `Schau mal — ${displayPoiName(poi)} liegt genau vor dir.`,
      onQueuedPoi,
    );
    return;
  }

  const interestOverride =
    plan.action === 'interest_override'
      ? { hookText: plan.hookText, matched: plan.matched }
      : null;

  const skipIntro =
    (plan.action === 'full_story' || plan.action === 'interest_override') &&
    (plan.reason === 'approach_already_heard' ||
      heardApproach ||
      wasApproachSpokenRecently(poi.spot_key) ||
      Boolean(interestOverride));

  const skipTeaserHook =
    skipIntro ||
    wasApproachSpokenRecently(poi.spot_key) ||
    Boolean(opts?.interestDeepDive) ||
    Boolean(interestOverride);

  // Deep-Dive / Override / nach Approach: kein Extra-Ack
  const localHook = opts?.interestDeepDive || interestOverride
    ? ''
    : skipTeaserHook
      ? ''
      : buildFastHook(poi, profile, sessionMemory).trim();

  const collected: string[] = [];
  let fastHook = localHook;

  try {
    await stopSpeaking();
    const voiceSettings = await getVoiceSettingsForTour();

    const deepDive = Boolean(opts?.interestDeepDive);
    // Reboot: Multi-Turn POI-Chat (Seed einmal, dann nur Instruction)
    const { streamModule1ChatSentences } = await import(
      '../services/ai/module1PoiChat'
    );
    const geminiIter = streamModule1ChatSentences({
      poi,
      profile,
      mode: deepDive ? 'deep' : 'arrival',
      approachAlreadyHeard: skipTeaserHook || deepDive,
      timeoutMs: deepDive || interestOverride ? 40000 : 28000,
      storyBriefBlock: storyBrief?.promptBlock ?? null,
      interestOverride,
    })[Symbol.asyncIterator]();
    const firstGeminiPromise = geminiIter.next();

    // Deep-Dive bleibt am Ort — Nähe-Hinweis ≤50 m nur bei normalem Main
    const subHintPromise =
      deepDive || interestOverride || flowKind !== 'main'
        ? Promise.resolve(null)
        : buildNearbyInviteLine(poi);

    async function* storySentences(): AsyncGenerator<string, void, unknown> {
      if (localHook) {
        collected.push(localHook);
        yield localHook;
      }
      // Nach Wegweiser: Meta-/Geschichte-Oversell am Anfang killen (Kaltstart)
      let stripColdMeta = Boolean(skipTeaserHook) && !localHook;
      let skipGeminiGreeting = Boolean(localHook);
      const isColdStartMeta = (s: string) =>
        /\b(flüstert\s+geschichte|fluestert\s+geschichte|rollt\s+geschichte|richtig\s+geschichte|volle?r?\s+geschichte|hörst\s+du\s+die\s+schienen|hoerst\s+du\s+die\s+schienen|tüt[-\s]?tüt|hier\s+steckt\s+richtig|nimm\s+dir\s+einen\s+moment|seine\s+eigene\s+geschichte)\b/iu.test(
          s,
        ) ||
        (/^(pst|tüt)/iu.test(s) && s.length < 120);

      try {
        let step = await firstGeminiPromise;
        while (!step.done) {
          let t = String(step.value ?? '').trim();
          if (t) {
            if (stripColdMeta && isColdStartMeta(t)) {
              stripColdMeta = false;
              step = await geminiIter.next();
              continue;
            }
            stripColdMeta = false;
            if (skipGeminiGreeting) {
              skipGeminiGreeting = false;
              const looksLikeHook =
                t.length < 180 ||
                /^(hey|schau|na |hier |willkommen|guck|oh |wow|pst|hörst|hoerst|siehst|riechst|spürst|spuerst|tüt)/i.test(
                  t,
                );
              const nameCore = displayPoiName(poi)
                .toLowerCase()
                .replace(/[^a-zäöüß0-9]+/giu, ' ')
                .trim()
                .slice(0, 24);
              const repeatsNameOnly =
                Boolean(nameCore) &&
                t.length < 90 &&
                t.toLowerCase().includes(nameCore) &&
                !/(plätscher|plaetscher|rauschen|duft|fachwerk|gleis|ufer|wiese)/i.test(
                  t,
                );
              if (!looksLikeHook && !repeatsNameOnly) {
                if (!fastHook) fastHook = t;
                collected.push(t);
                yield t;
              }
            } else {
              if (!fastHook) fastHook = t;
              collected.push(t);
              yield t;
            }
          }
          step = await geminiIter.next();
        }
        const subHint = await subHintPromise;
        const joined = collected.join(' ');
        const hasNaturalOutro =
          /(wenn du soweit bist|wenn du lust hast|schlendern wir|spazieren wir|lass uns .*weiter|genieße kurz)/i.test(
            joined,
          );
        if (subHint && !hasNaturalOutro) {
          collected.push(subHint);
          yield subHint;
        }
      } catch (error) {
        console.error('[narration] Story stream failed:', error);
        const offline = extractOfflineGeneralInfo(poi);
        const text =
          offline ||
          'Netz war gerade weg — und offline liegt hier keine fertige Erzählung.';
        if (!collected.length && text) {
          for await (const s of sentencesFromFullText(text)) {
            collected.push(s);
            yield s;
          }
        }
      }
    }

    if (__DEV__) {
      console.log(
        `[narration] flow${flowKind === 'sub' ? 'C' : 'B'}(localHook=${localHook ? 'yes' : 'no'}→gemini)`,
      );
    }

    store.setIsGenerating(false);
    // Actions früh; Stichpunkte sobald genug Speech da ist (nicht erst nach TTS)
    void presentModule1LiveCard({
      poi,
      spokenText: '',
      actionsOnly: true,
    }).catch((err) =>
      console.warn('[module1LiveCard] actions-first failed:', err),
    );
    try {
      const {
        beginNarrationResume,
        appendNarrationResumeText,
        completeNarrationResume,
      } = await import('../services/session/narrationResumeState');
      beginNarrationResume({
        poiId: poi.id,
        poiName: displayPoiName(poi),
        kind: deepDive ? 'deep' : 'main',
        fullText: '',
      });
      let bulletPartial = '';
      let lastBulletPushMs = 0;
      let bulletsPresented = false;
      async function* trackedSentences(): AsyncGenerator<string, void, unknown> {
        for await (const s of storySentences()) {
          appendNarrationResumeText(s);
          bulletPartial = `${bulletPartial} ${s}`.replace(/\s+/g, ' ').trim();
          const now = Date.now();
          if (
            bulletPartial.length >= 80 &&
            (now - lastBulletPushMs > 700 || !bulletsPresented)
          ) {
            lastBulletPushMs = now;
            bulletsPresented = true;
            void presentModule1LiveCard({
              poi,
              spokenText: bulletPartial,
            }).catch((err) =>
              console.warn('[module1LiveCard] mid-speech failed:', err),
            );
          }
          yield s;
        }
      }
      try {
        await speakRuntimeSentences(trackedSentences(), {
          voiceId: voiceSettings.voiceId,
          speechRate: voiceSettings.speechRate,
        });
        completeNarrationResume();
      } catch (speakErr) {
        // Unterbruch — State behalten für Session-Resume
        if (__DEV__) console.warn('[narration] speak interrupted', speakErr);
        throw speakErr;
      }
    } finally {
      // Standby sofort — unabhängig von TTS-Generation-Races
      store.setIsPlayingAudio(false);
      // Speech-Ende — kein UI-Clear nötig
      onPoiNarrationComplete();
      noteMainPoiSpoken();
      unlockSiblingApproaches(poi.parent_poi_id ?? poi.id);
      void clearApproachFiresForSpot(poi.spot_key, poi.id);
      if (poi.parent_poi_id != null) {
        void clearApproachFiresForSpot(null, poi.parent_poi_id);
      }
      const fullText = [fastHook, ...collected.filter((s) => s !== fastHook)]
        .join(' ')
        .trim();
      if (fullText) {
        store.addChatMessage({ role: 'assistant', content: fullText });
        void presentModule1LiveCard({ poi, spokenText: fullText }).catch(
          (err) => console.warn('[module1LiveCard] failed:', err),
        );
        void commitNarrationFeatureTips(fullText).catch((err) =>
          console.warn('[featureTips] commit failed:', err),
        );
        store.addToldFactKeys([
          factKey(fastHook),
          ...deep.facts.map((f) => factKey(f.text)),
        ]);
        store.addVisitedPlace(
          buildVisitedMemoryEntry(
            poi,
            [
              'Modul-1-Hauptpunkt',
              toStampSummary(
                collected.length > 0 ? collected : deep.facts.map((f) => f.text),
                { teaser: poi.teaser_text, name: poi.name },
              ),
            ],
            { onTimeline: true },
          ),
        );
        try {
          const { stampModule1Visit } = await import(
            '../module2/background/triggerEngine'
          );
          stampModule1Visit({
            title: displayPoiName(poi),
            lat: poi.lat,
            lng: poi.lng,
          });
        } catch {
          /* soft */
        }
        void lockPoiTeaser({ spotKey: poi.spot_key, poiId: poi.id });
        try {
          const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
          const blob = `${poi.name} ${poi.category ?? ''} ${tags}`;
          const type = /(hotel|pension|unterkunft)/i.test(blob)
            ? 'hotel'
            : /(restaurant|gastro|café|cafe|burger|imbiss|pizzeria)/i.test(blob)
              ? 'restaurant'
              : /(bahnhof|bus|fähre|faehre|hafen)/i.test(blob)
                ? 'transit'
                : 'attraction';
          useUserMemoryStore.getState().addOrUpdateEntity({
            type,
            name: displayPoiName(poi),
            isConfirmed: type !== 'hotel',
            lat: poi.lat,
            lng: poi.lng,
            poiId: poi.id,
            visitedAt: new Date().toISOString(),
          });
        } catch (memErr) {
          console.warn('[memory] sync after story failed:', memErr);
        }
      }
    }
  } catch (error) {
    console.error('[narration] Hook/Audio fehlgeschlagen:', error);
    store.setIsGenerating(false);
    store.setIsPlayingAudio(false);
  }
}

export async function runSoftPitchNarration(ctx: NarrationContext): Promise<void> {
  const { poi, plan, tideSoftPitch, onQueuedPoi } = ctx;
  if (plan.action !== 'soft_pitch') return;

  const store = useFinnusStore.getState();
  if (!tideSoftPitch) {
    const key = poi.spot_key ?? String(poi.id);
    store.addSoftPitchedSpotKey(key);
  }
  store.setIsGenerating(true);
  try {
    await speakTeaserOnly(plan.pitchText, onQueuedPoi);
    await setPendingOfferFromPoi(poi);
  } finally {
    store.setIsGenerating(false);
  }
}

export async function executeNarrationPlan(ctx: NarrationContext): Promise<void> {
  const { poi, plan, kind, tideSoftPitch, opts } = ctx;
  const store = useFinnusStore.getState();
  const poiId = poi.id;

  // Hintergrund-/Sperr-Pref: nur App offen → still überspringen
  if (!opts?.force) {
    try {
      const { canStartModule1Narration } = await import(
        '../services/speech/deviceAudioRoute'
      );
      const ok = await canStartModule1Narration();
      if (!ok) {
        if (__DEV__) {
          console.log(
            `[narration] skip Modul 1 #${poiId} — Hintergrund-Speech-Pref`,
          );
        }
        return;
      }
    } catch {
      /* soft — weiter wie bisher */
    }
  }

  // 50 m coexistence: Modul 1 stays silent when a turn cue is imminent
  if (shouldPauseExploreStoryForNavTurn() && !opts?.force) {
    if (__DEV__) {
      console.log(
        `[narration] mute Modul 1 #${poiId} — nav turn within 50m`,
      );
    }
    return;
  }

  if (kind !== 'approach' && !tideSoftPitch) {
    store.setLastVisitedPoiId(poiId);
    if (poi.spot_key) {
      markSpotVisited(poi.spot_key);
    }
  }
  store.setCurrentPoiId(poi.id);
  store.setCurrentLocationName(displayPoiName(poi));

  const epoch = tryAcquireNarrationLock(opts);
  if (epoch == null) return;
  narrationBusy = true;

  try {
    if (plan.action === 'soft_pitch') {
      await runSoftPitchNarration(ctx);
      if (!tideSoftPitch) markTriggerSpoken(poiId, kind);
      return;
    }

    if (plan.action === 'approach_hook' || kind === 'approach') {
      await runFlowA_Approach(ctx);
      if (!tideSoftPitch) markTriggerSpoken(poiId, kind);
      return;
    }

    // full_story | interest_override | redirect handled upstream
    await runFlowBC_FullStory(ctx);
    if (!tideSoftPitch) markTriggerSpoken(poiId, kind);
  } catch {
    unmarkTriggerSpoken(poiId, kind);
  } finally {
    releaseNarrationLock(epoch);
    // Nach Modul 1 immer Standby — verhindert hängendes „Ich erzähle“
    try {
      const { markAudiblePlayback, getActiveTtsSessionCount } =
        await import('../services/AudioVoiceService');
      markAudiblePlayback(false);
      if (getActiveTtsSessionCount() === 0) {
        useFinnusStore.getState().setIsPlayingAudio(false);
        useFinnusStore.getState().setIsAudiblySpeaking(false);
        // Speech-Ende — kein forceClear
      }
    } catch {
      /* ignore */
    }
    useFinnusStore.getState().setIsPlayingAudio(false);
    useFinnusStore.getState().setIsAudiblySpeaking(false);
    useFinnusStore.getState().setIsGenerating(false);
    notifyDestinationAudioEnded();
    const lastPos = getLastUserPosition();
    if (lastPos.lat != null && lastPos.lng != null) {
      void updateAdaptiveGpsProfile({
        lat: lastPos.lat,
        lng: lastPos.lng,
        audioBusy: false,
      });
    } else {
      void setGpsStreamProfile('economy');
    }
  }
}

export async function interruptNarrationForForce(): Promise<void> {
  await stopSpeaking();
  narrationBusy = false;
}
