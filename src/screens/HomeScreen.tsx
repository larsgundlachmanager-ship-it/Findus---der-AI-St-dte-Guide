import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../components/Header';
import { AudioWave } from '../components/AudioWave';
import { SubtitleOverlay } from '../components/SubtitleOverlay';
import { ConciergeCard } from '../components/ConciergeCard';
import { GetYourGuideWidget } from '../components/GetYourGuideWidget';
import { CityMapModal } from '../components/CityMapModal';
import { MicButton } from '../components/MicButton';
import { SimulationPicker } from '../components/SimulationPicker';
import { QuestionModal } from '../components/QuestionModal';
import { VisitPassportModal } from '../components/VisitPassportModal';
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
import {
  registerCityProximityHandlers,
  type CitySwitchResult,
} from '../services/cityProximityService';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TYPING_SUBTITLE = 'Schreib deine Frage an Findus.';

const FALLBACK_SUBTITLES: Record<VoiceFallbackReason, string> = {
  unavailable:
    'Spracherkennung ist auf diesem Gerät nicht verfügbar – tippe deine Frage. (Google App / Speech Services prüfen, App neu bauen.)',
  permission:
    'Mikrofon ist aus oder nicht erlaubt – tippe deine Frage, oder aktiviere Spracheingabe unter Einstellungen → Einrichtung → Datenschutz & Mikrofon.',
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
  const [showPassport, setShowPassport] = useState(false);

  const isPlayingAudio = useFinnusStore((s) => s.isPlayingAudio);
  const subtitleText = useFinnusStore((s) => s.subtitleText);
  const activeConciergeCard = useFinnusStore((s) => s.activeConciergeCard);
  const gygWidget = useFinnusStore((s) => s.gygWidget);
  const cityMap = useFinnusStore((s) => s.cityMap);
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const pois = useFinnusStore((s) => s.pois);
  const kokoroStatusMessage = useFinnusStore((s) => s.kokoroStatusMessage);

  const hasCard = activeConciergeCard != null;
  const prevHasCard = useRef(hasCard);

  useGeofencing();

  useEffect(() => {
    registerCityProximityHandlers({
      onCitySwitched: async (result: CitySwitchResult) => {
        const next = {
          ...profile,
          cityId: result.cityId,
          cityName: result.cityName,
        };
        await saveUserProfile(next);
        onProfileChange(next);
      },
    });
    return () => registerCityProximityHandlers(null);
  }, [onProfileChange, profile]);

  useLayoutEffect(() => {
    if (prevHasCard.current === hasCard) return;
    prevHasCard.current = hasCard;
    LayoutAnimation.configureNext({
      duration: 420,
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
      },
    });
  }, [hasCard]);

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
    isFinalizing,
    isGenerating,
    submitUserQuestion,
  } = useVoiceInput({
    onShortPress: openTextInput,
    onNeedTextFallback: openTextFallback,
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Header
        onOpenSettings={() => setShowSettings(true)}
        onOpenPassport={() => setShowPassport(true)}
      />

      {kokoroStatusMessage ? (
        <View style={styles.statusBanner}>
          <Text style={styles.statusText}>{kokoroStatusMessage}</Text>
        </View>
      ) : null}

      <View style={styles.main}>
        <View style={[styles.stage, hasCard && styles.stageWithCard]}>
          <View
            style={[styles.findusSlot, hasCard && styles.findusSlotLifted]}
          >
            <AudioWave
              compact={hasCard}
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
          </View>

          <View style={[styles.cardSlot, !hasCard && styles.cardSlotHidden]}>
            {hasCard ? (
              <ConciergeCard
                card={activeConciergeCard}
                onFollowUp={(prompt) => {
                  void submitUserQuestion(prompt);
                }}
              />
            ) : null}
          </View>
        </View>

        <SubtitleOverlay text={subtitleText} liftForCard={hasCard} />
      </View>

      <GetYourGuideWidget
        visible={gygWidget != null}
        options={gygWidget ?? undefined}
        onClose={() => useFinnusStore.getState().setGygWidget(null)}
      />

      <CityMapModal
        visible={cityMap != null}
        url={cityMap?.url}
        title={cityMap?.title}
        onClose={() => useFinnusStore.getState().setCityMap(null)}
      />

      {__DEV__ ? (
        <SimulationPicker pois={pois} visible={isSimulationMode} />
      ) : null}

      <MicButton
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        isListening={isListening}
        isFinalizing={isFinalizing}
        isGenerating={isGenerating}
        partialText={partialText}
      />

      <QuestionModal
        visible={showQuestionModal}
        onClose={() => setShowQuestionModal(false)}
        onSubmit={submitUserQuestion}
        subtitle={modalSubtitle}
      />

      <VisitPassportModal
        visible={showPassport}
        onClose={() => setShowPassport(false)}
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
    position: 'relative',
  },
  main: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.md,
    position: 'relative',
  },
  stage: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  stageWithCard: {
    justifyContent: 'flex-start',
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  findusSlot: {
    width: '100%',
    flex: 1,
    minHeight: 0,
  },
  findusSlotLifted: {
    flex: 0,
    flexGrow: 0,
    flexShrink: 0,
  },
  cardSlot: {
    width: '100%',
    flexShrink: 1,
    maxHeight: '48%',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    opacity: 1,
  },
  cardSlotHidden: {
    maxHeight: 0,
    marginTop: 0,
    marginBottom: 0,
    opacity: 0,
    overflow: 'hidden',
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
