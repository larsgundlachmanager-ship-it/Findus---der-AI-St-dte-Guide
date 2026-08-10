/**
 * Session-Resume nach App-Kill / Hintergrund (max. 5 Min).
 * Innerhalb des Fensters: Story automatisch weitererzählen — kein „Weiter?“-Klick.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getCachedUserProfile } from '../userProfileService';
import {
  getNarrationResumeState,
  remainingNarrationText,
  type NarrationKind,
  type NarrationResumeState,
} from './narrationResumeState';

const KEY = '@findus/session_resume_v2';
/** Nach 5 Min kein Auto-Weitererzählen mehr. */
const MAX_AGE_MS = 5 * 60_000;

export type SessionResumeSnapshot = {
  savedAtMs: number;
  leaveKind: string;
  currentPoiId: number | null;
  navTargetName: string | null;
  navActive: boolean;
  pendingNavOffer: {
    poiId: number;
    name: string;
    lat: number;
    lng: number;
  } | null;
  cardTitle: string | null;
  cardSpeechPreview: string | null;
  cityName: string | null;
  narration: {
    poiId: number;
    poiName: string;
    kind: NarrationKind;
    fullText: string;
    spokenCharOffset: number;
  } | null;
};

let offeredThisBoot = false;

function narrationFromLive(): SessionResumeSnapshot['narration'] {
  const n = getNarrationResumeState();
  if (!n?.fullText) return null;
  const rest = remainingNarrationText(n);
  if (rest.length < 40) return null;
  return {
    poiId: n.poiId,
    poiName: n.poiName,
    kind: n.kind,
    fullText: n.fullText,
    spokenCharOffset: n.spokenCharOffset,
  };
}

export async function persistSessionSnapshot(opts: {
  leaveKind: string;
}): Promise<void> {
  try {
    const s = useFinnusStore.getState();
    const offer = s.pendingNavOffer;
    const card = s.activeConciergeCard;
    const narration = narrationFromLive();
    const snap: SessionResumeSnapshot = {
      savedAtMs: Date.now(),
      leaveKind: opts.leaveKind,
      currentPoiId: s.currentPoiId ?? narration?.poiId ?? null,
      navTargetName: s.navTargetName,
      navActive: Boolean(s.navActive),
      pendingNavOffer:
        offer &&
        typeof offer.lat === 'number' &&
        typeof offer.lng === 'number'
          ? {
              poiId: offer.poiId,
              name: offer.name,
              lat: offer.lat,
              lng: offer.lng,
            }
          : null,
      cardTitle: card?.cardTitle ?? null,
      cardSpeechPreview: card?.speechText?.slice(0, 160) ?? null,
      cityName: getCachedUserProfile()?.cityName?.trim() || null,
      narration,
    };
    if (
      !snap.currentPoiId &&
      !snap.navActive &&
      !snap.pendingNavOffer &&
      !snap.cardTitle &&
      !snap.narration
    ) {
      return;
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    /* soft */
  }
}

export async function loadSessionSnapshot(): Promise<SessionResumeSnapshot | null> {
  try {
    const raw =
      (await AsyncStorage.getItem(KEY)) ||
      (await AsyncStorage.getItem('@findus/session_resume_v1'));
    if (!raw) return null;
    const snap = JSON.parse(raw) as SessionResumeSnapshot;
    if (!snap?.savedAtMs || Date.now() - snap.savedAtMs > MAX_AGE_MS) {
      await clearSessionSnapshot();
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

export async function clearSessionSnapshot(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      KEY,
      '@findus/session_resume_v1',
      '@findus/session_resume_pending_narration',
    ]);
  } catch {
    /* soft */
  }
}

async function resumeNarrationFromSnapshot(
  narration: NonNullable<SessionResumeSnapshot['narration']>,
): Promise<void> {
  const rest = remainingNarrationText({
    ...narration,
    updatedAtMs: Date.now(),
  } as NarrationResumeState);
  if (rest.length < 20) return;

  useFinnusStore.getState().setCurrentPoiId(narration.poiId);
  try {
    const { beginNarrationResume, completeNarrationResume } = await import(
      './narrationResumeState'
    );
    beginNarrationResume({
      poiId: narration.poiId,
      poiName: narration.poiName,
      kind: narration.kind,
      fullText: rest,
    });
    const { speakAssistantText, getVoiceSettingsForTour } = await import(
      '../ttsService'
    );
    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(rest, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
    completeNarrationResume();
  } catch (err) {
    if (__DEV__) console.warn('[sessionResume] narration continue failed', err);
  }
}

/**
 * Nach Cold-Start / Vordergrund: innerhalb 5 Min Story automatisch weitererzählen.
 * Keine Concierge-Karte, kein „Ja bitte“ / „Verwerfen“.
 */
export async function maybeOfferSessionResume(): Promise<boolean> {
  if (offeredThisBoot) return false;
  const profile = getCachedUserProfile();
  if (!profile?.setupComplete) return false;

  const snap = await loadSessionSnapshot();
  if (!snap) return false;

  offeredThisBoot = true;

  const s = useFinnusStore.getState();
  // Nav läuft schon → nichts anbieten/überlagern
  if (s.navActive) {
    await clearSessionSnapshot();
    return false;
  }

  // Schon Audio aktiv → nicht dazwischenquatschen
  if (s.isPlayingAudio || s.isAudiblySpeaking) {
    await clearSessionSnapshot();
    return false;
  }

  const narration = snap.narration;
  const restLen = narration
    ? remainingNarrationText({
        ...narration,
        updatedAtMs: Date.now(),
      } as NarrationResumeState).length
    : 0;

  await clearSessionSnapshot();

  if (!narration || restLen < 40) {
    return false;
  }

  if (__DEV__) {
    console.log(
      `[sessionResume] auto-continue „${narration.poiName}“ (${restLen} chars)`,
    );
  }

  // Keine UI — sofort weitererzählen
  void resumeNarrationFromSnapshot(narration);
  return true;
}

/** Legacy: SHOW_MORE mit __RESUME_NARRATION__ (falls alte Cards). */
export async function tryHandleNarrationResumePrompt(
  textPrompt: string,
): Promise<boolean> {
  if (!/^__RESUME_NARRATION__/i.test(textPrompt)) return false;
  try {
    const raw = await AsyncStorage.getItem(
      '@findus/session_resume_pending_narration',
    );
    await AsyncStorage.removeItem('@findus/session_resume_pending_narration');
    if (!raw) return true;
    const narration = JSON.parse(raw) as NonNullable<
      SessionResumeSnapshot['narration']
    >;
    await resumeNarrationFromSnapshot(narration);
  } catch {
    /* soft */
  }
  return true;
}

export async function bootstrapSessionResume(): Promise<void> {
  offeredThisBoot = false;
  await maybeOfferSessionResume();
}
