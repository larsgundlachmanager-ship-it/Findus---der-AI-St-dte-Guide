import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSystemSafePad } from '../hooks/useSystemSafePad';
import { Header, type PassportTab } from '../components/Header';
import {
  LiveStage,
  HOME_DOCK_BAR_H,
  HOME_MIC_DOCK_GAP,
  HOME_MIC_HINT_RESERVE,
} from '../components/liveStage';
import { HomePresenceMap } from '../components/homeMap/HomePresenceMap';
import { HomeDockBar } from '../components/HomeDockBar';
import { GetYourGuideWidget } from '../components/GetYourGuideWidget';
import { InAppBrowserSheet } from '../components/InAppBrowserSheet';
import { MicButton } from '../components/MicButton';
import { SimulationPicker } from '../components/SimulationPicker';
import { RuntimeDevBoard } from '../components/RuntimeDevBoard';
import { HomeOverlayHost } from './HomeOverlayHost';
import {
  HOME_QUESTION_DEFAULT_SUBTITLE,
  useHomeOverlayStore,
} from '../store/useHomeOverlayStore';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import {
  selectNavRouteLoading,
  useFinnusStore,
} from '../store/useFinnusStore';
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
import { inspectConciergeCard } from '../components/liveStage/inspectConciergeCard';
import { useLivePitchStore } from '../module2/pitch/publishPitchUi';

/** Nur exakte Chrome-Höhe — kein Extra-Abstand; Soft-Fade sitzt in der Karte. */

const FALLBACK_SUBTITLES: Record<VoiceFallbackReason, string> = {
  unavailable:
    'Spracherkennung ist auf diesem Gerät nicht verfügbar – tippe deine Frage. (Google App / Speech Services prüfen, App neu bauen.)',
  permission:
    'Mikrofon ist aus oder nicht erlaubt – tippe deine Frage, oder aktiviere „Sprache an“ unter Einstellungen → Allgemeine Einstellungen → Audio & Sparmodus.',
  error: 'Spracherkennung hat gerade nicht geklappt – tippe deine Frage.',
};

type Props = {
  profile: UserProfile;
  onProfileChange: (profile: UserProfile) => void;
  onResetSetup: () => void;
};

type HomeLiveLayerProps = {
  hudHeight: number;
  onHudHeight: (h: number) => void;
  mapBottomChrome: number;
  safePadTop: number;
  isListening: boolean;
  isMicLocked: boolean;
  isFinalizing: boolean;
  isGenerating: boolean;
  onAbortBusy: () => void;
  onFollowUp: (prompt: string) => void;
  onOpenPlanCalendar: () => void;
  onOpenPassport: (opts?: { tab?: PassportTab }) => void;
  onTellMore: (prompt: string) => void;
  onStartTour: () => void | Promise<void>;
  tourStarting: boolean;
  onCloseGyg: () => void;
  onCloseInAppBrowser: () => void;
};

type HomeChromeLayerProps = {
  safePadBottom: number;
  isListening: boolean;
  isMicLocked: boolean;
  isFinalizing: boolean;
  isGenerating: boolean;
  partialText: string;
  onPressIn: () => void;
  onPressOut: () => void;
  onSwipeLock: () => void;
  onSwipeLiveChat: () => void;
  onAbortBusy: () => void;
  onOpenPlanCalendar: () => void;
  onPlaces: () => void;
  onSettings: () => void;
};

/** Karte + Live-Stage. Mic/Dock liegen in HomeChromeLayer (eigene Store-Abos). */
const HomeLiveLayer = React.memo(function HomeLiveLayer({
  hudHeight,
  onHudHeight,
  mapBottomChrome,
  safePadTop,
  isListening,
  isMicLocked,
  isFinalizing,
  isGenerating,
  onAbortBusy,
  onFollowUp,
  onOpenPlanCalendar,
  onOpenPassport,
  onTellMore,
  onStartTour,
  tourStarting,
  onCloseGyg,
  onCloseInAppBrowser,
}: HomeLiveLayerProps) {
  const isPlayingAudio = useFinnusStore((s) => s.isPlayingAudio);
  const isAudiblySpeaking = useFinnusStore((s) => s.isAudiblySpeaking);
  const subtitleText = useFinnusStore((s) => s.subtitleText);
  const navRouteLoading = useFinnusStore(selectNavRouteLoading);
  const navActive = useFinnusStore((s) => s.navActive);
  const activeConciergeCard = useFinnusStore((s) => s.activeConciergeCard);
  const gygWidget = useFinnusStore((s) => s.gygWidget);
  const inAppBrowser = useFinnusStore((s) => s.inAppBrowser);
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const ttsStatusMessage = useFinnusStore((s) => s.ttsStatusMessage);
  const needsTourStart = useFinnusStore((s) => s.needsTourStart);
  const hasPitch = useLivePitchStore((s) =>
    Boolean(s.requestId && (s.options.length > 0 || s.loading)),
  );
  const { hasBullets, hasActions } = inspectConciergeCard(activeConciergeCard);
  const mapChromeDim = hasPitch || hasBullets || hasActions;

  const phinnosMood = derivePhinnosMood({
    isListening,
    isFinalizing,
    isGenerating,
    isPlayingAudio,
    isAudiblySpeaking,
    navRouteLoading,
    navActive,
  });

  return (
    <>
      <HomePresenceMap
        hudHeight={hudHeight}
        bottomChrome={mapBottomChrome}
        chromeDim={mapChromeDim}
      />

      <LiveStage
        mood={phinnosMood}
        card={activeConciergeCard}
        subtitleText={subtitleText}
        isPlayingAudio={isAudiblySpeaking}
        onFollowUp={onFollowUp}
        onAbortBusy={onAbortBusy}
      />

      {ttsStatusMessage ? (
        <View style={[styles.statusBanner, { top: hudHeight + 4 }]}>
          <Text style={styles.statusText}>{ttsStatusMessage}</Text>
        </View>
      ) : null}

      {needsTourStart && !isSimulationMode ? (
        <Pressable
          onPress={() => void onStartTour()}
          disabled={tourStarting}
          style={[styles.tourStartCard, { top: hudHeight + 8 }]}
          accessibilityRole="button"
          accessibilityLabel="Tour starten"
        >
          <Text style={styles.tourStartTitle}>
            {tourStarting ? 'Berechtigung…' : 'Tour starten'}
          </Text>
          <Text style={styles.tourStartBody}>
            Standort freigeben, damit Yorro an den richtigen Orten automatisch
            Audio-Hinweise abspielt — auch bei gesperrtem Display.
          </Text>
        </Pressable>
      ) : null}

      <RuntimeDevBoard />

      <GetYourGuideWidget
        visible={gygWidget != null}
        options={gygWidget ?? undefined}
        onClose={onCloseGyg}
      />

      <InAppBrowserSheet
        visible={inAppBrowser != null}
        url={inAppBrowser?.url ?? ''}
        title={inAppBrowser?.title}
        onClose={onCloseInAppBrowser}
      />

      <View
        style={[styles.hudOverlay, { paddingTop: safePadTop }]}
        pointerEvents="box-none"
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 40 && Math.abs(h - hudHeight) >= 2) onHudHeight(h);
        }}
      >
        <Header
          overlay
          hideTools
          fullBleedLive
          onOpenPlanCalendar={onOpenPlanCalendar}
          onOpenPassport={onOpenPassport}
          onTellMore={onTellMore}
        />
      </View>
    </>
  );
});

/** Mic + Dock — nur Voice-/Nav-Mood, kein POI/Card-Churn der Karte. */
const HomeChromeLayer = React.memo(function HomeChromeLayer({
  safePadBottom,
  isListening,
  isMicLocked,
  isFinalizing,
  isGenerating,
  partialText,
  onPressIn,
  onPressOut,
  onSwipeLock,
  onSwipeLiveChat,
  onAbortBusy,
  onOpenPlanCalendar,
  onPlaces,
  onSettings,
}: HomeChromeLayerProps) {
  const isPlayingAudio = useFinnusStore((s) => s.isPlayingAudio);
  const isAudiblySpeaking = useFinnusStore((s) => s.isAudiblySpeaking);
  const navRouteLoading = useFinnusStore(selectNavRouteLoading);
  const navActive = useFinnusStore((s) => s.navActive);
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const pois = useFinnusStore((s) => (s.isSimulationMode ? s.pois : EMPTY_POIS));

  const phinnosMood = derivePhinnosMood({
    isListening,
    isFinalizing,
    isGenerating,
    isPlayingAudio,
    isAudiblySpeaking,
    navRouteLoading,
    navActive,
  });

  return (
    <>
      <View
        style={[
          styles.micFloat,
          {
            bottom:
              HOME_DOCK_BAR_H +
              safePadBottom +
              HOME_MIC_DOCK_GAP +
              HOME_MIC_HINT_RESERVE,
          },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.micCenter} pointerEvents="auto">
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
            mood={phinnosMood}
            onAbortBusy={onAbortBusy}
            partialText={partialText}
          />
        </View>
        {isSimulationMode ? (
          <View style={styles.micSideLeft} pointerEvents="box-none">
            <SimulationPicker pois={pois} visible layout="micFab" />
          </View>
        ) : null}
      </View>

      <View style={styles.dockWrap} pointerEvents="box-none">
        <HomeDockBar
          onTimeline={onOpenPlanCalendar}
          onPlaces={onPlaces}
          onSettings={onSettings}
        />
      </View>
    </>
  );
});

const EMPTY_POIS: never[] = [];

export function HomeScreen({
  profile,
  onProfileChange,
  onResetSetup,
}: Props) {
  /** Gemessene Header-Höhe — Fade deckt die Live-Anzeige ab, Karte liegt nicht darunter. */
  const [hudHeight, setHudHeight] = useState(96);
  const safePad = useSystemSafePad();
  const isAudiblySpeaking = useFinnusStore((s) => s.isAudiblySpeaking);

  useGeofencing();
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
    void import('../services/timeline/visitLog')
      .then((m) => m.hydrateVisitLog())
      .catch(() => undefined);
  }, []);

  // Offene Wünsche nach 30 Min Kalender zu → aufräumen
  useEffect(() => {
    const id = setInterval(() => {
      void import('../module2/planning/purgeStaleOpenPlans').then((m) => {
        m.maybePurgeStalePlansWhileHidden();
      });
    }, 60_000);
    return () => clearInterval(id);
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

  // Speech-Watchdog — ohne Render-Abo auf Audio-Flags (Settings/Timeline bleiben flüssig)
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
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

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const tick = () => {
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
    };

    const sync = () => {
      const s = useFinnusStore.getState();
      if (s.isPlayingAudio || s.isAudiblySpeaking) {
        if (!timer) timer = setInterval(tick, 700);
        return;
      }
      stop();
    };

    sync();
    const unsub = useFinnusStore.subscribe(sync);
    return () => {
      cancelled = true;
      unsub();
      stop();
    };
  }, []);

  useEffect(() => {
    registerCityProximityHandlers({
      onCitySwitched: async (result: CitySwitchResult) => {
        // Masterbook Location Isolation — never navigate to hotel coords from another city
        useUserMemoryStore.getState().clearHotelsOutsideCity(result.cityId);
        try {
          const { clearShortTermOnCitySwitch } = require('../module2/context/shortTermContext') as {
            clearShortTermOnCitySwitch: () => void;
          };
          clearShortTermOnCitySwitch();
        } catch {
          /* soft */
        }
        try {
          const { parkForegroundOnCitySwitch } = require('../services/memory/conversationThreads') as {
            parkForegroundOnCitySwitch: (cityHint: string) => void;
          };
          parkForegroundOnCitySwitch(result.cityName);
        } catch {
          /* soft */
        }
        try {
          const { parkPlanSessionOnCitySwitch } = require('../module2/planning/planSessionState') as {
            parkPlanSessionOnCitySwitch: (cityName: string) => void;
          };
          parkPlanSessionOnCitySwitch(result.cityName);
        } catch {
          /* soft */
        }
        const next = {
          ...profile,
          cityId: result.cityId,
          cityName: result.cityName,
        };
        onProfileChange(next);
        void saveUserProfile(next);
        void import('../services/memory/travelPrefsReview')
          .then((m) => m.maybeOfferTravelPrefsAfterCity(result.cityId))
          .catch(() => undefined);
      },
    });
    return () => registerCityProximityHandlers(null);
  }, [onProfileChange, profile]);

  useEffect(() => {
    void import('../services/memory/travelPrefsReview')
      .then((m) => m.maybeOfferTravelPrefsAfterIdle())
      .catch(() => undefined);
    void import('../services/ui/idlePrefetch').then((m) =>
      m.scheduleIdleUiPrefetch(),
    );
  }, []);

  const openTextInput = useCallback(() => {
    useHomeOverlayStore
      .getState()
      .openQuestion(HOME_QUESTION_DEFAULT_SUBTITLE);
  }, []);

  const openTextFallback = useCallback((reason: VoiceFallbackReason) => {
    useHomeOverlayStore.getState().openQuestion(FALLBACK_SUBTITLES[reason]);
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
    cancelFindusBusy,
  } = useVoiceInput({
    // Kurz-Tipp öffnet das Tippfeld (Home + Timeline); Hold startet Voice.
    onShortPress: openTextInput,
    onNeedTextFallback: openTextFallback,
  });
  const navRouteLoading = useFinnusStore(selectNavRouteLoading);

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

  // Sticky „Überlegen“-Spinner: Flug-Recherche darf länger als 12s brauchen.
  useEffect(() => {
    if (!isGenerating && !selectNavRouteLoading(useFinnusStore.getState())) return;
    const thinkT = setTimeout(() => {
      const s = useFinnusStore.getState();
      if (
        s.isGenerating &&
        !s.isListening &&
        !isFinalizing &&
        !s.isAudiblySpeaking &&
        !s.isPlayingAudio
      ) {
        s.setIsGenerating(false);
      }
    }, 45_000);
    const navT = setTimeout(() => {
      const s = useFinnusStore.getState();
      if (selectNavRouteLoading(s)) {
        s.setNavRouteLoading(false);
      }
    }, 12_000);
    return () => {
      clearTimeout(thinkT);
      clearTimeout(navT);
    };
  }, [isGenerating, isListening, isFinalizing, navRouteLoading]);

  const openPassport = useCallback((opts?: { tab?: PassportTab }) => {
    useHomeOverlayStore.getState().openPassport(opts?.tab);
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
    useHomeOverlayStore.getState().openSettings();
    void import('../services/diagnostics/interactionDelay').then((m) =>
      m.noteUiTap('settings'),
    );
    void markFeatureTipCompleted('tune_profile');
    void import('../services/onboarding/uiCoachMarks').then((m) =>
      m.onUserOpenedSettings(),
    );
  }, []);
  const openPlanCalendar = useCallback(() => {
    void import('../services/diagnostics/interactionDelay').then((m) =>
      m.noteUiTap('timeline'),
    );
    usePlanCalendarUiStore.getState().setCalendarVisible(true);
    void import('../services/onboarding/uiCoachMarks').then((m) =>
      m.onUserOpenedPlanCalendar(),
    );
  }, []);
  const openPlaceSeek = useCallback(() => {
    void import('../services/diagnostics/interactionDelay').then((m) =>
      m.noteUiTap('places'),
    );
    useHomeOverlayStore.getState().openSeek();
  }, []);
  const closeGyg = useCallback(
    () => useFinnusStore.getState().setGygWidget(null),
    [],
  );
  const closeInAppBrowser = useCallback(
    () => useFinnusStore.getState().setInAppBrowser(null),
    [],
  );

  const onAbortBusy = useCallback(() => {
    void cancelFindusBusy();
  }, [cancelFindusBusy]);

  const onConciergeFollowUp = useCallback(
    (prompt: string) => {
      void submitUserQuestion(prompt);
    },
    [submitUserQuestion],
  );

  const mapBottomChrome = HOME_DOCK_BAR_H + safePad.bottom;
  const onHudHeight = useCallback((h: number) => {
    setHudHeight(h);
  }, []);

  return (
    <View style={styles.root}>
      <HomeLiveLayer
        hudHeight={hudHeight}
        onHudHeight={onHudHeight}
        mapBottomChrome={mapBottomChrome}
        safePadTop={safePad.top}
        isListening={isListening}
        isMicLocked={isMicLocked}
        isFinalizing={isFinalizing}
        isGenerating={isGenerating}
        onAbortBusy={onAbortBusy}
        onFollowUp={onConciergeFollowUp}
        onOpenPlanCalendar={openPlanCalendar}
        onOpenPassport={openPassport}
        onTellMore={onHudTellMore}
        onStartTour={onStartTour}
        tourStarting={tourStarting}
        onCloseGyg={closeGyg}
        onCloseInAppBrowser={closeInAppBrowser}
      />

      <HomeChromeLayer
        safePadBottom={safePad.bottom}
        isListening={isListening}
        isMicLocked={isMicLocked}
        isFinalizing={isFinalizing}
        isGenerating={isGenerating}
        partialText={partialText}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onSwipeLock={onSwipeLock}
        onSwipeLiveChat={onSwipeLiveChat}
        onAbortBusy={onAbortBusy}
        onOpenPlanCalendar={openPlanCalendar}
        onPlaces={openPlaceSeek}
        onSettings={openSettings}
      />

      <HomeOverlayHost
        profile={profile}
        onProfileChange={onProfileChange}
        onResetSetup={onResetSetup}
        submitUserQuestion={submitUserQuestion}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onSwipeLock={onSwipeLock}
        onSwipeLiveChat={onSwipeLiveChat}
        isListening={isListening}
        isMicLocked={isMicLocked}
        isFinalizing={isFinalizing}
        isGenerating={isGenerating}
        isAudiblySpeaking={isAudiblySpeaking}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  hudOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'stretch',
    zIndex: UI_LAYER.hud,
    elevation: UI_LAYER.hud,
  },
  micFloat: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: UI_LAYER.sheet - 1,
    elevation: UI_LAYER.sheet - 1,
  },
  /** True horizontal center — independent of left/right side content. */
  micCenter: {
    alignItems: 'center',
  },
  /** Simulation FAB overlays left; does not participate in mic centering. */
  micSideLeft: {
    position: 'absolute',
    left: spacing.md,
    bottom: 0,
  },
  dockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: UI_LAYER.hud,
    elevation: UI_LAYER.hud,
  },
  tourStartCard: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: UI_LAYER.hud,
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
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: UI_LAYER.hud,
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
