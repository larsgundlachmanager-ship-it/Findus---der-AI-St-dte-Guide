/**
 * Onboarding-Intro: Premium-Erzähler-Bogen (~45 s).
 * Große Kontraste — wie ein geiler Storyteller auf der Bühne.
 * Hook neugierig → Pain genervt/angespannt → Turn bestimmt → Rise begeistert → Close warm.
 */

import type { CartesiaGenerationConfig } from '../cartesiaTtsService';

type IntroPhase = 'hook' | 'pain' | 'turn' | 'rise' | 'joy';

const PHASE_CONFIG: Record<IntroPhase, CartesiaGenerationConfig> = {
  // Einstieg: neugierig, etwas langsamer — zieht rein
  hook: { emotion: 'curious', speed: 0.92, volume: 1.05 },
  // Problem: genervt, enger, druckvoller
  pain: { emotion: 'frustrated', speed: 0.96, volume: 1.12 },
  // Wendepunkt: klar, laut, bestimmt
  turn: { emotion: 'determined', speed: 1.02, volume: 1.28 },
  // Findus: Energie, Begeisterung
  rise: { emotion: 'excited', speed: 1.12, volume: 1.22 },
  // Close: warm, einladend
  joy: { emotion: 'happy', speed: 1.05, volume: 1.12 },
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
