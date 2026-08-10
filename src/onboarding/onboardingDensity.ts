/**
 * Onboarding-UI-Dichte — SSOT-aligned mit uiScale (groß ab 55 / Override).
 */

import { useUiScaleStore } from '../services/ui/uiScale';

export type OnboardingDensity = 'compact' | 'large';

export function onboardingDensityForAge(
  age: number | null | undefined,
): OnboardingDensity {
  // Live-Override aus Profil (Schrift) schlägt reines Alter
  const textLevel = useUiScaleStore.getState().textLevel;
  if (textLevel === 'large') return 'large';
  if (typeof age === 'number' && Number.isFinite(age) && age >= 55) {
    return 'large';
  }
  return 'compact';
}

export const ONBOARDING_METRICS = {
  compact: {
    title: 22,
    subtitle: 13,
    subtitleLine: 18,
    primaryPadV: 12,
    primaryFont: 15,
    chipPadV: 6,
    chipPadH: 10,
    chipFont: 12,
    chipEmoji: 14,
    ageDisplay: 22,
    ageBadge: 40,
    ageBadgeIcon: 20,
  },
  large: {
    title: 28,
    subtitle: 15,
    subtitleLine: 22,
    primaryPadV: 16,
    primaryFont: 17,
    chipPadV: 8,
    chipPadH: 12,
    chipFont: 14,
    chipEmoji: 16,
    ageDisplay: 28,
    ageBadge: 56,
    ageBadgeIcon: 28,
  },
} as const;
