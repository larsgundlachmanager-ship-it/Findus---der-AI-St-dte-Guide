import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  OnboardingShell,
  PrimaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import {
  MicConsentBlock,
  micConsentIsValid,
} from '../components/legal/MicConsentBlock';
import { LegalView } from '../components/legal/LegalView';
import { spacing } from '../constants/theme';
import type { MicListenMode, UserProfile } from '../types/userProfile';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  onNext: (override?: Partial<UserProfile>) => void;
};

/**
 * Standard-Onboarding: Mikrofon-Optionen + DSGVO-Opt-in (immer am Ende).
 */
export function MicConsentStep({ draft, onChange, onNext }: Props) {
  const [consentChecked, setConsentChecked] = useState(
    !!draft.hasAcceptedAudioConsent,
  );
  const [showLegal, setShowLegal] = useState(false);

  const valid = micConsentIsValid(draft.micListenMode ?? null, consentChecked);

  return (
    <OnboardingShell style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <StepTitle>Mikrofon & Datenschutz</StepTitle>
        <StepSubtitle>
          Kurz wählen, wie du mitmachen willst. Wie Fragen stellen funktioniert,
          erklärt Findus dir gleich in der Tour.
        </StepSubtitle>

        <MicConsentBlock
          compact
          mode={draft.micListenMode ?? null}
          consentChecked={consentChecked}
          onChangeMode={(micListenMode: MicListenMode) =>
            onChange({ micListenMode })
          }
          onChangeConsent={setConsentChecked}
          onOpenPrivacy={() => setShowLegal(true)}
        />

        <View style={styles.footer}>
          <PrimaryButton
            label="Weiter"
            disabled={!valid}
            onPress={() => {
              if (!valid || !draft.micListenMode) return;
              const now = new Date().toISOString();
              const voiceOn = draft.micListenMode === 'hear';
              onNext({
                hasAcceptedAudioConsent: voiceOn,
                audioConsentAt: voiceOn ? now : null,
                hasAcceptedPrivacyPolicy: true,
                privacyAcceptedAt: draft.privacyAcceptedAt ?? now,
                micListenMode: draft.micListenMode,
              });
            }}
          />
        </View>
      </ScrollView>

      <LegalView visible={showLegal} onClose={() => setShowLegal(false)} />
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  scroll: { paddingBottom: spacing.xl * 2, gap: spacing.sm },
  footer: { marginTop: spacing.lg },
});
