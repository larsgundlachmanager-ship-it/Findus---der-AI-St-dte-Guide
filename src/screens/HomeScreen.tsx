import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../components/Header';
import { AudioWave } from '../components/AudioWave';
import { SubtitleOverlay } from '../components/SubtitleOverlay';
import { MicButton } from '../components/MicButton';
import { SimulationPicker } from '../components/SimulationPicker';
import { QuestionModal } from '../components/QuestionModal';
import { SettingsScreen } from './SettingsScreen';
import { colors, spacing } from '../constants/theme';
import { useFinnusStore } from '../store/useFinnusStore';
import { useGeofencing } from '../hooks/useGeofencing';
import {
  useVoiceInput,
  type VoiceFallbackReason,
} from '../hooks/useVoiceInput';
import type { UserProfile } from '../types/userProfile';
import { saveUserProfile } from '../services/userProfileService';

const TYPING_SUBTITLE = 'Schreib deine Frage an Findus.';

const FALLBACK_SUBTITLES: Record<VoiceFallbackReason, string> = {
  unavailable:
    'Spracherkennung ist auf diesem Gerät nicht verfügbar – tippe deine Frage. (Google App / Speech Services prüfen, App neu bauen.)',
  permission:
    'Mikrofon-Zugriff wurde verweigert – tippe deine Frage, oder erlaube das Mikrofon in den Einstellungen.',
  error: 'Spracherkennung hat gerade nicht geklappt – tippe deine Frage.',
};

type Props = {
  profile: UserProfile;
  onProfileChange: (profile: UserProfile) => void;
  onResetSetup: () => void;
};

export function HomeScreen({
  profile,
  onProfileChange,
  onResetSetup,
}: Props) {
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [modalSubtitle, setModalSubtitle] = useState(TYPING_SUBTITLE);
  const [showSettings, setShowSettings] = useState(false);

  const isPlayingAudio = useFinnusStore((s) => s.isPlayingAudio);
  const subtitleText = useFinnusStore((s) => s.subtitleText);
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const pois = useFinnusStore((s) => s.pois);
  const kokoroStatusMessage = useFinnusStore((s) => s.kokoroStatusMessage);

  useGeofencing();

  const openTextInput = useCallback(() => {
    setModalSubtitle(TYPING_SUBTITLE);
    setShowQuestionModal(true);
  }, []);

  const openTextFallback = useCallback((reason: VoiceFallbackReason) => {
    setModalSubtitle(FALLBACK_SUBTITLES[reason]);
    setShowQuestionModal(true);
  }, []);

  const {
    onPressIn,
    onPressOut,
    partialText,
    isListening,
    isGenerating,
    submitUserQuestion,
  } = useVoiceInput({
    onShortPress: openTextInput,
    onNeedTextFallback: openTextFallback,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Header onOpenSettings={() => setShowSettings(true)} />

      {kokoroStatusMessage ? (
        <View style={styles.statusBanner}>
          <Text style={styles.statusText}>{kokoroStatusMessage}</Text>
        </View>
      ) : null}

      <View style={styles.main}>
        <AudioWave
          mood={
            isPlayingAudio
              ? 'speaking'
              : isListening
                ? 'listening'
                : isGenerating
                  ? 'thinking'
                  : 'idle'
          }
        />
        <SubtitleOverlay text={subtitleText} />
      </View>

      <SimulationPicker pois={pois} visible={isSimulationMode} />

      <MicButton
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        isListening={isListening}
        isGenerating={isGenerating}
        partialText={partialText}
      />

      <QuestionModal
        visible={showQuestionModal}
        onClose={() => setShowQuestionModal(false)}
        onSubmit={submitUserQuestion}
        subtitle={modalSubtitle}
      />

      <SettingsScreen
        visible={showSettings}
        profile={profile}
        onClose={() => setShowSettings(false)}
        onSaved={async (next) => {
          await saveUserProfile(next);
          onProfileChange(next);
        }}
        onReset={onResetSetup}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  main: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  statusBanner: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});
