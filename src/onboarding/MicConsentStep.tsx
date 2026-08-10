import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Audio } from 'expo-av';
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
 * Mikrofon & Datenschutz nach „Über dich“ — mit sofortiger Freigabe.
 */
export function MicConsentStep({ draft, onChange, onNext }: Props) {
  const [audioConsentChecked, setAudioConsentChecked] = useState(
    !!draft.hasAcceptedAudioConsent,
  );
  const [privacyConsentChecked, setPrivacyConsentChecked] = useState(
    !!draft.hasAcceptedPrivacyPolicy,
  );
  const [showLegal, setShowLegal] = useState(false);

  const valid = micConsentIsValid(
    draft.micListenMode ?? null,
    audioConsentChecked,
    privacyConsentChecked,
  );

  const requestMicIfNeeded = async (mode: MicListenMode) => {
    if (mode !== 'hear') return;
    try {
      await Audio.requestPermissionsAsync();
    } catch {
      /* soft — STT fragt später erneut */
    }
  };

  return (
    <OnboardingShell style={styles.shell}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <StepTitle>Mikrofon & Datenschutz</StepTitle>
        <StepSubtitle>
          Direkt nach dem Konto: wähle sichtbar, wie du mitmachen willst.
          Bei Spracheingabe fragen wir die Freigabe sofort an.
        </StepSubtitle>

        <MicConsentBlock
          compact
          mode={draft.micListenMode ?? null}
          audioConsentChecked={audioConsentChecked}
          privacyConsentChecked={privacyConsentChecked}
          onChangeMode={(micListenMode: MicListenMode) => {
            onChange({ micListenMode });
            void requestMicIfNeeded(micListenMode);
          }}
          onChangeAudioConsent={setAudioConsentChecked}
          onChangePrivacyConsent={setPrivacyConsentChecked}
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
              if (voiceOn) void requestMicIfNeeded('hear');
              onNext({
                hasAcceptedAudioConsent: voiceOn && audioConsentChecked,
                audioConsentAt: voiceOn && audioConsentChecked ? now : null,
                hasAcceptedPrivacyPolicy: privacyConsentChecked,
                privacyAcceptedAt: privacyConsentChecked
                  ? draft.privacyAcceptedAt ?? now
                  : null,
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
