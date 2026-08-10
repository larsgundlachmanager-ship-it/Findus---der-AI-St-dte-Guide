import React, { Component, useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  AppState,
  Linking,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { getNetworkStateAsync } from 'expo-network';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { OnboardingNavigator } from './src/onboarding/OnboardingNavigator';
import { initDatabase, getAllPois } from './src/db/database';
import { useFinnusStore } from './src/store/useFinnusStore';
import { colors } from './src/constants/theme';
import { syncPOIsInBackground } from './src/services/syncService';
import { syncDictionaryInBackground } from './src/services/sync/dictionarySyncService';
import { initDictionaryEngine } from './src/services/tts/dictionaryEngine';
import { loadFeatureTipState } from './src/services/ai/featureTips';
import { initMultilingualPhoneticEngine } from './src/services/ai/multilingualPhoneticEngine';
import {
  startVoiceBuffer,
  prefetchOnboardingAudioBundle,
  prefetchVoiceSamples,
  purgeLegacyVoiceAssets,
} from './src/services/ttsService';
import { bootstrapCartesiaCostTracker } from './src/services/cartesiaCostTracker';
import { startResourceUsageMonitor } from './src/services/diagnostics/resourceUsageTracker';
import { bootstrapApiCostLedger } from './src/services/diagnostics/apiCostLedger';
import { initSentryIfConfigured } from './src/services/diagnostics/sentryBootstrap';
import { initFeedbackTelemetry } from './src/services/feedback/telemetryBuffer';
import {
  createDefaultProfile,
  type UserProfile,
} from './src/types/userProfile';
import {
  loadUserProfile,
  saveUserProfile,
  subscribeUserProfile,
} from './src/services/userProfileService';
import { useUserMemoryStore } from './src/store/useUserMemoryStore';
import { useShoppingTaskStore } from './src/store/useShoppingTaskStore';
import { useSessionPlanStore } from './src/store/useSessionPlanStore';
import { useLogisticsTriggerStore } from './src/store/useLogisticsTriggerStore';
import { ensureUserProfileStoreSync } from './src/store/useUserProfileStore';
import { INTRO_WELCOME_DE } from './src/i18n';
import { hydrateAffiliateRedirectAck } from './src/services/affiliate/affiliateDisclosure';
import { startFindusHealthMonitor } from './src/services/findusHealthService';
import { startWeatherMonitor } from './src/services/weatherService';
import { startSurvivalModeMonitor } from './src/services/battery/survivalMode';
import { startGrowthMonitor } from './src/runtime/growthModule';
import {
  startRucksackWriters,
  stopRucksackWriters,
  startBackgroundTriggerEngine,
  stopBackgroundTriggerEngine,
} from './src/module2';
import { loadPoiTeaserLocks } from './src/services/poi/poiTeaserLocks';
import { loadWalkTrack } from './src/services/discovery/walkTrackService';
import { loadStampPassport } from './src/services/navigation/stampPassportPersistence';
import { loadMicHintPrefs } from './src/services/ui/micHintPrefs';
import { loadHudHintPrefs } from './src/services/ui/hudHintPrefs';
import { loadConversationThreads } from './src/services/memory/conversationThreads';
import { startUiScaleSync } from './src/services/ui/uiScale';
import { useOpenQuestionStore } from './src/store/useOpenQuestionStore';
import { loadNavSearchHistory } from './src/services/navigation/navSearchHistory';
import {
  configureNotificationHandler,
  ensureNotificationPermissionForProfile,
} from './src/services/notifications/notificationService';
import {
  SplashScreenController,
  SPLASH_BG,
} from './src/components/SplashScreenController';
import { LocationProminentDisclosureHost } from './src/components/LocationProminentDisclosureModal';
import { CitySwitchPromptHost } from './src/components/CitySwitchPrompt';
import {
  maybeSpeakWelcomeBack,
  touchActiveDay,
  bootstrapWelcomeBackAppState,
} from './src/services/memory/welcomeBackService';
/** Background-GPS-Task muss global beim Start definiert sein. */
import './src/services/backgroundLocationTask';

type AppPhase = 'booting' | 'onboarding' | 'ready' | 'error';

type ErrorBoundaryState = {
  error: Error | null;
};

class AppErrorBoundary extends Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[app] Uncaught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.bootFallback}>
          <Text style={styles.errorTitle}>Darstellung fehlgeschlagen</Text>
          <Text style={styles.errorText}>{this.state.error.message}</Text>
          <Text
            style={styles.retryHint}
            onPress={() => this.setState({ error: null })}
          >
            Tippen zum erneuten Versuch
          </Text>
          <StatusBar style="light" />
        </View>
      );
    }
    return this.props.children ? (
      <View style={styles.boundaryRoot}>{this.props.children}</View>
    ) : null;
  }
}

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('booting');
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState<UserProfile>(createDefaultProfile());
  const [bootReady, setBootReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [bootVoiceId, setBootVoiceId] = useState<UserProfile['voiceId']>(
    'alina',
  );
  const [targetPhase, setTargetPhase] = useState<Exclude<AppPhase, 'booting'>>(
    'onboarding',
  );

  const setPois = useFinnusStore((s) => s.setPois);

  useEffect(() => {
    initSentryIfConfigured();
    void purgeLegacyVoiceAssets().catch(() => undefined);
  }, []);

  useEffect(() => startUiScaleSync(), []);

  const boot = useCallback(async () => {
    setBootReady(false);
    setError(null);
    try {
      await initDatabase();
      await initDictionaryEngine();
      await initMultilingualPhoneticEngine();
      await useUserMemoryStore.getState().hydrate();
      await useShoppingTaskStore.getState().hydrate();
      await useSessionPlanStore.getState().hydrate();
      await useLogisticsTriggerStore.getState().hydrate();
      try {
        const { hydratePaceProfile, setPaceChangeListener } = await import(
          './src/services/mobility/paceProfile'
        );
        await hydratePaceProfile();
        setPaceChangeListener((mode, kmh) => {
          void import('./src/services/userProfileService')
            .then(({ getCachedUserProfile, saveUserProfile }) => {
              const p = getCachedUserProfile();
              if (!p) return;
              const mp = { ...(p.mobilityPrefs ?? {}) };
              if (mode === 'walk') mp.learnedWalkKmh = kmh;
              else mp.learnedBikeKmh = kmh;
              mp.learnedPaceAtMs = Date.now();
              void saveUserProfile({ ...p, mobilityPrefs: mp });
            })
            .catch(() => undefined);
        });
      } catch {
        /* soft */
      }
      const { hydrateMuteSession } = await import(
        './src/services/audio/muteSessionService'
      );
      await hydrateMuteSession();
      const stampEntries = await loadStampPassport();
      if (stampEntries.length > 0) {
        useFinnusStore.setState({ visitedHistory: stampEntries });
      }
      try {
        const { hydrateVisitLog, importStampsIntoVisitLog } = await import(
          './src/services/timeline/visitLog'
        );
        await hydrateVisitLog();
        importStampsIntoVisitLog(stampEntries, (poiId) => {
          const p = useFinnusStore.getState().pois.find((x) => x.id === poiId);
          return p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
            ? { lat: p.lat, lng: p.lng }
            : null;
        });
      } catch {
        /* soft */
      }
      try {
        const {
          hydratePlanTimeline,
          startPlanTimelinePersistWatchers,
        } = await import('./src/module2/timeline/planPersistence');
        await hydratePlanTimeline();
        startPlanTimelinePersistWatchers();
      } catch {
        /* soft */
      }
      await loadFeatureTipState();
      await hydrateAffiliateRedirectAck();
      ensureUserProfileStoreSync();
      syncDictionaryInBackground();
      const pois = await getAllPois();
      setPois(pois);

      const existing = await loadUserProfile();
      const resolvedVoice = existing?.voiceId ?? 'alina';
      setBootVoiceId(resolvedVoice);

      if (existing?.setupComplete) {
        setProfile(existing);
        setTargetPhase('ready');
        syncPOIsInBackground(existing.cityId ?? undefined);
      } else {
        const base = existing ?? createDefaultProfile();
        const nextDraft: UserProfile = {
          ...base,
          language: 'de',
          voiceId: base.voiceId || 'alina',
        };
        if (!existing) {
          nextDraft.language = 'de';
          nextDraft.voiceId = 'alina';
        }
        setBootVoiceId(nextDraft.voiceId);
        setDraft(nextDraft);
        setProfile(existing);
        setTargetPhase('onboarding');
        syncPOIsInBackground();
      }
      setBootReady(true);
    } catch (err) {
      console.error('[app] boot failed:', err);
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      setTargetPhase('error');
      setBootReady(true);
    }
  }, [setPois]);

  useEffect(() => {
    bootstrapCartesiaCostTracker();
    void boot();
  }, [boot]);

  useEffect(() => {
    const stopTelemetry = initFeedbackTelemetry();
    const stopResources = startResourceUsageMonitor();
    const stopCostLedger = bootstrapApiCostLedger();
    return () => {
      stopTelemetry();
      stopResources();
      stopCostLedger();
    };
  }, []);

  useEffect(() => {
    return startFindusHealthMonitor(12_000);
  }, []);

  useEffect(() => {
    return startWeatherMonitor();
  }, []);

  useEffect(() => {
    startRucksackWriters();
    startBackgroundTriggerEngine();
    return () => {
      stopRucksackWriters();
      stopBackgroundTriggerEngine();
    };
  }, []);

  useEffect(() => {
    return startSurvivalModeMonitor();
  }, []);

  useEffect(() => {
    return startGrowthMonitor();
  }, []);

  useEffect(() => {
    void loadWalkTrack();
    void loadMicHintPrefs();
    void loadHudHintPrefs();
    void loadNavSearchHistory();
    void loadPoiTeaserLocks();
    void loadConversationThreads();
    void useOpenQuestionStore.getState().hydrate();
  }, []);

  useEffect(() => {
    void configureNotificationHandler();
  }, []);

  useEffect(() => {
    const unsub = subscribeUserProfile((next) => {
      if (next?.setupComplete) setProfile(next);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!bootReady || !splashDone) return;
    setPhase(targetPhase);
  }, [bootReady, splashDone, targetPhase]);

  useEffect(() => {
    let stopWatchers: (() => void) | undefined;
    let unsubAuth: (() => void) | undefined;

    void (async () => {
      try {
        const { refreshAuthSession } = await import(
          './src/services/account/findusAuth'
        );
        const {
          pullUserCloudOnLogin,
          scheduleUserCloudPush,
          startUserCloudSyncWatchers,
        } = await import('./src/services/account/userCloudSync');
        const { getSupabase } = await import('./src/services/supabase');

        stopWatchers = startUserCloudSyncWatchers();
        const user = await refreshAuthSession();
        if (user) void pullUserCloudOnLogin();

        const sb = getSupabase();
        if (sb) {
          const { data } = sb.auth.onAuthStateChange((_event, session) => {
            if (session?.user) void pullUserCloudOnLogin();
          });
          unsubAuth = () => data.subscription.unsubscribe();
        }
      } catch {
        /* soft */
      }
    })();

    const appSub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void (async () => {
        try {
          const { refreshAuthSession } = await import(
            './src/services/account/findusAuth'
          );
          const {
            pullUserCloudOnLogin,
            scheduleUserCloudPush,
          } = await import('./src/services/account/userCloudSync');
          const user = await refreshAuthSession();
          if (user) await pullUserCloudOnLogin();
          scheduleUserCloudPush();
        } catch {
          /* soft */
        }
      })();
    });

    return () => {
      stopWatchers?.();
      unsubAuth?.();
      appSub.remove();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'ready' || !profile?.setupComplete) return;
    void (async () => {
      try {
        const { loadHandsFreePrefs } = await import(
          './src/services/handsFree/handsFreePrefs'
        );
        const { syncHandsFreeListenNotification } = await import(
          './src/services/handsFree/handsFreeNotification'
        );
        await loadHandsFreePrefs();
        await syncHandsFreeListenNotification();
        const { syncHeadsetButtonControls } = await import(
          './src/services/handsFree/headsetButtonService'
        );
        await syncHeadsetButtonControls();
        const { loadModule1BackgroundSpeechPrefs } = await import(
          './src/services/speech/module1BackgroundSpeechPrefs'
        );
        await loadModule1BackgroundSpeechPrefs();
      } catch {
        /* soft */
      }
    })();
  }, [phase, profile?.setupComplete]);

  useEffect(() => {
    const onUrl = ({ url }: { url: string }) => {
      void import('./src/services/handsFree/handsFreeLinking').then((m) => {
        m.handleIncomingHandsFreeUrl(url);
      });
    };
    const sub = Linking.addEventListener('url', onUrl);
    void Linking.getInitialURL().then((url) => {
      if (url) onUrl({ url });
    });

    let lastHandsFreeNotifKey: string | null = null;
    const handleNotifResponse = (
      response: Notifications.NotificationResponse | null,
      opts?: { clear?: boolean },
    ) => {
      if (!response) return;
      const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (key === lastHandsFreeNotifKey) return;
      void import('./src/services/handsFree/handsFreeNotification').then(
        (m) => {
          if (!m.isHandsFreeSpeakResponse(response)) return;
          lastHandsFreeNotifKey = key;
          void import('./src/services/handsFree/handsFreeBus').then((b) => {
            b.requestHandsFreeListen('notification');
          });
          if (opts?.clear) {
            void Notifications.clearLastNotificationResponseAsync().catch(
              () => undefined,
            );
          }
        },
      );
    };

    const notifSub = Notifications.addNotificationResponseReceivedListener(
      (response) => handleNotifResponse(response, { clear: true }),
    );
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      // Nach Handle clearen — sonst würde jeder spätere App-Start erneut lauschen
      handleNotifResponse(response, { clear: true });
    });

    return () => {
      sub.remove();
      notifSub.remove();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'ready' || !profile?.setupComplete) return;
    bootstrapWelcomeBackAppState();
    void (async () => {
      try {
        const { bootstrapSessionResume } = await import(
          './src/services/session/sessionResumeService'
        );
        await bootstrapSessionResume();
      } catch {
        /* soft */
      }
      await touchActiveDay();
      const { peekPostTourQuestion } = await import(
        './src/services/onboarding/pendingPostTourQuestion'
      );
      // Hilfe-Chip nach Erklärung: echte Recherche statt Welcome-Rede
      if (peekPostTourQuestion()) return;

      const { maybeSpeakFirstMapWelcome } = await import(
        './src/services/onboarding/firstMapWelcomeService'
      );
      const didFirst = await maybeSpeakFirstMapWelcome(profile);
      if (!didFirst) {
        await maybeSpeakWelcomeBack();
      }
      if (profile.cityId) {
        const { speakCityWelcomeForCity } = await import(
          './src/services/cityWelcomeService'
        );
        await speakCityWelcomeForCity({
          id: profile.cityId,
          name: profile.cityName ?? profile.cityId,
          symbol: '',
        });
      }
    })();
  }, [phase, profile]);

  const handleOnboardingComplete = async (next: UserProfile) => {
    const saved = await saveUserProfile(next);
    setProfile(saved);
    setPhase('ready');
    if (saved.cityId) {
      syncPOIsInBackground(saved.cityId);
    }
    // Push-Permission beim Abschluss der Einrichtung (ÖPNV-/Flug-Erinnerungen)
    void ensureNotificationPermissionForProfile(
      saved.notificationsEnabled !== false,
    ).then((perm) => {
      if (perm && !perm.granted) {
        // Still — User kann später bei der ersten Erinnerung erneut gefragt werden
        console.log('[notifications] permission after onboarding:', perm.status);
      }
    });
  };

  const handleReset = () => {
    setDraft(createDefaultProfile());
    setProfile(null);
    setBootVoiceId('alina');
    setPhase('onboarding');
    startVoiceBuffer({ speechRate: 1, priorityVoiceId: 'alina' });
    void prefetchOnboardingAudioBundle(INTRO_WELCOME_DE, 1);
  };

  const handleSplashFinish = useCallback(() => {
    setSplashDone(true);
    void getNetworkStateAsync().then((state) => {
      if (state.type === 'WIFI') {
        void prefetchVoiceSamples(bootVoiceId);
      }
    });
  }, [bootVoiceId]);

  let content: React.ReactNode;

  if (phase === 'error') {
    content = (
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <Text style={styles.errorTitle}>Start fehlgeschlagen</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Text style={styles.retryHint} onPress={() => void boot()}>
          Tippen zum erneuten Versuch
        </Text>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  } else if (phase === 'booting') {
    content = (
      <SplashScreenController
        onFinish={handleSplashFinish}
        priorityVoiceId={bootVoiceId}
      />
    );
  } else if (phase === 'onboarding') {
    content = (
      <>
        <OnboardingNavigator
          draft={draft}
          setDraft={setDraft}
          onComplete={(p) => void handleOnboardingComplete(p)}
          initialStep={0}
        />
        <StatusBar style="light" />
      </>
    );
  } else if (profile) {
    content = (
      <>
        <HomeScreen
          profile={profile}
          onProfileChange={setProfile}
          onResetSetup={handleReset}
        />
        <StatusBar style="light" />
      </>
    );
  } else {
    content = (
      <SplashScreenController
        onFinish={handleSplashFinish}
        priorityVoiceId="alina"
      />
    );
  }

  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <View style={styles.root}>
          {content}
          {/* Overlays im selben Root — kein RN-Modal (Android-Fragmente) */}
          <LocationProminentDisclosureHost />
          <CitySwitchPromptHost />
        </View>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SPLASH_BG,
  },
  boundaryRoot: {
    flex: 1,
  },
  bootFallback: {
    flex: 1,
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
  },
  retryHint: {
    marginTop: 20,
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
