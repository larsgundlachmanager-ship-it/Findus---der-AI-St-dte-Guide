/**
 * Kern-Trigger: Real-GPS und Simulation.
 * Unterstützt Area (Polygon), Approach (Wegweiser) und Sub-POIs.
 *
 * Regeln:
 * - Nur der nächste ungesprochene Trigger
 * - Während Audio/Generation: keine neuen Trigger
 * - Wegweiser = Fast-Hook; bei Ankunft am Hauptort Intro überspringen
 */

import {
  getPoiWithFacts,
  matchGeoTriggers,
  getChildPois,
} from '../db/database';
import type { Poi, PoiWithFacts } from '../db/types';
import { buildPoiResearchContext } from '../constants/prompts';
import { filterDeepStoryFacts } from './ai/deepStoryFilter';
import {
  buildVisitedMemoryEntry,
  extractOfflineGeneralInfo,
  streamFindusStorySentences,
} from './ai/storyService';
import { commitFeatureTipsAfterStory } from './ai/singleShotStory';
import { resolvePoiImportance } from './personaEngine';
import {
  buildFastHook,
  buildWegweiserHook,
  isBoringApproachTeaser,
} from './ai/fastHook';
import { buildRichApproachTeaser } from './ai/approachTeaser';
import { sentencesFromFullText } from './ai/sentenceStream';
import {
  speakAssistantText,
  speakSentenceStream,
  stopSpeaking,
  getVoiceSettingsForTour,
} from './ttsService';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from './userProfileService';
import { parseTagsJson } from './geo/triggerPolicy';
import { getTideState } from './geo/tideService';
import { env } from '../config/env';
import { tickDwellTracking } from './locationTracker';
import { useUserMemoryStore } from '../store/useUserMemoryStore';
import {
  planFindusTrigger,
  buildFindusStoryBrief,
} from './ai/findusTourDirector';
import {
  notifyDestinationAudioStarted,
  notifyDestinationAudioEnded,
  getCurrentTransportMode,
  tickFreeRoamMotion,
  tickNavigation,
  isNavigatingToPoi,
} from './navigation';
import { toStampBullets } from './navigation/stampBullets';
import { thresholdsForMode } from './navigation/transportMode';
import {
  buildBicycleContextPitch,
  buildTransitDriveByPitch,
  isActiveBicycleMode,
  isDriveByTransitMode,
} from './navigation/contextPitches';
import { setGpsStreamProfile } from './locationService';
import { updateAdaptiveGpsProfile } from './adaptiveGpsService';
import { hapticAttentionCue } from './navigation/haptics';
import { maybeSpeakFirstCityWelcome } from './cityWelcomeService';

/** Session-sticky: verhindert Re-Trigger bei GPS-Rauschen. */
const spokenAreaIds = new Set<number>();
const spokenApproachIds = new Set<number>();
const spokenSubIds = new Set<number>();
/** Spot-Keys mit gespieltem Hauptfokus — andere Wegweiser irrelevant. */
const visitedSpotKeys = new Set<string>();
let outsideSinceMs: number | null = null;
/** Letzte User-Position für Sub-Redirect nach Hauptfokus. */
let lastUserLat: number | null = null;
let lastUserLng: number | null = null;
/** Busy-Lock: erst fertig sprechen, dann neuen Trigger suchen. */
let narrationBusy = false;
/** Steigt bei jedem neuen Lauf — ältere finally dürfen busy nicht freigeben. */
let narrationEpoch = 0;

/** UI-Ort löschen nach kurzem Verlassen; Erzähl-Sperre bleibt. */
const UI_CLEAR_AFTER_MS = 4_000;

export function clearSpokenPoiSession(poiId?: number): void {
  if (poiId == null) {
    spokenAreaIds.clear();
    spokenApproachIds.clear();
    spokenSubIds.clear();
    visitedSpotKeys.clear();
    return;
  }
  spokenAreaIds.delete(poiId);
  spokenApproachIds.delete(poiId);
  spokenSubIds.delete(poiId);
}

export function isNarrationBusy(): boolean {
  return narrationBusy;
}

function sessionSetForKind(kind: string | null | undefined): Set<number> {
  if (kind === 'approach') return spokenApproachIds;
  if (kind === 'sub') return spokenSubIds;
  return spokenAreaIds;
}

function allSpokenIds(): Set<number> {
  return new Set([
    ...spokenAreaIds,
    ...spokenApproachIds,
    ...spokenSubIds,
  ]);
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

function spokenOfferName(poi: PoiWithFacts): string {
  return poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
}

function setPendingOfferFromPoi(poi: PoiWithFacts): void {
  useFinnusStore.getState().setPendingNavOffer({
    poiId: poi.parent_poi_id ?? poi.id,
    name: spokenOfferName(poi),
  });
}

function factKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}


async function speakTeaserOnly(text: string): Promise<void> {
  const store = useFinnusStore.getState();
  store.addChatMessage({ role: 'assistant', content: text });
  store.addToldFactKeys([factKey(text)]);
  store.setIsGenerating(false);
  await stopSpeaking();
  const voiceSettings = await getVoiceSettingsForTour();
  await speakAssistantText(text, {
    voiceId: voiceSettings.voiceId,
    speechRate: voiceSettings.speechRate,
  });
}

async function buildSubHintLine(areaPoiId: number): Promise<string | null> {
  const children = await getChildPois(areaPoiId);
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

export async function triggerPoiArrival(
  poiId: number,
  opts?: { force?: boolean },
): Promise<void> {
  if (narrationBusy && !opts?.force) {
    if (__DEV__) {
      console.log(`[geofence] busy — defer POI #${poiId}`);
    }
    return;
  }

  // Simulation / manueller Force: laufende Story hart abbrechen, dann neu starten
  if (opts?.force) {
    await stopSpeaking();
    narrationBusy = false;
  }

  const store = useFinnusStore.getState();
  const loaded = await getPoiWithFacts(poiId);
  if (!loaded) {
    console.warn('[geofence] POI not found:', poiId);
    return;
  }
  // Explizit gebunden — Closure (storySentences) behält sonst PoiWithFacts | null.
  const poi: PoiWithFacts = loaded;

  const kind = poi.kind ?? 'legacy';
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
      visitedSpotKeys.has(`${poi.spot_key}__approach`));

  const plan = await planFindusTrigger({
    poi,
    profile,
    spokenAreaIds,
    spokenApproachIds,
    spokenSubIds,
    userLat: lastUserLat,
    userLng: lastUserLng,
    force: opts?.force,
    approachAlreadyHeard: heardApproach,
    policyCtx: {
      profile,
      lastMealHintAtMs: store.lastMealHintAtMs,
      softPitchedSpotKeys: new Set(store.softPitchedSpotKeys),
      firstName: profile?.firstName,
      tide,
    },
  });

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
    if (plan.reason !== 'tide_not_low' && plan.reason !== 'already_spoken') {
      sessionSetForKind(kind).add(poiId);
    }
    return;
  }

  if (opts?.force) {
    sessionSetForKind(kind).delete(poiId);
    if (kind !== 'approach') store.setLastVisitedPoiId(null);
  }

  const tideSoftPitch =
    plan.action === 'soft_pitch' && plan.reason === 'tide_unknown';

  const motionMode = getCurrentTransportMode();
  const navigatingHere = isNavigatingToPoi(poiId);
  const transitDriveBy =
    isDriveByTransitMode(motionMode) && !navigatingHere && kind !== 'sub';
  const bicyclePass =
    isActiveBicycleMode(motionMode) && !navigatingHere && kind !== 'sub';

  // Transit-Vorbeifahrt / Rad: kein „volles Programm“, nicht dauerhaft abspeichern
  if (transitDriveBy || bicyclePass) {
    if (!opts?.force && sessionSetForKind(kind).has(poiId)) {
      return;
    }
    // Kurz-Session-Sperre gegen GPS-Rauschen, aber Spot bleibt wiederholbar
    sessionSetForKind(kind).add(poiId);
    store.setCurrentPoiId(poi.id);
    store.setCurrentLocationName(
      kind === 'approach'
        ? poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim()
        : poi.name,
    );

    const myEpoch = ++narrationEpoch;
    narrationBusy = true;
    try {
      hapticAttentionCue();
      const pitch = transitDriveBy
        ? buildTransitDriveByPitch(poi, {
            nextStationHint: store.navTargetName,
          })
        : buildBicycleContextPitch(poi);
      store.setIsGenerating(true);
      try {
        await speakTeaserOnly(pitch);
        setPendingOfferFromPoi(poi);
      } finally {
        store.setIsGenerating(false);
      }
      // Nach kurzer Zeit wieder freigeben, damit später erneut getriggert werden kann
      setTimeout(() => {
        sessionSetForKind(kind).delete(poiId);
      }, 90_000);
    } finally {
      if (myEpoch === narrationEpoch) {
        narrationBusy = false;
      }
    }
    return;
  }

  if (!tideSoftPitch) {
    sessionSetForKind(kind).add(poiId);
  }
  if (kind !== 'approach' && !tideSoftPitch) {
    store.setLastVisitedPoiId(poiId);
    if (poi.spot_key) {
      visitedSpotKeys.add(poi.spot_key);
    }
  }
  store.setCurrentPoiId(poi.id);
  store.setCurrentLocationName(
    kind === 'approach'
      ? poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim()
      : poi.name,
  );

  const myEpoch = ++narrationEpoch;
  narrationBusy = true;
  try {
    if (plan.action === 'soft_pitch') {
      if (!tideSoftPitch) {
        const key = poi.spot_key ?? String(poi.id);
        store.addSoftPitchedSpotKey(key);
      }
      store.setIsGenerating(true);
      try {
        await speakTeaserOnly(plan.pitchText);
        setPendingOfferFromPoi(poi);
      } finally {
        store.setIsGenerating(false);
      }
      return;
    }

    // Approach: Teaser aus dem VOLLEN Hauptort-Datensatz (Skandal/Legende/Person/Besonderheit)
    if (plan.action === 'approach_hook' || kind === 'approach') {
      store.setIsGenerating(true);
      try {
        const packTeaser =
          (poi.teaser_text ?? '').trim() ||
          poi.facts
            .find((f) => f.fact_text.startsWith('[Teaser]'))
            ?.fact_text.replace(/^\[Teaser\]\s*/u, '')
            .trim() ||
          '';

        let teaser = '';
        try {
          teaser = await buildRichApproachTeaser(poi, profile, packTeaser);
        } catch (teaserErr) {
          console.warn('[geofence] Approach-Teaser fehlgeschlagen:', teaserErr);
          teaser =
            !isBoringApproachTeaser(packTeaser) && packTeaser
              ? packTeaser
              : buildWegweiserHook(poi, profile);
        }

        // Fahrrad-Hinweis anhängen, wenn wirklich Rad-Tempo
        if (isActiveBicycleMode(motionMode)) {
          teaser = `${teaser} ${buildBicycleContextPitch(poi)}`;
        }

        if (__DEV__) {
          console.log(
            `[geofence] approach teaser="${teaser.slice(0, 72)}"`,
          );
        }

        if (isFoodish(poi)) {
          store.setLastMealHintAtMs(Date.now());
        }
        if (poi.spot_key) {
          store.addHeardApproachSpotKey(poi.spot_key);
          visitedSpotKeys.add(`${poi.spot_key}__approach`);
        }
        await speakTeaserOnly(teaser);
        setPendingOfferFromPoi(poi);
      } finally {
        store.setIsGenerating(false);
      }
      return;
    }

    // Full story at destination — fade compass if navigating here (nicht während User-Frage)
    const liveStore = useFinnusStore.getState();
    if (!liveStore.isGenerating && !liveStore.isListening) {
      notifyDestinationAudioStarted(poi.id);
    }
    void setGpsStreamProfile('throttled');

    if (isFoodish(poi)) {
      store.setLastMealHintAtMs(Date.now());
    }

    store.setIsGenerating(true);
    const sessionMemory = { entries: store.visitedHistory };

    let brief;
    let deep;
    try {
      brief = buildFindusStoryBrief({ poi, profile, sessionMemory });
      deep = filterDeepStoryFacts(poi, { profile, sessionMemory });
      store.addChatMessage({ role: 'system', content: buildSystemContext(poi) });
    } catch (prepErr) {
      console.error('[geofence] Story-Prep fehlgeschlagen:', prepErr);
      store.setIsGenerating(false);
      const offline = extractOfflineGeneralInfo(poi);
      await speakTeaserOnly(
        offline ||
          `Schau mal — ${poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim()} liegt genau vor dir.`,
      );
      return;
    }

    const skipIntro =
      plan.action === 'full_story' &&
      (plan.reason === 'approach_already_heard' || heardApproach);

    // Lokaler Hook sofort → TTS startet, während Gemini noch läuft
    const localHook = skipIntro
      ? ''
      : buildFastHook(poi, profile, sessionMemory).trim();
    const collected: string[] = [];
    let fastHook = localHook;

    try {
      await stopSpeaking();
      const voiceSettings = await getVoiceSettingsForTour();

      // Gemini sofort anstoßen — läuft parallel zum lokalen Hook-TTS
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
        approachAlreadyHeard: skipIntro,
        timeoutMs: 22000,
        parentIsMajor,
      })[Symbol.asyncIterator]();
      const firstGeminiPromise = geminiIter.next();

      const subHintPromise =
        kind === 'area' || kind === 'legacy'
          ? buildSubHintLine(poi.id)
          : Promise.resolve<string | null>(null);

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
          console.error('[geofence] Story stream failed:', error);
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
          `[geofence] ${kind} pipeline(localHook=${localHook ? 'yes' : 'no'}→gemini+tts-queue)`,
        );
      }

      store.setIsGenerating(false);
      try {
        await speakSentenceStream(storySentences(), {
          voiceId: voiceSettings.voiceId,
          speechRate: voiceSettings.speechRate,
        });
      } finally {
        const fullText = [fastHook, ...collected.filter((s) => s !== fastHook)]
          .join(' ')
          .trim();
        if (fullText) {
          store.addChatMessage({ role: 'assistant', content: fullText });
          void commitFeatureTipsAfterStory(fullText).catch((err) =>
            console.warn('[featureTips] commit failed:', err),
          );
          store.addToldFactKeys([
            factKey(fastHook),
            ...deep.facts.map((f) => factKey(f.text)),
          ]);
          store.addVisitedPlace(
            buildVisitedMemoryEntry(
              poi,
              toStampBullets(
                collected.length > 0
                  ? collected
                  : deep.facts.map((f) => f.text),
                3,
              ),
            ),
          );
          try {
            const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
            const blob = `${poi.name} ${poi.category ?? ''} ${tags}`;
            const type = /(hotel|pension|unterkunft)/i.test(blob)
              ? 'hotel'
              : /(restaurant|gastro|café|cafe|burger|imbiss|pizzeria)/i.test(
                    blob,
                  )
                ? 'restaurant'
                : /(bahnhof|bus|fähre|faehre|hafen)/i.test(blob)
                  ? 'transit'
                  : 'attraction';
            useUserMemoryStore.getState().addOrUpdateEntity({
              type,
              name: poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
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
      console.error('[geofence] Hook/Audio fehlgeschlagen:', error);
      store.setIsGenerating(false);
      store.setSubtitleText(null);
      store.setIsPlayingAudio(false);
    }
  } finally {
    if (myEpoch === narrationEpoch) {
      narrationBusy = false;
    }
    notifyDestinationAudioEnded();
    // Nach Audio: adaptive Frequenz (nicht blind realtime)
    if (lastUserLat != null && lastUserLng != null) {
      void updateAdaptiveGpsProfile({
        lat: lastUserLat,
        lng: lastUserLng,
        audioBusy: false,
      });
    } else {
      void setGpsStreamProfile('economy');
    }
  }
}

export async function handleLocationUpdate(
  lat: number,
  lng: number,
  opts?: { speedMs?: number | null; headingDeg?: number | null },
): Promise<void> {
  lastUserLat = lat;
  lastUserLng = lng;

  // Free-Roam: Speed → TransportMode (auch wenn gerade Audio läuft, für Schwellen)
  const motionMode = tickFreeRoamMotion(opts?.speedMs ?? null);
  const radiusScale = thresholdsForMode(motionMode).geofenceRadiusScale;

  const storeEarly = useFinnusStore.getState();
  // Live-km während Navigation — auch wenn Audio/Busy
  if (storeEarly.navActive) {
    tickNavigation(
      lat,
      lng,
      typeof opts?.headingDeg === 'number' ? opts.headingDeg : undefined,
      opts?.speedMs ?? null,
    );
  }

  void updateAdaptiveGpsProfile({
    lat,
    lng,
    speedMs: opts?.speedMs ?? null,
    audioBusy: storeEarly.isPlayingAudio || narrationBusy,
  });

  void maybeSpeakFirstCityWelcome(lat, lng);

  // Passives Dwell-Memory — auch während Audio (still im Hintergrund)
  void tickDwellTracking(lat, lng).catch((err) =>
    console.warn('[dwell] tick failed:', err),
  );

  if (narrationBusy) {
    return;
  }

  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isGenerating) {
    return;
  }

  const match = await matchGeoTriggers(lat, lng, {
    excludePoiIds: allSpokenIds(),
    visitedSpotKeys,
    radiusScale,
  });

  if (!match) {
    if (outsideSinceMs == null) outsideSinceMs = Date.now();
    const { lastVisitedPoiId, setCurrentLocationName, setCurrentPoiId } =
      useFinnusStore.getState();

    if (
      lastVisitedPoiId !== null &&
      Date.now() - outsideSinceMs >= UI_CLEAR_AFTER_MS
    ) {
      setCurrentLocationName(null);
      setCurrentPoiId(null);
    }
    return;
  }

  outsideSinceMs = null;
  await triggerPoiArrival(match.poi.id);
}

function buildSystemContext(poi: PoiWithFacts): string {
  return buildPoiResearchContext(poi);
}
