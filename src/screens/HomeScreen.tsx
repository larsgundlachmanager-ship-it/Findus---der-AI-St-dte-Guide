import React, { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header, type PassportTab } from '../components/Header';
import { LiveStage } from '../components/liveStage';
import { GetYourGuideWidget } from '../components/GetYourGuideWidget';
import { CityMapModal } from '../components/CityMapModal';
import { MicButton } from '../components/MicButton';
import { SimulationPicker } from '../components/SimulationPicker';
import { RuntimeDevBoard } from '../components/RuntimeDevBoard';
import { QuestionModal } from '../components/QuestionModal';
import { VisitPassportModal } from '../components/VisitPassportModal';
import { PlanCalendarModal } from '../components/PlanCalendarModal';
import { SettingsScreen } from './SettingsScreen';
import { colors, spacing } from '../constants/theme';
import { useFinnusStore } from '../store/useFinnusStore';
import { usePlanCalendarUiStore } from '../module2/timeline/planCalendarUiStore';
import {
  startTourWithLocationPermission,
  useGeofencing,
} from '../hooks/useGeofencing';
import {
  useVoiceInput,
  type VoiceFallbackReason,
} from '../hooks/useVoiceInput';
import type { UserProfile } from '../types/userProfile';
import {
  saveUserProfile,
} from '../services/userProfileService';
import {
  registerCityProximityHandlers,
  type CitySwitchResult,
} from '../services/cityProximityService';
import { markFeatureTipCompleted } from '../services/ai/featureTips';
import { useUserMemoryStore } from '../store/useUserMemoryStore';
import { derivePhinnosMood } from '../utils/phinnosMood';

const TYPING_SUBTITLE = 'Schreiben ist möglich — freie Fragen sind aktuell aus.';

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
  const [showPlanCalendar, setShowPlanCalendar] = useState(false);
  const [passportTab, setPassportTab] = useState<PassportTab>('discover');
  const planOpenRequestAtMs = usePlanCalendarUiStore((s) => s.openRequestAtMs);
  const planCloseRequestAtMs = usePlanCalendarUiStore((s) => s.closeRequestAtMs);

  const isPlayingAudio = useFinnusStore((s) => s.isPlayingAudio);
  const isAudiblySpeaking = useFinnusStore((s) => s.isAudiblySpeaking);
  const subtitleText = useFinnusStore((s) => s.subtitleText);
  const navRouteLoading = useFinnusStore((s) => s.navRouteLoading);
  const activeConciergeCard = useFinnusStore((s) => s.activeConciergeCard);
  const gygWidget = useFinnusStore((s) => s.gygWidget);
  const cityMap = useFinnusStore((s) => s.cityMap);
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const pois = useFinnusStore((s) => s.pois);
  const ttsStatusMessage = useFinnusStore((s) => s.ttsStatusMessage);
  const settingsOpenRequestAtMs = useFinnusStore(
    (s) => s.settingsOpenRequestAtMs,
  );
  const settingsOpenFocus = useFinnusStore((s) => s.settingsOpenFocus);

  useGeofencing();
  const needsTourStart = useFinnusStore((s) => s.needsTourStart);
  const [tourStarting, setTourStarting] = useState(false);

  const onStartTour = useCallback(async () => {
    if (tourStarting) return;
    setTourStarting(true);
    try {
      await startTourWithLocationPermission();
    } finally {
      setTourStarting(false);
    }
  }, [tourStarting]);


  useEffect(() => {
    if (settingsOpenRequestAtMs == null) return;
    void markFeatureTipCompleted('tune_profile');
    setShowSettings(true);
  }, [settingsOpenRequestAtMs]);

  useEffect(() => {
    if (planOpenRequestAtMs == null) return;
    usePlanCalendarUiStore.getState().setCalendarVisible(true);
    setShowPlanCalendar(true);
    usePlanCalendarUiStore.getState().clearOpenRequest();
  }, [planOpenRequestAtMs]);

  useEffect(() => {
    if (planCloseRequestAtMs == null) return;
    usePlanCalendarUiStore.getState().setCalendarVisible(false);
    setShowPlanCalendar(false);
    usePlanCalendarUiStore.getState().clearCloseRequest();
    void import('../module2/planning/runPlanningModule').then((m) =>
      m.onPlanningModuleClosed(),
    );
  }, [planCloseRequestAtMs]);

  /**
   * Fallback System-Zurück für Karten/Widget/Concierge/Tippen.
   * Einmalig registriert — Settings/Stempel/Timeline hängen sich später ein
   * und gewinnen (eine Ebene zurück).
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const s = useFinnusStore.getState();
      if (s.cityMap) {
        s.setCityMap(null);
        return true;
      }
      if (s.gygWidget) {
        s.setGygWidget(null);
        return true;
      }
      // Concierge-/Modul-1-Karte bleibt nach Maps/Browser-Zurück —
      // nur per ✕ / dismissConciergeCard schließen.
      return false;
    });
    return () => sub.remove();
  }, []);

  // Dauer-Standby-Reconciler: unabhängig von Flags — wenn kein Audio, idle.
  // Idle: 2s · während Speech: 700ms. Modul einmal cachen (kein Meta-Import/Tick).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let audioMod: typeof import('../services/AudioVoiceService') | null = null;

    const loadMod = async () => {
      if (!audioMod) audioMod = await import('../services/AudioVoiceService');
      return audioMod;
    };

    const tick = () => {
      void loadMod().then(async (m) => {
        if (cancelled) return;
        await m.reconcileSpeakingStandby();
      });
    };

    const arm = (speaking: boolean) => {
      if (timer) clearInterval(timer);
      timer = setInterval(tick, speaking ? 700 : 2_000);
    };

    tick();
    arm(
      useFinnusStore.getState().isPlayingAudio ||
        useFinnusStore.getState().isAudiblySpeaking,
    );
    const unsub = useFinnusStore.subscribe((s, prev) => {
      const now =
        s.isPlayingAudio || s.isAudiblySpeaking;
      const was =
        prev.isPlayingAudio || prev.isAudiblySpeaking;
      if (now !== was) arm(now);
    });

    return () => {
      cancelled = true;
      unsub();
      if (timer) clearInterval(timer);
    };
  }, []);

  // Speech-Watchdog (Sessions killen) — nur aktiv während Audio/Speaking
  useEffect(() => {
    if (!isPlayingAudio && !isAudiblySpeaking) return;
    let cancelled = false;
    let deadSessionSince: number | null = null;
    let audioMod: typeof import('../services/AudioVoiceService') | null = null;
    let speechQueueBusy: (() => boolean) | null = null;

    const load = async () => {
      if (!audioMod) audioMod = await import('../services/AudioVoiceService');
      if (!speechQueueBusy) {
        const q = await import('../services/ai/speechJobQueue');
        speechQueueBusy = q.isSpeechJobQueueBusy;
      }
      return audioMod;
    };

    const timer = setInterval(() => {
      const s = useFinnusStore.getState();
      if (s.isListening || s.isGenerating) {
        deadSessionSince = null;
        return;
      }
      void load().then(async (m) => {
        if (cancelled) return;
        const n = m.getActiveTtsSessionCount();
        const hwAudible = await m.probeHardwareAudible();
        if (cancelled) return;
        if (n === 0 && !hwAudible) {
          if (deadSessionSince == null) deadSessionSince = Date.now();
          if (Date.now() - deadSessionSince >= 400) {
            m.forceClearSpeakingUi();
            deadSessionSince = null;
          }
          return;
        }
        if (n > 0 && !hwAudible) {
          const limitMs = speechQueueBusy?.() ? 10_000 : 6_000;
          if (deadSessionSince == null) deadSessionSince = Date.now();
          if (Date.now() - deadSessionSince >= limitMs) {
            m.forceClearSpeakingUi();
            deadSessionSince = null;
          }
          return;
        }
        deadSessionSince = null;
      });
    }, 700);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isPlayingAudio, isAudiblySpeaking]);

  useEffect(() => {
    registerCityProximityHandlers({
      onCitySwitched: async (result: CitySwitchResult) => {
        // Masterbook Location Isolation — never navigate to hotel coords from another city
        useUserMemoryStore.getState().clearHotelsOutsideCity(result.cityId);
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
    onSwipeLock,
    onSwipeLiveChat,
    partialText,
    isListening,
    isMicLocked,
    isFinalizing,
    isGenerating,
    submitUserQuestion,
  } = useVoiceInput({
    // Timeline: Kurz-Tipp bleibt stumm (kein Tippfeld); Hold startet Voice —
    // Early-Release nach Aufnahme-Start wird in useVoiceInput finalisiert.
    onShortPress: showPlanCalendar ? undefined : openTextInput,
    onNeedTextFallback: openTextFallback,
  });

  // Nach Erklärung: Hilfe-Chip (z. B. Restaurant-Tipp) → echte Recherche
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void import('../services/onboarding/pendingPostTourQuestion').then(
        async ({ takePostTourQuestion }) => {
          if (cancelled) return;
          const prompt = takePostTourQuestion();
          if (!prompt) return;
          await submitUserQuestion(prompt);
        },
      );
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [submitUserQuestion]);

  const phinnosMood = derivePhinnosMood({
    isListening,
    isFinalizing,
    isGenerating,
    isPlayingAudio,
    isAudiblySpeaking,
    navRouteLoading,
  });

  const openPassport = useCallback((opts?: { tab?: PassportTab }) => {
    setPassportTab(opts?.tab ?? 'discover');
    setShowPassport(true);
  }, []);

  const onHudTellMore = useCallback(
    (prompt: string) => {
      if (prompt === '__WEATHER_DAY_CHECK__') {
        void import('../services/ui/weatherDayPlanCheck').then((m) =>
          m.runWeatherLiveDayCheck(),
        );
        return;
      }
      void submitUserQuestion(prompt);
    },
    [submitUserQuestion],
  );

  const openSettings = useCallback(() => {
    void markFeatureTipCompleted('tune_profile');
    void import('../services/onboarding/uiCoachMarks').then((m) =>
      m.onUserOpenedSettings(),
    );
    setShowSettings(true);
  }, []);
  const openPlanCalendar = useCallback(() => {
    void import('../services/onboarding/uiCoachMarks').then((m) =>
      m.onUserOpenedPlanCalendar(),
    );
    usePlanCalendarUiStore.getState().setCalendarVisible(true);
    setShowPlanCalendar(true);
  }, []);
  const closePlanCalendar = useCallback(() => {
    usePlanCalendarUiStore.getState().setCalendarVisible(false);
    setShowPlanCalendar(false);
    void import('../module2/planning/runPlanningModule').then((m) =>
      m.onPlanningModuleClosed(),
    );
  }, []);
  const closeSettings = useCallback(() => {
    setShowSettings(false);
    useFinnusStore.setState({ settingsOpenFocus: null });
  }, []);
  const closePassport = useCallback(() => setShowPassport(false), []);
  const closeQuestion = useCallback(() => setShowQuestionModal(false), []);
  const closeGyg = useCallback(
    () => useFinnusStore.getState().setGygWidget(null),
    [],
  );
  const closeCityMap = useCallback(
    () => useFinnusStore.getState().setCityMap(null),
    [],
  );

  const onConciergeFollowUp = useCallback(
    (prompt: string) => {
      void submitUserQuestion(prompt);
    },
    [submitUserQuestion],
  );

  const onPassportQuickNav = useCallback(
    (prompt: string) => {
      setShowPassport(false);
      void submitUserQuestion(prompt);
    },
    [submitUserQuestion],
  );

  const onSettingsSaved = useCallback(
    async (next: UserProfile) => {
      await saveUserProfile(next);
      onProfileChange(next);
    },
    [onProfileChange],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Header
        onOpenSettings={openSettings}
        onOpenPlanCalendar={openPlanCalendar}
        onOpenPassport={openPassport}
        onTellMore={onHudTellMore}
      />

      <RuntimeDevBoard />

      {ttsStatusMessage ? (
        <View style={styles.statusBanner}>
          <Text style={styles.statusText}>{ttsStatusMessage}</Text>
        </View>
      ) : null}

      {/*
        LiveStage: Presence oben | Bottom-Dock fix (Bullets → Actions → Subtitles)
        MicButton fest darunter — kein Hoch/Runter-Springen bei Thinking.
      */}

      {needsTourStart && !isSimulationMode ? (
        <Pressable
          onPress={() => void onStartTour()}
          disabled={tourStarting}
          style={styles.tourStartCard}
          accessibilityRole="button"
          accessibilityLabel="Tour starten"
        >
          <Text style={styles.tourStartTitle}>
            {tourStarting ? 'Berechtigung…' : 'Tour starten'}
          </Text>
          <Text style={styles.tourStartBody}>
            Standort freigeben, damit Findus an den richtigen Orten automatisch
            Audio-Hinweise abspielt — auch bei gesperrtem Display.
          </Text>
        </Pressable>
      ) : null}

      <LiveStage
        mood={phinnosMood}
        card={activeConciergeCard}
        subtitleText={subtitleText}
        isPlayingAudio={isAudiblySpeaking}
        onFollowUp={onConciergeFollowUp}
      />

      <GetYourGuideWidget
        visible={gygWidget != null}
        options={gygWidget ?? undefined}
        onClose={closeGyg}
      />

      <CityMapModal
        visible={cityMap != null}
        url={cityMap?.url}
        title={cityMap?.title}
        onClose={closeCityMap}
      />

      <View style={styles.micRow}>
        {isSimulationMode ? (
          <SimulationPicker pois={pois} visible layout="micFab" />
        ) : (
          <View style={styles.micSideSpacer} />
        )}
        <MicButton
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          onSwipeLock={onSwipeLock}
          onSwipeLiveChat={onSwipeLiveChat}
          isListening={isListening}
          isMicLocked={isMicLocked}
          isFinalizing={isFinalizing}
          isGenerating={isGenerating}
          isSpeaking={isAudiblySpeaking}
          partialText={partialText}
        />
        <View style={styles.micSideSpacer} />
      </View>

      <QuestionModal
        visible={showQuestionModal}
        onClose={closeQuestion}
        onSubmit={submitUserQuestion}
        subtitle={modalSubtitle}
      />

      {showSettings ? (
        <SettingsScreen
          visible
          profile={profile}
          onClose={closeSettings}
          onSaved={onSettingsSaved}
          onReset={onResetSetup}
          initialFocus={settingsOpenFocus}
        />
      ) : null}

      <VisitPassportModal
        visible={showPassport}
        initialTab={passportTab}
        onClose={closePassport}
        onQuickNavAdd={onPassportQuickNav}
      />

      <PlanCalendarModal
        visible={showPlanCalendar}
        onClose={closePlanCalendar}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onSwipeLock={onSwipeLock}
        onSwipeLiveChat={onSwipeLiveChat}
        isListening={isListening}
        isMicLocked={isMicLocked}
        isFinalizing={isFinalizing}
        isGenerating={isGenerating}
        isAudiblySpeaking={isAudiblySpeaking}
        onShortAnswerPrompt={(prompt) => {
          void import('../module2/planning/runPlanningModule').then((m) =>
            m.runPlanningModule({ userText: prompt }),
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
    position: 'relative',
    overflow: 'visible',
  },
  tourStartCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  tourStartTitle: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 4,
  },
  tourStartBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
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
  micRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    /** Feste Mindesthöhe — Hint-Text darf LiveStage nicht zusammenschieben. */
    minHeight: 84 + spacing.sm + spacing.lg + 20,
  },
  /** Gleichbreite wie Ort-FAB → Mic bleibt mittig. */
  micSideSpacer: {
    width: 64,
    // Vertikal an Mic-Kreis (84) ausrichten: sm + (84-56)/2
    paddingTop: spacing.sm + 14,
  },
});
