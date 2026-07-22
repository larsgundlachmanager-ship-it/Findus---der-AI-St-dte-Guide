import React, { Component, useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
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
import {
  startVoiceBuffer,
  prefetchOnboardingAudioBundle,
  prefetchAllKokoroVoicePacks,
  prefetchVoiceSamples,
  purgeLegacyVoiceAssets,
} from './src/services/ttsService';
import {
  createDefaultProfile,
  type UserProfile,
} from './src/types/userProfile';
import {
  loadUserProfile,
  saveUserProfile,
} from './src/services/userProfileService';
import { INTRO_WELCOME_DE } from './src/i18n';
import {
  SplashScreenController,
  SPLASH_BG,
} from './src/components/SplashScreenController';

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
    'standard_m',
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
      syncDictionaryInBackground();
      const pois = await getAllPois();
      setPois(pois);

      const existing = await loadUserProfile();
      const resolvedVoice = existing?.voiceId ?? 'standard_m';
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
          voiceId: base.voiceId || 'standard_m',
        };
        if (!existing) {
          nextDraft.language = 'de';
          nextDraft.voiceId = 'standard_m';
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
    void boot();
  }, [boot]);

  useEffect(() => {
    if (!bootReady || !splashDone) return;
    setPhase(targetPhase);
  }, [bootReady, splashDone, targetPhase]);

  const handleOnboardingComplete = async (next: UserProfile) => {
    const saved = await saveUserProfile(next);
    setProfile(saved);
    setPhase('ready');
    if (saved.cityId) {
      syncPOIsInBackground(saved.cityId);
    }
  };

  const handleReset = () => {
    setDraft(createDefaultProfile());
    setProfile(null);
    setBootVoiceId('standard_m');
    setPhase('onboarding');
    startVoiceBuffer({ speechRate: 1, priorityVoiceId: 'standard_m' });
    void prefetchOnboardingAudioBundle(INTRO_WELCOME_DE, 1);
  };

  const handleSplashFinish = useCallback(() => {
    setSplashDone(true);
    // Disk-Prefetch anderer Packs — RAM bleibt bei der aktiven Stimme
    void prefetchAllKokoroVoicePacks();
    void prefetchVoiceSamples(bootVoiceId);
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
        priorityVoiceId="standard_m"
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
