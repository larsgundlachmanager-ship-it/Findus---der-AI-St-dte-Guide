/**
 * Ambient „was heute geht“: nach ~10 Min App offen + 60 s Stille,
 * max. alle 8 Stunden eine belegte Event-Ansage (~5 km, Audience-Fit).
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
  loadEventPitchMemory,
  noteEventPitchSpoken,
  softSkipTagsForUser,
} from './eventPitchMemory';
import { isUpcomingForUnsolicitedPitch } from '../speech/laterPlanSpeech';
import { allowProactiveVoice } from '../ui/nachtruhePolicy';

const APP_OPEN_MIN_MS = 10 * 60_000;
const SILENCE_MIN_MS = 60_000;
/** Harte Obergrenze: höchstens eine Ansage alle 8 Stunden. */
export const AMBIENT_EVENT_PITCH_COOLDOWN_MS = 8 * 60 * 60_000;

let bootstrapped = false;
let foregroundSinceMs = Date.now();
let silenceSinceMs: number | null = null;
let pitchedThisForeground = false;
let researchInFlight = false;

function isConversationBusy(): boolean {
  const s = useFinnusStore.getState();
  return (
    s.isPlayingAudio ||
    s.isAudiblySpeaking ||
    s.isListening ||
    s.isGenerating ||
    Boolean(s.activeConciergeCard)
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
 * GPS-Tick: ggf. pitchen, was im Umkreis (~5 km) heute geht (max. 1× / 8 h).
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

  const speakGate = canSpeakExploreEvent('main', now);
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
    if (
      memory?.lastPitchAtMs != null &&
      now - memory.lastPitchAtMs < AMBIENT_EVENT_PITCH_COOLDOWN_MS
    ) {
      return;
    }
    if (isConversationBusy()) {
      pitchedThisForeground = false;
      return;
    }
    const mem = memory ?? (await loadEventPitchMemory());
    const cityHint =
      profile.cityName?.trim() || profile.cityId?.trim() || null;
    if (isConversationBusy()) {
      pitchedThisForeground = false;
      return;
    }
    const spots = await researchTemporaryLiveSpots({
      lat,
      lng,
      cityHint,
      timeoutMs: 12_000,
      maxDistanceM: 5_000,
      forAmbientPitch: true,
      user: {
        age: profile.age,
        travelParty: profile.travelParty ?? null,
        nightlifeOk: Boolean(profile.mustHaveStyles?.includes('nightlife')),
        aboutMe: profile.aboutMe?.trim() || null,
        softSkipTags: softSkipTagsForUser(mem, profile),
      },
    });
    if (!spots.length) {
      // Session verbraucht (kein Research-Spam); 8h-Cooldown nur bei echter Ansage
      return;
    }
    if (isConversationBusy()) {
      pitchedThisForeground = false;
      return;
    }

    const spot = spots[0]!;
    const clockNow = new Date(now);
    if (
      !isUpcomingForUnsolicitedPitch(
        `${spot.whenLabel} ${spot.name} ${spot.hook}`,
        clockNow,
        { kindHint: spot.kindHint },
      )
    ) {
      return;
    }
    const lastName = (mem.lastPitchName || '').trim().toLowerCase();
    if (
      lastName &&
      lastName === spot.name.trim().toLowerCase() &&
      mem.lastPitchAtMs != null &&
      now - mem.lastPitchAtMs < AMBIENT_EVENT_PITCH_COOLDOWN_MS
    ) {
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
