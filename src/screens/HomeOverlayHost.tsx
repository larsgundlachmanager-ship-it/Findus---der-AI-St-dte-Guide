/**
 * Home-Overlays isoliert: GPS/Voice zeichnet die Karte neu, nicht Settings/Timeline.
 * Jede Schicht abonniert nur ihren Store — Taps bleiben auf dem JS-Thread frei.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Platform, ToastAndroid } from 'react-native';
import { HomeMapPlacePopup } from '../components/homeMap/HomeMapPlacePopup';
import { PlaceSeekSheet } from '../components/PlaceSeekSheet';
import { VisitPassportModal } from '../components/VisitPassportModal';
import {
  PlanCalendarModal,
  type PlanCalendarModalHandle,
} from '../components/PlanCalendarModal';
import { QuestionModal } from '../components/QuestionModal';
import { ReisebueroModal } from '../components/ReisebueroModal';
import { TravelPrefsReviewHost } from '../components/TravelPrefsReviewHost';
import { SettingsScreen } from './SettingsScreenLazy';
import type { SettingsScreenHandle } from './SettingsScreen';
import { claimAndroidBackStep } from '../services/ui/androidBackStep';
import { markFeatureTipCompleted } from '../services/ai/featureTips';
import { saveUserProfile } from '../services/userProfileService';
import { useFinnusStore } from '../store/useFinnusStore';
import { useHomeMapUiStore } from '../store/useHomeMapUiStore';
import { useHomeOverlayStore } from '../store/useHomeOverlayStore';
import { usePlanCalendarUiStore } from '../module2/timeline/planCalendarUiStore';
import { useReisebueroStore } from '../reisebuero/store';
import type { UserProfile } from '../types/userProfile';

type VoiceChrome = {
  onPressIn: () => void;
  onPressOut: () => void;
  onSwipeLock: () => void;
  onSwipeLiveChat: () => void;
  isListening: boolean;
  isMicLocked: boolean;
  isFinalizing: boolean;
  isGenerating: boolean;
  isAudiblySpeaking: boolean;
};

type Props = {
  profile: UserProfile;
  onProfileChange: (profile: UserProfile) => void;
  onResetSetup: () => void;
  submitUserQuestion: (prompt: string) => void | Promise<void>;
} & VoiceChrome;

const settingsHostRef = React.createRef<SettingsScreenHandle>();
const calendarHostRef = React.createRef<PlanCalendarModalHandle>();

const HomePlacePopupLayer = React.memo(function HomePlacePopupLayer() {
  const place = useHomeMapUiStore((s) => s.placePopup);
  const onClose = useCallback(
    () => useHomeMapUiStore.getState().setPlacePopup(null),
    [],
  );
  return <HomeMapPlacePopup place={place} onClose={onClose} />;
});

const HomeSettingsLayer = React.memo(function HomeSettingsLayer({
  profile,
  onProfileChange,
  onResetSetup,
}: {
  profile: UserProfile;
  onProfileChange: (profile: UserProfile) => void;
  onResetSetup: () => void;
}) {
  const visible = useHomeOverlayStore((s) => s.settingsVisible);
  const mounted = useHomeOverlayStore((s) => s.settingsMounted);
  const initialFocus = useFinnusStore((s) => s.settingsOpenFocus);
  const settingsOpenRequestAtMs = useFinnusStore(
    (s) => s.settingsOpenRequestAtMs,
  );

  useEffect(() => {
    if (settingsOpenRequestAtMs == null) return;
    void markFeatureTipCompleted('tune_profile');
    useHomeOverlayStore.getState().openSettings();
  }, [settingsOpenRequestAtMs]);

  const onClose = useCallback(() => {
    useHomeOverlayStore.getState().closeSettings();
    useFinnusStore.setState({ settingsOpenFocus: null });
  }, []);

  const onSaved = useCallback(
    async (next: UserProfile) => {
      await saveUserProfile(next);
      onProfileChange(next);
    },
    [onProfileChange],
  );

  const onOpenReisebuero = useCallback(() => {
    useReisebueroStore.getState().openOverlay({ reset: true });
  }, []);

  if (!visible && !mounted) return null;
  return (
    <SettingsScreen
      ref={settingsHostRef}
      visible={visible}
      profile={profile}
      onClose={onClose}
      onSaved={onSaved}
      onReset={onResetSetup}
      initialFocus={initialFocus}
      onOpenReisebuero={onOpenReisebuero}
    />
  );
});

function voiceChromeEqual(
  a: VoiceChrome,
  b: VoiceChrome,
  includeLiveFlags: boolean,
): boolean {
  if (
    a.onPressIn !== b.onPressIn ||
    a.onPressOut !== b.onPressOut ||
    a.onSwipeLock !== b.onSwipeLock ||
    a.onSwipeLiveChat !== b.onSwipeLiveChat
  ) {
    return false;
  }
  if (!includeLiveFlags) return true;
  return (
    a.isListening === b.isListening &&
    a.isMicLocked === b.isMicLocked &&
    a.isFinalizing === b.isFinalizing &&
    a.isGenerating === b.isGenerating &&
    a.isAudiblySpeaking === b.isAudiblySpeaking
  );
}

const HomeCalendarLayer = React.memo(
  function HomeCalendarLayer({ voice }: { voice: VoiceChrome }) {
  const visible = usePlanCalendarUiStore((s) => s.calendarVisible);
  const mounted = usePlanCalendarUiStore((s) => s.calendarMounted);
  const planOpenRequestAtMs = usePlanCalendarUiStore((s) => s.openRequestAtMs);
  const planCloseRequestAtMs = usePlanCalendarUiStore((s) => s.closeRequestAtMs);

  useEffect(() => {
    if (planOpenRequestAtMs == null) return;
    void import('../module2/planning/purgeStaleOpenPlans').then((m) => {
      m.noteCalendarShown();
    });
    usePlanCalendarUiStore.getState().setCalendarVisible(true);
    usePlanCalendarUiStore.getState().clearOpenRequest();
  }, [planOpenRequestAtMs]);

  useEffect(() => {
    if (planCloseRequestAtMs == null) return;
    usePlanCalendarUiStore.getState().setCalendarVisible(false);
    usePlanCalendarUiStore.getState().clearCloseRequest();
    void import('../module2/planning/purgeStaleOpenPlans').then((m) => {
      m.noteCalendarHidden();
    });
    void import('../module2/planning/runPlanningModule').then((m) =>
      m.onPlanningModuleClosed(),
    );
  }, [planCloseRequestAtMs]);

  const onClose = useCallback(() => {
    usePlanCalendarUiStore.getState().setCalendarVisible(false);
    void import('../module2/planning/runPlanningModule').then((m) =>
      m.onPlanningModuleClosed(),
    );
  }, []);

  const onShortAnswerPrompt = useCallback((prompt: string) => {
    void import('../module2/planning/planSessionState').then(
      ({ usePlanSessionStore }) => {
        const session = usePlanSessionStore.getState();
        if (session.waitingLocation) {
          void import('../module2/speech/speechQueue').then(
            ({ enqueueSpeech }) => {
              enqueueSpeech({
                kind: 'main',
                text: prompt,
                turnId: `m5_hint_${Date.now()}`,
              });
            },
          );
          return;
        }
        void import('../module2/planning/runPlanningModule').then((m) =>
          m.runPlanningModule({ userText: prompt }),
        );
      },
    );
  }, []);

  if (!visible && !mounted) return null;
  return (
    <PlanCalendarModal
      ref={calendarHostRef}
      visible={visible}
      onClose={onClose}
      onPressIn={voice.onPressIn}
      onPressOut={voice.onPressOut}
      onSwipeLock={voice.onSwipeLock}
      onSwipeLiveChat={voice.onSwipeLiveChat}
      isListening={voice.isListening}
      isMicLocked={voice.isMicLocked}
      isFinalizing={voice.isFinalizing}
      isGenerating={voice.isGenerating}
      isAudiblySpeaking={voice.isAudiblySpeaking}
      onShortAnswerPrompt={onShortAnswerPrompt}
    />
  );
},
  (prev, next) =>
    voiceChromeEqual(
      prev.voice,
      next.voice,
      usePlanCalendarUiStore.getState().calendarVisible,
    ),
);

const HomeSeekLayer = React.memo(function HomeSeekLayer() {
  const visible = useHomeOverlayStore((s) => s.seekVisible);
  const mounted = useHomeOverlayStore((s) => s.seekMounted);
  const onClose = useCallback(
    () => useHomeOverlayStore.getState().closeSeek(),
    [],
  );
  if (!visible && !mounted) return null;
  return <PlaceSeekSheet visible={visible} onClose={onClose} />;
});

const HomePassportLayer = React.memo(function HomePassportLayer({
  onQuickNav,
}: {
  onQuickNav: (prompt: string) => void;
}) {
  const visible = useHomeOverlayStore((s) => s.passportVisible);
  const initialTab = useHomeOverlayStore((s) => s.passportTab);
  const onClose = useCallback(
    () => useHomeOverlayStore.getState().closePassport(),
    [],
  );
  if (!visible) return null;
  return (
    <VisitPassportModal
      visible
      initialTab={initialTab}
      onClose={onClose}
      onQuickNavAdd={onQuickNav}
    />
  );
});

const HomeQuestionLayer = React.memo(function HomeQuestionLayer({
  onSubmit,
}: {
  onSubmit: (prompt: string) => void | Promise<void>;
}) {
  const visible = useHomeOverlayStore((s) => s.questionVisible);
  const subtitle = useHomeOverlayStore((s) => s.questionSubtitle);
  const onClose = useCallback(
    () => useHomeOverlayStore.getState().closeQuestion(),
    [],
  );
  return (
    <QuestionModal
      visible={visible}
      onClose={onClose}
      onSubmit={onSubmit}
      subtitle={subtitle}
    />
  );
});

const HomeReisebueroLayer = React.memo(function HomeReisebueroLayer() {
  const visible = useReisebueroStore((s) => s.overlayOpen);
  const onClose = useCallback(
    () => useReisebueroStore.getState().closeOverlay(),
    [],
  );
  if (!visible) return null;
  return <ReisebueroModal visible onClose={onClose} />;
});

function HomeBackHandler() {
  const lastHomeBackAtMs = useRef(0);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!claimAndroidBackStep()) return true;

      if (useHomeMapUiStore.getState().placePopup) {
        useHomeMapUiStore.getState().setPlacePopup(null);
        return true;
      }
      const overlay = useHomeOverlayStore.getState();
      if (overlay.questionVisible) {
        overlay.closeQuestion();
        return true;
      }
      if (usePlanCalendarUiStore.getState().calendarVisible) {
        if (calendarHostRef.current?.handleHardwareBack()) return true;
        usePlanCalendarUiStore.getState().setCalendarVisible(false);
        void import('../module2/planning/runPlanningModule').then((m) =>
          m.onPlanningModuleClosed(),
        );
        return true;
      }
      if (useReisebueroStore.getState().overlayOpen) {
        useReisebueroStore.getState().closeOverlay();
        return true;
      }
      if (overlay.settingsVisible) {
        if (settingsHostRef.current?.handleHardwareBack()) return true;
        overlay.closeSettings();
        useFinnusStore.setState({ settingsOpenFocus: null });
        return true;
      }
      if (overlay.passportVisible) {
        overlay.closePassport();
        return true;
      }
      if (overlay.seekVisible) {
        overlay.closeSeek();
        return true;
      }
      const s = useFinnusStore.getState();
      if (s.inAppBrowser) {
        s.setInAppBrowser(null);
        return true;
      }
      if (s.gygWidget) {
        s.setGygWidget(null);
        return true;
      }
      try {
        const { useLivePitchStore } = require('../module2/pitch/publishPitchUi') as {
          useLivePitchStore: {
            getState: () => {
              requestId: string | null;
              options: unknown[];
              loading: boolean;
              clear: () => void;
            };
          };
        };
        const pitch = useLivePitchStore.getState();
        if (pitch.requestId && (pitch.options.length > 0 || pitch.loading)) {
          pitch.clear();
          return true;
        }
      } catch {
        /* soft */
      }
      if (s.activeConciergeCard) {
        try {
          const { dismissConciergeCard } = require('../services/actionHandlerService') as {
            dismissConciergeCard: () => void;
          };
          dismissConciergeCard();
        } catch {
          s.setActiveConciergeCard(null);
        }
        return true;
      }
      const now = Date.now();
      if (now - lastHomeBackAtMs.current < 2200) {
        lastHomeBackAtMs.current = 0;
        return false;
      }
      lastHomeBackAtMs.current = now;
      if (Platform.OS === 'android') {
        ToastAndroid.show(
          'Noch einmal zurück, um Yorro zu schließen',
          ToastAndroid.SHORT,
        );
      }
      return true;
    });
    return () => sub.remove();
  }, []);

  return null;
}

export const HomeOverlayHost = React.memo(function HomeOverlayHost({
  profile,
  onProfileChange,
  onResetSetup,
  submitUserQuestion,
  onPressIn,
  onPressOut,
  onSwipeLock,
  onSwipeLiveChat,
  isListening,
  isMicLocked,
  isFinalizing,
  isGenerating,
  isAudiblySpeaking,
}: Props) {
  const onPassportQuickNav = useCallback(
    (prompt: string) => {
      useHomeOverlayStore.getState().closePassport();
      void submitUserQuestion(prompt);
    },
    [submitUserQuestion],
  );

  return (
    <>
      <HomeBackHandler />
      {/* Map-Popup unter Chrome (placePopup < hud); Settings/Timeline darüber */}
      <HomePlacePopupLayer />
      <HomeSettingsLayer
        profile={profile}
        onProfileChange={onProfileChange}
        onResetSetup={onResetSetup}
      />
      <HomeReisebueroLayer />
      <TravelPrefsReviewHost
        profile={profile}
        onSave={async (patch) => {
          const next = { ...profile, ...patch };
          await saveUserProfile(next);
          onProfileChange(next);
        }}
      />
      <HomePassportLayer onQuickNav={onPassportQuickNav} />
      <HomeCalendarLayer
        voice={{
          onPressIn,
          onPressOut,
          onSwipeLock,
          onSwipeLiveChat,
          isListening,
          isMicLocked,
          isFinalizing,
          isGenerating,
          isAudiblySpeaking,
        }}
      />
      <HomeSeekLayer />
      <HomeQuestionLayer onSubmit={submitUserQuestion} />
    </>
  );
});
