import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  OnboardingShell,
  PrimaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import { ConciergePrefsEditor } from '../components/ConciergePrefsEditor';
import { spacing } from '../constants/theme';
import type { UserProfile } from '../types/userProfile';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  onNext: (override?: Partial<UserProfile>) => void;
};

/**
 * Standard-Onboarding: Concierge-Prefs (Gruppe, Mobilität, Budget, …).
 */
export function ConciergePrefsStep({ draft, onChange, onNext }: Props) {
  const canContinue =
    !!draft.travelParty &&
    !!draft.mobilityMode &&
    !!draft.energyLevel &&
    !!draft.budgetCategory &&
    ((draft.mustHaveStyles?.length ?? 0) > 0 || !!draft.touristMode) &&
    !!draft.answerStyle;

  return (
    <OnboardingShell style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <StepTitle>Dein Concierge-Profil</StepTitle>
        <StepSubtitle>
          Damit Empfehlungen, Routen und Restaurants wirklich zu dir passen.
        </StepSubtitle>
        <ConciergePrefsEditor draft={draft} onChange={onChange} />
        <View style={styles.footer}>
          <PrimaryButton
            label="Weiter"
            disabled={!canContinue}
            onPress={() => onNext()}
          />
        </View>
      </ScrollView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  scroll: { paddingBottom: spacing.xl * 2, gap: spacing.sm },
  footer: { marginTop: spacing.lg },
});
