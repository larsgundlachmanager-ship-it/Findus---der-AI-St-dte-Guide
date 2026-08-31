/**
 * Survival Mode: battery ≤ 20% → audio-first + konkrete Ladeoptionen
 * (Powerbank-Automat / Steckdose / Café) — stadt-agnostisch via OSM+Google.
 * Poll alle 3 Min; erneut erinnern solange der Akku niedrig bleibt (~20 Min Gap).
 */

import * as Battery from 'expo-battery';
import { AppState, type NativeEventSubscription } from 'react-native';
import { useFinnusStore } from '../../store/useFinnusStore';
import { speakAssistantText, getVoiceSettingsForTour } from '../ttsService';
import { setGpsStreamProfile } from '../locationService';
import {
  presentDiscoveryAsConcierge,
  type DiscoveryResult,
} from '../navigation/contextualDiscovery';
import { runPhoneChargeDiscovery } from '../navigation/phoneChargeDiscovery';
import { shortenActionLabel } from '../concierge/actionLabelShorten';

const SURVIVAL_PCT = 20;
const COOLDOWN_MS = 20 * 60_000;

let lastPromptAtMs = 0;
let started = false;
let batterySub: { remove: () => void } | null = null;
let appSub: NativeEventSubscription | null = null;

async function searchChargeNearby(): Promise<DiscoveryResult | null> {
  const { lastGpsLat, lastGpsLng } = useFinnusStore.getState();
  if (
    lastGpsLat == null ||
    lastGpsLng == null ||
    !Number.isFinite(lastGpsLat) ||
    !Number.isFinite(lastGpsLng)
  ) {
    return null;
  }
  try {
    const charge = await runPhoneChargeDiscovery({
      origin: { lat: lastGpsLat, lng: lastGpsLng },
    });
    return {
      queryLabel: charge.queryLabel,
      speech: charge.speech,
      candidates: charge.candidates,
      quickActions: charge.quickActions,
      visualBullets: charge.visualBullets,
      needsConfirmation: charge.needsConfirmation,
      autoInserted: charge.autoInserted,
    };
  } catch {
    return null;
  }
}

async function maybePromptSurvival(level: number | null): Promise<void> {
  if (level == null || !Number.isFinite(level)) return;
  const pct = Math.round(level * 100);
  if (pct > SURVIVAL_PCT) return;

  const now = Date.now();
  if (now - lastPromptAtMs < COOLDOWN_MS) return;
  lastPromptAtMs = now;

  const intro =
    'Jo, dein Akku macht gleich schlapp. Steck das Handy in die Tasche, ' +
    'ich mach alles über Audio — und such dir parallel eine Lademöglichkeit.';

  useFinnusStore.getState().setActiveConciergeCard({
    id: `survival-${now}`,
    createdAtMs: now,
    cardTitle: 'Akku schwach',
    speechText: intro,
    visualBullets: [
      'Akku unter 20 % — Audio-first',
      'Handy in die Tasche stecken',
      'Suche Powerbank / Steckdose…',
    ],
    quickActions: [
      {
        type: 'SHOW_MORE',
        label: shortenActionLabel('Powerbank / Steckdose'),
        payload: {
          textPrompt:
            'Akku fast leer — such Powerbank-Automaten oder Café mit Steckdosen in der Nähe und gib mir Route-Buttons.',
        },
      },
    ],
  });

  try {
    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(intro, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
  } catch {
    /* TTS optional — card still visible */
  }

  try {
    void setGpsStreamProfile('economy');
  } catch {
    // ignore
  }

  // Just-Do-It: konkrete Orte nachliefern (Powerbank bevorzugt)
  const found = await searchChargeNearby();
  if (found && found.candidates.length > 0) {
    const speech = found.speech;
    presentDiscoveryAsConcierge({
      ...found,
      speech,
      visualBullets: (found.visualBullets ?? []).slice(0, 2),
      queryLabel: 'Handy laden',
    });
    try {
      const voice = await getVoiceSettingsForTour();
      // Dieselbe Speech wie auf der Karte (Stichpunkte = gesprochene Orte)
      await speakAssistantText(speech, {
        voiceId: voice.voiceId,
        speechRate: voice.speechRate,
      });
    } catch {
      /* soft */
    }
    return;
  }

  useFinnusStore.getState().setActiveConciergeCard({
    id: `survival-${now}-fallback`,
    createdAtMs: Date.now(),
    cardTitle: 'Akku schwach',
    speechText:
      'Noch kein klarer Lade-Spot in der Nähe — tipp den Button, dann such ich nochmal Powerbank oder Steckdose.',
    visualBullets: [
      'Akku unter 20 % — Audio-first',
      'Powerbank-Automat oder Café mit Steckdose',
      'GPS an = bessere Treffer',
    ],
    quickActions: [
      {
        type: 'SHOW_MORE',
        label: shortenActionLabel('Powerbank suchen'),
        payload: {
          textPrompt:
            'Akku fast leer — such Powerbank-Automaten in der Nähe und gib mir eine Route.',
        },
      },
      {
        type: 'SHOW_MORE',
        label: shortenActionLabel('Café mit Steckdose'),
        payload: {
          textPrompt:
            'Akku fast leer — such ein Café mit Steckdosen in der Nähe und gib mir eine Route.',
        },
      },
    ],
  });
}

async function pollOnce(): Promise<void> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    await maybePromptSurvival(level);
  } catch {
    /* battery API unavailable */
  }
}

/** Start battery watcher. Returns unsubscribe. */
export function startSurvivalModeMonitor(): () => void {
  if (started) {
    return () => undefined;
  }
  started = true;

  void pollOnce();

  try {
    batterySub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      void maybePromptSurvival(batteryLevel);
    });
  } catch {
    batterySub = null;
  }

  appSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void pollOnce();
  });

  const interval = setInterval(() => {
    void pollOnce();
  }, 3 * 60_000);

  return () => {
    started = false;
    clearInterval(interval);
    batterySub?.remove();
    batterySub = null;
    appSub?.remove();
    appSub = null;
  };
}

export function isSurvivalBatteryLevel(level01: number | null): boolean {
  if (level01 == null || !Number.isFinite(level01)) return false;
  return Math.round(level01 * 100) <= SURVIVAL_PCT;
}
