/**
 * Soft Login-Erinnerung für Gäste — einmalig, nie während aktiver Nav.
 * Dies sind nur abstrakte Beispiele für den logischen Ablauf.
 */

import * as FileSystem from 'expo-file-system';
import { getCachedUserProfile } from '../userProfileService';
import { profileHasFinishedSetup } from '../../types/userProfile';
import { getLastAuthUser } from './findusAuth';
import { useFinnusStore } from '../../store/useFinnusStore';

const STATE_PATH = `${FileSystem.documentDirectory}findus-guest-auth-nudge.json`;
const MIN_SETUP_AGE_MS = 2 * 60 * 60_000;
const COOLDOWN_MS = 72 * 60 * 60_000;

type NudgeState = {
  lastSpokeAtMs: number;
  spoken: boolean;
};

let cache: NudgeState | null = null;

async function loadState(): Promise<NudgeState> {
  if (cache) return cache;
  try {
    const raw = await FileSystem.readAsStringAsync(STATE_PATH);
    const parsed = JSON.parse(raw) as Partial<NudgeState>;
    cache = {
      lastSpokeAtMs: Number(parsed.lastSpokeAtMs) || 0,
      spoken: parsed.spoken === true,
    };
  } catch {
    cache = { lastSpokeAtMs: 0, spoken: false };
  }
  return cache;
}

async function saveState(next: NudgeState): Promise<void> {
  cache = next;
  try {
    await FileSystem.writeAsStringAsync(STATE_PATH, JSON.stringify(next));
  } catch {
    /* soft */
  }
}

/**
 * Feuert soft, wenn Gast + Setup fertig + nicht in Nav / Voice-Busy.
 * @returns true wenn angesagt
 */
export async function maybeSpeakGuestAuthNudge(
  nowMs: number = Date.now(),
): Promise<boolean> {
  try {
    const store = useFinnusStore.getState();
    if (store.navActive) return false;
    if (store.isListening || store.isGenerating || store.isPlayingAudio) {
      return false;
    }
    if (getLastAuthUser()) return false;
    const profile = getCachedUserProfile();
    if (!profile || profile.accountMode !== 'guest') return false;
    if (!profileHasFinishedSetup(profile)) return false;
    const setupRaw = profile.completedAt;
    const setupAt =
      typeof setupRaw === 'string' && setupRaw.trim()
        ? Date.parse(setupRaw)
        : 0;
    if (Number.isFinite(setupAt) && setupAt > 0 && nowMs - setupAt < MIN_SETUP_AGE_MS) {
      return false;
    }

    const state = await loadState();
    if (state.spoken && nowMs - state.lastSpokeAtMs < COOLDOWN_MS) {
      return false;
    }

    const line =
      'Wenn du willst: mit Konto bleiben Stempel, Fog und Pläne auch auf dem nächsten Gerät — unter Einstellungen kannst du dich anmelden.';
    const { speakRuntimeText } = await import('../../runtime/speechModule');
    const { getVoiceSettingsForTour } = await import('../ttsService');
    const voice = await getVoiceSettingsForTour();
    store.addChatMessage({ role: 'assistant', content: line });
    await speakRuntimeText(
      line,
      { voiceId: voice.voiceId, speechRate: voice.speechRate },
      { deliveryKind: 'reminder' },
    );
    await saveState({ spoken: true, lastSpokeAtMs: nowMs });
    return true;
  } catch {
    return false;
  }
}
