/**
 * Modul 1 Narration Pipeline (Phase 4) — Flows A/B/C.
 *
 * Flow A — Wegweiser: visual orientierung (offline-first) → teaser + hook
 * Flow B — Hauptort: full story, skip intro if approach heard, LOCK
 * Flow C — Nebenort: same story path as B, parentIsMajor hint
 */

import {
  getChildPois,
  getPoiWithFacts,
  getAllPois,
  haversineMeters,
} from '../db/database';
import type { Poi, PoiWithFacts } from '../db/types';
import type { UserProfile } from '../types/userProfile';
import { buildPoiResearchContext } from '../constants/prompts';
import { filterDeepStoryFacts } from '../services/ai/deepStoryFilter';
import {
  buildVisitedMemoryEntry,
  extractOfflineGeneralInfo,
  streamFindusStorySentences,
} from '../services/ai/storyService';
import { commitNarrationFeatureTips } from './featureTipsModule';
import { resolvePoiImportance } from '../services/personaEngine';
import {
  buildFastHook,
  buildWegweiserHook,
  extractWegweiserDestination,
  isBoringApproachTeaser,
} from '../services/ai/fastHook';
import { buildRichApproachTeaser } from '../services/ai/approachTeaser';
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
  interestAckLine,
  noteApproachSpoken,
  startInterestWatch,
  wasApproachSpokenRecently,
} from '../services/interestPatternDetector';
import {
  onApproachInterestPatternUsed,
  resolveApproachExtraInstruction,
  shouldExplainInterestPattern,
} from './featureTipsModule';
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

function setPendingOfferFromPoi(poi: PoiWithFacts): void {
  const id = poi.parent_poi_id ?? poi.id;
  useFinnusStore.getState().setPendingNavOffer({
    poiId: id,
    name: displayPoiName(poi),
    lat: poi.lat,
    lng: poi.lng,
  });
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
    await speakRuntimeText(
      text,
      {
        voiceId: voiceSettings.voiceId,
        speechRate: voiceSettings.speechRate,
      },
      { priority: 'explore' },
    );
  } finally {
    store.setIsPlayingAudio(false);
    store.setSubtitleText(null);
    /* GPS queue flush via AudioVoiceService → notifyRuntimeSpeechEnded */
  }
}

async function buildSubHintLine(areaPoiId: number): Promise<string | null> {
  const children = await getChildPois(areaPoiId);
  const { spokenSubIds } = getTriggerSession();
  const openSubs = children.filter(
    (c) => c.kind === 'sub' && !spokenSubIds.has(c.id),
  );
  if (openSubs.length === 0) return null;
  const names = openSubs.slice(0, 2).map((s) => s.name);
  if (names.length === 1) {
    return `Wenn du schon mal hier bist: Schau dir noch ${names[0]} genauer an — dort erzähl ich dir mehr.`;
  }
  return `Hier in der Nähe lohnen noch ${names[0]} und ${names[1]} — magst du einen davon ansteuern?`;
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
  const lookSidePhrase = targetRelation?.shortPhrase ?? 'vorne';

  const landmarkRelation = bestLandmark
    ? relateTargetToFacing(
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
    return `Schau nach ${lookSidePhrase}. Siehst du ${bestLandmark.name}? Genau dahin.`;
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
      setPendingOfferFromPoi(poi);
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
    const packTeaser =
      (poi.teaser_text ?? '').trim() ||
      poi.facts
        .find((f) => f.fact_text.startsWith('[Teaser]'))
        ?.fact_text.replace(/^\[Teaser\]\s*/u, '')
        .trim() ||
      '';

    let teaser = takePrefetchedTeaserText(poi.id) || '';
    if (!teaser) {
      try {
        teaser = await buildRichApproachTeaser(poi, profile, packTeaser, null);
      } catch {
        teaser =
          !isBoringApproachTeaser(packTeaser) && packTeaser
            ? packTeaser
            : buildWegweiserHook(poi, profile);
      }
    }

    const visualCue = await buildApproachVisualCue(poi);
    if (visualCue) {
      teaser = `${visualCue.trim()} ${teaser.trim()}`.trim();
    }

    if (isActiveBicycleMode(motionMode)) {
      const parkHint = await resolveBikeParkHintNear(poi.lat, poi.lng);
      teaser = condenseForBikeMode(
        `${teaser} ${buildBicycleContextPitch(poi, { parkHint })}`.trim(),
        160,
      );
    }

    if (__DEV__) {
      console.log(`[narration] teaser+watch @ ${poi.name}`);
    }

    if (poi.spot_key) {
      store.addHeardApproachSpotKey(poi.spot_key);
      markSpotVisited(`${poi.spot_key}__approach`);
      noteApproachSpoken(poi.spot_key);
    }

    await speakTeaserOnly(teaser, onQueuedPoi);
    setPendingOfferFromPoi(poi);
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
  const { poi, profile, motionMode, onQueuedPoi } = ctx;
  const store = useFinnusStore.getState();
  store.setIsGenerating(true);

  try {
    const prefetched = await playPrefetchedPoiIfReady(poi.id);
    if (prefetched) {
      if (poi.spot_key) {
        store.addHeardApproachSpotKey(poi.spot_key);
        markSpotVisited(`${poi.spot_key}__approach`);
        noteApproachSpoken(poi.spot_key);
      }
      startInterestWatch({
        poiId: poi.id,
        name: poi.name,
        lat: poi.lat,
        lng: poi.lng,
      });
      setPendingOfferFromPoi(poi);
      return;
    }

    const packTeaser =
      (poi.teaser_text ?? '').trim() ||
      poi.facts
        .find((f) => f.fact_text.startsWith('[Teaser]'))
        ?.fact_text.replace(/^\[Teaser\]\s*/u, '')
        .trim() ||
      '';

    let teaser = takePrefetchedTeaserText(poi.id) || '';
    const extraInstruction = await resolveApproachExtraInstruction();
    if (!teaser) {
      try {
        teaser = await buildRichApproachTeaser(
          poi,
          profile,
          packTeaser,
          extraInstruction,
        );
      } catch (teaserErr) {
        console.warn('[narration] Approach-Teaser fehlgeschlagen:', teaserErr);
        teaser =
          !isBoringApproachTeaser(packTeaser) && packTeaser
            ? packTeaser
            : buildWegweiserHook(poi, profile);
      }
    }

    const visualCue = await buildApproachVisualCue(poi);
    if (visualCue) {
      teaser = `${visualCue.trim()} ${teaser.trim()}`.trim();
    }

    if (isActiveBicycleMode(motionMode)) {
      const parkHint = await resolveBikeParkHintNear(poi.lat, poi.lng);
      teaser = condenseForBikeMode(
        `${teaser} ${buildBicycleContextPitch(poi, { parkHint })}`.trim(),
        180,
      );
    }

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
    }

    if (extraInstruction) await onApproachInterestPatternUsed();

    await speakTeaserOnly(teaser, onQueuedPoi);
    setPendingOfferFromPoi(poi);
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
  let storyBriefBlock: string | null = null;
  try {
    const brief = buildFindusStoryBrief({ poi, profile, sessionMemory });
    storyBriefBlock = brief.promptBlock;
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

  const skipIntro =
    plan.action === 'full_story' &&
    (plan.reason === 'approach_already_heard' ||
      heardApproach ||
      wasApproachSpokenRecently(poi.spot_key));

  const skipTeaserHook =
    skipIntro ||
    wasApproachSpokenRecently(poi.spot_key) ||
    Boolean(opts?.interestDeepDive);

  const localHook = opts?.interestDeepDive
    ? interestAckLine(poi.name)
    : skipTeaserHook
      ? ''
      : buildFastHook(poi, profile, sessionMemory).trim();

  const collected: string[] = [];
  let fastHook = localHook;

  try {
    await stopSpeaking();
    const voiceSettings = await getVoiceSettingsForTour();

    let parentIsMajor = false;
    if (poi.parent_poi_id != null) {
      try {
        const parent = await getPoiWithFacts(poi.parent_poi_id);
        if (parent) {
          parentIsMajor = resolvePoiImportance(parent) === 'major';
        }
      } catch {
        parentIsMajor = false;
      }
    }

    const geminiIter = streamFindusStorySentences({
      poi,
      profile,
      sessionMemory,
      mode: 'arrival',
      approachAlreadyHeard: skipTeaserHook || Boolean(opts?.interestDeepDive),
      timeoutMs: 22000,
      parentIsMajor,
      storyBriefBlock,
    })[Symbol.asyncIterator]();
    const firstGeminiPromise = geminiIter.next();

    const subHintPromise =
      flowKind === 'main' ? buildSubHintLine(poi.id) : Promise.resolve(null);

    async function* storySentences(): AsyncGenerator<string, void, unknown> {
      if (localHook) {
        collected.push(localHook);
        yield localHook;
      }
      let skipGeminiGreeting = Boolean(localHook);
      try {
        let step = await firstGeminiPromise;
        while (!step.done) {
          const t = String(step.value ?? '').trim();
          if (t) {
            if (skipGeminiGreeting) {
              skipGeminiGreeting = false;
              const looksLikeHook =
                t.length < 180 ||
                /^(hey|schau|na |hier |willkommen|guck|oh |wow)/i.test(t);
              if (!looksLikeHook) {
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
    try {
      await speakRuntimeSentences(storySentences(), {
        voiceId: voiceSettings.voiceId,
        speechRate: voiceSettings.speechRate,
      });
    } finally {
      // Standby sofort — unabhängig von TTS-Generation-Races
      store.setIsPlayingAudio(false);
      store.setSubtitleText(null);
      onPoiNarrationComplete();
      const fullText = [fastHook, ...collected.filter((s) => s !== fastHook)]
        .join(' ')
        .trim();
      if (fullText) {
        store.addChatMessage({ role: 'assistant', content: fullText });
        void commitNarrationFeatureTips(fullText).catch((err) =>
          console.warn('[featureTips] commit failed:', err),
        );
        store.addToldFactKeys([
          factKey(fastHook),
          ...deep.facts.map((f) => factKey(f.text)),
        ]);
        store.addVisitedPlace(
          buildVisitedMemoryEntry(poi, [
            toStampSummary(
              collected.length > 0 ? collected : deep.facts.map((f) => f.text),
              { teaser: poi.teaser_text, name: poi.name },
            ),
          ]),
        );
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
    store.setSubtitleText(null);
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
    setPendingOfferFromPoi(poi);
  } finally {
    store.setIsGenerating(false);
  }
}

export async function executeNarrationPlan(ctx: NarrationContext): Promise<void> {
  const { poi, plan, kind, tideSoftPitch, opts } = ctx;
  const store = useFinnusStore.getState();
  const poiId = poi.id;

  // 50 m coexistence: Modul 1 stays silent when a turn cue is imminent
  if (shouldPauseExploreStoryForNavTurn() && !opts?.force) {
    if (__DEV__) {
      console.log(
        `[narration] mute Modul 1 #${poiId} — nav turn within 50m`,
      );
    }
    return;
  }

  if (!tideSoftPitch) {
    markTriggerSpoken(poiId, kind);
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
      return;
    }

    if (plan.action === 'approach_hook' || kind === 'approach') {
      await runFlowA_Approach(ctx);
      return;
    }

    await runFlowBC_FullStory(ctx);
  } finally {
    releaseNarrationLock(epoch);
    // Nach Modul 1 immer Standby — verhindert hängendes „Ich erzähle“
    useFinnusStore.getState().setIsPlayingAudio(false);
    useFinnusStore.getState().setSubtitleText(null);
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
