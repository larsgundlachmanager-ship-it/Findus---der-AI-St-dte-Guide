/**
 * Live Cartesia-Emotion aus Situation Gate + Matrix-Vibe.
 */

import type { CartesiaGenerationConfig } from '../cartesiaTtsService';
import type { VoiceId } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  resolveSituationContext,
  vibeToneForEmotion,
} from './situationGate';

const STRESS_EMOTION: CartesiaGenerationConfig = {
  emotion: 'determined',
  speed: 1.06,
  volume: 1.05,
};

const CALM_EMOTION: CartesiaGenerationConfig = {
  emotion: 'content',
  speed: 0.98,
  volume: 1.0,
};

const WONDER_CHILD_EMOTION: CartesiaGenerationConfig = {
  emotion: 'excited',
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
  return {
    ...cfg,
    speed: Math.min(1.45, Math.max(0.7, base + voiceSpeedBias(voiceId))),
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

  // Kind / Rena: wie Hörprobe — schneller, dynamischer, staunend
  if (isWonderChild && !ctx.stress) {
    return withVoiceSpeed(
      {
        ...WONDER_CHILD_EMOTION,
        emotion: /oh|schau|riesig|cool|wow|komm/iu.test(text)
          ? 'excited'
          : 'happy',
      },
      voiceId,
    );
  }

  if (ctx.stress || ctx.priority >= 85) {
    if (/flüster|geheim|psst|leise/iu.test(text)) {
      return withVoiceSpeed(
        { emotion: 'anxious', speed: 0.95, volume: 0.85 },
        voiceId,
      );
    }
    return withVoiceSpeed({ ...STRESS_EMOTION }, voiceId);
  }

  if (ctx.id === 'humor_banter' || profile?.humorOk) {
    if (/haha|witz|lol/iu.test(text)) {
      return withVoiceSpeed(
        { emotion: 'happy', speed: 1.08, volume: 1.1 },
        voiceId,
      );
    }
  }

  if (ctx.id === 'sunset_moment' || ctx.id === 'beach_relax') {
    return withVoiceSpeed(
      { emotion: 'reflective', speed: 0.98, volume: 0.98 },
      voiceId,
    );
  }

  if (
    profile?.spleens?.includes('whisperer') &&
    /geheim|flüster|saga|psst|leise/iu.test(text)
  ) {
    // Nur bei echtem Flüster-Moment leiser — Tempo nicht in die Schnecke
    return withVoiceSpeed(
      { emotion: 'anxious', speed: 0.98, volume: 0.9 },
      voiceId,
    );
  }

  return withVoiceSpeed(
    {
      emotion: vibe.baseEmotion,
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
  return { ...CALM_EMOTION };
}
