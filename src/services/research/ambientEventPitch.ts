/**
 * Ambient „was heute geht“: nach ~10 Min App offen + 60 s Stille,
 * max. alle 2 Stunden eine belegte Event-Ansage (~5 km, Audience-Fit;
 * motivierend: Was · Preis · Wo · Anreise · Warum).
 */

import { AppState, type AppStateStatus } from 'react-native';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import { canSpeakExploreEvent } from '../navigation/modulePriorityPolicy';
import {
  formatTemporaryLiveSpeech,
  researchTemporaryLiveSpots,
  type TemporaryLiveSpot,
} from './temporaryLiveSpots';
import {
  buildEventOfferKey,
  canEventPitch,
  EVENT_PITCH_COOLDOWN_MS,
  eventPitchQuotaExhausted,
  loadEventPitchMemory,
  noteEventPitchSpoken,
  softSkipTagsForUser,
} from './eventPitchMemory';
import { isUpcomingForUnsolicitedPitch } from '../speech/laterPlanSpeech';
import { allowProactiveVoice } from '../ui/nachtruhePolicy';

const APP_OPEN_MIN_MS = 10 * 60_000;
const SILENCE_MIN_MS = 60_000;
/** @deprecated Prefer EVENT_PITCH_COOLDOWN_MS — same value. */
export const AMBIENT_EVENT_PITCH_COOLDOWN_MS = EVENT_PITCH_COOLDOWN_MS;

let bootstrapped = false;
let foregroundSinceMs = Date.now();
let silenceSinceMs: number | null = null;
let pitchedThisForeground = false;
let researchInFlight = false;

function isConversationBusy(): boolean {
  const s = useFinnusStore.getState();
  const card = s.activeConciergeCard;
  const cardBusy = Boolean(
    card &&
      ((card.visualBullets?.length ?? 0) > 0 ||
        (card.quickActions?.length ?? 0) > 0),
  );
  return (
    s.isPlayingAudio ||
    s.isAudiblySpeaking ||
    s.isListening ||
    s.isGenerating ||
    cardBusy
  );
}

function refreshSilenceClock(now = Date.now()): void {
  if (isConversationBusy()) {
    silenceSinceMs = null;
    return;
  }
  if (silenceSinceMs == null) silenceSinceMs = now;
}

export function bootstrapAmbientEventPitch(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  foregroundSinceMs = Date.now();
  silenceSinceMs = Date.now();
  let last: AppStateStatus = AppState.currentState;
  AppState.addEventListener('change', (next) => {
    const prev = last;
    last = next;
    if (next === 'active' && prev !== 'active') {
      foregroundSinceMs = Date.now();
      silenceSinceMs = Date.now();
      pitchedThisForeground = false;
    }
    if (
      (next === 'background' || next === 'inactive') &&
      prev === 'active'
    ) {
      silenceSinceMs = null;
    }
  });
}

export function noteAmbientConversationActivity(): void {
  silenceSinceMs = null;
}

/**
 * GPS-Tick: ggf. pitchen, was im Umkreis (~5 km) heute geht (max. 1× / 2 h).
 */
export async function tickAmbientEventPitch(
  lat: number,
  lng: number,
): Promise<void> {
  bootstrapAmbientEventPitch();
  const now = Date.now();
  refreshSilenceClock(now);

  if (pitchedThisForeground) return;
  if (researchInFlight) return;
  if (!allowProactiveVoice(now)) return;
  try {
    const { isOpenQuietActive } = require('../navigation/modulePriorityPolicy') as {
      isOpenQuietActive: (n?: number) => boolean;
    };
    if (isOpenQuietActive(now)) return;
  } catch {
    /* soft */
  }
  try {
    const { isProactiveAlertEnabled } = require('../notifications/proactiveAlerts') as {
      isProactiveAlertEnabled: (k: 'ambientEvents') => boolean;
    };
    if (!isProactiveAlertEnabled('ambientEvents')) return;
  } catch {
    /* soft */
  }
  if (now - foregroundSinceMs < APP_OPEN_MIN_MS) return;
  if (silenceSinceMs == null || now - silenceSinceMs < SILENCE_MIN_MS) return;
  if (isConversationBusy()) return;

  // 'other' — Ambient ist kein Hauptort (Open-Quiet + 60s nach M2 bleiben)
  const speakGate = canSpeakExploreEvent('other', undefined, now);
  if (!speakGate.ok) return;

  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return;

  researchInFlight = true;
  pitchedThisForeground = true;
  silenceSinceMs = null;

  try {
    // Modul 2 aktiv → Live/Ambient pausiert (keine neue Recherche)
    if (isConversationBusy()) {
      pitchedThisForeground = false;
      return;
    }
    let memory;
    try {
      memory = await loadEventPitchMemory();
    } catch {
      memory = null;
    }
    if (eventPitchQuotaExhausted(memory, now)) {
      return;
    }
    if (isConversationBusy()) {
      pitchedThisForeground = false;
      return;
    }

    // Nähe-Arena/Theater zuerst (enger Radius) — teilt 8h-Quota
    try {
      const { useFinnusStore } = require('../../store/useFinnusStore') as {
        useFinnusStore: { getState: () => { navActive?: boolean } };
      };
      if (useFinnusStore.getState().navActive) return;
      const { tryVenueWalkByPitch } = await import('./venueWalkByPitch');
      const walked = await tryVenueWalkByPitch({ lat, lng, now });
      if (walked) return;
    } catch {
      /* soft — Stadt-Ambient weiter */
    }

    const mem = memory ?? (await loadEventPitchMemory());
    const cityHint =
      profile.cityName?.trim() || profile.cityId?.trim() || null;
    if (isConversationBusy()) {
      pitchedThisForeground = false;
      return;
    }
    const spots = await (async () => {
      const rings = [5_000, 15_000, 30_000] as const;
      for (const maxDistanceM of rings) {
        const found = await researchTemporaryLiveSpots({
          lat,
          lng,
          cityHint,
          timeoutMs: 12_000,
          maxDistanceM,
          forAmbientPitch: true,
          user: {
            age: profile.age,
            travelParty: profile.travelParty ?? null,
            nightlifeOk: Boolean(profile.mustHaveStyles?.includes('nightlife')),
            aboutMe: profile.aboutMe?.trim() || null,
            softSkipTags: softSkipTagsForUser(mem, profile),
          },
        });
        if (found.length) {
          if (maxDistanceM > 5_000 && __DEV__) {
            console.warn(
              `[ambientEvent] expand ring=${maxDistanceM}m hits=${found.length}`,
            );
          }
          return found;
        }
      }
      return [] as Awaited<ReturnType<typeof researchTemporaryLiveSpots>>;
    })();
    if (!spots.length) {
      // Session verbraucht (kein Research-Spam); 8h-Cooldown nur bei echter Ansage
      return;
    }
    if (isConversationBusy()) {
      pitchedThisForeground = false;
      return;
    }

    let spot: TemporaryLiveSpot | null = null;
    const clockNow = new Date(now);
    for (const candidate of spots) {
      if (
        !isUpcomingForUnsolicitedPitch(
          `${candidate.whenLabel} ${candidate.name} ${candidate.hook}`,
          clockNow,
          { kindHint: candidate.kindHint },
        )
      ) {
        continue;
      }
      const offerKey = buildEventOfferKey({
        venueName: candidate.name,
        whenLabel: candidate.whenLabel,
        titleOrHook: candidate.hook,
      });
      if (
        !canEventPitch(mem, now, {
          venueName: candidate.name,
          offerKey,
        }).ok
      ) {
        continue;
      }
      spot = candidate;
      break;
    }
    if (!spot) {
      return;
    }
    const speech = formatTemporaryLiveSpeech(spot, clockNow);
    if (speech.length < 12) {
      return;
    }

    const { speakAssistantText, getVoiceSettingsForTour } = await import(
      '../ttsService'
    );
    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(speech, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
    await noteEventPitchSpoken(spot);
  } catch (err) {
    if (__DEV__) console.warn('[ambientEventPitch]', err);
    pitchedThisForeground = false;
  } finally {
    researchInFlight = false;
  }
}

export function __resetAmbientEventPitchForTests(): void {
  foregroundSinceMs = Date.now();
  silenceSinceMs = Date.now();
  pitchedThisForeground = false;
  researchInFlight = false;
}

export type { TemporaryLiveSpot };
