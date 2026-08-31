/**
 * Onboarding-Intro: Tempo/Lautstärke-Bogen — ohne Cartesia-Emotion-Tags.
 * EN-Emotion (curious/frustrated/excited) zieht de-DE-Stimmen in den US-Akzent.
 * Dynamik kommt aus dem deutschen Intro-Text + Speed/Volume.
 */

import type { CartesiaGenerationConfig } from '../cartesiaTtsService';

type IntroPhase = 'hook' | 'pain' | 'turn' | 'rise' | 'joy';

const PHASE_CONFIG: Record<IntroPhase, CartesiaGenerationConfig> = {
  hook: { speed: 0.92, volume: 1.05 },
  pain: { speed: 0.96, volume: 1.12 },
  turn: { speed: 1.02, volume: 1.28 },
  rise: { speed: 1.12, volume: 1.22 },
  joy: { speed: 1.05, volume: 1.12 },
};

/** Stateful Resolver — ein Intro-Durchlauf, Phasen nur vorwärts. */
export function createIntroEmotionResolver(): (
  text: string,
  index: number,
) => CartesiaGenerationConfig {
  let phase: IntroPhase = 'hook';

  return (text: string, index: number) => {
    const t = text.toLowerCase();

    if (/genau das werde ich ändern/.test(t)) {
      phase = 'turn';
    } else if (/ich bin findus/.test(t)) {
      phase = 'rise';
    } else if (/freu mich|kennenlernen/.test(t)) {
      phase = 'joy';
    } else if (phase === 'turn') {
      phase = 'rise';
    } else if (
      phase === 'hook' &&
      (/handy|maps|essen|gebäude|hose|scrollen|fragst|restaurant|unterkunft/.test(
        t,
      ) ||
        index > 0)
    ) {
      phase = 'pain';
    }

    return { ...PHASE_CONFIG[phase] };
  };
}
