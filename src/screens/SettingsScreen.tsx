import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSystemSafePad } from '../hooks/useSystemSafePad';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { CityCatalogCard } from '../components/CityCatalogCard';
import { t } from '../i18n';
import { resolveVoiceForPersonality } from '../services/persona/personalityVoiceMap';
import type {
  AppLanguage,
  AudioOutputMode,
  UserGender,
  UserProfile,
  VoiceId,
} from '../types/userProfile';
import { uiLang } from '../types/userProfile';
import {
  resetUserProfile,
  saveUserProfile,
} from '../services/userProfileService';
import {
  clearMuteSession,
  describeMuteSession,
  getMuteSession,
  hydrateMuteSession,
  muteForHours,
  startMuteSession,
  subscribeMuteSession,
} from '../services/audio/muteSessionService';
import { clearStampPassport } from '../services/navigation/stampPassportPersistence';
import {
  stopSpeaking,
  resetVoiceSystem,
  voicePreloader,
} from '../services/ttsService';
import {
  catalogItemsFromIndexCache,
  installCityPack,
  listLocalCityDatasets,
  loadCityCatalog,
  removeLocalCityDataset,
  removeLocalCityFiles,
  type CityCatalogItem,
} from '../services/cityCatalogService';
import {
  isProactiveAlertEnabled,
  patchProactiveAlert,
} from '../services/notifications/proactiveAlerts';
import {
  formatLocalDatasetBytes,
  type LocalCityDataset,
} from '../services/cityPack/cityLocalStorage';
import { citiesForPickerGrid } from '../services/citySearch';
import { PrimaryButton, SecondaryButton } from '../onboarding/OnboardingUI';
import { NamePronunciationEditor } from '../components/settings/NamePronunciationEditor';
import { VoiceSelectorList } from '../components/VoiceSelectorList';
import { ConciergePrefsEditor } from '../components/ConciergePrefsEditor';
import { AgeLifeSlider } from '../onboarding/AgeLifeSlider';
import { PersonalityMatrixStep } from '../onboarding/PersonalityMatrixStep';
import { SwipeBackView } from '../components/SwipeBackView';
import { useFinnusStore } from '../store/useFinnusStore';
import { useUserMemoryStore } from '../store/useUserMemoryStore';
import { useGpsStore } from '../store/useGpsStore';
import {
  LazyHelpCatalogBrowser,
  LazyFeedbackSection,
  LazyLiveQualityPanel,
  LazyHandsFreeActivationSettings,
  LazyModule1BackgroundSpeechSettings,
  LazyLearnedProfilePanel,
  LazyLogisticsPanel,
  LazyPushTriggersPanel,
  LazyUserTriggersPanel,
  LazyBetaSituationsPanel,
} from '../components/settings/lazySettingsPanels';
import {
  ALLERGY_INTOLERANCE_OPTIONS,
  ANSWER_STYLE_OPTIONS,
  ACCESSIBILITY_NEED_OPTIONS,
} from '../constants/conciergePrefs';
import { recordLastAction } from '../services/feedback/telemetryBuffer';
import { noteUiVisible } from '../services/diagnostics/interactionDelay';
import type { HelpEntry as CatalogHelpEntry } from '../constants/helpCatalog';
import {
  getCurrentCoords,
  probeGpsFix,
  refreshLocationDiagnostics,
} from '../services/locationService';
import {
  getApiUsageSnapshot,
  resetApiUsage,
} from '../services/llm/apiUsageTracker';
import {
  formatCostEur,
  getCostOverviewAsync,
  type CostOverview,
} from '../services/diagnostics/apiCostLedger';
import {
  getCartesiaCostSnapshot,
  getCartesiaCostSnapshotAsync,
  resetCartesiaCostToday,
} from '../services/cartesiaCostTracker';
import {
  formatBytes,
  getResourceUsageSnapshot,
  resetResourceUsage,
  type ResourceUsageSnapshot,
} from '../services/diagnostics/resourceUsageTracker';
import {
  getLastAuthUser,
  isAuthConfigured,
  mergeAuthIntoProfile,
  refreshAuthSession,
  signInWithApple,
  signInWithGoogle,
  signOutAuth,
  type AuthSessionUser,
} from '../services/account/findusAuth';
import {
  forceUserCloudSync,
  pullUserCloudOnLogin,
} from '../services/account/userCloudSync';
import { SocialAuthButtons } from '../components/account/SocialAuthButtons';
import { setNewsletterOptIn } from '../services/account/newsletterService';
import {
  cancelSettingsPrefetch,
  prioritizeSettingsSection,
  startDefaultSettingsPrefetch,
  type SettingsPrefetchSection,
} from '../services/ui/settingsSectionPrefetch';

type LegalCopy = {
  imprintText: string;
  privacyBody: string;
  terms: string;
  learning: string;
  placeholder: string;
  controllerIncomplete: boolean;
  accountSync: string;
  newsletter: string;
};

function useLegalCopy(enabled: boolean): LegalCopy | null {
  const [copy, setCopy] = useState<LegalCopy | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void import('../constants/legal').then((m) => {
      if (cancelled) return;
      const imprint = m.LEGAL_CHAPTERS.find((ch) => ch.id === 'imprint');
      const privacyChapters = m.LEGAL_CHAPTERS.filter((ch) => ch.id !== 'imprint');
      setCopy({
        imprintText: imprint
          ? `${imprint.title}\n\n${imprint.body}`
          : '',
        privacyBody: privacyChapters
          .map((ch) => `${ch.title}\n\n${ch.body}`)
          .join('\n\n'),
        terms: m.TERMS_OF_SERVICE,
        learning: m.LEARNING_FEEDBACK_CONSENT,
        placeholder: m.LEGAL_PLACEHOLDER_CALLOUT,
        controllerIncomplete: m.isLegalControllerIncomplete(),
        accountSync: m.ACCOUNT_CLOUD_SYNC_PASSAGE,
        newsletter: m.NEWSLETTER_PRIVACY_PASSAGE,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return copy;
}

type SettingsSection =
  | 'city'
  | 'storage'
  | 'travel'
  | 'personal'
  | 'character'
  | 'general'
  | 'triggers'
  | 'explanations'
  | 'legal'
  | 'internal'
  | 'developer'
  /** legacy aliases kept for back-compat during transition */
  | 'setup'
  | 'startBase'
  | 'saverAudio'
  | 'handsFree'
  | 'help';

type PersonalSubSection = 'contact' | 'about';

type CharacterSubSection = 'core' | 'detail' | 'voice';

type GeneralSubSection =
  | 'navExplore'
  | 'module1Story'
  | 'handsFree'
  | 'audio'
  | 'uiScale'
  | 'answerPrefs'
  | 'autoAlerts';

type DevSubSection =
  | 'costs'
  | 'playbook'
  | 'gps'
  | 'demo'
  | 'tts';

type SetupSubSection =
  | PersonalSubSection
  | CharacterSubSection
  | GeneralSubSection
  | 'prefs'
  | 'startBase'
  | 'interests'
  | 'navExplore'
  | 'voice';

type InternalSubSection = 'learned' | 'beta_situations' | 'logistics' | 'push';

export type SettingsScreenProps = {
  visible: boolean;
  profile: UserProfile;
  onClose: () => void;
  onSaved: (profile: UserProfile) => void;
  onReset: () => void;
  /** Beim Öffnen: Stimme oder Mikrofon/Audio-Sektion */
  initialFocus?: 'voice' | 'mic' | null;
  onOpenReisebuero?: () => void;
};

type Props = SettingsScreenProps;

export type SettingsScreenHandle = {
  /** true = Back verbraucht (eine Ebene oder schließen). */
  handleHardwareBack: () => boolean;
};

export const SettingsScreen = React.memo(
  React.forwardRef<SettingsScreenHandle, Props>(function SettingsScreen(
    {
      visible,
      profile,
      onClose,
      onSaved,
      onReset,
      initialFocus = null,
      onOpenReisebuero,
    },
    ref,
  ) {
  const [draft, setDraft] = useState(profile);
  const [openSection, setOpenSection] = useState<SettingsSection | null>(null);
  const [openSetup, setOpenSetup] = useState<SetupSubSection | null>(null);
  const [openPersonal, setOpenPersonal] = useState<PersonalSubSection | null>(
    null,
  );
  const [openCharacter, setOpenCharacter] = useState<CharacterSubSection | null>(
    null,
  );
  const [openGeneral, setOpenGeneral] = useState<GeneralSubSection | null>(null);
  const [openDev, setOpenDev] = useState<DevSubSection | null>(null);
  const [openInternal, setOpenInternal] = useState<InternalSubSection | null>(
    null,
  );
  const [showLegal, setShowLegal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [accountSyncOpen, setAccountSyncOpen] = useState(false);
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authUser, setAuthUser] = useState<AuthSessionUser | null>(
    () => getLastAuthUser(),
  );
  const [imprintOpen, setImprintOpen] = useState(false);
  const [muteCustomTime, setMuteCustomTime] = useState('');
  const [muteCustomRadius, setMuteCustomRadius] = useState('');
  const [muteStatusLine, setMuteStatusLine] = useState(() =>
    describeMuteSession(),
  );
  const lang = draft.language;
  const safePad = useSystemSafePad();
  const kbInset = useKeyboardInset();
  const scrollRef = useRef<ScrollView>(null);

  // Overlay statt RN-Modal (Android + Homescreen-WebView: Modal oft nur Dunkelheit)
  // Accordion nur beim Öffnen zurücksetzen — nicht bei jedem Profile-Notify
  // (sonst klappt „Stimme“ sofort zu, sobald voiceId gespeichert wird).
  useEffect(() => {
    if (visible) {
      noteUiVisible('settings');
      setDraft({ ...profile, speechRate: 1 });
      if (initialFocus === 'voice') {
        setOpenSection('character');
        setOpenCharacter('voice');
        setOpenPersonal(null);
        setOpenSetup('voice');
        setOpenGeneral(null);
      } else if (initialFocus === 'mic') {
        setOpenSection('general');
        setOpenGeneral('audio');
        setOpenSetup('audio');
        setOpenPersonal(null);
        setOpenCharacter(null);
      } else {
        setOpenSection(null);
        setOpenSetup(null);
        setOpenPersonal(null);
        setOpenCharacter(null);
        setOpenGeneral(null);
      }
      setOpenDev(null);
      setOpenInternal(null);
      setShowLegal(false);
      recordLastAction('settings_open');
      void hydrateMuteSession().then((s) =>
        setMuteStatusLine(describeMuteSession(s)),
      );
      const paint = requestAnimationFrame(() => {
        if (initialFocus === 'voice') {
          prioritizeSettingsSection('character');
        } else if (initialFocus === 'mic') {
          prioritizeSettingsSection('general');
        } else {
          startDefaultSettingsPrefetch();
        }
      });
      return () => {
        cancelAnimationFrame(paint);
        cancelSettingsPrefetch();
      };
    }
    cancelSettingsPrefetch();
    recordLastAction('settings_close');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur visible/focus
  }, [visible, initialFocus]);

  // Profile von außen (z. B. Voice-Agent) → Draft nachziehen, UI offen lassen
  useEffect(() => {
    if (!visible) return;
    setDraft((d) => {
      if (
        d.voiceId === profile.voiceId &&
        d.ttsProvider === profile.ttsProvider &&
        d.audioOutputMode === profile.audioOutputMode
      ) {
        return d;
      }
      return {
        ...d,
        ...profile,
        speechRate: 1,
        // Lokale Draft-Felder nicht blind überschreiben, wenn User tippt:
        voiceId: profile.voiceId,
        ttsProvider: profile.ttsProvider,
        audioOutputMode: profile.audioOutputMode,
      };
    });
  }, [
    visible,
    profile.voiceId,
    profile.ttsProvider,
    profile.audioOutputMode,
  ]);

  useEffect(() => {
    return subscribeMuteSession((s) =>
      setMuteStatusLine(describeMuteSession(s)),
    );
  }, []);

  /** System-Zurück: Unterebene → Accordion → schließen */
  const handleBack = useCallback(() => {
    if (showFeedbackModal) {
      setShowFeedbackModal(false);
      return;
    }
    if (showLegal) {
      setShowLegal(false);
      return;
    }
    if (privacyOpen) {
      setPrivacyOpen(false);
      return;
    }
    if (accountSyncOpen) {
      setAccountSyncOpen(false);
      return;
    }
    if (imprintOpen) {
      setImprintOpen(false);
      return;
    }
    if (termsOpen) {
      setTermsOpen(false);
      return;
    }
    if (learningOpen) {
      setLearningOpen(false);
      return;
    }
    if (partnerOpen) {
      setPartnerOpen(false);
      return;
    }
    if (openPersonal != null) {
      setOpenPersonal(null);
      return;
    }
    if (openCharacter != null) {
      setOpenCharacter(null);
      return;
    }
    if (openGeneral != null) {
      setOpenGeneral(null);
      return;
    }
    if (openDev != null) {
      setOpenDev(null);
      return;
    }
    if (openSetup != null) {
      setOpenSetup(null);
      return;
    }
    if (openInternal != null) {
      setOpenInternal(null);
      return;
    }
    if (openSection != null) {
      setOpenSection(null);
      return;
    }
    onClose();
  }, [
    showFeedbackModal,
    showLegal,
    privacyOpen,
    accountSyncOpen,
    imprintOpen,
    termsOpen,
    learningOpen,
    partnerOpen,
    openPersonal,
    openCharacter,
    openGeneral,
    openDev,
    openSetup,
    openInternal,
    openSection,
    onClose,
  ]);

  React.useImperativeHandle(
    ref,
    () => ({
      handleHardwareBack: () => {
        if (!visible) return false;
        handleBack();
        return true;
      },
    }),
    [visible, handleBack],
  );

  useEffect(() => {
    if (!visible || !showFeedbackModal) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setShowFeedbackModal(false);
      return true;
    });
    return () => sub.remove();
  }, [visible, showFeedbackModal]);

  useEffect(() => {
    if (!visible) return;
    void refreshAuthSession().then((u) => setAuthUser(u));
  }, [visible]);

  const helpExtraEntries = useMemo(
    () => buildSettingsExtraHelpEntries(draft),
    [draft.cityName],
  );

  const applyMuteWithWake = async (opts: {
    hours?: 1 | 2;
    untilClock?: string;
    radiusM?: number;
  }) => {
    const gps = useGpsStore.getState();
    let unmuteAtMs: number | null = null;
    if (opts.hours) {
      unmuteAtMs = Date.now() + opts.hours * 60 * 60_000;
    } else if (opts.untilClock) {
      const m = opts.untilClock.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) {
        Alert.alert('Uhrzeit', 'Bitte als HH:MM eingeben, z. B. 14:30.');
        return;
      }
      const d = new Date();
      d.setHours(Number(m[1]), Number(m[2]), 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      unmuteAtMs = d.getTime();
    }
    const radiusM = opts.radiusM ?? null;
    await startMuteSession({
      unmuteAtMs,
      wakeRadiusM: radiusM,
      originLat: gps.lat,
      originLng: gps.lng,
      reason: 'settings',
    });
    persistPatch({ audioOutputMode: 'mute' });
  };

  const legalCopy = useLegalCopy(openSection === 'legal');

  const patch = (p: Partial<UserProfile>) =>
    setDraft((d) => ({ ...d, ...p, speechRate: 1 }));

  const persistPatch = (p: Partial<UserProfile>) => {
    setDraft((d) => {
      const next = { ...d, ...p, speechRate: 1 };
      queueMicrotask(() => {
        void saveUserProfile(next).then((saved) => onSaved(saved));
      });
      return next;
    });
  };

  const applySignedIn = (user: AuthSessionUser) => {
    setAuthUser(user);
    persistPatch({
      accountMode: 'registered',
      ...mergeAuthIntoProfile(draft, user),
    });
    void pullUserCloudOnLogin();
  };

  const runSocialLogin = async (provider: 'google' | 'apple') => {
    setAuthBusy(true);
    try {
      const res =
        provider === 'apple'
          ? await signInWithApple()
          : await signInWithGoogle();
      if (res.ok && res.user) {
        applySignedIn(res.user);
        Alert.alert('Konto', 'Angemeldet. Daten werden abgeglichen.');
        return;
      }
      if (!res.cancelled) {
        Alert.alert('Konto', res.error ?? 'Anmeldung fehlgeschlagen.');
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const clearNested = () => {
    setOpenPersonal(null);
    setOpenCharacter(null);
    setOpenGeneral(null);
    setOpenInternal(null);
    setOpenDev(null);
    setOpenSetup(null);
  };

  const toggleSection = (id: SettingsSection) => {
    if (openSection === id) {
      startDefaultSettingsPrefetch();
      clearNested();
      setOpenSection(null);
      return;
    }
    clearNested();
    if (
      id === 'city' ||
      id === 'travel' ||
      id === 'personal' ||
      id === 'character' ||
      id === 'general' ||
      id === 'triggers' ||
      id === 'explanations' ||
      id === 'legal' ||
      id === 'internal' ||
      id === 'developer'
    ) {
      prioritizeSettingsSection(id as SettingsPrefetchSection);
    }
    setOpenSection(id);
  };

  const sectionPinTitle = (id: SettingsSection | null): string => {
    switch (id) {
      case 'city':
        return t(lang, 'settingsCity');
      case 'storage':
        return t(lang, 'settingsStorage');
      case 'travel':
        return 'Aktuelle Reise';
      case 'personal':
        return 'Persönliche Informationen';
      case 'character':
        return 'Yorros Charakter';
      case 'general':
        return 'Allgemeine Einstellungen';
      case 'triggers':
        return 'Meine Trigger';
      case 'explanations':
      case 'legal':
        return 'Erklärungen und Datenschutz';
      case 'internal':
        return 'Nur für dich intern';
      case 'developer':
        return t(lang, 'settingsDeveloper');
      default:
        return t(lang, 'settings');
    }
  };

  useEffect(() => {
    if (!visible) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [visible, openSection, openPersonal, openCharacter, openGeneral, openInternal]);

  const nestedPin =
    openSection === 'personal' && openPersonal
      ? {
          title: openPersonal === 'contact' ? 'Kontakt' : 'Über dich',
          collapse: () => setOpenPersonal(null),
        }
      : openSection === 'character' && openCharacter
        ? {
            title:
              openCharacter === 'core'
                ? 'Kernrolle'
                : openCharacter === 'detail'
                  ? 'Weitere Einstellungen'
                  : t(lang, 'settingsVoice'),
            collapse: () => setOpenCharacter(null),
          }
        : openSection === 'general' && openGeneral
          ? {
              title:
                openGeneral === 'module1Story'
                  ? 'Modul 1 — Kurzantworten'
                  : openGeneral === 'answerPrefs'
                    ? 'Antwortstil & Hinweise'
                    : openGeneral === 'autoAlerts'
                      ? 'Auto-Benachrichtigungen'
                      : openGeneral === 'uiScale'
                        ? 'Schrift & Buttons'
                        : openGeneral === 'navExplore'
                          ? 'Modul 1 während Navigation'
                          : openGeneral === 'handsFree'
                            ? 'Hands-free & Live-Chat'
                            : 'Audio & Sparmodus',
              collapse: () => setOpenGeneral(null),
            }
          : openSection === 'internal' && openInternal
            ? {
                title:
                  openInternal === 'learned'
                    ? 'Gelerntes Profil'
                    : openInternal === 'beta_situations'
                      ? 'Beta-Situationen'
                      : openInternal === 'logistics'
                        ? 'Logistik'
                        : 'Push-Nachrichten & Trigger',
                collapse: () => setOpenInternal(null),
              }
            : null;
  const handleSave = () => {
    try {
      const { triggerHapticPulse } = require('../services/navigation/haptics') as {
        triggerHapticPulse: (k?: 'single' | 'double' | 'heavy') => void;
      };
      triggerHapticPulse('heavy');
    } catch {
      /* soft */
    }
    // UI zuerst schließen — Speichern darf nicht hinter Disk/SQLite hängen.
    const snapshot = draft;
    onClose();
    void saveUserProfile(snapshot)
      .then((saved) => onSaved(saved))
      .catch((err) => {
        console.warn('[settings] save failed:', err);
      });
  };

  const handleReset = () => {
    Alert.alert(t(lang, 'resetApp'), t(lang, 'resetConfirm'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      {
        text: t(lang, 'resetApp'),
        style: 'destructive',
        onPress: async () => {
          await stopSpeaking();
          await resetVoiceSystem();
          await resetUserProfile();
          await clearStampPassport();
          useFinnusStore.getState().resetTourContext();
          useFinnusStore.setState({ visitedHistory: [] });
          onClose();
          onReset();
        },
      },
    ]);
  };

  // Overlay statt RN-Modal — Tree bleibt mounted (Reopen = show, kein Cold-Mount).
  return (
    <View
      style={[styles.overlayRoot, !visible && styles.overlayHidden]}
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityViewIsModal={visible}
    >
      <SafeAreaView
        style={[
          styles.safe,
          { paddingTop: safePad.top, marginBottom: kbInset },
        ]}
        edges={kbInset > 80 ? [] : ['bottom']}
      >
        <SwipeBackView
          enabled={visible}
          captureHardwareBack={false}
          onBack={handleBack}
        >
          <View style={styles.header}>
            <Text style={styles.title}>{t(lang, 'settings')}</Text>
            <Pressable onPress={handleBack}>
              <Text style={styles.close}>{t(lang, 'close')}</Text>
            </Pressable>
          </View>

          {openSection && !nestedPin ? (
            <View style={styles.settingsStickyWrap}>
              <Pressable
                onPress={() => toggleSection(openSection)}
                style={[styles.accordion, styles.accordionOpen]}
                accessibilityRole="button"
                accessibilityState={{ expanded: true }}
                accessibilityLabel={`${sectionPinTitle(openSection)} zuklappen`}
              >
                <View style={styles.accordionHeader}>
                  <Text style={styles.accordionTitle} numberOfLines={2}>
                    {sectionPinTitle(openSection)}
                  </Text>
                  <Text style={styles.chevron}>▾</Text>
                </View>
              </Pressable>
            </View>
          ) : null}
          {nestedPin ? (
            <View style={styles.settingsStickyWrap}>
              <Pressable
                onPress={nestedPin.collapse}
                style={[styles.setupRow, styles.setupRowOpen]}
                accessibilityRole="button"
                accessibilityState={{ expanded: true }}
                accessibilityLabel={`${nestedPin.title} zuklappen`}
              >
                <View style={styles.setupRowHeader}>
                  <Text style={styles.setupRowTitle} numberOfLines={2}>
                    {nestedPin.title}
                  </Text>
                  <Text style={styles.chevron}>▾</Text>
                </View>
              </Pressable>
            </View>
          ) : null}

          <ScrollView
            ref={scrollRef}
            style={styles.bodyScroll}
            contentContainerStyle={[
              styles.body,
              kbInset > 0 ? { paddingBottom: kbInset + 48 } : null,
            ]}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            automaticallyAdjustKeyboardInsets
          >
            <ReorderChildren openId={openSection}>
            {/* 1. Stadt · Aktuelle Reise · Reisebüro */}
            <SettingsSlot id="city">
            <Accordion
              title={t(lang, 'settingsCity')}
              open={openSection === 'city'}
              hideHeader={openSection === 'city'}
              onToggle={() => toggleSection('city')}
            >
              {() => (
              <CityEditor
                lang={lang}
                selectedId={draft.cityId}
                selectedName={draft.cityName}
                onInstalled={(cityId, cityName, coords) => {
                  useUserMemoryStore.getState().clearHotelsOutsideCity(cityId);
                  persistPatch({
                    cityId,
                    cityName,
                    wantToExperience: '',
                    avoidExperience: '',
                  });
                  setOpenSection('city');
                  void import('../services/softWorkingCity')
                    .then((m) =>
                      m.setSoftWorkingCity({
                        id: cityId,
                        name: cityName,
                        lat: coords?.lat ?? null,
                        lng: coords?.lng ?? null,
                        soft: m.isSoftCityId(cityId),
                        source: m.isSoftCityId(cityId)
                          ? 'gps_soft'
                          : 'manual',
                      }),
                    )
                    .catch(() => undefined);
                  void import('../services/memory/travelPrefsReview')
                    .then((m) => m.maybeOfferTravelPrefsAfterCity(cityId))
                    .catch(() => undefined);
                }}
              />
              )}
            </Accordion>
            </SettingsSlot>

            <SettingsSlot id="travel">
            <Accordion
              title="Aktuelle Reise"
              open={openSection === 'travel'}
              hideHeader={openSection === 'travel'}
              onToggle={() => toggleSection('travel')}
            >
              {() => (
              <>
              <Text style={styles.hint}>
                Alles, was sich pro Stadt ändern kann: Reisezweck, Begleitung,
                Anreise, Energie, Budget, Tourlänge, Reisestil — plus Startpunkt
                & Unterkunft. Nach neuer Stadtauswahl höchstens alle 14 Tage —
                oder nach langer Pause ohne Nutzung.
              </Text>
              <ConciergePrefsEditor
                draft={draft}
                onChange={patch}
                scope="trip"
                mode="full"
              />
              </>
              )}
            </Accordion>
            </SettingsSlot>

            <SettingsSlot id="reisebuero">
            <Pressable
              onPress={() => {
                onClose();
                onOpenReisebuero?.();
              }}
              style={styles.accordion}
              accessibilityRole="button"
              accessibilityLabel="Yorro Reisebüro öffnen"
            >
              <View style={styles.accordionHeader}>
                <Text style={styles.accordionTitle}>Yorro Reisebüro</Text>
                <Text style={styles.chevron}>▸</Text>
              </View>
            </Pressable>
            </SettingsSlot>

            <GroupGap />

            {/* 2. Persönlich · Allgemein · Speicher */}
            <SettingsSlot id="personal">
            <Accordion
              title="Persönliche Informationen"
              open={openSection === 'personal'}
              hideHeader={openSection === 'personal'}
              onToggle={() => toggleSection('personal')}
            >
              {() => (
              <>
              {!openPersonal ? (
              <Text style={styles.hint}>
                Was sich selten ändert: Kontakt und Über dich — inkl.
                Ernährung — dein Profil.
              </Text>
              ) : null}
              <ReorderChildren openId={openPersonal}>
              <SettingsSlot id="contact">
              <SetupRow
                title="Kontakt"
                open={openPersonal === 'contact'}
                hideHeader={openPersonal === 'contact'}
                onToggle={() =>
                  setOpenPersonal((c) => (c === 'contact' ? null : 'contact'))
                }
              >
                <ContactEditor draft={draft} onChange={patch} />
              </SetupRow>
              </SettingsSlot>

              <SettingsSlot id="about">
              <SetupRow
                title="Über dich"
                open={openPersonal === 'about'}
                hideHeader={openPersonal === 'about'}
                onToggle={() =>
                  setOpenPersonal((c) => (c === 'about' ? null : 'about'))
                }
              >
                <AboutMeEditor draft={draft} onChange={patch} />
              </SetupRow>
              </SettingsSlot>
              </ReorderChildren>
              </>
              )}
            </Accordion>
            </SettingsSlot>

            <SettingsSlot id="character">
            <Accordion
              title="Yorros Charakter"
              open={openSection === 'character'}
              hideHeader={openSection === 'character'}
              onToggle={() => toggleSection('character')}
            >
              {() => (
              <>
              {!openCharacter ? (
              <Text style={styles.hint}>
                Kernrolle, Tonalität, Wissen, Spleens und Stimme — so soll
                Yorro mit dir sein.
              </Text>
              ) : null}
              <ReorderChildren openId={openCharacter}>
              <SettingsSlot id="core">
              <SetupRow
                title="Kernrolle"
                open={openCharacter === 'core'}
                hideHeader={openCharacter === 'core'}
                onToggle={() =>
                  setOpenCharacter((c) => (c === 'core' ? null : 'core'))
                }
              >
                <CharacterEditor
                  draft={draft}
                  onChange={patch}
                  lang={lang}
                  sections="core"
                />
              </SetupRow>
              </SettingsSlot>

              <SettingsSlot id="detail">
              <SetupRow
                title="Weitere Einstellungen"
                open={openCharacter === 'detail'}
                hideHeader={openCharacter === 'detail'}
                onToggle={() =>
                  setOpenCharacter((c) => (c === 'detail' ? null : 'detail'))
                }
              >
                <Text style={styles.hint}>
                  Tonalität & Stimmung, Wissensvermittlung und Spleens.
                </Text>
                <CharacterEditor
                  draft={draft}
                  onChange={patch}
                  lang={lang}
                  sections="detail"
                />
              </SetupRow>
              </SettingsSlot>

              <SettingsSlot id="voice">
              <SetupRow
                title={t(lang, 'settingsVoice')}
                open={openCharacter === 'voice'}
                hideHeader={openCharacter === 'voice'}
                onToggle={() =>
                  setOpenCharacter((c) => (c === 'voice' ? null : 'voice'))
                }
              >
                <Text style={styles.hint}>
                  Play = Offline-Hörprobe. Tippen speichert die Stimme.
                </Text>
                <VoiceSelectorList
                  selectedVoiceId={draft.voiceId}
                  recommendedVoiceId={resolveVoiceForPersonality({
                    coreRole: draft.coreRole,
                    vibeTone: draft.vibeTone,
                    knowledgeStyle: draft.knowledgeStyle,
                    spleens: draft.spleens,
                    gender: draft.gender,
                  })}
                  onSelectVoice={(id: VoiceId) => {
                    persistPatch({
                      voiceId: id,
                      language: 'de',
                      ttsProvider: 'cartesia',
                      voicePinnedByUser: true,
                    });
                  }}
                  onAfterSelect={(id: VoiceId) => {
                    void voicePreloader.switchActiveVoice(id);
                  }}
                />
              </SetupRow>
              </SettingsSlot>
              </ReorderChildren>
              </>
              )}
            </Accordion>
            </SettingsSlot>

            <SettingsSlot id="general">
            <Accordion
              title="Allgemeine Einstellungen"
              open={openSection === 'general'}
              hideHeader={openSection === 'general'}
              onToggle={() => toggleSection('general')}
            >
              {() => (
              <>
              <ReorderChildren openId={openGeneral}>
              <SettingsSlot id="autoAlerts">
              <SetupRow
                title="Auto-Benachrichtigungen"
                open={openGeneral === 'autoAlerts'}
                hideHeader={openGeneral === 'autoAlerts'}
                onToggle={() =>
                  setOpenGeneral((c) =>
                    c === 'autoAlerts' ? null : 'autoAlerts',
                  )
                }
              >
                <Text style={styles.hint}>
                  Alles, was Yorro von allein sagen oder pushen darf. Master aus
                  = alles still.
                </Text>
                <View style={[styles.switchRow, { marginTop: spacing.sm }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.langTitle}>Alle Auto-Hinweise</Text>
                    <Text style={styles.langHint}>
                      Master-Schalter für Push und ungefragtes Sprechen.
                    </Text>
                  </View>
                  <Switch
                    value={draft.notificationsEnabled !== false}
                    onValueChange={(notificationsEnabled) =>
                      patch({ notificationsEnabled })
                    }
                    trackColor={{ false: '#444', true: colors.accent }}
                  />
                </View>
                {(
                  [
                    {
                      id: 'weather' as const,
                      title: 'Wetter / Regen',
                      hint: 'Warnung vor Regen — auch als Push.',
                    },
                    {
                      id: 'parking' as const,
                      title: 'Parkplatz-Erinnerung',
                      hint: 'Leave-by zurück zum Auto.',
                    },
                    {
                      id: 'transit' as const,
                      title: 'Bus / Bahn / Flug',
                      hint: 'Leave-by und Abfahrts-Erinnerungen.',
                    },
                    {
                      id: 'ambientEvents' as const,
                      title: 'Ambient „was geht heute“',
                      hint: 'Ungefragt Events in der Nähe ansagen.',
                    },
                    {
                      id: 'cityWelcome' as const,
                      title: 'Stadt-Willkommen',
                      hint: 'Begrüßung beim Stadtwechsel oder Ankommen.',
                    },
                    {
                      id: 'welcomeBack' as const,
                      title: 'Welcome-back / Morgen',
                      hint: 'Rückkehr-Begrüßung und Morgen-Briefing.',
                    },
                  ] as const
                ).map((opt) => {
                  const on =
                    draft.notificationsEnabled !== false &&
                    isProactiveAlertEnabled(opt.id, draft);
                  return (
                    <View
                      key={opt.id}
                      style={[styles.switchRow, { marginTop: spacing.sm }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.langTitle}>{opt.title}</Text>
                        <Text style={styles.langHint}>{opt.hint}</Text>
                      </View>
                      <Switch
                        value={on}
                        disabled={draft.notificationsEnabled === false}
                        onValueChange={(enabled) =>
                          patch(patchProactiveAlert(draft, opt.id, enabled))
                        }
                        trackColor={{ false: '#444', true: colors.accent }}
                      />
                    </View>
                  );
                })}
              </SetupRow>
              </SettingsSlot>

              <SettingsSlot id="answerPrefs">
              <SetupRow
                title="Antwortstil & Hinweise"
                open={openGeneral === 'answerPrefs'}
                hideHeader={openGeneral === 'answerPrefs'}
                onToggle={() =>
                  setOpenGeneral((c) =>
                    c === 'answerPrefs' ? null : 'answerPrefs',
                  )
                }
              >
                <Text style={styles.hint}>Antwortstil</Text>
                <View style={styles.audioModeRow}>
                  {ANSWER_STYLE_OPTIONS.map((o) => {
                    const on = (draft.answerStyle ?? 'short') === o.id;
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => patch({ answerStyle: o.id })}
                        style={[styles.audioModeChip, on && styles.audioModeChipOn]}
                      >
                        <Text
                          style={[
                            styles.audioModeLabel,
                            on && styles.audioModeLabelOn,
                          ]}
                        >
                          {o.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </SetupRow>
              </SettingsSlot>

              <SettingsSlot id="uiScale">
              <SetupRow
                title="Schrift & Buttons"
                open={openGeneral === 'uiScale'}
                hideHeader={openGeneral === 'uiScale'}
                onToggle={() =>
                  setOpenGeneral((c) => (c === 'uiScale' ? null : 'uiScale'))
                }
              >
                <Text style={styles.hint}>
                  Auto = ab 55 größer. Gilt app-weit.
                </Text>
                <Text style={styles.hint}>Schrift</Text>
                <View style={styles.audioModeRow}>
                  {(
                    [
                      { id: 'auto' as const, label: 'Auto' },
                      { id: 'normal' as const, label: 'Normal' },
                      { id: 'large' as const, label: 'Groß' },
                    ] as const
                  ).map((opt) => {
                    const on = (draft.uiTextScale ?? 'auto') === opt.id;
                    return (
                      <Pressable
                        key={`text_${opt.id}`}
                        onPress={() => patch({ uiTextScale: opt.id })}
                        style={[styles.audioModeChip, on && styles.audioModeChipOn]}
                      >
                        <Text
                          style={[
                            styles.audioModeLabel,
                            on && styles.audioModeLabelOn,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.hint}>Buttons</Text>
                <View style={styles.audioModeRow}>
                  {(
                    [
                      { id: 'auto' as const, label: 'Auto' },
                      { id: 'normal' as const, label: 'Normal' },
                      { id: 'large' as const, label: 'Groß' },
                    ] as const
                  ).map((opt) => {
                    const on = (draft.uiButtonScale ?? 'auto') === opt.id;
                    return (
                      <Pressable
                        key={`btn_${opt.id}`}
                        onPress={() => patch({ uiButtonScale: opt.id })}
                        style={[styles.audioModeChip, on && styles.audioModeChipOn]}
                      >
                        <Text
                          style={[
                            styles.audioModeLabel,
                            on && styles.audioModeLabelOn,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </SetupRow>
              </SettingsSlot>

              <SettingsSlot id="module1Story">
              <SetupRow
                title="Modul 1 — Kurzantworten"
                open={openGeneral === 'module1Story'}
                hideHeader={openGeneral === 'module1Story'}
                onToggle={() =>
                  setOpenGeneral((c) =>
                    c === 'module1Story' ? null : 'module1Story',
                  )
                }
              >
                <Text style={styles.hint}>
                  Standard: volle immersive Story (~1000 Zeichen) — Geschichte
                  zum Anfassen. Optional nur Name + kurze Zusammenfassung (max.
                  400). Hardfacts immer aus dem Gesprochenen, max. 3 Stichpunkte.
                </Text>
                {(
                  [
                    {
                      id: 'full' as const,
                      label: 'Volle Story (Standard)',
                      hint: 'Spannende Historie + Aktuelles + was man hier tun kann.',
                    },
                    {
                      id: 'brief' as const,
                      label: 'Kurzantworten',
                      hint: 'Nur Name + Zusammenfassung, max. 400 Zeichen.',
                    },
                  ] as const
                ).map((opt) => {
                  const on = (draft.module1StoryMode ?? 'full') === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => patch({ module1StoryMode: opt.id })}
                      style={[
                        styles.langRow,
                        on && styles.langOn,
                        { marginTop: 8 },
                      ]}
                    >
                      <View style={styles.langCopy}>
                        <Text style={styles.langTitle}>{opt.label}</Text>
                        <Text style={styles.langHint}>{opt.hint}</Text>
                      </View>
                      {on ? <Text style={styles.langCheck}>✓</Text> : null}
                    </Pressable>
                  );
                })}
              </SetupRow>
              </SettingsSlot>

              <SettingsSlot id="navExplore">
              <SetupRow
                title="Modul 1 während Navigation"
                open={openGeneral === 'navExplore'}
                hideHeader={openGeneral === 'navExplore'}
                onToggle={() =>
                  setOpenGeneral((c) =>
                    c === 'navExplore' ? null : 'navExplore',
                  )
                }
              >
                <Text style={styles.hint}>
                  Wann Yorro Orte erzählt, während eine Route aktiv ist.
                </Text>
                {(
                  [
                    {
                      id: 'quiet' as const,
                      label: 'Leise mitlaufen (Standard)',
                      hint: 'Teaser unterwegs, volle Story unter 10 km/h am Ort.',
                    },
                    {
                      id: 'mute_until_dest' as const,
                      label: 'Stumm bis Ziel',
                      hint: 'Keine Modul-1-Stories bis zum Navigationsziel.',
                    },
                    {
                      id: 'full' as const,
                      label: 'Wie ohne Navigation',
                      hint: 'Keine Kürzung — wie beim freien Erkunden.',
                    },
                  ] as const
                ).map((opt) => {
                  const on = (draft.navExploreMode ?? 'quiet') === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => patch({ navExploreMode: opt.id })}
                      style={[
                        styles.langRow,
                        on && styles.langOn,
                        { marginTop: 8 },
                      ]}
                    >
                      <View style={styles.langCopy}>
                        <Text style={styles.langTitle}>{opt.label}</Text>
                        <Text style={styles.langHint}>{opt.hint}</Text>
                      </View>
                      {on ? <Text style={styles.langCheck}>✓</Text> : null}
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() =>
                    patch({
                      wegweiserMapPreview: !(draft.wegweiserMapPreview !== false),
                    })
                  }
                  style={[
                    styles.langRow,
                    draft.wegweiserMapPreview !== false && styles.langOn,
                    { marginTop: 12 },
                  ]}
                >
                  <View style={styles.langCopy}>
                    <Text style={styles.langTitle}>Wegweiser auf der Karte</Text>
                    <Text style={styles.langHint}>
                      Ziel blau markieren, Fuß-ETA und Route — Navigation erst nach Tap.
                    </Text>
                  </View>
                  {draft.wegweiserMapPreview !== false ? (
                    <Text style={styles.langCheck}>✓</Text>
                  ) : null}
                </Pressable>
              </SetupRow>
              </SettingsSlot>

              <SettingsSlot id="handsFree">
              <SetupRow
                title="Hands-free & Live-Chat"
                open={openGeneral === 'handsFree'}
                hideHeader={openGeneral === 'handsFree'}
                onToggle={() =>
                  setOpenGeneral((c) =>
                    c === 'handsFree' ? null : 'handsFree',
                  )
                }
              >
                <LazyHandsFreeActivationSettings />
              </SetupRow>
              </SettingsSlot>

              <SettingsSlot id="audio">
              <SetupRow
                title="Audio & Sparmodus"
                open={openGeneral === 'audio'}
                hideHeader={openGeneral === 'audio'}
                onToggle={() =>
                  setOpenGeneral((c) => (c === 'audio' ? null : 'audio'))
                }
              >
                <Text style={styles.hint}>
                  Mikrofon, Stimme/Untertitel und Sparmodus.
                </Text>
                <Text style={[styles.hint, { marginTop: spacing.sm }]}>
                  Sprache: Deutsch (fest).
                </Text>
                <Text style={[styles.hint, { marginTop: spacing.md }]}>
                  Spracheingabe / Mikrofon
                </Text>
                <View style={styles.audioModeRow}>
                  {(
                    [
                      {
                        id: 'hear' as const,
                        label: 'Sprache an',
                        hint: 'Mikro tippen/halten',
                      },
                      {
                        id: 'dont_hear' as const,
                        label: 'Nur tippen',
                        hint: 'Kein Mikrofon',
                      },
                    ] as const
                  ).map((opt) => {
                    const on = (draft.micListenMode ?? 'hear') === opt.id;
                    return (
                      <Pressable
                        key={opt.id}
                        onPress={() => {
                          const now = new Date().toISOString();
                          if (opt.id === 'hear') {
                            persistPatch({
                              micListenMode: 'hear',
                              hasAcceptedAudioConsent: true,
                              audioConsentAt: draft.audioConsentAt ?? now,
                            });
                            void (async () => {
                              try {
                                const { Audio } = await import('expo-av');
                                await Audio.requestPermissionsAsync();
                              } catch {
                                /* soft — STT fragt später erneut */
                              }
                              try {
                                const {
                                  ExpoSpeechRecognitionModule,
                                } = require('expo-speech-recognition') as {
                                  ExpoSpeechRecognitionModule: {
                                    requestPermissionsAsync: () => Promise<unknown>;
                                  };
                                };
                                await ExpoSpeechRecognitionModule.requestPermissionsAsync();
                              } catch {
                                /* soft */
                              }
                            })();
                          } else {
                            persistPatch({
                              micListenMode: 'dont_hear',
                              hasAcceptedAudioConsent: false,
                            });
                          }
                        }}
                        style={[
                          styles.audioModeChip,
                          on && styles.audioModeChipOn,
                        ]}
                      >
                        <Text
                          style={[
                            styles.audioModeLabel,
                            on && styles.audioModeLabelOn,
                          ]}
                        >
                          {opt.label}
                        </Text>
                        <Text style={styles.audioModeHint}>{opt.hint}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.saverSwitchRow}>
                  <View style={styles.saverSwitchCopy}>
                    <Text style={styles.saverSwitchTitle}>Sparmodus</Text>
                    <Text style={styles.hint}>
                      Kürzere Antworten, weniger Maps und Live-Recherche.
                    </Text>
                  </View>
                  <Switch
                    value={!!draft.dataSaverMode}
                    onValueChange={(dataSaverMode) =>
                      persistPatch({ dataSaverMode })
                    }
                    trackColor={{ false: '#444', true: colors.accent }}
                    thumbColor={colors.text}
                  />
                </View>

                <Text style={[styles.hint, { marginTop: spacing.md }]}>
                  Audio-Ausgabe
                </Text>
                <View style={styles.audioModeRow}>
                  {(
                    [
                      {
                        id: 'normal' as AudioOutputMode,
                        label: 'Normal',
                        hint: 'Stimme + Untertitel',
                      },
                      {
                        id: 'mute' as AudioOutputMode,
                        label: 'Stumm',
                        hint: 'Kein TTS',
                      },
                      {
                        id: 'text_only' as AudioOutputMode,
                        label: 'Nur Text',
                        hint: 'Untertitel statt Stimme',
                      },
                    ] as const
                  ).map((opt) => {
                    const on =
                      (draft.audioOutputMode ?? 'normal') === opt.id;
                    return (
                      <Pressable
                        key={opt.id}
                        onPress={() => {
                          if (opt.id === 'normal' || opt.id === 'text_only') {
                            void clearMuteSession({ restoreAudio: false });
                            persistPatch({ audioOutputMode: opt.id });
                            return;
                          }
                          persistPatch({ audioOutputMode: 'mute' });
                        }}
                        style={[
                          styles.audioModeChip,
                          on && styles.audioModeChipOn,
                        ]}
                      >
                        <Text
                          style={[
                            styles.audioModeLabel,
                            on && styles.audioModeLabelOn,
                          ]}
                        >
                          {opt.label}
                        </Text>
                        <Text style={styles.audioModeHint}>{opt.hint}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <LazyModule1BackgroundSpeechSettings />
                {(draft.audioOutputMode ?? 'normal') === 'mute' && (
                  <View style={{ gap: 8, marginTop: spacing.sm }}>
                    <Text style={styles.hint}>
                      Wann soll Yorro wieder aufwachen? {muteStatusLine}
                    </Text>
                    <View style={styles.audioModeRow}>
                      <Pressable
                        style={styles.audioModeChip}
                        onPress={() =>
                          void muteForHours(1).then(() =>
                            persistPatch({ audioOutputMode: 'mute' }),
                          )
                        }
                      >
                        <Text style={styles.audioModeLabel}>1 Std.</Text>
                      </Pressable>
                      <Pressable
                        style={styles.audioModeChip}
                        onPress={() =>
                          void muteForHours(2).then(() =>
                            persistPatch({ audioOutputMode: 'mute' }),
                          )
                        }
                      >
                        <Text style={styles.audioModeLabel}>2 Std.</Text>
                      </Pressable>
                    </View>
                    {getMuteSession().active && (
                      <Pressable
                        style={styles.audioModeChip}
                        onPress={() => {
                          void clearMuteSession({ restoreAudio: true }).then(
                            () => persistPatch({ audioOutputMode: 'normal' }),
                          );
                        }}
                      >
                        <Text style={styles.audioModeLabel}>
                          Stumm beenden / aufwachen
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </SetupRow>
              </SettingsSlot>
              </ReorderChildren>
              </>
              )}
            </Accordion>
            </SettingsSlot>

            <SettingsSlot id="storage">
            <Accordion
              title={t(lang, 'settingsStorage')}
              open={openSection === 'storage'}
              hideHeader={openSection === 'storage'}
              onToggle={() => toggleSection('storage')}
            >
              {() => (
                <StorageEditor
                  lang={lang}
                  activeCityId={draft.cityId}
                />
              )}
            </Accordion>
            </SettingsSlot>

            <GroupGap />

            {/* 3. Trigger · Erklärungen & Datenschutz */}
            <SettingsSlot id="triggers">
            <Accordion
              title="Meine Trigger"
              open={openSection === 'triggers'}
              hideHeader={openSection === 'triggers'}
              onToggle={() => {
                if (openSection !== 'triggers') {
                  void import('../services/onboarding/uiCoachMarks').then((m) =>
                    m.onUserOpenedTriggers(),
                  );
                }
                toggleSection('triggers');
              }}
            >
              {() => (
              <>
              <Text style={styles.hint}>
                Zeit-, Geo- und Navigations-Erinnerungen aus der Timeline.
              </Text>
              <LazyUserTriggersPanel />
              </>
              )}
            </Accordion>
            </SettingsSlot>

            <SettingsSlot id="legal">
            <Accordion
              title="Erklärungen und Datenschutz"
              open={openSection === 'legal'}
              hideHeader={openSection === 'legal'}
              onToggle={() => toggleSection('legal')}
            >
              {() => (
              <View style={styles.legalEmbeddedAccRoot}>
                <Text style={styles.hint}>
                  Funktionen, Floskeln und Tipps — plus Konto, Datenschutz und
                  Impressum.
                </Text>
                <LazyHelpCatalogBrowser
                  showLead
                  extraEntries={helpExtraEntries}
                />
                <View style={styles.legalEmbeddedDivider} />
                <Pressable
                  onPress={() => setAccountSyncOpen((v) => !v)}
                  style={styles.legalEmbeddedAccHeader}
                >
                  <Text style={styles.legalEmbeddedAccTitle}>
                    Konto, Sync & Newsletter
                  </Text>
                  <Text style={styles.chevron}>
                    {accountSyncOpen ? '▾' : '▸'}
                  </Text>
                </Pressable>
                {accountSyncOpen ? (
                  <View style={styles.legalEmbeddedAccBody}>
                    <Text style={styles.legalEmbeddedText}>
                      {legalCopy?.accountSync}
                      {'\n\n'}
                      {legalCopy?.newsletter}
                    </Text>
                    <View
                      style={[
                        styles.saverSwitchRow,
                        { marginTop: spacing.md },
                      ]}
                    >
                      <View style={styles.saverSwitchCopy}>
                        <Text style={styles.saverSwitchTitle}>Newsletter</Text>
                        <Text style={styles.hint}>
                          Produkt-Updates per E-Mail — nur mit Opt-in.
                        </Text>
                      </View>
                      <Switch
                        value={!!draft.newsletterOptIn}
                        onValueChange={(on) => {
                          patch({ newsletterOptIn: on });
                          void setNewsletterOptIn(on, draft.language);
                        }}
                        trackColor={{ false: '#444', true: colors.accent }}
                        thumbColor={colors.text}
                      />
                    </View>
                    {isAuthConfigured() ? (
                      <>
                        <Text style={[styles.hint, { marginTop: spacing.sm }]}>
                          {authUser
                            ? `Angemeldet${authUser.email ? ` als ${authUser.email}` : ''}.`
                            : 'Noch nicht angemeldet — Stempel, Fog und Pläne kommen nach Login zurück.'}
                        </Text>
                        {!authUser ? (
                          <View style={{ marginTop: spacing.sm }}>
                            <SocialAuthButtons
                              onGoogle={() => void runSocialLogin('google')}
                              onApple={() => void runSocialLogin('apple')}
                              busy={authBusy || cloudSyncBusy}
                            />
                          </View>
                        ) : (
                          <Pressable
                            style={[
                              styles.audioModeChip,
                              { marginTop: spacing.sm, alignSelf: 'flex-start' },
                            ]}
                            disabled={authBusy}
                            onPress={() => {
                              setAuthBusy(true);
                              void signOutAuth()
                                .then(() => {
                                  setAuthUser(null);
                                  persistPatch({ accountMode: 'guest' });
                                })
                                .finally(() => setAuthBusy(false));
                            }}
                          >
                            <Text style={styles.audioModeLabel}>Abmelden</Text>
                          </Pressable>
                        )}
                        <Pressable
                          style={[
                            styles.audioModeChip,
                            { marginTop: spacing.sm, alignSelf: 'flex-start' },
                          ]}
                          disabled={cloudSyncBusy || !authUser}
                          onPress={() => {
                            setCloudSyncBusy(true);
                            void forceUserCloudSync()
                              .then(() =>
                                Alert.alert(
                                  'Sync',
                                  'Cloud-Abgleich abgeschlossen.',
                                ),
                              )
                              .catch(() =>
                                Alert.alert(
                                  'Sync',
                                  'Abgleich fehlgeschlagen oder offline.',
                                ),
                              )
                              .finally(() => setCloudSyncBusy(false));
                          }}
                        >
                          {cloudSyncBusy ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.text}
                            />
                          ) : (
                            <Text style={styles.audioModeLabel}>
                              Jetzt synchronisieren
                            </Text>
                          )}
                        </Pressable>
                      </>
                    ) : (
                      <Text style={[styles.hint, { marginTop: spacing.sm }]}>
                        Cloud-Sync ist in dieser Build nicht aktiv.
                      </Text>
                    )}
                  </View>
                ) : null}

                <View style={styles.legalEmbeddedDivider} />
                <Pressable
                  onPress={() => setPrivacyOpen((v) => !v)}
                  style={styles.legalEmbeddedAccHeader}
                >
                  <Text style={styles.legalEmbeddedAccTitle}>Datenschutz</Text>
                  <Text style={styles.chevron}>
                    {privacyOpen ? '▾' : '▸'}
                  </Text>
                </Pressable>
                {privacyOpen ? (
                  <View style={styles.legalEmbeddedAccBody}>
                    <Text style={styles.legalEmbeddedText}>
                      {legalCopy?.privacyBody}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.legalEmbeddedDivider} />
                <Pressable
                  onPress={() => setTermsOpen((v) => !v)}
                  style={styles.legalEmbeddedAccHeader}
                >
                  <Text style={styles.legalEmbeddedAccTitle}>
                    Nutzungsbedingungen / AGB
                  </Text>
                  <Text style={styles.chevron}>{termsOpen ? '▾' : '▸'}</Text>
                </Pressable>
                {termsOpen ? (
                  <View style={styles.legalEmbeddedAccBody}>
                    <Text style={styles.legalEmbeddedText}>
                      {legalCopy?.terms}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.legalEmbeddedDivider} />
                <Pressable
                  onPress={() => setLearningOpen((v) => !v)}
                  style={styles.legalEmbeddedAccHeader}
                >
                  <Text style={styles.legalEmbeddedAccTitle}>
                    Lernen & Feedback-Einwilligung
                  </Text>
                  <Text style={styles.chevron}>
                    {learningOpen ? '▾' : '▸'}
                  </Text>
                </Pressable>
                {learningOpen ? (
                  <View style={styles.legalEmbeddedAccBody}>
                    <Text style={styles.legalEmbeddedText}>
                      {legalCopy?.learning}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.legalEmbeddedDivider} />
                <Pressable
                  onPress={() => setPartnerOpen((v) => !v)}
                  style={styles.legalEmbeddedAccHeader}
                >
                  <Text style={styles.legalEmbeddedAccTitle}>
                    Partner-Links (*)
                  </Text>
                  <Text style={styles.chevron}>
                    {partnerOpen ? '▾' : '▸'}
                  </Text>
                </Pressable>
                {partnerOpen ? (
                  <View style={styles.legalEmbeddedAccBody}>
                    <Text style={styles.legalEmbeddedText}>
                      Partner-Links sind mit einem kleinen Sternchen (*)
                      markiert — keine „Anzeige“-Labels. Bei Buchung darüber
                      kann Yorro eine Provision erhalten; der Preis für dich
                      bleibt gleich.{'\n\n'}
                      {t(lang, 'affiliateDisclosure')}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.legalEmbeddedDivider} />
                <Pressable
                  onPress={() => setImprintOpen((v) => !v)}
                  style={styles.legalEmbeddedAccHeader}
                >
                  <Text style={styles.legalEmbeddedAccTitle}>Impressum</Text>
                  <Text style={styles.chevron}>
                    {imprintOpen ? '▾' : '▸'}
                  </Text>
                </Pressable>
                {imprintOpen ? (
                  <View style={styles.legalEmbeddedAccBody}>
                    {legalCopy?.controllerIncomplete ? (
                      <View style={styles.legalCallout}>
                        <Text style={styles.legalCalloutText}>
                          {legalCopy.placeholder}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={styles.legalEmbeddedText}>
                      {legalCopy?.imprintText || '—'}
                    </Text>
                  </View>
                ) : null}
              </View>
              )}
            </Accordion>
            </SettingsSlot>

            <GroupGap />

            <SettingsSlot id="feedback">
            <View style={styles.feedbackBottomSection}>
              <PrimaryButton
                label="🎙️ Feedback & Problem melden"
                onPress={() => setShowFeedbackModal(true)}
              />
            </View>
            </SettingsSlot>

            <GroupGap />

            <SettingsSlot id="internal">
            <Accordion
              title="Nur für dich intern"
              open={openSection === 'internal'}
              hideHeader={openSection === 'internal'}
              onToggle={() => toggleSection('internal')}
              tone="developer"
            >
              {() => (
              <>
              {!openInternal ? (
              <Text style={styles.hint}>
                Gelerntes Profil, Beta, Logistik und App-geplante Trigger.
              </Text>
              ) : null}
              <ReorderChildren openId={openInternal}>
              <SettingsSlot id="learned">
              <SetupRow
                title="Gelerntes Profil"
                open={openInternal === 'learned'}
                hideHeader={openInternal === 'learned'}
                onToggle={() =>
                  setOpenInternal((c) => (c === 'learned' ? null : 'learned'))
                }
              >
                <LazyLearnedProfilePanel
                  draft={draft}
                  onChange={patch}
                  persistPatch={persistPatch}
                />
              </SetupRow>
              </SettingsSlot>
              <SettingsSlot id="beta_situations">
              <SetupRow
                title="Beta-Situationen"
                open={openInternal === 'beta_situations'}
                hideHeader={openInternal === 'beta_situations'}
                onToggle={() =>
                  setOpenInternal((c) =>
                    c === 'beta_situations' ? null : 'beta_situations',
                  )
                }
              >
                <LazyBetaSituationsPanel />
              </SetupRow>
              </SettingsSlot>
              <SettingsSlot id="logistics">
              <SetupRow
                title="Logistik"
                open={openInternal === 'logistics'}
                hideHeader={openInternal === 'logistics'}
                onToggle={() =>
                  setOpenInternal((c) =>
                    c === 'logistics' ? null : 'logistics',
                  )
                }
              >
                <LazyLogisticsPanel />
              </SetupRow>
              </SettingsSlot>
              <SettingsSlot id="push">
              <SetupRow
                title="Push-Nachrichten & Trigger"
                open={openInternal === 'push'}
                hideHeader={openInternal === 'push'}
                onToggle={() =>
                  setOpenInternal((c) => (c === 'push' ? null : 'push'))
                }
              >
                <LazyPushTriggersPanel />
              </SetupRow>
              </SettingsSlot>
              </ReorderChildren>
              </>
              )}
            </Accordion>
            </SettingsSlot>

            <SettingsSlot id="developer">
            <Accordion
              title={t(lang, 'settingsDeveloper')}
              open={openSection === 'developer'}
              hideHeader={openSection === 'developer'}
              onToggle={() => toggleSection('developer')}
              tone="developer"
            >
              {() => (
              <>
              <Text style={styles.hint}>
                Kosten/API, Playbook & Device-Must (Checkliste + Pflichtfragen),
                GPS-Simulation und Demo-Audio für Store-Videos.
              </Text>
              <DeveloperSection
                lang={lang}
                onReset={handleReset}
                draft={draft}
                persistPatch={persistPatch}
              />
              </>
              )}
            </Accordion>
            </SettingsSlot>
            </ReorderChildren>
          </ScrollView>

          {showFeedbackModal ? (
            <View style={styles.feedbackModalOverlay} pointerEvents="auto">
              <View style={styles.feedbackModalRoot}>
                <View style={styles.feedbackModalHeader}>
                  <Pressable
                    onPress={() => setShowFeedbackModal(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Zurück zu den Einstellungen"
                    hitSlop={8}
                  >
                    <Text style={styles.feedbackModalClose}>‹ Zurück</Text>
                  </Pressable>
                  <Text style={styles.feedbackModalTitle}>Feedback & Diagnostics</Text>
                  <Pressable
                    onPress={() => setShowFeedbackModal(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Feedback schließen"
                    hitSlop={8}
                  >
                    <Text style={styles.feedbackModalClose}>✕</Text>
                  </Pressable>
                </View>
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.feedbackModalBody}
                >
                  <LazyFeedbackSection
                    defaultUserName={
                      [draft.firstName, draft.lastName]
                        .filter(Boolean)
                        .join(' ') || 'Tester / User'
                    }
                  />
                </ScrollView>
              </View>
            </View>
          ) : null}

          <View style={styles.footer}>
            <PrimaryButton
              label={t(lang, 'save')}
              onPress={() => void handleSave()}
            />
          </View>
        </SwipeBackView>
      </SafeAreaView>
    </View>
  );
  }),
);

function renderLazyBody(
  children: React.ReactNode | (() => React.ReactNode),
): React.ReactNode {
  return typeof children === 'function' ? children() : children;
}

function ReorderChildren({
  openId,
  children,
}: {
  openId: string | null;
  children: React.ReactNode;
}) {
  const list = React.Children.toArray(children);
  if (!openId) return <>{list}</>;
  const idx = list.findIndex(
    (child) =>
      React.isValidElement(child) &&
      (child.props as { id?: string }).id === openId,
  );
  if (idx <= 0) return <>{list}</>;
  const next = list.slice();
  const [hit] = next.splice(idx, 1);
  next.unshift(hit);
  return <>{next}</>;
}

function SettingsSlot({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
  /** @deprecated Physical reorder via ReorderChildren */
  lifted?: boolean;
}) {
  return (
    <View nativeID={id} collapsable={false}>
      {children}
    </View>
  );
}

function GroupGap() {
  return <View style={styles.groupGap} accessibilityRole="none" />;
}

function SetupRow({
  title,
  open,
  onToggle,
  children,
  hideHeader = false,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode | (() => React.ReactNode);
  hideHeader?: boolean;
  /** @deprecated Siblings stay visible — ignored. */
  groupOpen?: string | null;
}) {
  return (
    <View
      style={[
        !hideHeader && styles.setupRow,
        !hideHeader && open && styles.setupRowOpen,
      ]}
    >
      {hideHeader ? null : (
        <Pressable
          onPress={onToggle}
          style={styles.setupRowHeader}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <Text style={styles.setupRowTitle}>{title}</Text>
          <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
        </Pressable>
      )}
      {open ? (
        <View style={[styles.setupRowBody, hideHeader && styles.setupRowBodyPinned]}>
          {renderLazyBody(children)}
        </View>
      ) : null}
    </View>
  );
}

function Accordion({
  title,
  open,
  onToggle,
  children,
  tone = 'default',
  hidden = false,
  hideHeader = false,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode | (() => React.ReactNode);
  tone?: 'default' | 'developer';
  hidden?: boolean;
  hideHeader?: boolean;
}) {
  if (hidden) return null;
  return (
    <View
      style={[
        !hideHeader && styles.accordion,
        !hideHeader && tone === 'developer' && styles.accordionDev,
        !hideHeader && open && styles.accordionOpen,
      ]}
    >
      {hideHeader ? null : (
        <Pressable
          onPress={onToggle}
          style={styles.accordionHeader}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <Text
            style={[
              styles.accordionTitle,
              tone === 'developer' && styles.accordionTitleDev,
            ]}
          >
            {title}
          </Text>
          <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
        </Pressable>
      )}
      {open ? (
        <View style={[styles.accordionBody, hideHeader && styles.accordionBodyPinned]}>
          {renderLazyBody(children)}
        </View>
      ) : null}
    </View>
  );
}

function AboutMeEditor({
  draft,
  onChange,
}: {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
}) {
  const genderOpts: Array<{ id: UserGender; label: string }> = [
    { id: 'female', label: 'Weiblich' },
    { id: 'male', label: 'Männlich' },
    { id: 'diverse', label: 'Divers' },
    { id: 'unspecified', label: 'Keine Angabe' },
  ];

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
    <View style={{ gap: 10 }}>
      <Text style={styles.hint}>
        Gleich wie in der Standardeinrichtung — Alter, Geschlecht, Allergien,
        Barriere, Freitext und Ernährung.
      </Text>
      <Text style={styles.hint}>Alter (Pflicht)</Text>
      <AgeLifeSlider
        age={draft.age}
        yearsLabel="Jahre"
        onChange={(age: number) => onChange({ age })}
      />
      <TextInput
        style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
        placeholder="Über dich…"
        placeholderTextColor={colors.textMuted}
        value={draft.aboutMe ?? ''}
        onChangeText={(aboutMe) => onChange({ aboutMe })}
        multiline
      />
      <Text style={styles.hint}>Geschlecht</Text>
      <View style={styles.audioModeRow}>
        {genderOpts.map((opt) => {
          const on = (draft.gender ?? null) === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => onChange({ gender: opt.id })}
              style={[styles.audioModeChip, on && styles.audioModeChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text
                style={[styles.audioModeLabel, on && styles.audioModeLabelOn]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>Allergien & Unverträglichkeiten (optional)</Text>
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
                  const cur = (draft.allergyTags ?? []).filter(
                    (x) => x !== 'keine',
                  );
                  onChange({ allergyTags: cur });
                }
              }}
              style={[styles.langRow, on && styles.langOn, { flex: undefined }]}
            >
              <Text style={styles.langTitle}>{o.label}</Text>
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
                style={[styles.langRow, on && styles.langOn, { flex: undefined }]}
              >
                <Text style={styles.langTitle}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        placeholder="Sonstiges (z. B. Kiwi…)"
        placeholderTextColor={colors.textMuted}
        value={draft.allergies ?? ''}
        onChangeText={(allergies) => onChange({ allergies })}
      />
      <Text style={styles.hint}>Barriere & besondere Bedürfnisse</Text>
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
              style={[styles.langRow, on && styles.langOn, { flex: undefined }]}
            >
              <Text style={styles.langTitle}>{o.label}</Text>
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
                style={[styles.langRow, on && styles.langOn, { flex: undefined }]}
              >
                <Text style={styles.langTitle}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Text style={[styles.hint, { marginTop: spacing.md }]}>Ernährung</Text>
      <Text style={styles.hint}>
        Ernährungspräferenzen — bleiben meist gleich, egal welche Stadt.
      </Text>
      <ConciergePrefsEditor
        draft={draft}
        onChange={onChange}
        scope="profile"
      />
    </View>
  );
}

function ContactEditor({
  draft,
  onChange,
}: {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.hint}>
        Einmalig hinterlegen — Yorro nutzt das für Tisch-Anfragen per E-Mail
        oder KI-Anruf. Keine Fake-Buchungen ohne deine Bestätigung.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Vorname"
        placeholderTextColor={colors.textMuted}
        value={draft.firstName}
        onChangeText={(firstName) => onChange({ firstName })}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        showSoftInputOnFocus
      />
      <NamePronunciationEditor draft={draft} onChange={onChange} />
      <TextInput
        style={styles.input}
        placeholder="Nachname"
        placeholderTextColor={colors.textMuted}
        value={draft.lastName}
        onChangeText={(lastName) => onChange({ lastName })}
        autoCapitalize="words"
      />
      <TextInput
        style={styles.input}
        placeholder="E-Mail"
        placeholderTextColor={colors.textMuted}
        value={draft.email}
        onChangeText={(email) => onChange({ email })}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        placeholder="Handy (z. B. +49 170 …)"
        placeholderTextColor={colors.textMuted}
        value={draft.phoneNumber ?? ''}
        onChangeText={(phoneNumber) => onChange({ phoneNumber })}
        keyboardType="phone-pad"
      />
    </View>
  );
}

function CharacterEditor({
  draft,
  onChange,
  sections = 'all',
}: {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  lang: AppLanguage;
  sections?: 'all' | 'core' | 'detail';
}) {
  return (
    <View>
      <PersonalityMatrixStep
        coreRole={draft.coreRole ?? null}
        vibeTone={draft.vibeTone ?? null}
        knowledgeStyle={draft.knowledgeStyle ?? null}
        spleens={draft.spleens ?? []}
        embed
        hideContinue
        showQuickPresets={false}
        sections={sections}
        onChange={(p: Partial<UserProfile>) => {
          const nextRole =
            p.coreRole !== undefined ? p.coreRole : draft.coreRole;
          const nextVibe =
            p.vibeTone !== undefined ? p.vibeTone : draft.vibeTone;
          const nextKnow =
            p.knowledgeStyle !== undefined
              ? p.knowledgeStyle
              : draft.knowledgeStyle;
          const nextSpleens =
            p.spleens !== undefined ? p.spleens : draft.spleens;
          const suggested = resolveVoiceForPersonality({
            coreRole: nextRole,
            vibeTone: nextVibe,
            knowledgeStyle: nextKnow,
            spleens: nextSpleens,
            gender: draft.gender,
          });
          if (draft.voicePinnedByUser && suggested !== draft.voiceId) {
            Alert.alert(
              'Stimme anpassen?',
              'Deine Persönlichkeit hat sich geändert. Soll die Stimme zur neuen Kombi passen?',
              [
                {
                  text: 'Behalten',
                  style: 'cancel',
                  onPress: () => onChange({ ...p }),
                },
                {
                  text: 'Anpassen',
                  onPress: () => {
                    onChange({
                      ...p,
                      voiceId: suggested,
                      voicePinnedByUser: false,
                    });
                    void voicePreloader.switchActiveVoice(suggested);
                  },
                },
              ],
            );
            return;
          }
          onChange({
            ...p,
            voiceId: suggested,
            voicePinnedByUser: false,
          });
          void voicePreloader.switchActiveVoice(suggested);
        }}
        onNext={() => {
          /* Settings: no step advance */
        }}
        onInfo={(title: string, body: string) => Alert.alert(title, body)}
      />
    </View>
  );
}

function StorageEditor({
  lang,
  activeCityId,
}: {
  lang: AppLanguage;
  activeCityId: string | null;
}) {
  const [rows, setRows] = useState<LocalCityDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listLocalCityDatasets();
      setRows(next);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active = (activeCityId ?? '').trim().toLowerCase();
  const total = rows.reduce((sum, r) => sum + r.bytes, 0);

  const runBusy = (id: string, job: () => Promise<void>) => {
    setBusyId(id);
    void job()
      .then(() => reload())
      .catch((err) => {
        Alert.alert(
          t(lang, 'settingsStorageDeleteTitle'),
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => setBusyId(null));
  };

  const onDeleteAll = (row: LocalCityDataset) => {
    if (row.id === active) {
      Alert.alert(
        t(lang, 'settingsStorageDeleteTitle'),
        t(lang, 'settingsStorageActive'),
      );
      return;
    }
    Alert.alert(
      t(lang, 'settingsStorageDeleteTitle'),
      `${row.name}: ${t(lang, 'settingsStorageDeleteBody')}`,
      [
        { text: t(lang, 'cancel'), style: 'cancel' },
        {
          text: t(lang, 'settingsStorageDelete'),
          style: 'destructive',
          onPress: () =>
            runBusy(row.id, () =>
              removeLocalCityDataset(row.id, { activeCityId: active }),
            ),
        },
      ],
    );
  };

  const onDeletePart = (
    row: LocalCityDataset,
    kind: 'pack' | 'map',
    label: string,
  ) => {
    if (kind === 'pack' && row.id === active) {
      Alert.alert(
        t(lang, 'settingsStorageDeleteTitle'),
        t(lang, 'settingsStorageActive'),
      );
      return;
    }
    Alert.alert(
      `${label} löschen?`,
      `${row.name}: nur die lokale ${label}-Datei. Neu laden jederzeit möglich.`,
      [
        { text: t(lang, 'cancel'), style: 'cancel' },
        {
          text: t(lang, 'settingsStorageDelete'),
          style: 'destructive',
          onPress: () =>
            runBusy(row.id, () =>
              removeLocalCityFiles(row.id, [kind], { activeCityId: active }),
            ),
        },
      ],
    );
  };

  const onRefreshPack = (row: LocalCityDataset) => {
    runBusy(row.id, async () => {
      await installCityPack(row.id, {
        forceRefresh: true,
        reason: 'sync',
      });
    });
  };

  const onRefreshMap = (row: LocalCityDataset) => {
    runBusy(row.id, async () => {
      await removeLocalCityFiles(row.id, ['map'], { activeCityId: active });
      const { prefetchCityMapExtract } = await import(
        '../services/homeMap/cityMapExtract'
      );
      await prefetchCityMapExtract(row.id);
    });
  };

  if (loading) {
    return (
      <View style={styles.cityLoading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.hint}>{t(lang, 'settingsStorageHint')}</Text>
      {rows.length === 0 ? (
        <Text style={styles.hint}>{t(lang, 'settingsStorageEmpty')}</Text>
      ) : (
        <>
          <Text style={styles.cityStats}>
            {t(lang, 'settingsStorageTotal')}: {formatLocalDatasetBytes(total)}
          </Text>
          {rows.map((row) => {
            const isActive = row.id === active;
            const open = expandedId === row.id;
            const busy = busyId === row.id;
            return (
              <View key={row.id} style={{ marginTop: 8 }}>
                <View
                  style={[styles.cityRow, isActive && styles.cityOn, { marginTop: 0 }]}
                >
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() =>
                      setExpandedId((c) => (c === row.id ? null : row.id))
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${row.name} Offline-Details`}
                  >
                    <Text style={styles.cityName}>{row.name}</Text>
                    <Text style={styles.cityStats}>
                      {formatLocalDatasetBytes(row.bytes)}
                      {row.version > 0 ? ` · v${row.version}` : ''}
                      {isActive ? ` · ${t(lang, 'settingsStorageActive')}` : ''}
                      {row.hasPack ? ' · Pack' : ''}
                      {row.hasMap ? ' · Karte' : ''}
                    </Text>
                  </Pressable>
                  {busy ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
                  )}
                </View>
                {open ? (
                  <View
                    style={[
                      styles.cityRow,
                      isActive && styles.cityOn,
                      {
                        marginTop: 4,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 8,
                      },
                    ]}
                  >
                    {row.hasPack ? (
                      <View style={styles.switchRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.langTitle}>Pack</Text>
                          <Text style={styles.langHint}>
                            {formatLocalDatasetBytes(row.packBytes)}
                            {row.hasPins
                              ? ` · Pins ${formatLocalDatasetBytes(row.pinsBytes)}`
                              : ''}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => onRefreshPack(row)}
                          style={styles.storageDeleteBtn}
                          disabled={busy}
                        >
                          <Text style={styles.storageDeleteText}>Aktualisieren</Text>
                        </Pressable>
                        {!isActive ? (
                          <Pressable
                            onPress={() => onDeletePart(row, 'pack', 'Pack')}
                            style={styles.storageDeleteBtn}
                            disabled={busy}
                          >
                            <Text style={styles.storageDeleteText}>
                              {t(lang, 'settingsStorageDelete')}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                    {row.hasMap || row.hasPack ? (
                      <View style={styles.switchRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.langTitle}>Offline-Karte</Text>
                          <Text style={styles.langHint}>
                            {row.hasMap
                              ? formatLocalDatasetBytes(row.mapBytes)
                              : 'Noch nicht geladen'}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => onRefreshMap(row)}
                          style={styles.storageDeleteBtn}
                          disabled={busy}
                        >
                          <Text style={styles.storageDeleteText}>
                            {row.hasMap ? 'Aktualisieren' : 'Laden'}
                          </Text>
                        </Pressable>
                        {row.hasMap ? (
                          <Pressable
                            onPress={() => onDeletePart(row, 'map', 'Karte')}
                            style={styles.storageDeleteBtn}
                            disabled={busy}
                          >
                            <Text style={styles.storageDeleteText}>
                              {t(lang, 'settingsStorageDelete')}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                    {!isActive ? (
                      <Pressable
                        onPress={() => onDeleteAll(row)}
                        style={[styles.storageDeleteBtn, { alignSelf: 'flex-start' }]}
                        disabled={busy}
                      >
                        <Text style={styles.storageDeleteText}>Alles löschen</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

function CityEditor({
  lang,
  selectedId,
  onInstalled,
}: {
  lang: AppLanguage;
  selectedId: string | null;
  selectedName: string | null;
  onInstalled: (
    cityId: string,
    cityName: string,
    coords?: { lat: number | null; lng: number | null },
  ) => void;
}) {
  const [cities, setCities] = useState<CityCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpsReady, setGpsReady] = useState(false);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const kbInset = useKeyboardInset();
  const keyboardUp = kbInset > 80 || searchFocused;

  const handleSelect = (city: CityCatalogItem) => {
    if (installingId === city.id) return;
    setInstallingId(city.id);
    onInstalled(city.id, city.name, {
      lat: typeof city.lat === 'number' ? city.lat : null,
      lng: typeof city.lng === 'number' ? city.lng : null,
    });
    setQuery('');
    setSearchFocused(false);
    Keyboard.dismiss();
    try {
      const { noteManualCityFocus } = require('../services/cityProximityService') as {
        noteManualCityFocus: (id: string) => void;
      };
      noteManualCityFocus(city.id);
    } catch {
      /* soft */
    }
    try {
      const { triggerHapticPulse } = require('../services/navigation/haptics') as {
        triggerHapticPulse: (k?: 'single' | 'double' | 'heavy') => void;
      };
      triggerHapticPulse('heavy');
    } catch {
      /* soft */
    }
    void import('../services/cityWelcomeService')
      .then((m) => m.speakCityWelcomeForCity(city, { preferSwitch: true }))
      .catch(() => undefined);
    // Pack nach dem ersten Paint — Hero/✓ sofort, SQLite im Hintergrund.
    void (async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
      try {
        const result = await installCityPack(city.id, {
          checkRemote: true,
          reason: 'switch',
        });
        if (result.cityName && result.cityName !== city.name) {
          onInstalled(city.id, result.cityName, {
            lat: typeof city.lat === 'number' ? city.lat : null,
            lng: typeof city.lng === 'number' ? city.lng : null,
          });
        }
      } catch (err) {
        Alert.alert(
          t(lang, 'cityInstallFailed'),
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        setInstallingId((cur) => (cur === city.id ? null : cur));
      }
    })();
  };

  // Cache + GPS-Nähe sofort; volles Bucket-Listing nur im Hintergrund (abbruchbar).
  useEffect(() => {
    let cancelled = false;
    const gps = useGpsStore.getState();
    const storeCoords =
      gps.lat != null && gps.lng != null
        ? { lat: gps.lat, lng: gps.lng }
        : null;
    const instant = catalogItemsFromIndexCache(storeCoords);
    if (instant && instant.length > 0) {
      setCities(instant);
      setLoading(false);
      setGpsReady(!!storeCoords);
    } else {
      setLoading(true);
    }
    setError(null);

    (async () => {
      try {
        const coords =
          storeCoords ?? (await getCurrentCoords({ timeoutMs: 1800 }));
        if (cancelled) return;
        const nearby = await loadCityCatalog(coords, {
          fresh: false,
          skipBucketListing: true,
        });
        if (cancelled) return;
        setCities(nearby);
        setLoading(false);
        setGpsReady(!!coords);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const searching = query.trim().length > 0;
  const featured =
    cities.find((c) => c.id === selectedId) ?? cities[0] ?? null;
  const gridCities = useMemo(
    () =>
      citiesForPickerGrid(cities, {
        excludeId: searching ? null : featured?.id ?? selectedId,
        query,
      }),
    [cities, featured?.id, selectedId, query, searching],
  );

  if (loading) {
    return (
      <View style={styles.cityLoading}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.hint}>{t(lang, 'loadingCities')}</Text>
      </View>
    );
  }

  if (error || cities.length === 0) {
    return (
      <Text style={styles.hint}>{error ?? t(lang, 'noCitiesHint')}</Text>
    );
  }

  return (
    <View style={styles.cityEditor}>
      <Text style={styles.citySectionLabel}>{t(lang, 'citySearchTitle')}</Text>
      <TextInput
        style={styles.citySearch}
        value={query}
        onChangeText={setQuery}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        placeholder={t(lang, 'citySearchPlaceholder')}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        blurOnSubmit
      />
      {gpsReady && !keyboardUp ? (
        <Text style={styles.citySearchMeta}>{t(lang, 'gpsReady')}</Text>
      ) : null}

      {featured && !searching && !keyboardUp ? (
        <>
          <Text style={styles.citySectionLabel}>
            {selectedId === featured.id
              ? t(lang, 'settingsCityCurrent')
              : t(lang, 'nearby')}
          </Text>
          <CityCatalogCard
            city={featured}
            lang={lang}
            selected={selectedId === featured.id}
            variant="hero"
            onPress={() => void handleSelect(featured)}
          />
        </>
      ) : null}

      <Text style={styles.citySectionLabel}>
        {searching
          ? gridCities.length > 0
            ? `${gridCities.length} ${t(lang, 'citySearchHits')}`
            : t(lang, 'citySearchNoHits')
          : t(lang, 'otherCities')}
      </Text>

      {gridCities.length > 0 ? (
        <View style={styles.cityGrid}>
          {gridCities.map((city) => (
            <View key={city.id} style={styles.cityGridItem}>
              <CityCatalogCard
                city={city}
                lang={lang}
                selected={selectedId === city.id}
                variant="grid"
                onPress={() => void handleSelect(city)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ApiUsagePanel() {
  const [snap, setSnap] = useState(() => getApiUsageSnapshot());
  const [costs, setCosts] = useState<CostOverview | null>(null);
  const [cartesia, setCartesia] = useState(() => getCartesiaCostSnapshot());
  const [resources, setResources] = useState<ResourceUsageSnapshot>(() =>
    getResourceUsageSnapshot(),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setSnap(getApiUsageSnapshot());
      setResources(getResourceUsageSnapshot());
      void getCartesiaCostSnapshotAsync().then(setCartesia);
      void getCostOverviewAsync().then(setCosts);
    }, 2000);
    void getCostOverviewAsync().then(setCosts);
    void import('../services/diagnostics/deviceCostUpload')
      .then((m) => m.uploadDeviceCostDay())
      .catch(() => undefined);
    return () => clearInterval(id);
  }, []);

  const eurLabel = formatCostEur(snap.estimatedEur);
  const cartesiaEur = formatCostEur(cartesia.costEurToday);

  const batStart =
    resources.batteryStartPct != null
      ? `${resources.batteryStartPct.toFixed(1).replace('.', ',')} %`
      : '—';
  const batNow =
    resources.batteryNowPct != null
      ? `${resources.batteryNowPct.toFixed(1).replace('.', ',')} %`
      : '—';

  const costRow = (
    label: string,
    eur: number,
    hint?: string,
  ) => (
    <View style={styles.costRow} key={label}>
      <View style={{ flex: 1 }}>
        <Text style={styles.costRowLabel}>{label}</Text>
        {hint ? <Text style={styles.costRowHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.costRowValue}>{formatCostEur(eur)}</Text>
    </View>
  );

  return (
    <View style={styles.apiPanel}>
      <Text style={styles.devLabel}>Kosten-Übersicht (für Tester)</Text>
      <Text style={styles.hint}>
        Obergrenze zu Listenpreisen (Gemini Pro, Cartesia, Google Places) —
        ohne Rabatte, damit wir nicht unterzählen. Sparpfad steht klein
        daneben. Cartesia zählt nur echte Cloud-Synthese; Cache ist gratis.
        Bitte Screenshot schicken, wenn wir gegenrechnen.
      </Text>

      {costs ? (
        <>
          {costRow(
            'Gesamt seit Installation',
            costs.lifetime.breakdown.totalEur,
            `seit ${new Date(costs.installedAt).toLocaleDateString('de-DE')}`,
          )}
          {costRow(
            'Heute',
            costs.today.breakdown.totalEur,
            costs.today.day,
          )}
          {costRow(
            'Letzte Session',
            costs.lastSession.breakdown.totalEur,
            costs.lastSession.sessionMinutes
              ? `${costs.lastSession.sessionMinutes} Min${
                  costs.lastSession.endedAt
                    ? ` · ${new Date(costs.lastSession.endedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                    : ''
                }`
              : 'Noch keine abgeschlossene Session',
          )}
          {costRow(
            'Aktuelle Session',
            costs.currentSession.breakdown.totalEur,
            `${costs.currentSession.sessionMinutes ?? snap.sessionMinutes} Min · läuft · Sparpfad ${formatCostEur(costs.currentSession.breakdown.efficientEur)}`,
          )}
          <Text style={styles.costRowHint}>
            Gesamt-Obergrenze {formatCostEur(costs.lifetime.breakdown.conservativeEur)}
            {' · '}Sparpfad {formatCostEur(costs.lifetime.breakdown.efficientEur)}
          </Text>

          <Text style={[styles.devLabel, { marginTop: spacing.md }]}>
            Module — aktuelle Session
          </Text>
          {costs.sessionModules.length === 0 ? (
            <Text style={styles.hint}>Noch keine Abfragen in dieser Session.</Text>
          ) : (
            costs.sessionModules.map((row) =>
              costRow(
                row.label,
                row.conservativeEur,
                `${row.requests} Abfragen`,
              ),
            )
          )}

          <Text style={[styles.devLabel, { marginTop: spacing.md }]}>
            Module — heute
          </Text>
          {costs.todayModules.length === 0 ? (
            <Text style={styles.hint}>Heute noch keine API-Kosten.</Text>
          ) : (
            costs.todayModules.map((row) =>
              costRow(
                row.label,
                row.conservativeEur,
                `${row.requests} Abfragen`,
              ),
            )
          )}

          <Text style={[styles.devLabel, { marginTop: spacing.md }]}>
            Letzte Abfragen
          </Text>
          {costs.recentEvents.length === 0 ? (
            <Text style={styles.hint}>Noch keine einzelnen Calls erfasst.</Text>
          ) : (
            costs.recentEvents.slice(0, 16).map((ev, i) => (
              <Text key={`${ev.atMs}-${i}`} style={styles.apiLine}>
                {new Date(ev.atMs).toLocaleTimeString('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}{' '}
                · {ev.label} · {formatCostEur(ev.conservativeEur)}
              </Text>
            ))
          )}

          <Text style={[styles.devLabel, { marginTop: spacing.md }]}>
            Heute im Detail — wieso?
          </Text>
          {costs.todayReasons.map((reason) => (
            <View key={reason.label} style={styles.costReasonCard}>
              <View style={styles.costReasonHeader}>
                <Text style={styles.costReasonTitle}>{reason.label}</Text>
                <Text style={styles.costReasonEur}>
                  {formatCostEur(reason.eur)}
                </Text>
              </View>
              <Text style={styles.costReasonDetail}>{reason.detail}</Text>
            </View>
          ))}
        </>
      ) : (
        <Text style={styles.hint}>Kosten werden geladen…</Text>
      )}

      <Text style={[styles.devLabel, { marginTop: spacing.md }]}>
        API-Nutzung (aktuelle Session)
      </Text>
      <Text style={styles.hint}>
        Session {snap.sessionMinutes} Min · geschätzt {eurLabel}
      </Text>
      <Text style={styles.apiLine}>
        Cartesia Cloud-Zeichen heute: {(costs?.today.tts.charsOut ?? cartesia.charsToday).toLocaleString('de-DE')}
        {' · '}Ledger {formatCostEur(costs?.today.breakdown.ttsEur ?? cartesia.costEurToday)}
        {' · '}Zähler-Datei {cartesiaEur} (nur Synthese, Cache zählt nicht)
      </Text>
      <Text style={styles.apiLine}>
        Gemini: {snap.geminiRequests} Anfragen ·{' '}
        {snap.geminiCharsIn.toLocaleString('de-DE')} Zeichen rein ·{' '}
        {snap.geminiCharsOut.toLocaleString('de-DE')} Zeichen raus ·{' '}
        {snap.breakdown.geminiEur.toFixed(4).replace('.', ',')} €
      </Text>
      <Text style={styles.apiLine}>
        Maps: {snap.mapsRequests} Calls ·{' '}
        {snap.breakdown.mapsEur.toFixed(4).replace('.', ',')} €
      </Text>
      <Text style={styles.apiLine}>
        TTS (Session): {snap.ttsRequests} ·{' '}
        {snap.ttsChars.toLocaleString('de-DE')} Zeichen ·{' '}
        {snap.breakdown.ttsEur.toFixed(4).replace('.', ',')} €
      </Text>

      <Text style={[styles.devLabel, { marginTop: spacing.md }]}>
        Datenverbrauch (Session)
      </Text>
      <Text style={styles.hint}>
        Gesamt {formatBytes(resources.dataTotalBytes)} · gemessen über App-Traffic
        (kein OS-Zähler)
      </Text>
      {resources.dataRows.length === 0 ? (
        <Text style={styles.apiLine}>Noch kein Netzwerk-Traffic erfasst.</Text>
      ) : (
        resources.dataRows.map((row) => (
          <Text key={row.id} style={styles.apiLine}>
            {row.label}: {formatBytes(row.bytesTotal)}
            {row.bytesIn > 0 || row.bytesOut > 0
              ? ` (↓${formatBytes(row.bytesIn)} ↑${formatBytes(row.bytesOut)})`
              : ''}
            {' · '}
            {row.requests}× · {row.sharePct.toFixed(0)} %
          </Text>
        ))
      )}

      <Text style={[styles.devLabel, { marginTop: spacing.md }]}>
        Akku (Session-Schätzung)
      </Text>
      <Text style={styles.hint}>
        Start {batStart} → jetzt {batNow}
        {resources.batteryDropPctPoints > 0
          ? ` · −${resources.batteryDropPctPoints.toFixed(1).replace('.', ',')} %-Punkte`
          : ' · kein messbarer Drop'}
      </Text>
      <Text style={styles.hint}>
        Verteilung nach aktiver Zeit (GPS, TTS, Mic, KI, Nav, Screen).
      </Text>
      {resources.batteryRows.length === 0 ? (
        <Text style={styles.apiLine}>
          Noch zu wenig Samples — App etwas laufen lassen.
        </Text>
      ) : (
        resources.batteryRows.map((row) => (
          <Text key={row.id} style={styles.apiLine}>
            {row.label}: ~
            {row.estimatedPctPoints.toFixed(1).replace('.', ',')} %-Pkt ·{' '}
            {row.sharePct.toFixed(0)} % der aktiven Zeit
            {row.weightSec >= 60
              ? ` · ${Math.round(row.weightSec / 60)} Min`
              : ` · ${Math.round(row.weightSec)} s`}
          </Text>
        ))
      )}

      <Pressable
        onPress={() => {
          resetApiUsage();
          void resetCartesiaCostToday().then(() =>
            setCartesia(getCartesiaCostSnapshot()),
          );
          void resetResourceUsage().then(() =>
            setResources(getResourceUsageSnapshot()),
          );
          setSnap(getApiUsageSnapshot());
        }}
        style={styles.apiReset}
      >
        <Text style={styles.apiResetText}>Zähler zurücksetzen</Text>
      </Pressable>
    </View>
  );
}

function DeveloperSection({
  lang,
  onReset,
  draft,
  persistPatch,
}: {
  lang: AppLanguage;
  onReset: () => void;
  draft: UserProfile;
  persistPatch: (p: Partial<UserProfile>) => void;
}) {
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const setSimulationMode = useFinnusStore((s) => s.setSimulationMode);
  const resetTourContext = useFinnusStore((s) => s.resetTourContext);
  const setTtsProvider = useFinnusStore((s) => s.setTtsProvider);
  const gpsStatus = useFinnusStore((s) => s.gpsStatus);
  const gpsWatching = useFinnusStore((s) => s.gpsWatching);
  const gpsServicesEnabled = useFinnusStore((s) => s.gpsServicesEnabled);
  // Coords from isolated GPS store — does not re-render main HUD/Audio.
  const gpsAccuracyM = useGpsStore((s) => s.accuracyM);
  const lastGpsAtMs = useGpsStore((s) => s.atMs);
  const lastGpsLat = useGpsStore((s) => s.lat);
  const lastGpsLng = useGpsStore((s) => s.lng);
  const ttsProvider =
    draft.ttsProvider === 'system' ? 'system' : 'cartesia';

  const [probing, setProbing] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    void refreshLocationDiagnostics();
    const id = setInterval(() => setNowTick(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  const ageSec =
    lastGpsAtMs != null
      ? Math.max(0, Math.round((nowTick - lastGpsAtMs) / 1000))
      : null;

  const servicesLabel =
    gpsServicesEnabled === true
      ? 'An'
      : gpsServicesEnabled === false
        ? 'Aus'
        : 'Unbekannt';

  const watchingLabel = isSimulationMode
    ? 'Pausiert (Simulation)'
    : gpsWatching
      ? 'An (Watcher aktiv)'
      : 'Aus';

  const permissionLabel =
    gpsStatus === 'denied'
      ? 'Verweigert'
      : gpsStatus === 'fix' || gpsStatus === 'searching' || gpsWatching
        ? 'Erteilt'
        : isSimulationMode
          ? '—'
          : 'Nicht angefragt / idle';

  const fixHealthy =
    !isSimulationMode &&
    gpsWatching &&
    gpsStatus === 'fix' &&
    ageSec != null &&
    ageSec <= 15;

  const queryLabel = isSimulationMode
    ? 'Simulation — kein Real-GPS'
    : gpsServicesEnabled === false
      ? 'Standort-Dienste am Gerät aus'
      : gpsStatus === 'denied'
        ? 'Berechtigung fehlt'
        : gpsStatus === 'searching'
          ? 'Suche Fix…'
          : fixHealthy
            ? 'OK — Fix frisch'
            : gpsStatus === 'fix' && ageSec != null && ageSec > 15
              ? `Fix veraltet (${ageSec}s)`
              : gpsWatching
                ? 'Watcher an, noch kein Fix'
                : 'Kein aktiver Abruf';

  const onProbe = async () => {
    setProbing(true);
    try {
      await probeGpsFix();
    } finally {
      setProbing(false);
      setNowTick(Date.now());
    }
  };

  return (
    <View>
      <ApiUsagePanel />
      <View style={{ marginBottom: spacing.md }}>
        <LazyLiveQualityPanel />
      </View>
      <View style={styles.devRow}>
        <View style={styles.devCopy}>
          <Text style={styles.devLabel}>{t(lang, 'ttsProvider')}</Text>
          <Text style={styles.hint}>{t(lang, 'ttsProviderHint')}</Text>
        </View>
      </View>
      <View style={styles.ttsSwitchRow}>
        <Pressable
          onPress={() => {
            setTtsProvider('cartesia');
            persistPatch({ ttsProvider: 'cartesia' });
          }}
          style={[
            styles.ttsChip,
            ttsProvider === 'cartesia' && styles.ttsChipOn,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: ttsProvider === 'cartesia' }}
        >
          <Text
            style={[
              styles.ttsChipText,
              ttsProvider === 'cartesia' && styles.ttsChipTextOn,
            ]}
          >
            {t(lang, 'ttsProviderCartesia')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setTtsProvider('system');
            persistPatch({ ttsProvider: 'system' });
          }}
          style={[
            styles.ttsChip,
            ttsProvider === 'system' && styles.ttsChipOn,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: ttsProvider === 'system' }}
        >
          <Text
            style={[
              styles.ttsChipText,
              ttsProvider === 'system' && styles.ttsChipTextOn,
            ]}
          >
            {t(lang, 'ttsProviderSystem')}
          </Text>
        </Pressable>
      </View>
      <View style={[styles.devRow, { marginTop: spacing.md }]}>
        <View style={styles.devCopy}>
          <Text style={styles.devLabel}>{t(lang, 'gpsSimulation')}</Text>
          <Text style={styles.hint}>{t(lang, 'gpsSimulationHint')}</Text>
        </View>
        <Switch
          value={isSimulationMode}
          onValueChange={(value) => {
            setSimulationMode(value);
            resetTourContext();
            if (!value) {
              void import('../services/navigation').then((m) =>
                m.setSimulatedNavCoords(null),
              );
            }
          }}
          trackColor={{ false: '#2A5A4A', true: colors.accent }}
          thumbColor={colors.text}
          accessibilityLabel={t(lang, 'gpsSimulation')}
        />
      </View>
      <Text style={styles.devMode}>
        {isSimulationMode ? t(lang, 'simOn') : t(lang, 'simOff')}
      </Text>

      <View style={styles.gpsCard}>
        <Text style={styles.devLabel}>{t(lang, 'gpsStatusTitle')}</Text>
        <Text style={[styles.hint, { marginBottom: 10 }]}>
          {t(lang, 'gpsStatusHint')}
        </Text>

        <GpsStatusRow
          label="Standort-Dienste"
          value={servicesLabel}
          ok={gpsServicesEnabled === true}
        />
        <GpsStatusRow
          label="GPS-Überwachung"
          value={watchingLabel}
          ok={!isSimulationMode && gpsWatching}
        />
        <GpsStatusRow
          label="Berechtigung"
          value={permissionLabel}
          ok={permissionLabel === 'Erteilt'}
        />
        <GpsStatusRow
          label="Standort-Abruf"
          value={queryLabel}
          ok={fixHealthy}
        />
        <GpsStatusRow
          label="Genauigkeit"
          value={
            typeof gpsAccuracyM === 'number'
              ? `±${Math.round(gpsAccuracyM)} m`
              : '—'
          }
          ok={
            typeof gpsAccuracyM === 'number' && gpsAccuracyM > 0 && gpsAccuracyM <= 40
          }
        />
        <GpsStatusRow
          label="Letzter Fix"
          value={
            lastGpsAtMs != null && lastGpsLat != null && lastGpsLng != null
              ? `vor ${ageSec}s · ${lastGpsLat.toFixed(5)}, ${lastGpsLng.toFixed(5)}`
              : 'Noch keiner'
          }
          ok={fixHealthy}
        />

        <Pressable
          onPress={() => void onProbe()}
          disabled={probing || isSimulationMode}
          style={[
            styles.gpsProbeBtn,
            (probing || isSimulationMode) && styles.gpsProbeBtnDisabled,
          ]}
        >
          {probing ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.gpsProbeText}>
              {isSimulationMode
                ? 'Erst Simulation ausschalten'
                : t(lang, 'gpsProbe')}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            void import('../services/ttsService').then(({ speakAssistantText }) =>
              speakAssistantText(
                'Hier rechts siehst du einen besonderen Ort — ich spiele dir jetzt den Audio-Hinweis ab, wie bei einer echten Tour.',
              ),
            );
          }}
          style={[styles.gpsProbeBtn, { marginTop: 8 }]}
        >
          <Text style={styles.gpsProbeText}>
            Demo: Audio-Hinweis auslösen (für Play-Video)
          </Text>
        </Pressable>
      </View>

      <View style={{ marginTop: spacing.md }}>
        <Text style={[styles.hint, { marginBottom: 8 }]}>
          {t(lang, 'resetConfirm')}
        </Text>
        <SecondaryButton label={t(lang, 'resetApp')} onPress={onReset} />
      </View>
    </View>
  );
}

function GpsStatusRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <View style={styles.gpsRow}>
      <Text style={styles.gpsRowLabel}>{label}</Text>
      <View style={styles.gpsRowRight}>
        <View
          style={[
            styles.gpsDot,
            { backgroundColor: ok ? colors.wave : colors.danger },
          ]}
        />
        <Text style={styles.gpsRowValue} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function buildSettingsExtraHelpEntries(
  draft: UserProfile,
): CatalogHelpEntry[] {
  return [
    {
      id: 'settings-voice',
      title: 'Einstellungen: Stimme ändern',
      what: 'Dauerhafte Yorro-Stimme wählen.',
      how: 'Unter Yorros Charakter → Stimme Hörprobe anhören und auswählen. Sprache aktuell Deutsch.',
      optimal: 'Ruhige Probe mit dem Headset, das du unterwegs nutzt.',
      keywords: ['stimme', 'audio', 'hörprobe', 'tts', 'deutsch'],
    },
    {
      id: 'settings-about',
      title: 'Einstellungen: Über dich',
      what: 'Persönlichen Kontext für Ton und Tipps hinterlegen.',
      how: 'Freitext und Ernährung unter Persönliche Informationen → Über dich. Fließt in Antworten und Empfehlungen ein.',
      optimal: 'Kurz und konkret: Tempo, Begleitung, Vorlieben.',
      keywords: ['über dich', 'profil', 'persönlich'],
    },
    {
      id: 'settings-allergies',
      title: 'Einstellungen: Allergien & Unverträglichkeiten',
      what: 'Essens- und Gesundheitswarnungen personalisieren.',
      how: 'Reisepräferenzen: Gruppe, Mobilität, Energie, Budget, Tourlänge — auch nach Stadtwechsel.',
      optimal: '„Keine“ setzen wenn leer — sonst bekannte Allergien immer angeben.',
      keywords: ['allergie', 'unverträglichkeit', 'nüsse', 'laktose'],
    },
    {
      id: 'settings-contact',
      title: 'Einstellungen: Kontakt für Reservierungen',
      what: 'Name, E-Mail, optional Handy für Reservierungs-Kontexte.',
      how: 'Persönliche Informationen → Kontakt. Yorro bucht nichts heimlich.',
      optimal: 'E-Mail gültig halten für Rückfragen vom Restaurant.',
      keywords: ['kontakt', 'reservierung', 'email', 'telefon', 'name'],
    },
    {
      id: 'settings-name-pronunciation',
      title: 'Einstellungen: Namens-Aussprache',
      what: 'Schwierige Vornamen so hinterlegen, dass Yorro sie richtig sagt.',
      how: 'Persönliche Informationen → Kontakt → Aussprache. Vorschlag antippen; Schalter an, wenn die Umschrift in die Stimme soll.',
      optimal: 'Vorschlag anhören, erst dann den Schalter setzen. Speichern nicht vergessen.',
      keywords: [
        'aussprache',
        'name',
        'vorname',
        'jonna',
        'tts',
        'stimme',
        'einsprechen',
      ],
    },
    {
      id: 'settings-city',
      title: 'Einstellungen: Stadt & Inhalte',
      what: `Stadt-Pack laden (aktuell: ${draft.cityName ?? 'noch nicht gesetzt'}).`,
      how: 'Stadt (ganz oben in den Einstellungen): wählen und Pack installieren. GPS sortiert nahe Städte.',
      optimal: 'Vor der Reise mit WLAN laden.',
      keywords: ['stadt', 'inhalte', 'gps', 'pack'],
    },
    {
      id: 'settings-internal',
      title: 'Einstellungen: Interne Einstellungen',
      what: 'Gelerntes Profil, Logistik und Push-Trigger einsehen.',
      how: 'Zahnrad → Interne Einstellungen. Memory löschen möglich.',
      optimal: 'Nur zum Prüfen/Debuggen nötig.',
      keywords: ['intern', 'gelernt', 'logistik', 'trigger'],
    },
  ];
}

const styles = StyleSheet.create({
  /** Vollfläche über Home — kein RN-Modal (Android: Nested Modals = nur Dunkelheit). */
  bodyLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: UI_LAYER.overlay,
    elevation: UI_LAYER.overlay,
  },
  overlayHidden: {
    opacity: 0,
  },
  safe: { flex: 1, backgroundColor: colors.bg },
  bodyScroll: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  close: { color: colors.accent, fontWeight: '600', fontSize: 16 },
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: 36,
    gap: 10,
    flexGrow: 1,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  linkRowTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  affiliateFoot: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontStyle: 'italic',
    marginTop: 4,
    marginBottom: 4,
  },
  setupRow: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
    overflow: 'hidden',
  },
  setupRowOpen: {
    borderColor: colors.accent,
  },
  setupRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  setupRowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  setupRowBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  accordion: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  accordionDev: {
    borderColor: 'rgba(217, 107, 92, 0.35)',
    backgroundColor: colors.bgElevated,
  },
  accordionOpen: {
    borderColor: colors.accent,
  },
  groupGap: {
    height: 14,
  },
  settingsStickyWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: 8,
  },
  accordionBodyPinned: {
    borderTopWidth: 0,
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  setupRowBodyPinned: {
    borderTopWidth: 0,
    paddingTop: 2,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  accordionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  accordionTitleDev: {
    color: colors.danger,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: '700',
  },
  accordionBody: {
    paddingHorizontal: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  saverSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: spacing.sm,
  },
  saverSwitchCopy: { flex: 1 },
  saverSwitchTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 2,
  },
  audioModeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  audioModeChip: {
    flexGrow: 1,
    minWidth: '30%',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  audioModeChipOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.15)',
  },
  audioModeLabel: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  audioModeLabelOn: {
    color: colors.accent,
  },
  audioModeHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  voiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.bgElevated,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  voiceOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  voiceText: { color: colors.text, fontWeight: '600', flex: 1 },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  playBtnActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  langOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  langFlag: { fontSize: 28 },
  langCopy: { flex: 1 },
  langTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  langHint: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  langCheck: { color: colors.accent, fontWeight: '800', fontSize: 18 },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 10,
    lineHeight: 18,
  },
  explainCard: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 4,
  },
  explainTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  explainBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  helpResultLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  legalBlock: {
    gap: 6,
  },
  legalHeading: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  legalBody: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  catBlock: { marginBottom: 14 },
  catTitle: {
    color: colors.textMuted,
    marginBottom: 4,
    fontWeight: '700',
    fontSize: 13,
  },
  catHint: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 8,
    opacity: 0.9,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  interestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 6,
  },
  interestYes: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  interestNo: {
    borderColor: 'rgba(217, 107, 92, 0.5)',
    backgroundColor: 'rgba(217, 107, 92, 0.12)',
  },
  interestText: { color: colors.text, fontWeight: '600', flex: 1 },
  interestPref: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 12,
    marginLeft: 8,
  },
  inputLabel: {
    color: colors.textMuted,
    marginBottom: 4,
    marginTop: 8,
    fontSize: 13,
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  cityLoading: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  cityEditor: {
    gap: spacing.sm,
  },
  citySearch: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  citySearchMeta: {
    color: colors.textMuted,
    fontSize: 12,
    paddingHorizontal: 4,
    marginTop: -2,
  },
  cityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cityGridItem: {
    width: '48%',
    flexGrow: 1,
    maxWidth: '48%',
  },
  citySectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: 4,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
  },
  cityOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  storageDeleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  storageDeleteText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  cityName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  cityStats: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  devSpacer: { height: 18 },
  internalCut: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  apiPanel: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 6,
  },
  apiLine: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  apiReset: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
  },
  apiResetText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  costRowLabel: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  costRowHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  costRowValue: {
    color: colors.accent,
    fontWeight: '800',
    fontSize: 14,
  },
  costReasonCard: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  costReasonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  costReasonTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    flex: 1,
  },
  costReasonEur: {
    color: colors.accent,
    fontWeight: '800',
    fontSize: 13,
  },
  costReasonDetail: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  devCopy: { flex: 1 },
  devLabel: { color: colors.text, fontWeight: '700', fontSize: 15 },
  devMode: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 8,
    fontWeight: '600',
  },
  gpsCard: {
    marginTop: spacing.md,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  gpsRowLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    width: '38%',
  },
  gpsRowRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  gpsRowValue: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  gpsProbeBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    minHeight: 44,
  },
  gpsProbeBtnDisabled: {
    opacity: 0.55,
  },
  gpsProbeText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 14,
  },
  ttsSwitchRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  ttsChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
  },
  ttsChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  ttsChipText: {
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  ttsChipTextOn: {
    color: colors.text,
  },
  footer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  legalEmbeddedAccRoot: {
    paddingHorizontal: 14,
    paddingBottom: 16,
    gap: 10,
  },
  legalEmbeddedAccHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  legalEmbeddedAccTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  legalEmbeddedDivider: {
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  legalEmbeddedAccBody: {
    paddingBottom: 10,
  },
  legalEmbeddedText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  legalCallout: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    backgroundColor: 'rgba(180, 40, 40, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 120, 80, 0.55)',
  },
  legalCalloutText: {
    color: '#FFB4A0',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  feedbackBottomSection: {
    marginTop: spacing.md,
    marginBottom: 6,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  feedbackModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay + 1,
    elevation: UI_LAYER.overlay + 1,
    backgroundColor: colors.bg,
  },
  feedbackModalRoot: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.bg,
  },
  feedbackModalHeader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  feedbackModalTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    flex: 1,
    textAlign: 'center',
  },
  feedbackModalClose: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '900',
  },
  feedbackModalBody: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
});
