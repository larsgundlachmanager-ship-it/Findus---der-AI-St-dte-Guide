import React, { Component, useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
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
import { loadPoiTeaserLocks } from './src/services/poi/poiTeaserLocks';
import { loadWalkTrack } from './src/services/discovery/walkTrackService';
import { loadStampPassport } from './src/services/navigation/stampPassportPersistence';
import { loadMicHintPrefs } from './src/services/ui/micHintPrefs';
import { loadHudHintPrefs } from './src/services/ui/hudHintPrefs';
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
    return this.props.children;
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
    void purgeLegacyVoiceAssets().catch(() => undefined);
  }, []);

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
        const { useDayPlanStore } = await import('./src/store/useDayPlanStore');
        await useDayPlanStore.getState().hydrate();
        const mod5 = await import('./src/services/module5');
        await mod5.hydratePaceProfile();
        mod5.setPaceChangeListener((mode, kmh) => {
          mod5.refreshDayPlanTravelTimes(mode, kmh);
        });
        mod5.bootstrapModule5Today();
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
        importStampsIntoVisitLog(stampEntries, () => null);
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
    if (phase !== 'ready' || !profile?.setupComplete) return;
    bootstrapWelcomeBackAppState();
    void (async () => {
      await touchActiveDay();
      const { maybeSpeakFirstMapWelcome } = await import(
        './src/services/onboarding/firstMapWelcomeService'
      );
      const didFirst = await maybeSpeakFirstMapWelcome(profile);
      if (!didFirst) {
        await maybeSpeakWelcomeBack();
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
        <View style={styles.root}>{content}</View>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SPLASH_BG,
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
