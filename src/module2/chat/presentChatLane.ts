/**
 * Present Chat-Lane result — Speech zuerst, Stichpunkte/Buttons nachziehen.
 */

import type { ChatLaneResult } from './runChatLane';
import type {
  LogicNodeOutput,
  Module2ActionButton,
  PipelineTurnResult,
  SynthesisPayload,
} from '../types';
import { synthesizeOutput } from '../pipeline/synthesis';
import { presentToUi } from '../pipeline/presentToUi';
import { enqueueSpeech } from '../speech/speechQueue';
import { sanitizeBridgeText } from './butlerOfferBus';
import type { QuickAction } from '../../types/concierge';

function quickToModule2(a: QuickAction, i: number): Module2ActionButton | null {
  const id = `chat_${a.type}_${i}`.slice(0, 40);
  if (
    a.type === 'START_NAVIGATION' &&
    typeof a.payload.destLat === 'number' &&
    typeof a.payload.destLng === 'number'
  ) {
    return {
      id,
      label: a.label,
      payload: {
        kind: 'navigate',
        lat: a.payload.destLat,
        lng: a.payload.destLng,
        label: a.payload.destName || a.label,
      },
    };
  }
  if (a.type === 'OPEN_URL' && a.payload.url) {
    return {
      id,
      label: a.label,
      payload: {
        kind: 'deep_link',
        url: a.payload.url,
        destName: a.payload.destName || a.label,
      },
    };
  }
  if (a.type === 'DIAL_PHONE' && a.payload.phoneNumber) {
    return {
      id,
      label: a.label,
      payload: { kind: 'dial', phone: a.payload.phoneNumber },
    };
  }
  const prompt = a.payload.textPrompt;
  if (prompt) {
    return {
      id,
      label: a.label,
      payload: {
        kind: 'ui',
        action: 'text_prompt',
        data: { textPrompt: prompt },
      },
    };
  }
  return null;
}

async function enrichChatPresentation(
  result: ChatLaneResult,
  userText?: string,
): Promise<ChatLaneResult> {
  let speech = result.speech;
  let bullets = [...result.bullets];
  let buttons = [...result.buttons];
  try {
    const { stripPermissionLookupAsks } = require('../../services/concierge/justDoItPolicy') as {
      stripPermissionLookupAsks: (s: string) => string;
    };
    speech = stripPermissionLookupAsks(speech);
  } catch {
    /* soft */
  }
  try {
    const { looksLikeOutfitOrWeatherUtterance } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
    };
    const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    const skipDerive =
      Boolean(userText) &&
      looksLikeOutfitOrWeatherUtterance(userText) &&
      !looksLikePicnicQuery(userText);
    if (!skipDerive) {
      const { deriveMemoryBullets } = require('../../services/concierge/speechMemoryBullets') as {
        deriveMemoryBullets: (
          s: string,
          e?: string[] | null,
          o?: { userText?: string },
        ) => string[];
      };
      bullets = deriveMemoryBullets(speech, bullets, { userText }).slice(0, 3);
    }
  } catch {
    /* soft */
  }
  try {
    const { deriveHelpActionsFromSpeech } = require('../../services/concierge/postSpeechActions') as {
      deriveHelpActionsFromSpeech: (o: {
        speech: string;
        userText?: string;
        existing?: QuickAction[];
        maxActions?: number;
      }) => Promise<{ actions: QuickAction[] }>;
    };
    const existingUrls: QuickAction[] = [];
    for (const b of buttons) {
      const p = b.payload;
      if (p.kind === 'deep_link' && p.url) {
        existingUrls.push({
          type: 'OPEN_URL',
          label: b.label,
          payload: { url: p.url },
        });
      }
    }
    const help = await deriveHelpActionsFromSpeech({
      speech,
      existing: existingUrls,
      maxActions: 4,
    });
    const extra = help.actions
      .map((a, i) => quickToModule2(a, i))
      .filter((x): x is Module2ActionButton => Boolean(x));
    const seen = new Set(buttons.map((b) => b.label.toLowerCase()));
    for (const b of extra) {
      if (seen.has(b.label.toLowerCase())) continue;
      seen.add(b.label.toLowerCase());
      buttons.push(b);
      if (buttons.length >= 4) break;
    }
  } catch {
    /* soft */
  }
  return { ...result, speech, bullets, buttons };
}

export async function presentChatLaneResult(opts: {
  turnId: string;
  result: ChatLaneResult;
  bridgeFromRouter?: string | null;
  userText?: string;
}): Promise<PipelineTurnResult> {
  const { turnId } = opts;
  const result = await enrichChatPresentation(opts.result, opts.userText);
  let bridgingText: string | null = null;

  const bridge =
    sanitizeBridgeText(opts.bridgeFromRouter) || result.bridgeSpoken;

  if (bridge) {
    bridgingText = bridge;
    try {
      const { hadRecentLatencyAck } = require('../../services/speech/floskelEngine') as {
        hadRecentLatencyAck: (ms?: number) => boolean;
      };
      const already = (() => {
        try {
          const { isBridgeAlreadySpoken } = require('../../services/speech/contextualBridge') as {
            isBridgeAlreadySpoken: (line?: string | null) => boolean;
          };
          return isBridgeAlreadySpoken(bridge);
        } catch {
          return false;
        }
      })();
      if (!already && !hadRecentLatencyAck(12_000)) {
        enqueueSpeech({
          kind: 'bridging',
          text: bridge,
          turnId,
          alreadySpoken: false,
        });
        try {
          const { noteLatencyAck } = require('../../services/speech/floskelEngine') as {
            noteLatencyAck: (p?: string | null) => void;
          };
          noteLatencyAck(bridge);
        } catch {
          /* soft */
        }
        try {
          const { rememberSpokenBridgeLine } = require('../../services/speech/contextualBridge') as {
            rememberSpokenBridgeLine: (s: string) => void;
          };
          rememberSpokenBridgeLine(bridge);
        } catch {
          /* soft */
        }
      }
    } catch {
      /* soft */
    }
  }

  const logic: LogicNodeOutput = {
    spokenDraft: result.speech,
    bullets: result.bullets,
    buttons: result.buttons,
    moneyEur: [],
    warnings: [],
  };
  const synthesis: SynthesisPayload = synthesizeOutput(logic);

  // Haupt-Antwort nur über die Queue — sonst alreadySpoken ohne Audio = Stille.
  enqueueSpeech({
    kind: 'main',
    text: result.speech,
    turnId,
    alreadySpoken: false,
  });

  // Parallel: Speech läuft → Stichpunkte/Buttons nachziehen (nicht 10 s warten).
  // Max kurz nach Hörstart bzw. Fallback ~0,9 s, damit die Card nie „leer“ bleibt.
  const bullets = result.bullets;
  const buttons = result.buttons;
  void (async () => {
    await waitUntilSpeechRunningOrMs(900);
    try {
      await presentToUi(result.speech, bullets, buttons, {
        userText: opts.userText,
        cardTitle: result.cardTitle,
        // Leer → aus Speech ableiten; sonst vorhandene behalten
        skipBulletDerive: bullets.filter(Boolean).length > 0,
      });
    } catch {
      /* soft */
    }
  })();

  try {
    const { latencyMark } = require('../../services/debug/latencyTiming') as {
      latencyMark: (m: string, d?: string) => void;
    };
    latencyMark('tts', 'chat_lane_main');
  } catch {
    /* soft */
  }

  return {
    turnId,
    tasks: [],
    bridgingText,
    logic,
    synthesis,
    deepResearchQueued: result.needsResearch === 'deep',
    jobId: result.celestial ? 'fact_number' : 'chat_lane',
    jobCompletenessOk: true,
  };
}

/**
 * Wartet bis TTS hörbar / Session aktiv — oder max. `maxMs`.
 * Nie lange blockieren: Card soll parallel zur Speech kommen.
 */
async function waitUntilSpeechRunningOrMs(maxMs: number): Promise<boolean> {
  const start = Date.now();
  try {
    const { isAudiblyPlaying } = require('../../services/AudioVoiceService') as {
      isAudiblyPlaying: () => boolean;
    };
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => {
          isPlayingAudio?: boolean;
          isAudiblySpeaking?: boolean;
        };
      };
    };
    while (Date.now() - start < maxMs) {
      const s = useFinnusStore.getState();
      if (isAudiblyPlaying() || s.isAudiblySpeaking || s.isPlayingAudio) {
        await sleep(80);
        return true;
      }
      await sleep(40);
    }
  } catch {
    await sleep(Math.min(400, maxMs));
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
