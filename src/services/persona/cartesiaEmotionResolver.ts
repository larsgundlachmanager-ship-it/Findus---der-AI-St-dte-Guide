/**
 * Live Cartesia generation_config — Tempo/Lautstärke, keine Emotion-Tags.
 *
 * Cartesia-`emotion` (excited, determined, …) ist auf englische Stimmen
 * trainiert. Auf native de-DE-Voices (Alina/Sebastian) zieht das den
 * ganzen Satz in einen US-Akzent. Die Offline-Hörproben klingen sauber,
 * weil sie kein `generation_config.emotion` schicken.
 *
 * Emotion kommt aus dem deutschen Text (Satzzeichen, Wortwahl) —
 * Cartesia interpretiert das von allein.
 */

import type { CartesiaGenerationConfig } from '../cartesiaTtsService';
import type { VoiceId } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  resolveSituationContext,
  vibeToneForEmotion,
} from './situationGate';

const STRESS_PACE: CartesiaGenerationConfig = {
  speed: 1.22,
  volume: 1.05,
};

const CALM_PACE: CartesiaGenerationConfig = {
  speed: 1.14,
  volume: 1.0,
};

const WONDER_CHILD_PACE: CartesiaGenerationConfig = {
  speed: 1.14,
  volume: 1.12,
};

/** Stimmen, die von Natur aus träge wirken — etwas anziehen. */
function voiceSpeedBias(voiceId?: VoiceId | null): number {
  if (voiceId === 'klaus') return 0.12;
  if (voiceId === 'lukas' || voiceId === 'alexander') return 0.04;
  return 0;
}

function withVoiceSpeed(
  cfg: CartesiaGenerationConfig,
  voiceId?: VoiceId | null,
): CartesiaGenerationConfig {
  const base = typeof cfg.speed === 'number' ? cfg.speed : 1;
  let volume = cfg.volume;
  try {
    const { applyUserTtsVolume } = require('../speech/ttsVolumePref') as {
      applyUserTtsVolume: (b?: number | null) => number;
    };
    volume = applyUserTtsVolume(volume ?? 1.02);
  } catch {
    /* soft */
  }
  return {
    ...cfg,
    speed: Math.min(1.45, Math.max(0.7, base + voiceSpeedBias(voiceId))),
    volume,
  };
}

export function resolveCartesiaGenerationForChunk(
  text: string,
  _index: number,
  speakVoiceId?: VoiceId | null,
): CartesiaGenerationConfig {
  const profile = getCachedUserProfile();
  const ctx = resolveSituationContext({ profile: profile ?? undefined });
  const vibe = vibeToneForEmotion(profile?.vibeTone);
  const voiceId = speakVoiceId ?? profile?.voiceId;
  const isWonderChild =
    profile?.coreRole === 'innocent_child' || voiceId === 'rena';

  if (isWonderChild && !ctx.stress) {
    return withVoiceSpeed({ ...WONDER_CHILD_PACE }, voiceId);
  }

  if (ctx.stress || ctx.priority >= 85) {
    if (/flüster|geheim|psst|leise/iu.test(text)) {
      return withVoiceSpeed({ speed: 0.95, volume: 0.85 }, voiceId);
    }
    return withVoiceSpeed({ ...STRESS_PACE }, voiceId);
  }

  if (ctx.id === 'humor_banter' || profile?.humorOk) {
    if (/haha|witz|lol/iu.test(text)) {
      return withVoiceSpeed({ speed: 1.08, volume: 1.1 }, voiceId);
    }
  }

  if (ctx.id === 'sunset_moment' || ctx.id === 'beach_relax') {
    return withVoiceSpeed({ speed: 0.98, volume: 0.98 }, voiceId);
  }

  if (
    profile?.spleens?.includes('whisperer') &&
    /geheim|flüster|saga|psst|leise/iu.test(text)
  ) {
    return withVoiceSpeed({ speed: 0.98, volume: 0.9 }, voiceId);
  }

  return withVoiceSpeed(
    {
      speed: vibe.speed,
      volume: 1.02,
    },
    voiceId,
  );
}

/** Pro Chunk — für speakText / Streaming-Queue (Live-Pfad). */
export function createLiveEmotionResolver(
  speakVoiceId?: VoiceId | null,
): (text: string, index: number) => CartesiaGenerationConfig {
  return (text, index) =>
    resolveCartesiaGenerationForChunk(text, index, speakVoiceId);
}

export function defaultLiveGenerationConfig(): CartesiaGenerationConfig {
  return { ...CALM_PACE };
}
