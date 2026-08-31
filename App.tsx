import React, { Component, useCallback, useEffect, useRef, useState } from 'react';
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
  profileHasFinishedSetup,
  type UserProfile,
} from './src/types/userProfile';
import {
  loadUserProfile,
  saveUserProfile,
  subscribeUserProfile,
} from './src/services/userProfileService';
import { useUserMemoryStore } from './src/store/useUserMemoryStore';
import { useShoppingTaskStore } from './src/store/useShoppingTaskStore';
import { useTripModeStore } from './src/store/useTripModeStore';
import { useReservationMemoryStore } from './src/store/useReservationMemoryStore';
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
import { UI_LAYER } from './src/constants/uiLayers';
import { warmupHomeMapDuringIntro, noteSplashMapWarmup } from './src/services/homeMap/warmupHomeMap';
import {
  noteSplashBootMinimal,
  noteSplashSkipMap,
  noteSplashStarted,
} from './src/services/homeMap/splashReadyGate';
import {
  markSplashInteractive,
  waitUntilInteractiveSettled,
  runHydrateWhenFree,
  runHydrateSteps,
} from './src/services/boot/interactiveBootGate';
import { warmMicrophonePipeline } from './src/services/sttService';
import { scheduleIdleUiPrefetch } from './src/services/ui/idlePrefetch';
import { LocationProminentDisclosureHost } from './src/components/LocationProminentDisclosureModal';
import { CitySwitchPromptHost } from './src/components/CitySwitchPrompt';
import {
  maybeSpeakWelcomeBack,
  touchActiveDay,
  bootstrapWelcomeBackAppState,
} from './src/services/memory/welcomeBackService';
/** Background-GPS-Task muss global beim Start definiert sein. */
import './src/services/backgroundLocationTask';
import { bootstrapTravelAlertTapHandler } from './src/services/notifications/travelAlertNotifications';
import { bootstrapTaskReminderTapHandler } from './src/services/notifications/taskReminderNotifications';

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
  const bootInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    initSentryIfConfigured();
    try {
      const EU = (
        globalThis as {
          ErrorUtils?: {
            getGlobalHandler?: () => (e: Error, fatal: boolean) => void;
            setGlobalHandler?: (
              fn: (e: Error, fatal: boolean) => void,
            ) => void;
          };
        }
      ).ErrorUtils;
      const prev = EU?.getGlobalHandler?.();
      EU?.setGlobalHandler?.((error, isFatal) => {
        console.warn(
          '[app] js global error',
          !!isFatal,
          String(error?.message || error).slice(0, 200),
        );
        prev?.(error, isFatal);
      });
    } catch {
      /* soft */
    }
    void purgeLegacyVoiceAssets().catch(() => undefined);
  }, []);

  useEffect(() => startUiScaleSync(), []);

  // Soft-Reload / Unmount: Expo-AV Sounds stoppen (sonst „Player accessed on wrong thread“)
  useEffect(() => {
    if (__DEV__) {
      try {
        const { DevSettings } = require('react-native') as {
          DevSettings?: { reload?: (...a: unknown[]) => void };
        };
        const ds = DevSettings;
        if (ds && typeof ds.reload === 'function' && !(ds as { __findusAvReloadWrapped?: boolean }).__findusAvReloadWrapped) {
          const orig = ds.reload.bind(ds);
          (ds as { __findusAvReloadWrapped?: boolean }).__findusAvReloadWrapped = true;
          ds.reload = (...args: unknown[]) => {
            console.warn(
              '[av] Soft-Reload: Audio stoppen. Bei AV-Crash → Cold-Start (Force-Stop + Dev Client).',
            );
            void Promise.all([
              import('./src/services/AudioVoiceService').then((m) =>
                m.stopSpeaking(),
              ),
              import('./src/db/database').then((m) => m.closeFindusDatabase()),
            ])
              .catch(() => undefined)
              .finally(() => orig(...args));
          };
        }
      } catch {
        /* soft */
      }
    }
    return () => {
      void import('./src/services/AudioVoiceService')
        .then((m) => m.stopSpeaking())
        .catch(() => undefined);
      if (!__DEV__) return;
      void import('./src/db/database')
        .then((m) => m.closeFindusDatabase())
        .catch(() => undefined);
    };
  }, []);

  const boot = useCallback(async () => {
    if (bootInFlight.current) return bootInFlight.current;
    setBootReady(false);
    setError(null);
    const run = (async () => {
    try {
      // Warmup parallel — Boot/UI nicht auf Extract/Disk warten.
      const warm = warmupHomeMapDuringIntro();
      await Promise.race([warm, new Promise((r) => setTimeout(r, 300))]);
      let dbErr: unknown;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await initDatabase();
          dbErr = null;
          break;
        } catch (err) {
          dbErr = err;
          const locked =
            /database is locked|finalizeAsync|SQLITE_BUSY|Error code 5/i.test(
              String(err ?? ''),
            );
          if (!locked || attempt === 3) throw err;
          console.warn(
            `[app] SQLite locked — retry ${attempt + 1}/3 after Soft-Reload…`,
          );
          try {
            const { closeFindusDatabase } = await import('./src/db/database');
            await closeFindusDatabase();
          } catch {
            /* soft */
          }
          // Drop any stale global init promise from the failed attempt.
          (globalThis as { __findusDbInitPromise?: null }).__findusDbInitPromise =
            null;
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
      if (dbErr) throw dbErr;

      noteSplashStarted();
      const existing = await loadUserProfile();
      let resolved = existing;
      if (!profileHasFinishedSetup(resolved)) {
        try {
          const { refreshAuthSession } = await import(
            './src/services/account/findusAuth'
          );
          const { pullUserCloudOnLogin } = await import(
            './src/services/account/userCloudSync'
          );
          const user = await refreshAuthSession();
          if (user) {
            await pullUserCloudOnLogin();
            resolved = await loadUserProfile();
          }
        } catch {
          /* soft — weiter mit lokalem Profil */
        }
      }
      if (profileHasFinishedSetup(resolved) && resolved) {
        const restored = {
          ...resolved,
          setupComplete: true as const,
          firstMapWelcomeDone: true,
          completedAt: resolved.completedAt ?? new Date().toISOString(),
        };
        if (
          !resolved.setupComplete ||
          !resolved.firstMapWelcomeDone
        ) {
          await saveUserProfile(restored);
        }
        setProfile(restored);
        setBootVoiceId(restored.voiceId ?? 'alina');
        setTargetPhase('ready');
        // Pack-Sync nach Interactive Window — nicht mit Mic kämpfen
      } else if (existing?.setupComplete) {
        setProfile(existing);
        setTargetPhase('ready');
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
        noteSplashSkipMap();
      }
      noteSplashBootMinimal();
      setBootReady(true);

      // Mic + Overlays + lokale POIs sofort — nicht hinter Interactive Window.
      void warmMicrophonePipeline().catch(() => undefined);
      scheduleIdleUiPrefetch();
      void (async () => {
        try {
          const pois = await getAllPois();
          setPois(pois);
        } catch (err) {
          console.warn('[app] early pois:', err);
        }
      })();
      void import('./src/services/homeMap/mapPinIndex')
        .then((m) => {
          const cityId =
            resolved?.cityId || existing?.cityId || null;
          return m.warmNearbyPinIndexes({
            activeCityId: cityId,
            lat: null,
            lng: null,
          });
        })
        .catch(() => undefined);
      // Timeline-Persist früh (Leeren/Close brauchen State) — leicht, mit Yield.
      void import('./src/module2/timeline/planPersistence')
        .then(async (m) => {
          await m.hydratePlanTimeline();
          m.startPlanTimelinePersistWatchers();
        })
        .catch(() => undefined);

      const deferredCityId =
        (resolved?.cityId || existing?.cityId || undefined) ?? undefined;

      void (async () => {
        try {
          await waitUntilInteractiveSettled();
          runHydrateWhenFree(() => {
            void runHydrateSteps([
              () => {
                syncPOIsInBackground(deferredCityId);
              },
              () => initDictionaryEngine(),
              () => initMultilingualPhoneticEngine(),
              () => useUserMemoryStore.getState().hydrate(),
              () => useShoppingTaskStore.getState().hydrate(),
              () => useTripModeStore.getState().hydrate(),
              () => useReservationMemoryStore.getState().hydrate(),
              () => useSessionPlanStore.getState().hydrate(),
              () => useLogisticsTriggerStore.getState().hydrate(),
              async () => {
                try {
                  const { hydratePaceProfile, setPaceChangeListener } =
                    await import('./src/services/mobility/paceProfile');
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
              },
              async () => {
                const { hydrateMuteSession } = await import(
                  './src/services/audio/muteSessionService'
                );
                await hydrateMuteSession();
              },
              async () => {
                const stampEntries = await loadStampPassport();
                if (stampEntries.length > 0) {
                  useFinnusStore.setState({ visitedHistory: stampEntries });
                }
                try {
                  const { hydrateVisitLog, importStampsIntoVisitLog } =
                    await import('./src/services/timeline/visitLog');
                  await hydrateVisitLog();
                  importStampsIntoVisitLog(stampEntries, (poiId) => {
                    const p = useFinnusStore
                      .getState()
                      .pois.find((x) => x.id === poiId);
                    return p &&
                      Number.isFinite(p.lat) &&
                      Number.isFinite(p.lng)
                      ? { lat: p.lat, lng: p.lng }
                      : null;
                  });
                } catch {
                  /* soft */
                }
              },
              async () => {
                try {
                  const { hydrateFlightWatches } = await import(
                    './src/services/flights/flightWatchService'
                  );
                  const { hydrateFlightTripSession } = await import(
                    './src/services/flights/flightTripSession'
                  );
                  await hydrateFlightTripSession();
                  await hydrateFlightWatches();
                } catch {
                  /* soft */
                }
              },
              () => loadFeatureTipState(),
              () => hydrateAffiliateRedirectAck(),
              () => {
                ensureUserProfileStoreSync();
                syncDictionaryInBackground();
              },
              async () => {
                // POIs nochmal nach Sync (falls Sync schon fertig)
                const pois = await getAllPois();
                setPois(pois);
              },
            ]).catch((err) => {
              console.warn('[app] deferred hydrate:', err);
            });
          });
        } catch (err) {
          console.warn('[app] idle hydrate gate:', err);
        }
      })();
    } catch (err) {
      console.error('[app] boot failed:', err);
      const raw = err instanceof Error ? err.message : 'Unbekannter Fehler';
      const locked =
        /database is locked|finalizeAsync|SQLITE_BUSY|Error code 5/i.test(raw);
      setError(
        locked
          ? 'Datenbank gesperrt (Soft-Reload). App einmal Force-Stoppen und neu öffnen.'
          : raw,
      );
      setTargetPhase('error');
      noteSplashSkipMap();
      noteSplashBootMinimal();
      setBootReady(true);
    }
    })();
    bootInFlight.current = run.finally(() => {
      bootInFlight.current = null;
    });
    return bootInFlight.current;
  }, [setPois]);

  useEffect(() => {
    bootstrapCartesiaCostTracker();
    void boot();
  }, [boot]);

  useEffect(() => {
    const stopTelemetry = initFeedbackTelemetry();
    const stopResources = __DEV__ ? startResourceUsageMonitor() : () => undefined;
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
    bootstrapTravelAlertTapHandler();
    bootstrapTaskReminderTapHandler();
  }, []);

  useEffect(() => {
    const unsub = subscribeUserProfile((next) => {
      if (next?.setupComplete) setProfile(next);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (splashDone) return;
    noteSplashMapWarmup(8_000);
  }, [splashDone]);

  useEffect(() => {
    if (phase === 'error') return;
    if (!bootReady) return;
    // setupComplete schlägt ein veraltetes targetPhase=onboarding
    // (sonst nach QA-Skip / Abschluss sofort wieder Einrichtung).
    if (profile?.setupComplete) {
      if (splashDone && phase !== 'ready') setPhase('ready');
      return;
    }
    if (!splashDone) return;
    setPhase(targetPhase);
  }, [bootReady, splashDone, targetPhase, profile?.setupComplete, phase]);

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
        const { warmSoftWorkingCity, setSoftWorkingCity } = await import(
          './src/services/softWorkingCity'
        );
        const soft = await warmSoftWorkingCity();
        if (!soft && profile.cityId && profile.cityName) {
          await setSoftWorkingCity({
            id: profile.cityId,
            name: profile.cityName,
            lat: null,
            lng: null,
            soft: /^soft_/i.test(profile.cityId),
            source: /^soft_/i.test(profile.cityId) ? 'gps_soft' : 'pack_focus',
          });
        }
      } catch {
        /* soft */
      }
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
  }, [phase, profile?.setupComplete, profile?.cityId, profile?.cityName]);

  useEffect(() => {
    // QA: Fast-path in Dev — Profil mit setupComplete, damit Device-Tests nicht im Onboarding hängen
    if (!__DEV__) return;
    if (phase !== 'onboarding') return;
    void (async () => {
      try {
        const flag = (globalThis as { __findusQaSkipOnboarding?: boolean })
          .__findusQaSkipOnboarding;
        const existing = await loadUserProfile();
        if (existing?.setupComplete) return;
        if (flag === false) return;
        const next: UserProfile = {
          ...createDefaultProfile(),
          setupComplete: true,
          firstMapWelcomeDone: true,
          cityId: 'prisdorf',
          cityName: 'Prisdorf',
          hasAcceptedPrivacyPolicy: true,
          privacyAcceptedAt: new Date().toISOString(),
          micListenMode: 'hear',
          onboardingMode: 'express',
          accountMode: 'guest',
          completedAt: new Date().toISOString(),
        };
        const saved = await saveUserProfile(next);
        try {
          const { markFirstMapWelcomeDone } = await import(
            './src/services/onboarding/firstMapWelcomeService'
          );
          await markFirstMapWelcomeDone(saved);
        } catch {
          /* soft */
        }
        setProfile(saved);
        setTargetPhase('ready');
        setPhase('ready');
        if (saved.cityId) {
          syncPOIsInBackground(saved.cityId);
        }
        console.log('[qa] skipped onboarding for device tests');
      } catch (err) {
        console.warn('[qa] skip onboarding failed', err);
      }
    })();
  }, [phase]);

  useEffect(() => {
    console.log('[boot] phase=', phase, '__DEV__=', __DEV__, 'setup=', !!profile?.setupComplete);
    // Geräte-QA Ask-Poller (adb reverse :8791) — auch Release, offline = silent.
    void import('./src/services/handsFree/devAskPoller').then((m) => {
      m.startDevAskPoller();
    });
    return () => {
      void import('./src/services/handsFree/devAskPoller').then((m) => {
        m.stopDevAskPoller();
      });
    };
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
    void import('./src/services/ui/idlePrefetch').then((m) =>
      m.scheduleIdleUiPrefetch(),
    );
    bootstrapWelcomeBackAppState();
    void (async () => {
      await waitUntilInteractiveSettled();
      runHydrateWhenFree(() => {
        void import('./src/services/cityCoverCache')
          .then((m) => m.hydrateCityCoverCache())
          .catch(() => undefined);
        void import('./src/services/cityPackMorningSync')
          .then((m) => m.bootstrapCityPackMorningSync())
          .catch(() => undefined);
        void import('./src/services/research/ambientEventPitch')
          .then((m) => m.bootstrapAmbientEventPitch())
          .catch(() => undefined);
      });
    })();
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

      await waitUntilInteractiveSettled();
      const { peekInteractiveBootGate } = await import(
        './src/services/boot/interactiveBootGate'
      );
      if (peekInteractiveBootGate().micActive) return;

      const { maybeSpeakFirstMapWelcome } = await import(
        './src/services/onboarding/firstMapWelcomeService'
      );
      const didFirst = await maybeSpeakFirstMapWelcome(profile);
      if (!didFirst) {
        await maybeSpeakWelcomeBack();
      }
      try {
        const { bootstrapColdStartCityCheck } = await import(
          './src/services/cityProximityService'
        );
        bootstrapColdStartCityCheck();
      } catch {
        /* soft */
      }
    })();
  }, [phase, profile]);

  const handleOnboardingComplete = async (next: UserProfile) => {
    const saved = await saveUserProfile(next);
    setProfile(saved);
    setTargetPhase('ready');
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
    setTargetPhase('onboarding');
    setPhase('onboarding');
    startVoiceBuffer({ speechRate: 1, priorityVoiceId: 'alina' });
    void prefetchOnboardingAudioBundle(INTRO_WELCOME_DE, 1);
  };

  const handleSplashFinish = useCallback(() => {
    setSplashDone(true);
    markSplashInteractive();
    void warmMicrophonePipeline().catch(() => undefined);
    // Pin-Index früh für atomaren Places-Reveal
    void import('./src/services/homeMap/mapPinIndex')
      .then((m) => {
        const { getCachedUserProfile } = require('./src/services/userProfileService') as {
          getCachedUserProfile: () => { cityId?: string | null } | null;
        };
        const { useGpsStore } = require('./src/store/useGpsStore') as {
          useGpsStore: { getState: () => { lat: number | null; lng: number | null } };
        };
        const cityId = getCachedUserProfile()?.cityId ?? null;
        const { lat, lng } = useGpsStore.getState();
        return m.warmNearbyPinIndexes({
          activeCityId: cityId,
          lat,
          lng,
        });
      })
      .catch(() => undefined);
    void getNetworkStateAsync().then((state) => {
      if (state.type === 'WIFI') {
        void prefetchVoiceSamples(bootVoiceId);
        try {
          const { prefetchCommonLatencyAcks } = require('./src/services/speech/floskelEngine') as {
            prefetchCommonLatencyAcks: () => void;
          };
          prefetchCommonLatencyAcks();
        } catch {
          /* soft */
        }
      }
    });
  }, [bootVoiceId]);

  const showHome =
    !!profile?.setupComplete &&
    bootReady &&
    (targetPhase === 'ready' || phase === 'ready');

  let content: React.ReactNode = null;

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
  } else if (showHome && profile) {
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
  }

  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <View style={styles.root}>
          {content}
          {!splashDone ? (
            <View style={styles.splashOverlay} pointerEvents="auto">
              <SplashScreenController
                onFinish={handleSplashFinish}
                priorityVoiceId={bootVoiceId}
              />
            </View>
          ) : null}
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
  splashOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay,
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
