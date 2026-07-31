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
  OnboardingShell,
  PrimaryButton,
  SecondaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import { AgeLifeSlider } from './AgeLifeSlider';
import { AudioWave } from '../components/AudioWave';
import { SpeechMicButton } from '../components/SpeechMicButton';
import { SubtitleOverlay } from '../components/SubtitleOverlay';
import { colors, spacing } from '../constants/theme';
import {
  defaultVoiceForLanguage,
  voicesForLanguage,
} from '../constants/voices';
import { VoiceSelectorList } from '../components/VoiceSelectorList';
import {
  CHARACTER_CATEGORIES,
  EXPERIENCE_CARDS,
  EXPERIENCE_CATEGORY_TITLES,
  type ExperienceCard,
} from '../constants/onboardingOptions';
import {
  INTRO_WELCOME_DE,
  t,
  voiceLabel,
  buildExplanationOpener,
  type ExplanationHint,
} from '../i18n';
import { markFirstMapWelcomeDone } from '../services/onboarding/firstMapWelcomeService';
import { buildGuidedFeatureTourSegments } from '../services/onboarding/guidedFeatureTour';
import { GuidedFeatureTourOverlays } from './GuidedFeatureTourOverlays';
import type {
  AppLanguage,
  SwipePreference,
  UserProfile,
  VoiceId,
} from '../types/userProfile';
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
import {
  formatTriggerStats,
  installCityPack,
  loadCityCatalog,
  resortCatalogByCoords,
  type CityCatalogItem,
} from '../services/cityCatalogService';
import { getCurrentCoords } from '../services/locationService';
import {
  startListening,
  stopListening,
  isSttAvailable,
} from '../services/sttService';
import { saveUserProfile } from '../services/userProfileService';
import { appendSpeechSegment } from '../utils/speechText';
import { showPermissionMissingAlert } from '../utils/permissionAlerts';
import { SwipeBackView } from '../components/SwipeBackView';
import { PlayPauseIcon } from '../components/PlayPauseIcon';
import { Header } from '../components/Header';
import { MicButton } from '../components/MicButton';
import { PathChoiceStep } from './PathChoiceStep';
import { ExpressSetupStep } from './ExpressSetupStep';
import { MicConsentStep } from './MicConsentStep';
import type { OnboardingMode, TravelParty } from '../types/userProfile';
import { BUDGET_OPTIONS, ENERGY_OPTIONS, TOURIST_MODE_OPTIONS } from '../constants/conciergePrefs';
import type { BudgetCategory, EnergyLevel, TouristVsInsider } from '../types/userProfile';

type FlowStep =
  | 'path'
  | 'express'
  | 'intro'
  | 'voice'
  | 'about'
  | 'character'
  | 'city'
  | 'experience'
  | 'mic'
  | 'summary';

const EXPRESS_FLOW: FlowStep[] = ['path', 'mic', 'city', 'express', 'summary'];
const STANDARD_FLOW: FlowStep[] = [
  'path',
  'intro',
  'mic',
  'voice',
  'about',
  'character',
  'city',
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

  const flow = mode === 'express' ? EXPRESS_FLOW : STANDARD_FLOW;
  const step = flow[Math.min(flowIndex, flow.length - 1)] ?? 'path';

  const patch = (p: Partial<UserProfile>) =>
    setDraft((d) => ({ ...d, ...p }));

  const persist = async (next: UserProfile) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (override?: Partial<UserProfile>) => {
    void stopSpeaking();
    onComplete({
      ...draft,
      ...override,
      language: 'de',
      setupComplete: true,
      completedAt: new Date().toISOString(),
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
    // Erklärung: Opener + Engine schon warm, bevor der Screen mountet
    if (nextStep === 'summary') {
      const voiceId = next.voiceId;
      void warmupTtsEngine({ voiceId });
      void startVoiceBuffer({ speechRate: 1, priorityVoiceId: voiceId });
      void prepareOnboardingVoiceSamples({ priorityVoiceId: voiceId });
    }
    setFlowIndex(nextIndex);
  };

  const goBack = () => {
    void stopSpeaking();
    if (flowIndex <= 0) return;
    if (flowIndex === 1) {
      setMode(null);
      setFlowIndex(0);
      return;
    }
    setFlowIndex((i) => Math.max(0, i - 1));
  };

  const choosePath = (nextMode: OnboardingMode) => {
    void prefetchOnboardingAudioBundle(INTRO_WELCOME_DE);
    void prepareOnboardingVoiceSamples({
      priorityVoiceId: 'sebastian',
    });
    setMode(nextMode);
    const next = {
      ...draft,
      onboardingMode: nextMode,
      language: 'de' as const,
      voiceId: draft.voiceId || defaultVoiceForLanguage('de'),
      speechRate: 1 as const,
    };
    setDraft(next);
    void persist(next);
    setFlowIndex(1);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <SwipeBackView enabled={flowIndex > 0} onBack={goBack}>
        {step === 'path' && <PathChoiceStep onChoose={choosePath} />}

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
            onChangeVoice={(voiceId) => {
              setDraft((d) => {
                const next = { ...d, voiceId, speechRate: 1 };
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
          <CharacterStep
            lang={lang}
            draft={draft}
            onChange={patch}
            onNext={goNext}
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
              };
              patch({ voiceId, speechRate: 1 as const, language: 'de' });
              void persist(next);
              void voicePreloader.switchActiveVoice(voiceId);
            }}
          />
        )}
      </SwipeBackView>
    </SafeAreaView>
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
  const subtitle = useFinnusStore((s) => s.subtitleText);
  const doneRef = useRef(false);
  const onNextRef = useRef(onNext);
  const onSkipRef = useRef(onSkip);
  onNextRef.current = onNext;
  onSkipRef.current = onSkip;

  useEffect(() => {
    // Während Intro: Hörproben weiter cachen (Infer-Queue)
    void prepareOnboardingVoiceSamples({
      priorityVoiceId: 'sebastian',
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    doneRef.current = false;

    (async () => {
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
      onNextRef.current();
    })();

    return () => {
      cancelled = true;
      void stopSpeaking();
    };
  }, []);

  return (
    <OnboardingShell style={styles.introShell}>
      <Text style={styles.durationBadge}>
        Dauer: ca. 2–3 Minuten für perfekte Personalisierung
      </Text>
      <View style={styles.introMain}>
        <AudioWave mood={isPlaying ? 'speaking' : 'idle'} />
        <SubtitleOverlay text={subtitle} />
      </View>
      <SecondaryButton
        label={t(lang, 'skipIntro')}
        onPress={() => {
          doneRef.current = true;
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
  onChangeVoice,
  onNext,
}: {
  lang: AppLanguage;
  voiceId: VoiceId;
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
  const canContinue =
    draft.firstName.trim().length > 0 && draft.lastName.trim().length > 0;

  return (
    <OnboardingShell>
      <StepTitle>{t(lang, 'aboutTitle')}</StepTitle>
      <ScrollView>
        <Field
          label={t(lang, 'firstName')}
          value={draft.firstName}
          onChangeText={(firstName) => onChange({ firstName })}
        />
        <Field
          label={t(lang, 'lastName')}
          value={draft.lastName}
          onChangeText={(lastName) => onChange({ lastName })}
        />
        <Field
          label={t(lang, 'email')}
          value={draft.email}
          onChangeText={(email) => onChange({ email })}
          keyboardType="email-address"
        />
        <Field
          label="Telefon"
          value={draft.phoneNumber ?? ''}
          onChangeText={(phoneNumber) => onChange({ phoneNumber })}
          keyboardType="phone-pad"
        />
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
        <Text style={styles.rateLabel}>{t(lang, 'aboutMe')}</Text>
        <TextInput
          value={draft.aboutMe ?? ''}
          onChangeText={(aboutMe) => onChange({ aboutMe })}
          style={[styles.input, styles.aboutMeInput]}
          placeholder={t(lang, 'aboutMeHint')}
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
        />
        <AboutMeVoiceField
          value={draft.aboutMe ?? ''}
          onChange={(aboutMe) => onChange({ aboutMe })}
        />
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

function CityStep({
  lang,
  selectedId,
  onSelect,
  onNext,
}: {
  lang: AppLanguage;
  selectedId: string | null;
  onSelect: (id: string, name: string) => void;
  onNext: (city: { cityId: string; cityName: string }) => void;
}) {
  const [cities, setCities] = useState<CityCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [gpsStatus, setGpsStatus] = useState<
    'pending' | 'ready' | 'unavailable'
  >('pending');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      setGpsStatus('pending');

      try {
        const catalog = await loadCityCatalog(null);
        if (cancelled) return;
        setCities(catalog);
        setLoading(false);

        if (catalog.length === 0) {
          setLoadError(t(lang, 'noCitiesHint'));
        }

        const coords = await getCurrentCoords({ timeoutMs: 8000 });
        if (cancelled) return;

        if (coords) {
          setCities((prev) => resortCatalogByCoords(prev, coords));
          setGpsStatus('ready');
        } else {
          setGpsStatus('unavailable');
        }
      } catch (err) {
        console.warn('[CityStep]', err);
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
          setGpsStatus('unavailable');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lang, reloadToken]);

  const nearest = cities[0];
  const rest = cities.slice(1);
  const selected = cities.find((c) => c.id === selectedId) ?? nearest;

  const handleContinue = async () => {
    if (!selected) return;
    onSelect(selected.id, selected.name);
    // Download im Hintergrund — User wartet nicht im City-Step
    void installCityPack(selected.id)
      .then((result) => {
        if (__DEV__) {
          console.log(
            `[CityStep] background pack ${result.poiCount} POIs / ${result.factCount} facts`,
          );
        }
      })
      .catch((err) => {
        console.warn('[CityStep] Hintergrund-Download:', err);
      });
    onNext({
      cityId: selected.id,
      cityName: selected.name,
    });
  };

  return (
    <OnboardingShell>
      <StepTitle>{t(lang, 'cityTitle')}</StepTitle>
      {!loading ? (
        <Text style={styles.gpsStatus}>
          {gpsStatus === 'pending'
            ? t(lang, 'locatingGps')
            : gpsStatus === 'ready'
              ? t(lang, 'gpsReady')
              : t(lang, 'gpsUnavailable')}
        </Text>
      ) : null}

      {loading ? (
        <Text style={styles.muted}>{t(lang, 'loadingCities')}</Text>
      ) : cities.length === 0 ? (
        <View style={styles.emptyCities}>
          <Text style={styles.emptyTitle}>{t(lang, 'noCities')}</Text>
          <Text style={styles.muted}>{loadError ?? t(lang, 'noCitiesHint')}</Text>
          <SecondaryButton
            label={t(lang, 'retryCities')}
            onPress={() => setReloadToken((n) => n + 1)}
          />
        </View>
      ) : (
        <ScrollView>
          {nearest ? (
            <>
              <Text style={styles.sectionLabel}>{t(lang, 'nearby')}</Text>
              <CityCard
                city={nearest}
                lang={lang}
                selected={selectedId === nearest.id || !selectedId}
                onPress={() => onSelect(nearest.id, nearest.name)}
              />
            </>
          ) : null}
          {rest.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>{t(lang, 'otherCities')}</Text>
              {rest.map((c) => (
                <CityCard
                  key={c.id}
                  city={c}
                  lang={lang}
                  selected={selectedId === c.id}
                  onPress={() => onSelect(c.id, c.name)}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
      {selected ? (
        <Text style={styles.muted}>
          Stadt-Daten laden im Hintergrund — du kannst gleich weiter.
        </Text>
      ) : null}
      <PrimaryButton
        label={`${t(lang, 'continueWith')} ${selected?.name ?? ''}`.trim()}
        onPress={() => void handleContinue()}
        disabled={!selected}
      />
    </OnboardingShell>
  );
}

function CityCard({
  city,
  lang,
  selected,
  onPress,
}: {
  city: CityCatalogItem;
  lang: AppLanguage;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.cityCard, selected && styles.cityCardSelected]}
    >
      <Text style={styles.cityName}>
        {city.symbol ?? '📍'} {city.name}
      </Text>
      {city.distanceKm != null ? (
        <Text style={styles.muted}>
          {city.distanceKm < 10
            ? city.distanceKm.toFixed(1)
            : Math.round(city.distanceKm)}{' '}
          {t(lang, 'kmAway')}
        </Text>
      ) : null}
      <Text style={styles.cityStats}>
        {formatTriggerStats({
          triggerCount: city.triggerCount,
          zoneCount: city.zoneCount,
          factCount: city.factCount,
        })}
      </Text>
    </Pressable>
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
  const categories = (
    ['wissen', 'vibes', 'mobilitaet', 'tempo', 'essen', 'stil'] as const
  ).map((id) => ({
    id,
    title: EXPERIENCE_CATEGORY_TITLES[id][uiLang(lang)],
    cards: EXPERIENCE_CARDS.filter(
      (c) => c.category === id && c.id !== 'budget',
    ),
  }));

  const setPref = (id: string, value: SwipePreference) => {
    const nextPrefs = { ...draft.experiencePrefs, [id]: value };
    const patch: Partial<UserProfile> = { experiencePrefs: nextPrefs };
    if (id === 'budget') {
      patch.budgetCategory =
        value === 'no' ? 'sparsam' : value === 'yes' ? 'komfort' : 'mittel';
    }
    if (id === 'weg_vom_trubel' && value === 'yes') {
      patch.touristMode = 'insider';
    }
    if (id === 'typisch_touri' && value === 'yes') {
      patch.touristMode = 'tourist';
    }
    onChange(patch);
  };

  const ensureDefaults = () => {
    const prefs = { ...draft.experiencePrefs };
    for (const card of EXPERIENCE_CARDS) {
      if (!prefs[card.id]) prefs[card.id] = 'neutral';
    }
    onChange({ experiencePrefs: prefs });
  };

  useEffect(() => {
    ensureDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [micTarget, setMicTarget] = useState<'want' | 'avoid' | null>(null);
  const micTargetRef = useRef<'want' | 'avoid' | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantBaseRef = useRef('');
  const avoidBaseRef = useRef('');

  const clearSilenceTimer = () => {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
  };

  const resetSilenceTimer = () => {
    clearSilenceTimer();
    silenceTimer.current = setTimeout(() => {
      void stopMic();
    }, 3000);
  };

  const stopMic = async () => {
    clearSilenceTimer();
    const target = micTargetRef.current;
    micTargetRef.current = null;
    setMicTarget(null);
    if (!target) {
      try {
        await stopListening();
      } catch {
        // ignore
      }
      return;
    }

    const baseRef = target === 'want' ? wantBaseRef : avoidBaseRef;
    try {
      const text = await stopListening();
      const committed = appendSpeechSegment(baseRef.current, text);
      baseRef.current = committed;
      if (target === 'want') onChange({ wantToExperience: committed });
      else onChange({ avoidExperience: committed });
    } catch {
      // ignore
    }
  };

  const startMic = async (target: 'want' | 'avoid') => {
    if (micTargetRef.current === target) {
      await stopMic();
      return;
    }

    if (micTargetRef.current) {
      await stopMic();
    }

    if (!(await isSttAvailable())) {
      showPermissionMissingAlert('speechUnavailable', { force: true });
      return;
    }

    const baseRef = target === 'want' ? wantBaseRef : avoidBaseRef;
    baseRef.current = (
      target === 'want' ? draft.wantToExperience : draft.avoidExperience
    ).trim();

    micTargetRef.current = target;
    setMicTarget(target);

    const onPartial = (partial: string) => {
      resetSilenceTimer();
      const display = appendSpeechSegment(baseRef.current, partial);
      if (target === 'want') onChange({ wantToExperience: display });
      else onChange({ avoidExperience: display });
    };

    const result = await startListening(onPartial, { replaceActive: true });
    if (!result.ok) {
      micTargetRef.current = null;
      setMicTarget(null);
      // Popup bereits über sttService
      return;
    }

    resetSilenceTimer();
  };

  useEffect(() => {
    return () => {
      void stopMic();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OnboardingShell>
      <StepTitle>{t(lang, 'experienceTitle')}</StepTitle>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={styles.fieldLabel}>Energielevel</Text>
        <View style={styles.chipRow}>
          {ENERGY_OPTIONS.map((o) => {
            const on = draft.energyLevel === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() =>
                  onChange({ energyLevel: o.id as EnergyLevel })
                }
                style={[styles.prefChip, on && styles.prefChipOn]}
              >
                <Text style={styles.prefChipLabel}>{o.label}</Text>
                <Text style={styles.prefChipHint}>{o.hint}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Budget — ungefähr wie viel?</Text>
        <View style={styles.chipRow}>
          {BUDGET_OPTIONS.map((o) => {
            const on = draft.budgetCategory === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() =>
                  onChange({
                    budgetCategory: o.id as BudgetCategory,
                    experiencePrefs: {
                      ...draft.experiencePrefs,
                      budget:
                        o.id === 'sparsam'
                          ? 'no'
                          : o.id === 'komfort'
                            ? 'yes'
                            : 'neutral',
                    },
                  })
                }
                style={[styles.prefChip, on && styles.prefChipOn]}
              >
                <Text style={styles.prefChipLabel}>{o.label}</Text>
                <Text style={styles.prefChipHint}>{o.hint}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Must-sees oder Geheimtipps?</Text>
        <View style={styles.chipRow}>
          {TOURIST_MODE_OPTIONS.map((o) => {
            const on = draft.touristMode === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() =>
                  onChange({ touristMode: o.id as TouristVsInsider })
                }
                style={[styles.prefChip, on && styles.prefChipOn]}
              >
                <Text style={styles.prefChipLabel}>{o.label}</Text>
                <Text style={styles.prefChipHint}>{o.hint}</Text>
              </Pressable>
            );
          })}
        </View>

        {categories.map((cat) => (
          <View key={cat.id} style={styles.catBlock}>
            <Text style={styles.catTitle}>{cat.title}</Text>
            {cat.cards.map((card) => (
              <SwipeCard
                key={card.id}
                card={card}
                lang={lang}
                value={draft.experiencePrefs[card.id] ?? 'neutral'}
                onChange={(v) => setPref(card.id, v)}
              />
            ))}
          </View>
        ))}

        <Text style={styles.fieldLabel}>{t(lang, 'wantExperience')}</Text>
        <View style={styles.micRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={draft.wantToExperience}
            onChangeText={(wantToExperience) => onChange({ wantToExperience })}
            multiline
            placeholderTextColor={colors.textMuted}
          />
          <SpeechMicButton
            active={micTarget === 'want'}
            onPress={() => void startMic('want')}
          />
        </View>

        <Text style={styles.fieldLabel}>{t(lang, 'avoidExperience')}</Text>
        <View style={styles.micRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={draft.avoidExperience}
            onChangeText={(avoidExperience) => onChange({ avoidExperience })}
            multiline
            placeholderTextColor={colors.textMuted}
          />
          <SpeechMicButton
            active={micTarget === 'avoid'}
            onPress={() => void startMic('avoid')}
          />
        </View>
      </ScrollView>
      <PrimaryButton
        label={t(lang, 'continue')}
        onPress={() =>
          onNext({
            energyLevel: draft.energyLevel ?? 'medium',
            budgetCategory: draft.budgetCategory ?? 'mittel',
            touristMode: draft.touristMode ?? 'mix',
            mobilityMode: draft.mobilityMode ?? 'foot',
            answerStyle: draft.answerStyle ?? 'detailed',
            notificationsEnabled: draft.notificationsEnabled !== false,
            dataSaverMode: false,
          })
        }
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
          <Text style={styles.swipeMidText}>{t(lang, 'neutral')}</Text>
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

const SEGMENT_PAUSE_MS = 1000;

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
  const isPlaying = useFinnusStore((s) => s.isAudiblySpeaking);
  const subtitle = useFinnusStore((s) => s.subtitleText);

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
  const planningRef = useRef<View>(null);
  const settingsRef = useRef<View>(null);
  const module1Ref = useRef<View>(null);
  const bulletsRef = useRef<View>(null);
  const actionsRef = useRef<View>(null);
  const planDemoRef = useRef<View>(null);
  const settingsDemoRef = useRef<View>(null);
  const queueDemoRef = useRef<View>(null);
  const lastHintRef = useRef<ExplanationHint | null>(null);

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
        hint === 'mic'
          ? micRef.current
          : hint === 'live_hud' || hint === 'passport' || hint === 'location'
            ? locationRef.current
            : hint === 'planning'
              ? planningRef.current ?? planDemoRef.current
              : hint === 'settings'
                ? settingsRef.current
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
            y: y - ry + h * 0.45,
          });
        });
      });
    });
  }, []);

  const showFinger = useCallback(
    async (hint: ExplanationHint) => {
      setActiveHint(hint);

      if (hint === 'none') {
        setSettingsDemoOpen(false);
        await new Promise<void>((resolve) => {
          Animated.timing(fingerOpacity, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            setFingerVisible(false);
            resolve();
          });
        });
        return;
      }

      if (hint === 'settings') {
        setSettingsDemoOpen(true);
        setSettingsAccordion('setup');
      } else {
        setSettingsDemoOpen(false);
      }

      // Kurz warten bis Overlay layoutet
      await new Promise<void>((r) => setTimeout(r, hint === 'module1' || hint === 'planning' || hint === 'settings' ? 280 : 80));

      const pos = await measureTarget(hint);
      if (!pos) {
        // Fallback: Mitte
        setFingerVisible(false);
        return;
      }
      setFingerPos(pos);
      setFingerVisible(true);
      await new Promise<void>((resolve) => {
        Animated.timing(fingerOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }).start(() => resolve());
      });
      bumpFinger();

      if (hint === 'settings') {
        await new Promise<void>((r) => setTimeout(r, 700));
        setSettingsAccordion('voice');
        await new Promise<void>((r) => setTimeout(r, 900));
        setSettingsAccordion('help');
        await new Promise<void>((r) => setTimeout(r, 800));
        setSettingsAccordion('feedback');
      }
    },
    [bumpFinger, fingerOpacity, measureTarget],
  );

  // Finger anhand Untertitel an Segment koppeln
  useEffect(() => {
    if (!subtitle) {
      lastHintRef.current = null;
      void showFinger('none');
      return;
    }
    const hit = segmentsRef.current.find((s) =>
      subtitle.startsWith(s.text.slice(0, Math.min(28, s.text.length))),
    );
    if (!hit) return;
    if (hit.hint === lastHintRef.current) return;
    lastHintRef.current = hit.hint;
    void showFinger(hit.hint);
  }, [subtitle, showFinger]);

  useEffect(() => {
    let cancelled = false;
    finishedRef.current = false;

    const pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    (async () => {
      const voiceOpts = {
        voiceId: draft.voiceId,
        speechRate: 1 as const,
      };

      void warmupTtsEngine({ voiceId: draft.voiceId });
      void startVoiceBuffer({
        speechRate: 1,
        priorityVoiceId: draft.voiceId,
      });

      await pause(80);
      if (cancelled || finishedRef.current) return;

      // PHASE 1: persönliche Begrüßung (wie bisher) — PHASE 2: geführte Tour
      const opener = buildExplanationOpener(draft);
      const tour = buildGuidedFeatureTourSegments({
        cityName: draft.cityName ?? draft.cityId ?? 'deiner Stadt',
      });
      const segments = [
        { hint: 'none' as const, text: opener },
        ...tour,
      ];
      segmentsRef.current = segments;

      async function* explanationStream(): AsyncGenerator<
        string,
        void,
        unknown
      > {
        for (const segment of segments) {
          if (cancelled || finishedRef.current) return;
          yield segment.text;
        }
      }

      try {
        await speakSentenceStream(explanationStream(), voiceOpts);
      } catch (err) {
        console.warn('[explanation] stream failed:', err);
        for (let i = 0; i < segments.length; i++) {
          if (cancelled || finishedRef.current) return;
          try {
            await speakText(segments[i]!.text, voiceOpts);
          } catch (e) {
            console.warn('[explanation] speak failed:', e);
          }
          if (i < segments.length - 1) await pause(SEGMENT_PAUSE_MS);
        }
      }

      if (cancelled || finishedRef.current) return;
      await markFirstMapWelcomeDone(draft);
      setCanSkip(false);
      await showFinger('none');
      await pause(200);
      if (!cancelled && !finishedRef.current) {
        finishedRef.current = true;
        onFinished();
      }
    })();

    return () => {
      cancelled = true;
      void stopSpeaking();
    };
  }, [draft, onFinished, showFinger]);

  const cityLabel = draft.cityName ?? draft.cityId ?? 'dein Ort';

  return (
    <View ref={rootRef} style={styles.homeLike} collapsable={false}>
      <Header
        locationRef={locationRef}
        settingsRef={settingsRef}
        planningRef={planningRef}
        settingsDisabled={false}
        onOpenPlanning={() => {
          bumpFinger();
          setActiveHint('planning');
        }}
        onOpenPassport={() => {
          bumpFinger();
        }}
        onOpenSettings={() => {
          setSettingsDemoOpen(true);
          setSettingsAccordion('setup');
          bumpFinger();
        }}
      />

      {canSkip ? (
        <View style={styles.skipWrap}>
          <SecondaryButton
            label={t(draft.language, 'skipExplanation')}
            onPress={() => {
              finishedRef.current = true;
              setSettingsDemoOpen(false);
              setActiveHint('none');
              lastHintRef.current = null;
              void markFirstMapWelcomeDone(draft);
              void stopSpeaking();
              onFinished();
            }}
          />
        </View>
      ) : null}

      <View style={styles.introMain}>
        <AudioWave mood={isPlaying ? 'speaking' : 'idle'} />
        <SubtitleOverlay text={subtitle} />
      </View>

      <GuidedFeatureTourOverlays
        hint={activeHint}
        cityName={cityLabel}
        settingsOpen={settingsDemoOpen}
        settingsAccordion={settingsAccordion}
        onToggleAccordion={(id) =>
          setSettingsAccordion((prev) => (prev === id ? null : id))
        }
        module1Ref={module1Ref}
        bulletsRef={bulletsRef}
        actionsRef={actionsRef}
        planDemoRef={planDemoRef}
        settingsDemoRef={settingsDemoRef}
        queueDemoRef={queueDemoRef}
      />

      <View ref={micRef} collapsable={false}>
        <MicButton
          onPressIn={() => bumpFinger()}
          onPressOut={() => undefined}
          isListening={false}
          isGenerating={false}
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
            },
          ]}
        >
          <Text style={styles.fingerEmoji}>👆</Text>
        </Animated.View>
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
  introMain: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  skipWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    zIndex: 30,
  },
  finger: {
    position: 'absolute',
    zIndex: 40,
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
  catBlock: { marginBottom: spacing.lg },
  catTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  prefChip: {
    minWidth: '46%',
    flexGrow: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
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
  prefChipLabel: { color: colors.text, fontWeight: '700', fontSize: 13 },
  prefChipHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
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
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  swipeTitle: {
    color: colors.text,
    fontWeight: '600',
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
