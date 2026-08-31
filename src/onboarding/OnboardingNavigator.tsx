import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Chip,
  OnboardingDensityProvider,
  OnboardingShell,
  PrimaryButton,
  SecondaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import { NamePronunciationEditor } from '../components/settings/NamePronunciationEditor';
import { AktuelleReiseEditor } from '../components/settings/AktuelleReiseEditor';
import { AgeLifeSlider } from './AgeLifeSlider';
import { AudioWave } from '../components/AudioWave';
import { SubtitlesSlot } from '../components/liveStage/SubtitlesSlot';
import { SpeechMicButton } from '../components/SpeechMicButton';
import { colors, spacing } from '../constants/theme';
import {
  ACCESSIBILITY_NEED_OPTIONS,
  ALLERGY_INTOLERANCE_OPTIONS,
  BUDGET_OPTIONS,
  DIETARY_OPTIONS,
  ENERGY_OPTIONS,
  TAXI_PREF_OPTIONS,
  TRAVEL_MODE_OPTIONS,
} from '../constants/conciergePrefs';
import { EqualChipRow } from '../components/EqualChipRow';
import {
  TRAVEL_PERIOD_PRESETS,
  matchTravelPeriodPreset,
  type TravelPeriodPreset,
} from '../constants/travelPeriod';
import { Audio } from 'expo-av';
import {
  defaultVoiceForLanguage,
  voicesForLanguage,
} from '../constants/voices';
import { VoiceSelectorList } from '../components/VoiceSelectorList';
import {
  CHARACTER_CATEGORIES,
  EXPERIENCE_CARDS,
  type ExperienceCard,
} from '../constants/onboardingOptions';
import {
  INTRO_WELCOME_DE,
  t,
  voiceLabel,
  type ExplanationHint,
} from '../i18n';
import { markFirstMapWelcomeDone } from '../services/onboarding/firstMapWelcomeService';
import { runPostExplanationCityWelcome } from '../services/cityWelcomeService';
import {
  buildGuidedFeatureTourSegments,
  cityDemoPack,
  createExplanationSpeechCursor,
  explanationSegmentHoldMs,
  explanationSpeechChunkStream,
  POST_EXPLANATION_SETTLE_MS,
} from '../services/onboarding/guidedFeatureTour';
import { GuidedFeatureTourOverlays } from './GuidedFeatureTourOverlays';
import { ensureWeatherFresh } from '../services/weatherService';
import type {
  AppLanguage,
  SwipePreference,
  UserProfile,
  VoiceId,
} from '../types/userProfile';
import type { SpleenId } from '../constants/personalityMatrix';
import { uiLang } from '../types/userProfile';
import {
  speakText,
  speakSentenceStream,
  stopSpeaking,
  speakOnboardingIntro,
  prefetchOnboardingAudioBundle,
  prefetchVoiceSamples,
  prepareOnboardingVoiceSamples,
  playVoiceSample,
  isVoiceSampleReady,
  warmupTtsEngine,
  startVoiceBuffer,
  voicePreloader,
} from '../services/ttsService';
import { useFinnusStore } from '../store/useFinnusStore';
import { useHomeMapUiStore } from '../store/useHomeMapUiStore';
import {
  startListening,
  stopListening,
  isSttAvailable,
} from '../services/sttService';
import { getCachedUserProfile, saveUserProfile } from '../services/userProfileService';
import { appendSpeechSegment } from '../utils/speechText';
import { showPermissionMissingAlert } from '../utils/permissionAlerts';
import { SwipeBackView } from '../components/SwipeBackView';
import { PlayPauseIcon } from '../components/PlayPauseIcon';
import { Header } from '../components/Header';
import { HomeDockBar } from '../components/HomeDockBar';
import { MicButton } from '../components/MicButton';
import { PlanCalendarModal } from '../components/PlanCalendarModal';
import { PlaceSeekSheet } from '../components/PlaceSeekSheet';
import { HomePresenceMap } from '../components/homeMap/HomePresenceMap';
import { HomeMapPlacePopup } from '../components/homeMap/HomeMapPlacePopup';
import { SettingsScreen } from '../screens/SettingsScreenLazy';
import { UI_LAYER } from '../constants/uiLayers';
import { useSystemSafePad } from '../hooks/useSystemSafePad';
import {
  HOME_DOCK_BAR_H,
  HOME_MIC_DOCK_GAP,
  HOME_MIC_HINT_RESERVE,
} from '../components/liveStage';
import { PathChoiceStep } from './PathChoiceStep';
import { ExpressSetupStep } from './ExpressSetupStep';
import { MicConsentStep } from './MicConsentStep';
import { LanguageStep } from './LanguageStep';
import { AuthGateStep } from './AuthGateStep';
import { PersonalityMatrixStep } from './PersonalityMatrixStep';
import { OnboardingInfoSheet } from './OnboardingInfoSheet';
import { CityStep } from './CityStep';
import { warmCityCatalogForOnboarding } from '../services/cityCatalogService';
import type { OnboardingMode, TravelParty, MobilityPrefs } from '../types/userProfile';
import { profileHasFinishedSetup } from '../types/userProfile';
import type { BudgetCategory, EnergyLevel } from '../types/userProfile';
import { useFuturePlanStore } from '../module2/timeline/futurePlanState';
import { todayDateKey } from '../utils/dateKeys';
import { resolveVoiceForPersonality } from '../services/persona/personalityVoiceMap';
import {
  sendMagicLink,
  signInWithGoogle,
  signInWithApple,
  mergeAuthIntoProfile,
  refreshAuthSession,
  subscribeAuthRedirects,
  signOutAuth,
  getLastAuthUser,
  type AuthSessionUser,
} from '../services/account/findusAuth';

type FlowStep =
  | 'language'
  | 'intro'
  | 'path'
  | 'auth'
  | 'mic'
  | 'express'
  | 'voice'
  | 'about'
  | 'character'
  | 'city'
  | 'experience'
  | 'summary';

const EXPRESS_FLOW: FlowStep[] = [
  'language',
  'intro',
  'path',
  'auth',
  'city',
  'mic',
  'express',
  'summary',
];
const STANDARD_FLOW: FlowStep[] = [
  'language',
  'intro',
  'path',
  'auth',
  'about',
  'city',
  'mic',
  'character',
  'voice',
  'experience',
  'summary',
];

function socialToTravelParty(id: string | undefined): TravelParty {
  switch (id) {
    case 'familie':
      return 'family';
    case 'date':
      return 'date';
    case 'zu_zweit':
      return 'couple';
    case 'freundesgruppe':
      return 'friends';
    default:
      return 'solo';
  }
}

type Props = {
  draft: UserProfile;
  setDraft: React.Dispatch<React.SetStateAction<UserProfile>>;
  onComplete: (profile: UserProfile) => void;
  initialStep?: number;
};

export function OnboardingNavigator({
  draft,
  setDraft,
  onComplete,
}: Props) {
  const [mode, setMode] = useState<OnboardingMode | null>(
    draft.onboardingMode ?? null,
  );
  const [flowIndex, setFlowIndex] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthSessionUser | null>(
    () => getLastAuthUser(),
  );

  const flow = mode === 'express' ? EXPRESS_FLOW : STANDARD_FLOW;
  const step = flow[Math.min(flowIndex, flow.length - 1)] ?? 'path';

  const completeRestoredProfile = useCallback(
    (p: import('../types/userProfile').UserProfile) => {
      onComplete({
        ...p,
        language: 'de',
        setupComplete: true,
        firstMapWelcomeDone: true,
        accountMode: 'registered',
        completedAt: p.completedAt ?? new Date().toISOString(),
      });
    },
    [onComplete],
  );

  const restoreFinishedAccount = useCallback(
    async (u: AuthSessionUser): Promise<boolean> => {
      setAuthUser(u);
      setDraft((d) => ({
        ...d,
        ...mergeAuthIntoProfile(d, u),
        accountMode: 'registered',
      }));
      setAuthStatus(
        u.email
          ? `Angemeldet als ${u.email}`
          : 'Konto bestätigt — du kannst weiter.',
      );
      try {
        const { pullUserCloudOnLogin } = await import(
          '../services/account/userCloudSync'
        );
        await pullUserCloudOnLogin();
      } catch {
        /* soft */
      }
      const p = getCachedUserProfile();
      if (!profileHasFinishedSetup(p) || !p) return false;
      completeRestoredProfile(p);
      return true;
    },
    [completeRestoredProfile],
  );

  const applyAuthUser = useCallback(
    (u: AuthSessionUser, advance: boolean) => {
      void restoreFinishedAccount(u).then((done) => {
        if (done || !advance) return;
        setFlowIndex((idx) => {
          if (EXPRESS_FLOW[idx] === 'auth' || STANDARD_FLOW[idx] === 'auth') {
            return idx + 1;
          }
          return idx;
        });
      });
    },
    [restoreFinishedAccount],
  );

  const patch = (p: Partial<UserProfile>) =>
    setDraft((d) => ({ ...d, ...p }));

  const persist = async (next: UserProfile) => {
    if (profileHasFinishedSetup(getCachedUserProfile())) return;
    await saveUserProfile({ ...next, setupComplete: false });
  };

  const lang: AppLanguage = 'de';

  useEffect(() => {
    if (draft.language !== 'de' || !draft.voiceId) {
      patch({
        language: 'de',
        voiceId: draft.voiceId || defaultVoiceForLanguage('de'),
      });
    }
    // Früh warmen: Stadt-Katalog + Stimmen, noch bevor City/Voice-Screens kommen
    void warmCityCatalogForOnboarding();
    void prepareOnboardingVoiceSamples({
      priorityVoiceId: draft.voiceId || 'sebastian',
    });
    void refreshAuthSession().then((u) => {
      if (!u) return;
      applyAuthUser(u, false);
    });
    return subscribeAuthRedirects((u) => {
      applyAuthUser(u, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zurück auf Auth-Step: bestehende Session wieder erkennen
  useEffect(() => {
    if (step !== 'auth') return;
    void refreshAuthSession().then((u) => {
      if (u) applyAuthUser(u, false);
    });
  }, [step, applyAuthUser]);

  const finish = (override?: Partial<UserProfile>) => {
    void stopSpeaking();
    onComplete({
      ...draft,
      ...override,
      language: 'de',
      setupComplete: true,
      firstMapWelcomeDone: true,
      completedAt: override?.completedAt ?? draft.completedAt ?? new Date().toISOString(),
      onboardingMode: mode ?? override?.onboardingMode ?? 'standard',
    });
  };

  const goNext = (override?: Partial<UserProfile>) => {
    void stopSpeaking();
    const next = { ...draft, ...override, language: 'de' as const };
    if (override) setDraft(next);
    void persist(next);
    const nextIndex = Math.min(flowIndex + 1, flow.length - 1);
    const nextStep = flow[nextIndex];
    if (
      nextStep === 'summary' &&
      (profileHasFinishedSetup(getCachedUserProfile()) || next.firstMapWelcomeDone)
    ) {
      finish(next);
      return;
    }
    // Stadt/Stimmen schon warmen, bevor der Screen kommt — kein sichtbarer GPS-Sprung
    if (
      nextStep === 'city' ||
      nextStep === 'about' ||
      nextStep === 'auth' ||
      nextStep === 'intro' ||
      nextStep === 'path'
    ) {
      void warmCityCatalogForOnboarding();
    }
    if (nextStep === 'voice' || nextStep === 'character' || nextStep === 'city') {
      void prepareOnboardingVoiceSamples({
        priorityVoiceId: next.voiceId || 'sebastian',
      });
      void prefetchVoiceSamples(next.voiceId || 'sebastian');
    }
    // Erklärung: Stimme + Wetter schon warm, bevor der Screen mountet
    if (nextStep === 'summary') {
      const voiceId = next.voiceId;
      void warmupTtsEngine({ voiceId });
      void startVoiceBuffer({ speechRate: 1, priorityVoiceId: voiceId });
      void prepareOnboardingVoiceSamples({ priorityVoiceId: voiceId });
      void ensureWeatherFresh('open');
    }
    setFlowIndex(nextIndex);
  };

  const goBack = () => {
    void stopSpeaking();
    if (flowIndex <= 0) return;
    const prevStep = flow[flowIndex - 1];
    // Von Einrichtung zurück → Modus zurücksetzen
    if (step === 'path') {
      setMode(null);
      setFlowIndex(Math.max(0, flowIndex - 1));
      return;
    }
    if (prevStep === 'path') {
      setMode(null);
    }
    setFlowIndex((i) => Math.max(0, i - 1));
  };

  const choosePath = (nextMode: OnboardingMode) => {
    void prefetchOnboardingAudioBundle(INTRO_WELCOME_DE);
    void prepareOnboardingVoiceSamples({
      priorityVoiceId: 'sebastian',
    });
    // Katalog + GPS schon während Auth/About — City-Screen ohne Resort-Sprung
    void warmCityCatalogForOnboarding();
    setMode(nextMode);
    const next = {
      ...draft,
      onboardingMode: nextMode,
      language: 'de' as const,
      voiceId: draft.voiceId || defaultVoiceForLanguage('de'),
      speechRate: 1 as const,
      // Standard: nichts vorauswählen. Express: Rolle+Preset später wählen.
      ...(nextMode === 'standard'
        ? {
            coreRole: null,
            vibeTone: null,
            knowledgeStyle: null,
            spleens: [] as SpleenId[],
          }
        : {}),
    };
    setDraft(next);
    void persist(next);
    const nextFlow = nextMode === 'express' ? EXPRESS_FLOW : STANDARD_FLOW;
    const authIdx = nextFlow.indexOf('auth');
    setFlowIndex(authIdx >= 0 ? authIdx : flowIndex + 1);
  };

  const openOAuth = async (provider: 'google' | 'apple') => {
    setAuthBusy(true);
    setAuthStatus(null);
    try {
      const res =
        provider === 'apple'
          ? await signInWithApple()
          : await signInWithGoogle();
      if (res.ok && res.user) {
        const restored = await restoreFinishedAccount(res.user);
        if (restored) return;
        goNext({
          accountMode: 'registered',
          ...mergeAuthIntoProfile(draft, res.user),
        });
        return;
      }
      setAuthStatus(
        res.error ?? 'Anmeldung abgebrochen oder fehlgeschlagen.',
      );
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <View style={styles.safe}>
      <OnboardingDensityProvider age={draft.age}>
      <SwipeBackView
        enabled={flowIndex > 0 && step !== 'summary'}
        captureHardwareBack={flowIndex > 0 && step !== 'summary'}
        onBack={goBack}
      >
        {step === 'path' && <PathChoiceStep onChoose={choosePath} />}

        {step === 'language' && (
          <LanguageStep
            selected={draft.language}
            onSelect={(language) => patch({ language })}
            onNext={() => goNext({ language: 'de' })}
          />
        )}

        {step === 'auth' && (
          <AuthGateStep
            busy={authBusy}
            statusMessage={authStatus}
            isSignedIn={!!authUser}
            signedInEmail={authUser?.email ?? draft.email ?? null}
            onContinueSignedIn={() => {
              void (async () => {
                if (authUser) {
                  const restored = await restoreFinishedAccount(authUser);
                  if (restored) return;
                }
                goNext({
                  accountMode: 'registered',
                  ...(authUser ? mergeAuthIntoProfile(draft, authUser) : {}),
                });
              })();
            }}
            onSwitchAccount={() => {
              setAuthBusy(true);
              void signOutAuth()
                .then(() => {
                  setAuthUser(null);
                  setAuthStatus(null);
                  patch({ accountMode: 'guest', email: '' });
                })
                .finally(() => setAuthBusy(false));
            }}
            onGuest={() => goNext({ accountMode: 'guest' })}
            onMagicLink={(email) => {
              setAuthBusy(true);
              void sendMagicLink(email).then((r) => {
                setAuthBusy(false);
                setAuthStatus(
                  r.ok
                    ? 'Magic Link gesendet. Tippe den Link in der Mail — Yorro öffnet sich danach von selbst.'
                    : r.error ?? 'Fehler',
                );
                if (r.ok) {
                  patch({ email, accountMode: 'registered' });
                }
              });
            }}
            onGoogle={() => void openOAuth('google')}
            onApple={() => void openOAuth('apple')}
          />
        )}

        {step === 'express' && (
          <ExpressSetupStep
            draft={draft}
            onChange={patch}
            onNext={(override) => goNext(override)}
          />
        )}

        {step === 'intro' && (
          <IntroStep lang={lang} onNext={goNext} onSkip={goNext} />
        )}

        {step === 'voice' && (
          <VoiceStep
            lang={lang}
            voiceId={draft.voiceId}
            recommendedVoiceId={resolveVoiceForPersonality({
              coreRole: draft.coreRole,
              vibeTone: draft.vibeTone,
              knowledgeStyle: draft.knowledgeStyle,
              spleens: draft.spleens,
              gender: draft.gender,
            })}
            onChangeVoice={(voiceId) => {
              setDraft((d) => {
                const next = {
                  ...d,
                  voiceId,
                  speechRate: 1 as const,
                  voicePinnedByUser: true,
                };
                void persist(next);
                return next;
              });
              void voicePreloader.switchActiveVoice(voiceId);
            }}
            onNext={goNext}
          />
        )}

        {step === 'about' && (
          <AboutYouStep
            lang={lang}
            draft={draft}
            onChange={patch}
            onNext={goNext}
          />
        )}

        {step === 'character' && (
          <PersonalityMatrixStep
            coreRole={draft.coreRole ?? null}
            vibeTone={draft.vibeTone ?? null}
            knowledgeStyle={draft.knowledgeStyle ?? null}
            spleens={draft.spleens ?? []}
            onChange={(p) => {
              const nextRole = p.coreRole !== undefined ? p.coreRole : draft.coreRole;
              const nextVibe = p.vibeTone !== undefined ? p.vibeTone : draft.vibeTone;
              const nextKnow =
                p.knowledgeStyle !== undefined
                  ? p.knowledgeStyle
                  : draft.knowledgeStyle;
              const nextSpleens =
                p.spleens !== undefined ? p.spleens : draft.spleens;
              const voicePatch =
                draft.voicePinnedByUser
                  ? {}
                  : {
                      voiceId: resolveVoiceForPersonality({
                        coreRole: nextRole,
                        vibeTone: nextVibe,
                        knowledgeStyle: nextKnow,
                        spleens: nextSpleens,
                        gender: draft.gender,
                      }),
                    };
              patch({ ...p, ...voicePatch });
            }}
            onNext={() => {
              if (!draft.voicePinnedByUser) {
                const voiceId = resolveVoiceForPersonality({
                  coreRole: draft.coreRole,
                  vibeTone: draft.vibeTone,
                  knowledgeStyle: draft.knowledgeStyle,
                  spleens: draft.spleens,
                  gender: draft.gender,
                });
                goNext({ voiceId, voicePinnedByUser: false });
                return;
              }
              goNext();
            }}
            onInfo={undefined}
          />
        )}

        {step === 'city' && (
          <CityStep
            lang={lang}
            selectedId={draft.cityId}
            onSelect={(cityId, cityName) => patch({ cityId, cityName })}
            onNext={(city) =>
              goNext({
                cityId: city.cityId,
                cityName: city.cityName,
              })
            }
          />
        )}

        {step === 'experience' && (
          <ExperienceStep
            lang={lang}
            draft={draft}
            onChange={patch}
            onNext={goNext}
          />
        )}

        {step === 'mic' && (
          <MicConsentStep
            draft={draft}
            onChange={patch}
            onNext={goNext}
          />
        )}

        {step === 'summary' && (
          <SummaryIntroStep
            draft={draft}
            onFinished={() => finish()}
            onSetVoiceId={(voiceId) => {
              const next: UserProfile = {
                ...draft,
                language: 'de',
                voiceId,
                speechRate: 1 as const,
                voicePinnedByUser: true,
              };
              patch({
                voiceId,
                speechRate: 1 as const,
                language: 'de',
                voicePinnedByUser: true,
              });
              void persist(next);
              void voicePreloader.switchActiveVoice(voiceId);
            }}
          />
        )}
      </SwipeBackView>
      </OnboardingDensityProvider>
    </View>
  );
}

function IntroStep({
  lang,
  onNext,
  onSkip,
}: {
  lang: AppLanguage;
  onNext: () => void;
  onSkip: () => void;
}) {
  const isPlaying = useFinnusStore((s) => s.isAudiblySpeaking);
  const subtitleText = useFinnusStore((s) => s.subtitleText);
  const doneRef = useRef(false);
  const onNextRef = useRef(onNext);
  const onSkipRef = useRef(onSkip);
  onNextRef.current = onNext;
  onSkipRef.current = onSkip;

  useEffect(() => {
    // Während Intro: Hörproben + Stadt-Katalog vorladen (Packs/Stats), bevor City-Screen kommt
    void prepareOnboardingVoiceSamples({
      priorityVoiceId: 'sebastian',
    });
    void warmCityCatalogForOnboarding();
    return () => {
      useFinnusStore.getState().setSubtitleText(null);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    doneRef.current = false;

    (async () => {
      // Parallel zum TTS: Städte weiter vorwärmen (falls Mount-Warmup noch läuft)
      void warmCityCatalogForOnboarding();
      try {
        await speakOnboardingIntro({ fullText: INTRO_WELCOME_DE });
      } catch (err) {
        console.warn('[onboarding] Intro-TTS:', err);
      }
      // Nach Intro: Samples fertigstellen, bevor Stimmen-Schritt kommt
      try {
        await prepareOnboardingVoiceSamples({
          priorityVoiceId: 'sebastian',
        });
      } catch {
        // trotzdem weiter
      }
      if (cancelled || doneRef.current) return;
      await new Promise((r) => setTimeout(r, 800));
      if (cancelled || doneRef.current) return;
      doneRef.current = true;
      useFinnusStore.getState().setSubtitleText(null);
      onNextRef.current();
    })();

    return () => {
      cancelled = true;
      void stopSpeaking();
    };
  }, []);

  return (
    <OnboardingShell style={styles.introShell}>
      <View style={styles.introMain}>
        <AudioWave mood={isPlaying ? 'speaking' : 'idle'} />
        <View style={styles.introSubtitles} pointerEvents="none">
          {subtitleText?.trim() ? (
            <SubtitlesSlot text={subtitleText} />
          ) : null}
        </View>
      </View>
      <SecondaryButton
        label={t(lang, 'skipIntro')}
        onPress={() => {
          doneRef.current = true;
          useFinnusStore.getState().setSubtitleText(null);
          void prepareOnboardingVoiceSamples({
            priorityVoiceId: 'sebastian',
          });
          void stopSpeaking().then(() => onSkipRef.current());
        }}
      />
    </OnboardingShell>
  );
}

function VoiceStep({
  lang,
  voiceId,
  recommendedVoiceId,
  onChangeVoice,
  onNext,
}: {
  lang: AppLanguage;
  voiceId: VoiceId;
  recommendedVoiceId?: VoiceId;
  onChangeVoice: (id: VoiceId) => void;
  onNext: () => void;
}) {
  const voices = voicesForLanguage(lang);

  useEffect(() => {
    if (!voices.some((v) => v.id === voiceId)) {
      onChangeVoice(defaultVoiceForLanguage(lang));
    }
  }, [lang, voiceId, voices, onChangeVoice]);

  return (
    <OnboardingShell>
      <StepTitle>{t(lang, 'voiceTitle')}</StepTitle>
      <Text style={{ color: colors.textMuted, marginBottom: 12, fontSize: 13 }}>
        Play = Offline-Hörprobe. Tippen auf den Namen wählt deine Stimme.
        {recommendedVoiceId
          ? ` Empfehlung zu deiner Kombi: ${recommendedVoiceId}.`
          : ''}
      </Text>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <VoiceSelectorList
          selectedVoiceId={voiceId}
          onSelectVoice={onChangeVoice}
          onAfterSelect={(id) => {
            void voicePreloader.switchActiveVoice(id);
          }}
        />
      </ScrollView>
      <PrimaryButton label={t(lang, 'continue')} onPress={onNext} />
    </OnboardingShell>
  );
}

function AboutMeVoiceField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const baseRef = useRef(value);

  useEffect(() => {
    if (!listening) baseRef.current = value;
  }, [value, listening]);

  const toggle = async () => {
    if (listening) {
      setListening(false);
      const final = await stopListening({ finalizeMs: 400 });
      const next = appendSpeechSegment(baseRef.current, final || partial);
      onChange(next.trim());
      setPartial('');
      return;
    }
    if (!(await isSttAvailable())) {
      showPermissionMissingAlert('microphone');
      return;
    }
    baseRef.current = value;
    setListening(true);
    setPartial('');
    const result = await startListening(
      (p) => {
        setPartial(p);
        onChange(appendSpeechSegment(baseRef.current, p));
      },
      { replaceActive: true },
    );
    if (!result.ok) {
      setListening(false);
      showPermissionMissingAlert('microphone');
    }
  };

  return (
    <View style={{ marginBottom: spacing.md, gap: spacing.sm }}>
      <Text style={styles.muted}>
        Tippe aufs Mikro und erzähl — Hobbies, Beruf, mit wem du unterwegs bist.
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <SpeechMicButton
          active={listening}
          onPress={() => void toggle()}
        />
        <Text style={styles.muted}>
          {listening ? 'Ich höre zu…' : 'Spracheingabe für „Über mich“'}
        </Text>
      </View>
    </View>
  );
}

function AboutAllergyBlock({
  draft,
  onChange,
}: {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
}) {
  const [allergyOpen, setAllergyOpen] = useState(() => {
    const tags = draft.allergyTags ?? [];
    return tags.some((t) => t !== 'keine');
  });

  const toggleAllergy = (id: string) => {
    const cur = (draft.allergyTags ?? []).filter((x) => x !== 'keine');
    const next = cur.includes(id)
      ? cur.filter((x) => x !== id)
      : [...cur, id];
    onChange({ allergyTags: next });
  };

  return (
    <>
      <View style={styles.chipRow}>
        {(
          [
            { id: false, label: 'Keine' },
            { id: true, label: 'Ja' },
          ] as const
        ).map((o) => {
          const on = allergyOpen === o.id;
          return (
            <Pressable
              key={String(o.id)}
              onPress={() => {
                setAllergyOpen(o.id);
                if (!o.id) onChange({ allergyTags: ['keine'] });
                else {
                  onChange({
                    allergyTags: (draft.allergyTags ?? []).filter(
                      (x) => x !== 'keine',
                    ),
                  });
                }
              }}
              style={[styles.prefChip, on && styles.prefChipOn]}
            >
              <Text style={styles.prefChipLabel}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {allergyOpen ? (
        <View style={styles.chipRow}>
          {ALLERGY_INTOLERANCE_OPTIONS.map((o) => {
            const on = (draft.allergyTags ?? []).includes(o.id);
            return (
              <Pressable
                key={o.id}
                onPress={() => toggleAllergy(o.id)}
                style={[styles.prefChip, on && styles.prefChipOn]}
              >
                <Text style={styles.prefChipLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Field
        label="Sonstiges (optional)"
        value={draft.allergies ?? ''}
        onChangeText={(allergies) => onChange({ allergies })}
      />
    </>
  );
}

function AboutAccessibilityBlock({
  draft,
  onChange,
}: {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
}) {
  return (
    <>
      <View style={styles.chipRow}>
        {(
          [
            { id: false, label: 'Nein' },
            { id: true, label: 'Ja — Details' },
          ] as const
        ).map((o) => {
          const on = !!draft.accessibilityCare === o.id;
          return (
            <Pressable
              key={String(o.id)}
              onPress={() => onChange({ accessibilityCare: o.id })}
              style={[styles.prefChip, on && styles.prefChipOn]}
            >
              <Text style={styles.prefChipLabel}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {draft.accessibilityCare ? (
        <View style={styles.chipRow}>
          {ACCESSIBILITY_NEED_OPTIONS.map((o) => {
            const on = (draft.accessibility ?? []).includes(o.id);
            return (
              <Pressable
                key={o.id}
                onPress={() => {
                  const cur = draft.accessibility ?? [];
                  onChange({
                    accessibility: on
                      ? cur.filter((x) => x !== o.id)
                      : [...cur, o.id],
                  });
                }}
                style={[styles.prefChip, on && styles.prefChipOn]}
              >
                <Text style={styles.prefChipLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </>
  );
}

function AboutYouStep({
  lang,
  draft,
  onChange,
  onNext,
}: {
  lang: AppLanguage;
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  onNext: () => void;
}) {
  const isGuest = draft.accountMode === 'guest';
  const emailOk = /@/.test(draft.email.trim());
  const phoneOk = (draft.phoneNumber ?? '').replace(/\D/g, '').length >= 6;
  const genderOk = !!draft.gender;
  const canContinue = isGuest
    ? draft.firstName.trim().length > 0
    : draft.firstName.trim().length > 0 &&
      draft.lastName.trim().length > 0 &&
      emailOk &&
      phoneOk &&
      genderOk &&
      typeof draft.age === 'number' &&
      draft.age >= 12;

  return (
    <OnboardingShell>
      <StepTitle>{t(lang, 'aboutTitle')}</StepTitle>
      <ScrollView
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
      >
        {isGuest ? (
          <Text style={[styles.muted, { marginBottom: spacing.md }]}>
            Als Gast reicht der Vorname. E-Mail und Telefon holen wir bei der
            ersten Reservierung nach.
          </Text>
        ) : null}
        <Field
          label={t(lang, 'firstName')}
          value={draft.firstName}
          onChangeText={(firstName) => onChange({ firstName })}
        />
        <NamePronunciationEditor draft={draft} onChange={onChange} />
        {!isGuest ? (
          <Field
            label={`${t(lang, 'lastName')} *`}
            value={draft.lastName}
            onChangeText={(lastName) => onChange({ lastName })}
          />
        ) : (
          <Field
            label={t(lang, 'lastName')}
            value={draft.lastName}
            onChangeText={(lastName) => onChange({ lastName })}
          />
        )}
        <Field
          label={isGuest ? t(lang, 'email') : `${t(lang, 'email')} *`}
          value={draft.email}
          onChangeText={(email) => onChange({ email })}
          keyboardType="email-address"
        />
        {!isGuest && !emailOk ? (
          <Text style={{ color: '#c45c26', fontSize: 13, marginBottom: spacing.sm }}>
            E-Mail ist Pflicht — für Konto, Reservierungen und Newsletter.
          </Text>
        ) : null}
        <Field
          label={isGuest ? 'Telefon' : 'Telefon *'}
          value={draft.phoneNumber ?? ''}
          onChangeText={(phoneNumber) => onChange({ phoneNumber })}
          keyboardType="phone-pad"
        />
        {!isGuest && !phoneOk ? (
          <Text style={{ color: '#c45c26', fontSize: 13, marginBottom: spacing.sm }}>
            Telefon ist Pflicht — damit Yorro Anrufe/Rückrufe vorbereiten kann.
          </Text>
        ) : null}
        <Text style={styles.rateLabel}>Geschlecht</Text>
        <View style={styles.chipRow}>
          {(
            [
              { id: 'female' as const, label: 'Weiblich' },
              { id: 'male' as const, label: 'Männlich' },
              { id: 'diverse' as const, label: 'Divers' },
              { id: 'unspecified' as const, label: 'Keine Angabe' },
            ] as const
          ).map((o) => {
            const on = (draft.gender ?? null) === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() => onChange({ gender: o.id })}
                style={[styles.prefChip, on && styles.prefChipOn]}
              >
                <Text style={styles.prefChipLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.rateLabel}>{t(lang, 'age')}</Text>
        <AgeLifeSlider
          age={draft.age}
          yearsLabel={t(lang, 'years')}
          onChange={(age) => onChange({ age })}
        />

        <Text style={styles.rateLabel}>Ernährung</Text>
        <View style={styles.chipRow}>
          {DIETARY_OPTIONS.filter((o) =>
            ['vegan', 'vegetarisch', 'fisch', 'glutenfrei'].includes(o.id),
          ).map((o) => {
            const on = (draft.dietaryTags ?? []).includes(o.id);
            return (
              <Pressable
                key={o.id}
                onPress={() => {
                  const cur = draft.dietaryTags ?? [];
                  onChange({
                    dietaryTags: on
                      ? cur.filter((x) => x !== o.id)
                      : [...cur, o.id],
                  });
                }}
                style={[styles.prefChip, on && styles.prefChipOn]}
              >
                <Text style={styles.prefChipLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.rateLabel}>Allergien & Unverträglichkeiten</Text>
        <AboutAllergyBlock draft={draft} onChange={onChange} />

        <Text style={styles.rateLabel}>Barriere & besondere Bedürfnisse</Text>
        <AboutAccessibilityBlock draft={draft} onChange={onChange} />
      </ScrollView>
      <PrimaryButton
        label={t(lang, 'continue')}
        onPress={onNext}
        disabled={!canContinue}
      />
    </OnboardingShell>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        style={styles.input}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        autoCorrect={false}
        showSoftInputOnFocus
        autoCapitalize={
          keyboardType === 'email-address' || keyboardType === 'phone-pad'
            ? 'none'
            : 'words'
        }
      />
    </View>
  );
}

function CharacterStep({
  lang,
  draft,
  onChange,
  onNext,
}: {
  lang: AppLanguage;
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  onNext: () => void;
}) {
  const getSelected = (catId: string): string[] => {
    switch (catId) {
      case 'characters':
        return draft.characters;
      case 'tonalities':
        return draft.tonalities;
      case 'motives':
        return draft.motives;
      case 'accessibility':
        return draft.accessibility;
      case 'socialDynamics':
        return draft.socialDynamics;
      default:
        return draft.extraTraits.filter((id) =>
          CHARACTER_CATEGORIES.find((c) => c.id === catId)?.options.some(
            (o) => o.id === id,
          ),
        );
    }
  };

  const setSelected = (catId: string, ids: string[]) => {
    switch (catId) {
      case 'characters':
        onChange({ characters: ids });
        break;
      case 'tonalities':
        onChange({ tonalities: ids });
        break;
      case 'motives':
        onChange({ motives: ids });
        break;
      case 'accessibility':
        onChange({ accessibility: ids });
        break;
      case 'socialDynamics':
        onChange({
          socialDynamics: ids,
          travelParty: socialToTravelParty(ids[0]),
        });
        break;
      default: {
        const otherCatIds = new Set(
          CHARACTER_CATEGORIES.filter((c) => c.id !== catId).flatMap((c) =>
            c.options.map((o) => o.id),
          ),
        );
        const kept = draft.extraTraits.filter((id) => otherCatIds.has(id));
        onChange({ extraTraits: [...kept, ...ids] });
      }
    }
  };

  const toggle = (catId: string, optionId: string) => {
    const cat = CHARACTER_CATEGORIES.find((c) => c.id === catId);
    const cur = getSelected(catId);
    if (cur.includes(optionId)) {
      setSelected(
        catId,
        cur.filter((x) => x !== optionId),
      );
      return;
    }
    if (cat?.maxSelect === 1) {
      setSelected(catId, [optionId]);
      return;
    }
    if (cat?.maxSelect != null && cur.length >= cat.maxSelect) {
      return;
    }
    setSelected(catId, [...cur, optionId]);
  };

  const valid = CHARACTER_CATEGORIES.every((cat) => {
    if (!cat.required) return true;
    const n = getSelected(cat.id).length;
    if (n < cat.minSelect) return false;
    if (cat.maxSelect != null && n > cat.maxSelect) return false;
    return true;
  });

  useEffect(() => {
    if (draft.characters.length === 0) {
      onChange({ characters: ['standard_char'] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OnboardingShell>
      <StepTitle>{t(lang, 'characterTitle')}</StepTitle>
      <ScrollView
        style={styles.characterScroll}
        contentContainerStyle={{ paddingBottom: 16 }}
      >
        <StepSubtitle>{t(lang, 'characterHint')}</StepSubtitle>
        {CHARACTER_CATEGORIES.map((cat) => (
          <View key={cat.id} style={styles.catBlock}>
            <Text style={styles.catTitle}>
              {uiLang(lang) === 'de' ? cat.titleDe : cat.titleEn}
            </Text>
            {cat.maxSelect != null && cat.maxSelect > 1 ? (
              <Text style={styles.catHint}>
                {uiLang(lang) === 'de'
                  ? `Mehrfachauswahl möglich — max. ${cat.maxSelect}. Yorro mixt den Stil.`
                  : `Multi-select — max ${cat.maxSelect}. Yorro mixes the style.`}
              </Text>
            ) : null}
            <View style={styles.chipRow}>
              {cat.options.map((opt) => (
                <Chip
                  key={opt.id}
                  emoji={opt.emoji}
                  label={uiLang(lang) === 'de' ? opt.labelDe : opt.labelEn}
                  selected={getSelected(cat.id).includes(opt.id)}
                  onPress={() => toggle(cat.id, opt.id)}
                  onInfo={() =>
                    Alert.alert(
                      uiLang(lang) === 'de' ? opt.labelDe : opt.labelEn,
                      uiLang(lang) === 'de' ? opt.infoDe : opt.infoEn,
                    )
                  }
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <PrimaryButton
        label={t(lang, 'continue')}
        onPress={onNext}
        disabled={!valid}
      />
    </OnboardingShell>
  );
}

function ExperienceStep({
  lang,
  draft,
  onChange,
  onNext,
}: {
  lang: AppLanguage;
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  onNext: (override?: Partial<UserProfile>) => void;
}) {
  useEffect(() => {
    const prefs = { ...draft.experiencePrefs };
    for (const card of EXPERIENCE_CARDS) {
      if (!prefs[card.id]) prefs[card.id] = 'neutral';
    }
    onChange({ experiencePrefs: prefs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OnboardingShell>
      <StepTitle>Aktuelle Reise</StepTitle>
      <StepSubtitle>
        Gleich wie in den Einstellungen — Reisezweck, Mobilität, Tempo und
        Interessen.
      </StepSubtitle>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
      >
        <AktuelleReiseEditor draft={draft} onChange={onChange} mode="full" />
      </ScrollView>
      <PrimaryButton
        label={t(lang, 'continue')}
        onPress={() => onNext()}
      />
    </OnboardingShell>
  );
}

function SwipeCard({
  card,
  lang,
  value,
  onChange,
}: {
  card: ExperienceCard;
  lang: AppLanguage;
  value: SwipePreference;
  onChange: (v: SwipePreference) => void;
}) {
  // Tempo/Länge: kleiner/langsamer links, größer/schneller rechts
  // (Pref-Semantik bleibt: yes=entspannt/kompakt, no=schneller/viel Zeit)
  const flipSides = card.category === 'tempo';
  const leftValue: SwipePreference = flipSides ? 'yes' : 'no';
  const rightValue: SwipePreference = flipSides ? 'no' : 'yes';
  const leftLabel = flipSides
    ? uiLang(lang) === 'de'
      ? card.yesLabelDe
      : card.yesLabelEn
    : uiLang(lang) === 'de'
      ? card.noLabelDe
      : card.noLabelEn;
  const rightLabel = flipSides
    ? uiLang(lang) === 'de'
      ? card.noLabelDe
      : card.noLabelEn
    : uiLang(lang) === 'de'
      ? card.yesLabelDe
      : card.yesLabelEn;

  return (
    <View style={styles.swipeCard}>
      <Text style={styles.swipeTitle}>
        {card.emoji} {uiLang(lang) === 'de' ? card.labelDe : card.labelEn}
      </Text>
      <View style={styles.swipeRow}>
        <Pressable
          onPress={() => onChange(leftValue)}
          style={[
            styles.swipeSide,
            flipSides ? styles.swipeYes : styles.swipeNo,
            value === leftValue &&
              (flipSides ? styles.swipeYesOn : styles.swipeNoOn),
          ]}
        >
          <Text style={styles.swipeSideText}>{leftLabel}</Text>
        </Pressable>
        <Pressable
          onPress={() => onChange('neutral')}
          style={[
            styles.swipeMid,
            value === 'neutral' && styles.swipeMidOn,
          ]}
        >
          <Text style={styles.swipeMidText}>
            {uiLang(lang) === 'de'
              ? card.midLabelDe ?? t(lang, 'neutral')
              : card.midLabelEn ?? t(lang, 'neutral')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onChange(rightValue)}
          style={[
            styles.swipeSide,
            flipSides ? styles.swipeNo : styles.swipeYes,
            value === rightValue &&
              (flipSides ? styles.swipeNoOn : styles.swipeYesOn),
          ]}
        >
          <Text style={styles.swipeSideText}>{rightLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Früher Pause zwischen speakText-Calls — Stream braucht das nicht mehr. */
const LAYOUT_WAIT_MS = 140;

function SummaryIntroStep({
  draft,
  onFinished,
  onSetVoiceId,
}: {
  draft: UserProfile;
  onFinished: () => void;
  onSetVoiceId: (voiceId: VoiceId) => void;
}) {
  void onSetVoiceId;
  const subtitleText = useFinnusStore((s) => s.subtitleText);

  const [canSkip, setCanSkip] = useState(true);
  const [fingerVisible, setFingerVisible] = useState(false);
  const [fingerPos, setFingerPos] = useState({ x: 0, y: 0 });
  const [activeHint, setActiveHint] = useState<ExplanationHint>('none');
  const [settingsDemoOpen, setSettingsDemoOpen] = useState(false);
  const [settingsAccordion, setSettingsAccordion] = useState<string | null>(
    'setup',
  );

  const rootRef = useRef<View>(null);
  const locationRef = useRef<View>(null);
  const micRef = useRef<View>(null);
  const settingsRef = useRef<View>(null);
  const module1Ref = useRef<View>(null);
  const bulletsRef = useRef<View>(null);
  const actionsRef = useRef<View>(null);
  const settingsDemoRef = useRef<View>(null);
  const queueDemoRef = useRef<View>(null);
  const timelineRef = useRef<View>(null);
  const planCalendarRef = useRef<View>(null);
  const stampMapRef = useRef<View>(null);
  const lastHintRef = useRef<ExplanationHint | null>(null);
  const [tourLandmark, setTourLandmark] = useState<string | null>(null);
  const [planCalendarOpen, setPlanCalendarOpen] = useState(false);
  const [placeSeekOpen, setPlaceSeekOpen] = useState(false);
  const [realSettingsOpen, setRealSettingsOpen] = useState(false);
  const [tourPlaceDemo, setTourPlaceDemo] = useState(false);
  const [hudHeight, setHudHeight] = useState(96);
  const placePopup = useHomeMapUiStore((s) => s.placePopup);
  const demoStopIdsRef = useRef<string[]>([]);
  const safePad = useSystemSafePad();

  const finishedRef = useRef(false);
  const segmentsRef = useRef<{ hint: ExplanationHint; text: string }[]>([]);
  const fingerOpacity = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const tapBoost = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.12,
          duration: 520,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 520,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulse]);

  const bumpFinger = useCallback(() => {
    tapBoost.setValue(1);
    Animated.sequence([
      Animated.timing(tapBoost, {
        toValue: 1.18,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(tapBoost, {
        toValue: 1,
        duration: 170,
        useNativeDriver: true,
      }),
    ]).start();
  }, [tapBoost]);

  const measureTarget = useCallback((hint: ExplanationHint) => {
    return new Promise<{ x: number; y: number } | null>((resolve) => {
      const target =
        hint === 'mic' || hint === 'help_prompt'
          ? micRef.current
          : hint === 'passport'
            ? stampMapRef.current
            : hint === 'live_hud' || hint === 'location'
              ? locationRef.current
              : hint === 'settings' || hint === 'settings_panel'
                ? settingsRef.current
                : hint === 'timeline'
                  ? planCalendarRef.current
                  : hint === 'module1'
                    ? module1Ref.current
                    : hint === 'bullets'
                      ? bulletsRef.current
                      : hint === 'actions'
                        ? actionsRef.current
                        : hint === 'nav_queue'
                          ? queueDemoRef.current
                          : null;
      if (!target || !rootRef.current) {
        resolve(null);
        return;
      }
      rootRef.current.measureInWindow((rx, ry) => {
        target.measureInWindow((x, y, w, h) => {
          resolve({
            x: x - rx + w / 2 - 18,
            y: y - ry + h * 0.55,
          });
        });
      });
    });
  }, []);

  const revealFingerAt = useCallback(
    async (hint: ExplanationHint) => {
      const pos = await measureTarget(hint);
      if (!pos) {
        setFingerVisible(false);
        return false;
      }
      setFingerPos(pos);
      setFingerVisible(true);
      await new Promise<void>((resolve) => {
        Animated.timing(fingerOpacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }).start(() => resolve());
      });
      bumpFinger();
      return true;
    },
    [bumpFinger, fingerOpacity, measureTarget],
  );

  const seedTourTimeline = useCallback(() => {
    try {
      const pack = cityDemoPack(draft.cityName ?? draft.cityId);
      const dayKey = todayDateKey();
      const store = useFuturePlanStore.getState();
      store.ensureDay(dayKey);
      const base = Date.now();
      const ids = [
        `tour_demo_${dayKey}_0`,
        `tour_demo_${dayKey}_1`,
        `tour_demo_${dayKey}_2`,
      ];
      demoStopIdsRef.current = ids;
      const stops = [
        {
          id: ids[0]!,
          title: pack.timelineStops[0],
          plannedStartMs: base + 2 * 60 * 60_000,
          plannedEndMs: base + 3 * 60 * 60_000,
          bufferMin: 0,
          transport: 'walk' as const,
          kind: 'stop' as const,
          emoji: '📍',
        },
        {
          id: ids[1]!,
          title: pack.timelineStops[1],
          plannedStartMs: base + 4 * 60 * 60_000,
          plannedEndMs: base + 5 * 60 * 60_000,
          bufferMin: 0,
          transport: 'walk' as const,
          kind: 'stop' as const,
          emoji: '✨',
        },
        {
          id: ids[2]!,
          title: pack.timelineStops[2],
          plannedStartMs: base + 7 * 60 * 60_000,
          plannedEndMs: base + 8 * 60 * 60_000,
          bufferMin: 0,
          transport: 'walk' as const,
          kind: 'stop' as const,
          emoji: '🌅',
        },
      ];
      for (const s of stops) store.upsertStop(s);
    } catch (err) {
      console.warn('[explanation] timeline seed failed', err);
    }
  }, [draft.cityId, draft.cityName]);

  const clearTourTimeline = useCallback(() => {
    try {
      const store = useFuturePlanStore.getState();
      for (const id of demoStopIdsRef.current) {
        store.removeStop(id);
      }
      demoStopIdsRef.current = [];
    } catch {
      /* soft */
    }
  }, []);

  const showFinger = useCallback(
    async (hint: ExplanationHint) => {
      setActiveHint(hint);

      if (hint === 'none') {
        setSettingsDemoOpen(false);
        setPlanCalendarOpen(false);
        setPlaceSeekOpen(false);
        setRealSettingsOpen(false);
        setTourPlaceDemo(false);
        clearTourTimeline();
        await new Promise<void>((resolve) => {
          Animated.timing(fingerOpacity, {
            toValue: 0,
            duration: 140,
            useNativeDriver: true,
          }).start(() => {
            setFingerVisible(false);
            resolve();
          });
        });
        return;
      }

      // Settings: erst Finger auf Zahnrad (Panel bleibt zu) — Speech folgt im Runner
      if (hint === 'settings') {
        setPlanCalendarOpen(false);
        setPlaceSeekOpen(false);
        setTourPlaceDemo(false);
        setSettingsDemoOpen(false);
        setRealSettingsOpen(false);
        await new Promise<void>((r) => setTimeout(r, LAYOUT_WAIT_MS));
        await revealFingerAt('settings');
        bumpFinger();
        await new Promise<void>((r) => setTimeout(r, 500));
        return;
      }

      // Settings-Panel: öffnen, Accordion kurz durchwandern (parallel zur Speech im Runner)
      if (hint === 'settings_panel') {
        setPlanCalendarOpen(false);
        setPlaceSeekOpen(false);
        setTourPlaceDemo(false);
        setSettingsDemoOpen(false);
        setRealSettingsOpen(true);
        await new Promise<void>((r) => setTimeout(r, LAYOUT_WAIT_MS));
        await revealFingerAt('settings');
        bumpFinger();
        return;
      }

      if (hint === 'passport') {
        setSettingsDemoOpen(false);
        setRealSettingsOpen(false);
        setPlanCalendarOpen(false);
        setTourPlaceDemo(false);
        setPlaceSeekOpen(false);
        await new Promise<void>((r) => setTimeout(r, LAYOUT_WAIT_MS));
        await revealFingerAt('passport');
        bumpFinger();
        return;
      }

      if (hint === 'actions') {
        setPlaceSeekOpen(false);
        setPlanCalendarOpen(false);
        setRealSettingsOpen(false);
        setTourPlaceDemo(true);
        await new Promise<void>((r) => setTimeout(r, LAYOUT_WAIT_MS));
        await revealFingerAt('passport');
        bumpFinger();
        return;
      }

      if (hint === 'timeline') {
        setSettingsDemoOpen(false);
        setRealSettingsOpen(false);
        setPlaceSeekOpen(false);
        setTourPlaceDemo(false);
        setPlanCalendarOpen(false);
        await new Promise<void>((r) => setTimeout(r, LAYOUT_WAIT_MS));
        await revealFingerAt('timeline');
        await new Promise<void>((r) => setTimeout(r, 280));
        bumpFinger();
        await new Promise<void>((r) => setTimeout(r, 160));
        seedTourTimeline();
        setPlanCalendarOpen(true);
        await new Promise<void>((r) => setTimeout(r, 220));
        bumpFinger();
        return;
      }

      setSettingsDemoOpen(false);
      setRealSettingsOpen(false);
      setPlanCalendarOpen(false);
      setPlaceSeekOpen(false);
      setTourPlaceDemo(false);

      await new Promise<void>((r) =>
        setTimeout(
          r,
          hint === 'module1' || hint === 'mic' || hint === 'help_prompt'
            ? LAYOUT_WAIT_MS
            : 70,
        ),
      );

      await revealFingerAt(hint);
      if (hint === 'mic' || hint === 'help_prompt') {
        await new Promise<void>((r) => setTimeout(r, 200));
        bumpFinger();
        await new Promise<void>((r) => setTimeout(r, 160));
        bumpFinger();
      }
    },
    [
      bumpFinger,
      clearTourTimeline,
      fingerOpacity,
      revealFingerAt,
      seedTourTimeline,
    ],
  );

  // Finger wird vom Segment-Runner gesteuert

  useEffect(() => {
    let cancelled = false;
    finishedRef.current = false;

    const pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    (async () => {
      if (profileHasFinishedSetup(draft) || draft.firstMapWelcomeDone) {
        onFinished();
        return;
      }
      const voiceOpts = {
        voiceId: draft.voiceId,
        speechRate: 1 as const,
      };

      void warmupTtsEngine({ voiceId: draft.voiceId });
      void startVoiceBuffer({
        speechRate: 1,
        priorityVoiceId: draft.voiceId,
      });
      // Nicht awaiten — Wetter braucht die Erklärung nicht, Stadt-Welcome später schon
      void ensureWeatherFresh('open').catch(() => undefined);

      if (cancelled || finishedRef.current) return;

      const pack = cityDemoPack(draft.cityName ?? draft.cityId);
      setTourLandmark(pack.landmark);

      const tour = buildGuidedFeatureTourSegments({
        profile: draft,
      });
      const segments = tour;
      segmentsRef.current = segments;

      // Fast-Hook zuerst, dann Phrase-Chunks mit wachsendem Prefetch (2→5).
      // Finger folgt der Stimme (Chunk-Start), nicht einer Zeichen-Stoppuhr.
      const cursor = createExplanationSpeechCursor(segments);
      let speechSettled = false;

      const speechPromise = (async () => {
        try {
          await speakSentenceStream(
            explanationSpeechChunkStream(segments),
            voiceOpts,
            {
              bypassDeliveryPolicy: true,
              priority: 'system',
              onChunkText: (text) => cursor.pushChunk(text),
            },
          );
        } catch (e) {
          console.warn('[explanation] speak stream failed:', e);
          const clock = (async () => {
            for (const s of segments) {
              if (cancelled || finishedRef.current) return;
              cursor.pushChunk(s.text);
              await pause(explanationSegmentHoldMs(s.text));
            }
          })();
          try {
            await speakText(
              segments.map((s) => s.text).join(' '),
              voiceOpts,
              { bypassDeliveryPolicy: true },
            );
          } catch (e2) {
            console.warn('[explanation] speak fallback failed:', e2);
          }
          await clock;
        } finally {
          speechSettled = true;
        }
      })();

      for (let i = 0; i < segments.length; i++) {
        if (cancelled || finishedRef.current) break;
        const seg = segments[i]!;
        await cursor.waitForSegment(
          i,
          () => !cancelled && !finishedRef.current && !speechSettled,
        );
        if (cancelled || finishedRef.current) break;
        lastHintRef.current = seg.hint;
        await showFinger(seg.hint);
        if (seg.hint === 'passport') {
          void (async () => {
            while (
              !cancelled &&
              !finishedRef.current &&
              lastHintRef.current === 'passport'
            ) {
              if (cursor.passportPlacesCue()) {
                setPlaceSeekOpen(true);
                return;
              }
              await pause(80);
            }
          })();
        }
      }

      await speechPromise;

      if (cancelled || finishedRef.current) return;
      await markFirstMapWelcomeDone(draft);
      setCanSkip(false);
      setPlanCalendarOpen(false);
      setPlaceSeekOpen(false);
      setRealSettingsOpen(false);
      setTourPlaceDemo(false);
      setActiveHint('none');
      await showFinger('none');

      // Kurz selbst ankommen, dann Stadt-Welcome auf derselben Karte
      const settleUntil = Date.now() + POST_EXPLANATION_SETTLE_MS;
      while (Date.now() < settleUntil) {
        if (cancelled || finishedRef.current) return;
        await pause(250);
      }
      if (cancelled || finishedRef.current) return;
      try {
        await runPostExplanationCityWelcome(draft);
      } catch (err) {
        console.warn('[explanation] city welcome failed:', err);
      }
      if (cancelled || finishedRef.current) return;
      finishedRef.current = true;
      await showFinger('none');
      clearTourTimeline();
      onFinished();
    })();

    return () => {
      cancelled = true;
      clearTourTimeline();
      void stopSpeaking();
    };
  }, [clearTourTimeline, draft, onFinished, showFinger]);

  const cityLabel = draft.cityName ?? draft.cityId ?? 'dein Ort';
  const mapBottomChrome = HOME_DOCK_BAR_H + safePad.bottom;

  return (
    <View ref={rootRef} style={styles.homeLikeInner} collapsable={false}>
      <HomePresenceMap
        hudHeight={hudHeight}
        bottomChrome={mapBottomChrome}
        tourPlaceDemo={tourPlaceDemo}
        paused={realSettingsOpen || planCalendarOpen || placeSeekOpen}
      />

      <View
        style={[styles.hudOverlay, { paddingTop: safePad.top }]}
        pointerEvents="box-none"
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          if (h > 40 && Math.abs(h - hudHeight) >= 2) setHudHeight(h);
        }}
      >
        <Header
          overlay
          hideTools
          fullBleedLive
          locationRef={locationRef}
          onOpenPlanCalendar={() => {
            seedTourTimeline();
            setPlanCalendarOpen(true);
          }}
        />
      </View>

      <View
        style={[
          styles.tourSubtitles,
          {
            bottom:
              HOME_DOCK_BAR_H +
              safePad.bottom +
              HOME_MIC_DOCK_GAP +
              HOME_MIC_HINT_RESERVE +
              88,
          },
        ]}
        pointerEvents="none"
      >
        {subtitleText?.trim() ? (
          <SubtitlesSlot text={subtitleText} />
        ) : null}
      </View>

      <GuidedFeatureTourOverlays
        hint={activeHint}
        cityName={cityLabel}
        landmarkName={tourLandmark}
        settingsOpen={false}
        settingsAccordion={settingsAccordion}
        onToggleAccordion={(id) =>
          setSettingsAccordion((prev) => (prev === id ? null : id))
        }
        helpInteractive={false}
        module1Ref={module1Ref}
        bulletsRef={bulletsRef}
        actionsRef={actionsRef}
        settingsDemoRef={settingsDemoRef}
        queueDemoRef={queueDemoRef}
        timelineRef={timelineRef}
        realTimelineOpen={planCalendarOpen}
      />

      <PlanCalendarModal
        visible={planCalendarOpen}
        onClose={() => {
          setPlanCalendarOpen(false);
          clearTourTimeline();
        }}
        onPressIn={() => bumpFinger()}
        onPressOut={() => undefined}
        isListening={false}
        isGenerating={false}
      />

      <PlaceSeekSheet
        visible={placeSeekOpen}
        onClose={() => setPlaceSeekOpen(false)}
      />

      <SettingsScreen
        visible={realSettingsOpen}
        profile={draft}
        onClose={() => setRealSettingsOpen(false)}
        onSaved={(nextProfile) => {
          void saveUserProfile(nextProfile);
        }}
        onReset={() => undefined}
      />

      <View
        style={[
          styles.micFloat,
          {
            bottom:
              HOME_DOCK_BAR_H +
              safePad.bottom +
              HOME_MIC_DOCK_GAP +
              HOME_MIC_HINT_RESERVE,
          },
        ]}
        pointerEvents="box-none"
      >
        <View ref={micRef} collapsable={false} style={styles.tourMicCenter}>
          <MicButton
            onPressIn={() => bumpFinger()}
            onPressOut={() => undefined}
            isListening={false}
            isGenerating={false}
          />
        </View>
      </View>

      <View style={styles.dockWrap} pointerEvents="box-none">
        <HomeDockBar
          timelineRef={planCalendarRef}
          placesRef={stampMapRef}
          settingsRef={settingsRef}
          onTimeline={() => {
            bumpFinger();
            seedTourTimeline();
            setPlanCalendarOpen(true);
          }}
          onPlaces={() => {
            bumpFinger();
            setPlaceSeekOpen(true);
          }}
          onSettings={() => {
            setRealSettingsOpen(true);
            bumpFinger();
          }}
        />
      </View>

      {fingerVisible ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.finger,
            {
              left: fingerPos.x,
              top: fingerPos.y,
              opacity: fingerOpacity,
              transform: [{ scale: Animated.multiply(pulse, tapBoost) }],
              zIndex: UI_LAYER.overlay,
              elevation: UI_LAYER.overlay,
            },
          ]}
        >
          <Text style={styles.fingerEmoji}>👆</Text>
        </Animated.View>
      ) : null}

      <HomeMapPlacePopup
        place={placePopup}
        onClose={() => useHomeMapUiStore.getState().setPlacePopup(null)}
      />

      {canSkip ? (
        <View
          style={[styles.skipWrap, { top: Math.max(6, safePad.top + 4) }]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => {
              finishedRef.current = true;
              setSettingsDemoOpen(false);
              setPlanCalendarOpen(false);
              setPlaceSeekOpen(false);
              setRealSettingsOpen(false);
              setTourPlaceDemo(false);
              clearTourTimeline();
              setActiveHint('none');
              lastHintRef.current = null;
              void markFirstMapWelcomeDone(draft);
              void stopSpeaking();
              onFinished();
            }}
            style={styles.skipPill}
            accessibilityRole="button"
            accessibilityLabel={t(draft.language, 'skipExplanation')}
            hitSlop={8}
          >
            <Text style={styles.skipPillText} numberOfLines={2}>
              {t(draft.language, 'skipExplanation')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  langRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  langCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  langCardRecommended: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  langFlag: { fontSize: 48, marginBottom: spacing.sm },
  langName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  characterScroll: {
    flex: 1,
  },
  introShell: { justifyContent: 'space-between' },
  durationBadge: {
    alignSelf: 'center',
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  homeLike: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  homeLikeInner: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  introMain: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  introSubtitles: {
    width: '100%',
    minHeight: 60,
    marginTop: spacing.md,
    justifyContent: 'center',
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
  dockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: UI_LAYER.hud,
    elevation: UI_LAYER.hud,
  },
  tourMicCenter: {
    alignItems: 'center',
  },
  tourSubtitles: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: UI_LAYER.subtitles,
  },
  skipWrap: {
    position: 'absolute',
    right: 10,
    alignItems: 'flex-end',
    maxWidth: 158,
    zIndex: UI_LAYER.askSheet + 1,
    elevation: UI_LAYER.askSheet + 1,
  },
  skipPill: {
    backgroundColor: 'rgba(12, 28, 24, 0.88)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  skipPillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    lineHeight: 15,
  },
  finger: {
    position: 'absolute',
    zIndex: UI_LAYER.overlay,
  },
  fingerEmoji: {
    fontSize: 36,
  },
  swipeDemoWrap: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  swipeDemo: {
    width: 220,
    height: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(0,0,0,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeDemoIcon: {
    fontSize: 22,
  },
  swipeDemoText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },

  settingsDemoOverlay: {
    position: 'absolute',
    zIndex: 35,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  settingsDemoCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.bgElevated,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  settingsDemoTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  settingsVoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  settingsVoiceRowText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  settingsChevron: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '700',
  },
  settingsVoicePanel: {
    paddingTop: spacing.sm,
  },
  followUpDemoOverlay: {
    position: 'absolute',
    zIndex: 30,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  followUpDemoCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.bgElevated,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  followUpDemoTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  followUpDemoBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  followUpVideoPlaceholder: {
    height: 130,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  followUpVideoText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  voiceRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  voiceName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  playBtnActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  rateLabel: {
    color: colors.text,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  aboutMeInput: {
    minHeight: 96,
    marginBottom: spacing.md,
  },
  sectionGroup: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 16,
    backgroundColor: 'rgba(22, 54, 44, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(196, 163, 90, 0.14)',
  },
  sectionGroupTitle: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xs,
    letterSpacing: 0.2,
  },
  catBlock: { marginBottom: spacing.lg },
  catTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  catHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRowEqual: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    marginBottom: 8,
  },
  chipRowEqual4: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  prefChip: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    marginBottom: 4,
  },
  prefChipEqual: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  prefChipEqual4: {
    width: '47%',
    flexGrow: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    marginBottom: 4,
  },
  prefChipOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.15)',
  },
  prefChipLabel: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    flexShrink: 1,
  },
  prefChipHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    flexShrink: 1,
  },
  sectionLabel: {
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 12,
    marginBottom: 8,
    marginTop: 12,
  },
  cityCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cityList: {
    gap: 12,
    marginBottom: 8,
  },
  cityCardModern: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    marginBottom: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cityHero: {
    width: '100%',
    height: 96,
    resizeMode: 'cover',
  },
  cityCardBody: {
    padding: spacing.md,
    gap: 6,
  },
  cityNameModern: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  cityStatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    gap: 8,
  },
  cityStatCell: {
    width: '47%',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cityStatNum: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: '800',
  },
  cityStatLabel: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    fontWeight: '600',
  },
  rahmenLead: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  cityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  cityCardHalf: {
    width: '47%',
    flexGrow: 1,
    minWidth: '45%',
  },
  cityCardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  cityName: { color: colors.text, fontSize: 18, fontWeight: '700' },
  cityStats: { color: colors.textMuted, marginTop: 6, fontSize: 13 },
  muted: { color: colors.textMuted, fontSize: 14 },
  gpsStatus: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  emptyCities: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  swipeCard: {
    backgroundColor: 'rgba(28, 67, 55, 0.9)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(196, 163, 90, 0.16)',
  },
  swipeTitle: {
    color: colors.text,
    fontWeight: '700',
    marginBottom: 10,
    fontSize: 15,
  },
  swipeRow: { flexDirection: 'row', gap: 6 },
  swipeSide: {
    flex: 5,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
  },
  swipeNo: { backgroundColor: 'rgba(217,107,92,0.25)' },
  swipeNoOn: { opacity: 1, borderWidth: 1, borderColor: colors.danger },
  swipeYes: { backgroundColor: 'rgba(126,200,163,0.25)' },
  swipeYesOn: { opacity: 1, borderWidth: 1, borderColor: colors.wave },
  swipeSideText: {
    color: colors.text,
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '600',
  },
  swipeMid: {
    flex: 4,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
    opacity: 0.55,
  },
  swipeMidOn: { opacity: 1, borderWidth: 1, borderColor: colors.accent },
  swipeMidText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  micRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
