import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import { HandsFreeActivationSettings } from '../components/settings/HandsFreeActivationSettings';
import { Module1BackgroundSpeechSettings } from '../components/settings/Module1BackgroundSpeechSettings';
import { UI_LAYER } from '../constants/uiLayers';
import { CityCatalogCard } from '../components/CityCatalogCard';
import { VoiceSelectorList } from '../components/VoiceSelectorList';
import {
  CHARACTER_CATEGORIES,
} from '../constants/onboardingOptions';
import { PersonalityMatrixStep } from '../onboarding/PersonalityMatrixStep';
import { resolveVoiceForPersonality } from '../services/persona/personalityVoiceMap';
import { t } from '../i18n';
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
  installCityPack,
  loadCityCatalog,
  resortCatalogByCoords,
  type CityCatalogItem,
} from '../services/cityCatalogService';
import { citiesForPickerGrid } from '../services/citySearch';
import { Chip, PrimaryButton, SecondaryButton } from '../onboarding/OnboardingUI';
import { SwipeBackView } from '../components/SwipeBackView';
import { useFinnusStore } from '../store/useFinnusStore';
import { useUserMemoryStore } from '../store/useUserMemoryStore';
import { useGpsStore } from '../store/useGpsStore';
import { LEGAL_CHAPTERS, LEGAL_PLACEHOLDER_CALLOUT, ACCOUNT_CLOUD_SYNC_PASSAGE, NEWSLETTER_PRIVACY_PASSAGE, isLegalControllerIncomplete } from '../constants/legal';
import { HelpCatalogBrowser } from '../components/legal/HelpGuideView';
import type { HelpEntry as CatalogHelpEntry } from '../constants/helpCatalog';
import { ConciergePrefsEditor } from '../components/ConciergePrefsEditor';
import { ExperiencePrefsEditor } from '../components/ExperiencePrefsEditor';
import { FeedbackSection } from '../components/feedback/FeedbackSection';
import { AgeLifeSlider } from '../onboarding/AgeLifeSlider';
import { ALLERGY_INTOLERANCE_OPTIONS } from '../constants/conciergePrefs';
import { recordLastAction } from '../services/feedback/telemetryBuffer';
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
  LearnedProfilePanel,
  LogisticsPanel,
  PushTriggersPanel,
  UserTriggersPanel,
  BetaSituationsPanel,
} from '../components/settings/InternalSettingsPanels';
import { LiveQualityPanel } from '../components/LiveQualityPanel';
import { getLastAuthUser, isAuthConfigured } from '../services/account/findusAuth';
import { forceUserCloudSync } from '../services/account/userCloudSync';
import { setNewsletterOptIn } from '../services/account/newsletterService';

type SettingsSection =
  | 'triggers'
  | 'setup'
  | 'city'
  | 'saverAudio'
  | 'handsFree'
  | 'internal'
  | 'explanations'
  | 'help'
  | 'legal'
  | 'developer';

type SetupSubSection =
  | 'voice'
  | 'about'
  | 'character'
  | 'interests'
  | 'prefs'
  | 'startBase'
  | 'navExplore';

type InternalSubSection = 'learned' | 'beta_situations' | 'logistics' | 'push';

type Props = {
  visible: boolean;
  profile: UserProfile;
  onClose: () => void;
  onSaved: (profile: UserProfile) => void;
  onReset: () => void;
  /** Beim Öffnen direkt Einrichtung → Stimme aufklappen */
  initialFocus?: 'voice' | null;
};

export function SettingsScreen({
  visible,
  profile,
  onClose,
  onSaved,
  onReset,
  initialFocus = null,
}: Props) {
  const [draft, setDraft] = useState(profile);
  const [openSection, setOpenSection] = useState<SettingsSection | null>(null);
  const [openSetup, setOpenSetup] = useState<SetupSubSection | null>(null);
  const [openInternal, setOpenInternal] = useState<InternalSubSection | null>(
    null,
  );
  const [showLegal, setShowLegal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [accountSyncOpen, setAccountSyncOpen] = useState(false);
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);
  const [imprintOpen, setImprintOpen] = useState(false);
  const [muteCustomTime, setMuteCustomTime] = useState('');
  const [muteCustomRadius, setMuteCustomRadius] = useState('');
  const [muteStatusLine, setMuteStatusLine] = useState(() =>
    describeMuteSession(),
  );
  const lang = draft.language;

  // Accordion nur beim Öffnen zurücksetzen — nicht bei jedem Profile-Notify
  // (sonst klappt „Stimme“ sofort zu, sobald voiceId gespeichert wird).
  useEffect(() => {
    if (visible) {
      setDraft({ ...profile, speechRate: 1 });
      if (initialFocus === 'voice') {
        setOpenSection('setup');
        setOpenSetup('voice');
      } else {
        setOpenSection(null);
        setOpenSetup(null);
      }
      setOpenInternal(null);
      setShowLegal(false);
      recordLastAction('settings_open');
      void hydrateMuteSession().then((s) =>
        setMuteStatusLine(describeMuteSession(s)),
      );
    } else {
      recordLastAction('settings_close');
    }
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
    if (imprintOpen) {
      setImprintOpen(false);
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
    imprintOpen,
    openSetup,
    openInternal,
    openSection,
    onClose,
  ]);

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

  const patch = (p: Partial<UserProfile>) =>
    setDraft((d) => ({ ...d, ...p, speechRate: 1 }));

  const imprintChapter = LEGAL_CHAPTERS.find((ch) => ch.id === 'imprint');
  const privacyChapters = LEGAL_CHAPTERS.filter((ch) => ch.id !== 'imprint');
  const privacyBody = privacyChapters
    .map((ch) => `${ch.title}\n\n${ch.body}`)
    .join('\n\n');

  const persistPatch = (p: Partial<UserProfile>) => {
    setDraft((d) => {
      const next = { ...d, ...p, speechRate: 1 };
      void saveUserProfile(next);
      return next;
    });
  };

  const toggleSection = (id: SettingsSection) => {
    setOpenSection((cur) => (cur === id ? null : id));
  };
  const handleSave = async () => {
    const saved = await saveUserProfile(draft);
    onSaved(saved);
    onClose();
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

  return (
    <View
      style={styles.overlayRoot}
      pointerEvents="auto"
      accessibilityViewIsModal
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <SwipeBackView enabled={visible} onBack={handleBack}>
          <View style={styles.header}>
            <Text style={styles.title}>{t(lang, 'settings')}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>{t(lang, 'close')}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Accordion
              title="Meine Trigger"
              open={openSection === 'triggers'}
              onToggle={() => {
                if (openSection !== 'triggers') {
                  void import('../services/onboarding/uiCoachMarks').then((m) =>
                    m.onUserOpenedTriggers(),
                  );
                }
                toggleSection('triggers');
              }}
            >
              <Text style={styles.hint}>
                Zeit-, Geo- und Navigations-Erinnerungen — alles, was in der
                Timeline als Trigger markiert ist.
              </Text>
              <UserTriggersPanel />
            </Accordion>

            <Accordion
              title={t(lang, 'settingsSetup')}
              open={openSection === 'setup'}
              onToggle={() => toggleSection('setup')}
            >
              <Text style={styles.hint}>
                Stimme, Charakter, Interessen und Kontakt — alles für deine
                Personalisierung.
              </Text>

              <SetupRow
                title={t(lang, 'settingsVoice')}
                open={openSetup === 'voice'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'voice' ? null : 'voice'))
                }
              >
                <Text style={styles.hint}>
                  Play = Offline-Hörprobe (lokal). Tippen auf den Namen speichert
                  die Stimme für alle Live-Anfragen. Empfehlung folgt deiner
                  Persönlichkeit — du kannst trotzdem jede Stimme wählen.
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
                  onSelectVoice={(id) => {
                    persistPatch({
                      voiceId: id,
                      language: 'de',
                      ttsProvider: 'cartesia',
                      voicePinnedByUser: true,
                    });
                  }}
                  onAfterSelect={(id) => {
                    void voicePreloader.switchActiveVoice(id);
                  }}
                />
              </SetupRow>

              <SetupRow
                title="Über dich & Kontakt"
                open={openSetup === 'about'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'about' ? null : 'about'))
                }
              >
                <AboutMeEditor draft={draft} onChange={patch} />
                <Text style={[styles.hint, { marginTop: spacing.md }]}>
                  Kontakt für Reservierungen
                </Text>
                <ContactEditor draft={draft} onChange={patch} />
              </SetupRow>

              <SetupRow
                title={t(lang, 'settingsCharacter')}
                open={openSetup === 'character'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'character' ? null : 'character'))
                }
              >
                <CharacterEditor draft={draft} onChange={patch} lang={lang} />
              </SetupRow>

              <SetupRow
                title={t(lang, 'settingsInterests')}
                open={openSetup === 'interests'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'interests' ? null : 'interests'))
                }
              >
                <Text style={styles.hint}>
                  Wie in der Standardeinrichtung „Was willst du erleben?“ —
                  Mobilität, Tourlänge, Orte, Essen — Präferenzen wählen.
                </Text>
                <ExperiencePrefsEditor
                  draft={draft}
                  onChange={patch}
                  mode="full"
                />
              </SetupRow>

              <SetupRow
                title="Reise-Präferenzen"
                open={openSetup === 'prefs'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'prefs' ? null : 'prefs'))
                }
              >
                <ConciergePrefsEditor draft={draft} onChange={patch} />
              </SetupRow>

              <SetupRow
                title="Startpunkt / Unterkunft"
                open={openSetup === 'startBase'}
                onToggle={() =>
                  setOpenSetup((c) =>
                    c === 'startBase' ? null : 'startBase',
                  )
                }
              >
                <StartBaseSettingsBlock />
              </SetupRow>

              <SetupRow
                title="Modul 1 während Navigation"
                open={openSetup === 'navExplore'}
                onToggle={() =>
                  setOpenSetup((c) =>
                    c === 'navExplore' ? null : 'navExplore',
                  )
                }
              >
                <Text style={styles.hint}>
                  Wann Findus Orte erzählt, während eine Route aktiv ist.
                  Standard: leise mitlaufen.
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
                      style={[styles.langRow, on && styles.langOn, { marginTop: 8 }]}
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
            </Accordion>

            <Accordion
              title={t(lang, 'settingsCity')}
              open={openSection === 'city'}
              onToggle={() => toggleSection('city')}
            >
              <CityEditor
                lang={lang}
                selectedId={draft.cityId}
                selectedName={draft.cityName}
                onInstalled={(cityId, cityName) => {
                  useUserMemoryStore.getState().clearHotelsOutsideCity(cityId);
                  persistPatch({
                    cityId,
                    cityName,
                    wantToExperience: '',
                    avoidExperience: '',
                  });
                  setOpenSection('city');
                }}
              />
            </Accordion>

            <Accordion
              title="Hands-free & Live-Chat"
              open={openSection === 'handsFree'}
              onToggle={() => toggleSection('handsFree')}
            >
              <HandsFreeActivationSettings />
            </Accordion>

            <Accordion
              title="Audio & Sparmodus"
              open={openSection === 'saverAudio'}
              onToggle={() => toggleSection('saverAudio')}
            >
              <Text style={styles.hint}>
                Mikrofon, Stimme/Untertitel und Sparmodus — weniger Verbrauch,
                Findus stummschalten.
              </Text>

              <Text style={[styles.hint, { marginTop: spacing.sm }]}>
                Sprache: Deutsch (fest).
              </Text>

              <Text style={[styles.hint, { marginTop: spacing.md }]}>
                Spracheingabe / Mikrofon
              </Text>
              <Text style={styles.hint}>
                „Nur tippen“ = kein Mikrofon, alles per Tastatur. Hier jederzeit
                umstellbar.
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
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
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
                    Kürzere Antworten, weniger Maps/Street-View und weniger
                    Live-Recherche (Events/Web).
                  </Text>
                </View>
                <Switch
                  value={!!draft.dataSaverMode}
                  onValueChange={(dataSaverMode) =>
                    persistPatch({ dataSaverMode })
                  }
                  trackColor={{ false: '#444', true: colors.accent }}
                  thumbColor={colors.text}
                  accessibilityLabel="Sparmodus"
                />
              </View>

              <Text style={[styles.hint, { marginTop: spacing.md }]}>
                Audio-Ausgabe
              </Text>
              <Text style={styles.hint}>
                Stumm und Nur Text: kein TTS. Untertitel bleiben sichtbar. Im
                Museum: Findus stumm schalten — er wacht nach Zeit oder Distanz
                wieder auf.
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
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
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

              <Module1BackgroundSpeechSettings />

              {(draft.audioOutputMode ?? 'normal') === 'mute' && (
                <View style={{ gap: 8, marginTop: spacing.sm }}>
                  <Text style={styles.hint}>
                    Wann soll Findus wieder aufwachen? {muteStatusLine}
                  </Text>
                  <Text style={styles.hint}>Nach Zeit</Text>
                  <View style={styles.audioModeRow}>
                    <Pressable
                      style={styles.audioModeChip}
                      onPress={() => void muteForHours(1).then(() =>
                        persistPatch({ audioOutputMode: 'mute' }),
                      )}
                    >
                      <Text style={styles.audioModeLabel}>1 Std.</Text>
                    </Pressable>
                    <Pressable
                      style={styles.audioModeChip}
                      onPress={() => void muteForHours(2).then(() =>
                        persistPatch({ audioOutputMode: 'mute' }),
                      )}
                    >
                      <Text style={styles.audioModeLabel}>2 Std.</Text>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Benutzerdefiniert HH:MM"
                      placeholderTextColor={colors.textMuted}
                      value={muteCustomTime}
                      onChangeText={setMuteCustomTime}
                      keyboardType="numbers-and-punctuation"
                    />
                    <Pressable
                      style={styles.audioModeChip}
                      onPress={() =>
                        void applyMuteWithWake({ untilClock: muteCustomTime })
                      }
                    >
                      <Text style={styles.audioModeLabel}>Setzen</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.hint}>
                    Geotag — wach auf, wenn du so weit weg bist
                  </Text>
                  <View style={styles.audioModeRow}>
                    <Pressable
                      style={styles.audioModeChip}
                      onPress={() => void applyMuteWithWake({ radiusM: 100 })}
                    >
                      <Text style={styles.audioModeLabel}>100 m</Text>
                    </Pressable>
                    <Pressable
                      style={styles.audioModeChip}
                      onPress={() => void applyMuteWithWake({ radiusM: 200 })}
                    >
                      <Text style={styles.audioModeLabel}>200 m</Text>
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      placeholder="Meter (benutzerdefiniert)"
                      placeholderTextColor={colors.textMuted}
                      value={muteCustomRadius}
                      onChangeText={setMuteCustomRadius}
                      keyboardType="number-pad"
                    />
                    <Pressable
                      style={styles.audioModeChip}
                      onPress={() => {
                        const n = Number(muteCustomRadius.replace(',', '.'));
                        if (!Number.isFinite(n) || n < 20) {
                          Alert.alert(
                            'Distanz',
                            'Bitte mindestens 20 Meter eingeben.',
                          );
                          return;
                        }
                        void applyMuteWithWake({ radiusM: Math.round(n) });
                      }}
                    >
                      <Text style={styles.audioModeLabel}>Setzen</Text>
                    </Pressable>
                  </View>
                  {getMuteSession().active && (
                    <Pressable
                      style={styles.audioModeChip}
                      onPress={() => {
                        void clearMuteSession({ restoreAudio: true }).then(() =>
                          persistPatch({ audioOutputMode: 'normal' }),
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
            </Accordion>

            <Accordion
              title="Erklärungen"
              open={openSection === 'explanations'}
              onToggle={() => toggleSection('explanations')}
            >
              <HelpCatalogBrowser
                showLead
                extraEntries={helpExtraEntries}
              />
            </Accordion>

            <Accordion
              title={t(lang, 'settingsLegal')}
              open={openSection === 'legal'}
              onToggle={() => toggleSection('legal')}
            >
              <View style={styles.legalEmbeddedAccRoot}>
                <Pressable
                  onPress={() => setAccountSyncOpen((v) => !v)}
                  style={styles.legalEmbeddedAccHeader}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: accountSyncOpen }}
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
                      {ACCOUNT_CLOUD_SYNC_PASSAGE}
                      {'\n\n'}
                      {NEWSLETTER_PRIVACY_PASSAGE}
                    </Text>
                    <View style={[styles.saverSwitchRow, { marginTop: spacing.md }]}>
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
                        accessibilityLabel="Newsletter"
                      />
                    </View>
                    {isAuthConfigured() ? (
                      <>
                        <Text style={[styles.hint, { marginTop: spacing.sm }]}>
                          {getLastAuthUser()
                            ? `Angemeldet${getLastAuthUser()?.email ? ` als ${getLastAuthUser()?.email}` : ''}.`
                            : 'Noch nicht angemeldet — Sync startet nach Login (Magic Link / Google / Apple).'}
                        </Text>
                        <Pressable
                          style={[
                            styles.audioModeChip,
                            { marginTop: spacing.sm, alignSelf: 'flex-start' },
                          ]}
                          disabled={cloudSyncBusy || !getLastAuthUser()}
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
                            <ActivityIndicator size="small" color={colors.text} />
                          ) : (
                            <Text style={styles.audioModeLabel}>Jetzt synchronisieren</Text>
                          )}
                        </Pressable>
                      </>
                    ) : (
                      <Text style={[styles.hint, { marginTop: spacing.sm }]}>
                        Cloud-Sync ist in dieser Build-Konfiguration nicht aktiv.
                      </Text>
                    )}
                  </View>
                ) : null}

                <View style={styles.legalEmbeddedDivider} />

                <Pressable
                  onPress={() => setPrivacyOpen((v) => !v)}
                  style={styles.legalEmbeddedAccHeader}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: privacyOpen }}
                >
                  <Text style={styles.legalEmbeddedAccTitle}>
                    Datenschutz
                  </Text>
                  <Text style={styles.chevron}>{privacyOpen ? '▾' : '▸'}</Text>
                </Pressable>

                {privacyOpen ? (
                  <View style={styles.legalEmbeddedAccBody}>
                    <Text style={styles.legalEmbeddedText}>
                      {privacyBody}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.legalEmbeddedDivider} />

                <Pressable
                  onPress={() => setImprintOpen((v) => !v)}
                  style={styles.legalEmbeddedAccHeader}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: imprintOpen }}
                >
                  <Text style={styles.legalEmbeddedAccTitle}>Impressum</Text>
                  <Text style={styles.chevron}>{imprintOpen ? '▾' : '▸'}</Text>
                </Pressable>

                {imprintOpen ? (
                  <View style={styles.legalEmbeddedAccBody}>
                    {isLegalControllerIncomplete() ? (
                      <View style={styles.legalCallout}>
                        <Text style={styles.legalCalloutText}>
                          {LEGAL_PLACEHOLDER_CALLOUT}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={styles.legalEmbeddedText}>
                      {imprintChapter
                        ? `${imprintChapter.title}\n\n${imprintChapter.body}`
                        : '—'}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Accordion>

            <Text style={styles.affiliateFoot}>
              Partner-Links sind mit einem kleinen Sternchen (★) markiert — keine
              „Anzeige“-Labels. Details unter Impressum & Datenschutz bzw.{' '}
              {t(lang, 'affiliateDisclosure')}
            </Text>

            <View style={styles.devSpacer} />
            <Accordion
              title={t(lang, 'settingsDeveloper')}
              open={openSection === 'developer'}
              onToggle={() => toggleSection('developer')}
              tone="developer"
            >
              <DeveloperSection
                lang={lang}
                onReset={handleReset}
                draft={draft}
                persistPatch={persistPatch}
              />
            </Accordion>

            <Accordion
              title="Interne Einstellungen"
              open={openSection === 'internal'}
              onToggle={() => toggleSection('internal')}
            >
              <Text style={styles.hint}>
                Insider-Blick: was Findus sich merkt, welche Logistik offen ist,
                und welche Push-/Zeit-Trigger die App selbst plant.
              </Text>

              <SetupRow
                title="Gelerntes Profil"
                open={openInternal === 'learned'}
                onToggle={() =>
                  setOpenInternal((c) => (c === 'learned' ? null : 'learned'))
                }
              >
                <LearnedProfilePanel
                  draft={draft}
                  onChange={patch}
                  persistPatch={persistPatch}
                />
              </SetupRow>

              <SetupRow
                title="Beta-Situationen"
                open={openInternal === 'beta_situations'}
                onToggle={() =>
                  setOpenInternal((c) =>
                    c === 'beta_situations' ? null : 'beta_situations',
                  )
                }
              >
                <BetaSituationsPanel />
              </SetupRow>

              <SetupRow
                title="Logistik"
                open={openInternal === 'logistics'}
                onToggle={() =>
                  setOpenInternal((c) =>
                    c === 'logistics' ? null : 'logistics',
                  )
                }
              >
                <LogisticsPanel />
              </SetupRow>

              <SetupRow
                title="Push-Nachrichten & Trigger"
                open={openInternal === 'push'}
                onToggle={() =>
                  setOpenInternal((c) => (c === 'push' ? null : 'push'))
                }
              >
                <PushTriggersPanel />
              </SetupRow>
            </Accordion>

            <View style={styles.feedbackBottomSection}>
              <PrimaryButton
                label="🎙️ Feedback & Problem melden"
                onPress={() => setShowFeedbackModal(true)}
              />
            </View>
          </ScrollView>

          {showFeedbackModal ? (
            <View style={styles.feedbackModalOverlay} pointerEvents="box-none">
              <View style={styles.feedbackModalRoot}>
                <View style={styles.feedbackModalHeader}>
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
                  <FeedbackSection
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
}

function StartBaseSettingsBlock() {
  const entities = useUserMemoryStore((s) => s.entities);
  const base = React.useMemo(() => {
    const hotel = useUserMemoryStore.getState().getConfirmedHotel();
    if (
      hotel &&
      typeof hotel.lat === 'number' &&
      typeof hotel.lng === 'number' &&
      Number.isFinite(hotel.lat) &&
      Number.isFinite(hotel.lng)
    ) {
      return {
        name: hotel.name,
        kind: 'unterkunft',
        lat: hotel.lat,
        lng: hotel.lng,
      };
    }
    return null;
  }, [entities]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const onHere = async (kind: 'zuhause' | 'hotel' | 'ferienwohnung') => {
    setBusy(true);
    try {
      const gps = useFinnusStore.getState();
      const lat = gps.lastGpsLat;
      const lng = gps.lastGpsLng;
      if (
        lat == null ||
        lng == null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        setStatus('Kein GPS — kurz ins Freie und erneut tippen.');
        return;
      }
      const name =
        kind === 'zuhause'
          ? 'Zuhause'
          : kind === 'ferienwohnung'
            ? 'Ferienwohnung'
            : 'Hotel';
      useUserMemoryStore.getState().addOrUpdateEntity({
        type: 'hotel',
        name,
        isConfirmed: true,
        lat,
        lng,
        notes: `Settings: ${kind} als Unterkunft`,
        visitedAt: new Date().toISOString(),
      });
      setStatus(`${name} als Startpunkt gespeichert.`);
    } catch {
      setStatus('Konnte Startpunkt nicht speichern.');
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      const hotel = useUserMemoryStore.getState().getConfirmedHotel();
      if (hotel?.id) {
        useUserMemoryStore.getState().removeEntity(hotel.id);
      }
      setStatus('Startpunkt gelöscht.');
    } catch {
      setStatus('Löschen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={styles.hint}>
        Von hier starten die Wege im Tagesplan („Los zu …“), solange kein
        anderer Stop davor liegt. Stadt-getrennt — wechselt du die Stadt,
        gilt der alte Startpunkt nicht mit.
      </Text>
      {base ? (
        <Text style={[styles.hint, { marginTop: 8 }]}>
          Aktuell: {base.name} ({base.kind}) ·{' '}
          {base.lat.toFixed(4)}, {base.lng.toFixed(4)}
        </Text>
      ) : (
        <Text style={[styles.hint, { marginTop: 8 }]}>
          Noch kein Startpunkt mit Position gesetzt.
        </Text>
      )}
      <Pressable
        style={[styles.langRow, { marginTop: 10, opacity: busy ? 0.5 : 1 }]}
        disabled={busy}
        onPress={() => void onHere('zuhause')}
      >
        <Text style={styles.langTitle}>📍 Hier = Zuhause / Unterkunft</Text>
      </Pressable>
      <Pressable
        style={[styles.langRow, { marginTop: 8, opacity: busy ? 0.5 : 1 }]}
        disabled={busy}
        onPress={() => void onHere('hotel')}
      >
        <Text style={styles.langTitle}>🏨 Hier = Hotel</Text>
      </Pressable>
      <Pressable
        style={[styles.langRow, { marginTop: 8, opacity: busy ? 0.5 : 1 }]}
        disabled={busy}
        onPress={() => void onHere('ferienwohnung')}
      >
        <Text style={styles.langTitle}>🏠 Hier = Ferienwohnung</Text>
      </Pressable>
      {base ? (
        <Pressable
          style={[styles.langRow, { marginTop: 8, opacity: busy ? 0.5 : 1 }]}
          disabled={busy}
          onPress={() => void onClear()}
        >
          <Text style={styles.langTitle}>Startpunkt löschen</Text>
        </Pressable>
      ) : null}
      {status ? (
        <Text style={[styles.hint, { marginTop: 8 }]}>{status}</Text>
      ) : null}
    </View>
  );
}

function SetupRow({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.setupRow}>
      <Pressable
        onPress={onToggle}
        style={styles.setupRowHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.setupRowTitle}>{title}</Text>
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? <View style={styles.setupRowBody}>{children}</View> : null}
    </View>
  );
}

function Accordion({
  title,
  open,
  onToggle,
  children,
  tone = 'default',
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  tone?: 'default' | 'developer';
}) {
  return (
    <View
      style={[
        styles.accordion,
        tone === 'developer' && styles.accordionDev,
        open && styles.accordionOpen,
      ]}
    >
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
      {open ? <View style={styles.accordionBody}>{children}</View> : null}
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
        Gleich wie in der Standardeinrichtung — Alter, Geschlecht, Allergien und
        Freitext. Kontaktfelder darunter.
      </Text>
      <Text style={styles.hint}>Alter (Pflicht)</Text>
      <AgeLifeSlider
        age={draft.age}
        yearsLabel="Jahre"
        onChange={(age) => onChange({ age })}
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
      <Text style={[styles.hint, { marginTop: 8 }]}>
        Schrift & Buttons (auto = ab 55 größer)
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
              onPress={() => onChange({ uiTextScale: opt.id })}
              style={[styles.audioModeChip, on && styles.audioModeChipOn]}
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
              onPress={() => onChange({ uiButtonScale: opt.id })}
              style={[styles.audioModeChip, on && styles.audioModeChipOn]}
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
        Einmalig hinterlegen — Findus nutzt das für Tisch-Anfragen per E-Mail
        oder KI-Anruf. Keine Fake-Buchungen ohne deine Bestätigung.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Vorname"
        placeholderTextColor={colors.textMuted}
        value={draft.firstName}
        onChangeText={(firstName) => onChange({ firstName })}
        autoCapitalize="words"
      />
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
  lang,
}: {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  lang: AppLanguage;
}) {
  const nonPersonalityCats = CHARACTER_CATEGORIES.filter(
    (c) => c.id !== 'characters' && c.id !== 'tonalities',
  );

  const getSelected = (catId: string): string[] => {
    switch (catId) {
      case 'motives':
        return draft.motives;
      case 'accessibility':
        return draft.accessibility;
      case 'socialDynamics':
        return draft.socialDynamics;
      default:
        return draft.extraTraits.filter((id) =>
          nonPersonalityCats
            .find((c) => c.id === catId)
            ?.options.some((o) => o.id === id),
        );
    }
  };

  const setSelected = (catId: string, ids: string[]) => {
    switch (catId) {
      case 'motives':
        onChange({ motives: ids });
        break;
      case 'accessibility':
        onChange({ accessibility: ids });
        break;
      case 'socialDynamics':
        onChange({
          socialDynamics: ids,
          travelParty:
            ids[0] === 'familie'
              ? 'family'
              : ids[0] === 'date'
                ? 'date'
                : ids[0] === 'zu_zweit'
                  ? 'couple'
                  : ids[0] === 'freundesgruppe'
                    ? 'friends'
                    : 'solo',
        });
        break;
      default: {
        const otherCatIds = new Set(
          nonPersonalityCats
            .filter((c) => c.id !== catId)
            .flatMap((c) => c.options.map((o) => o.id)),
        );
        const kept = draft.extraTraits.filter((id) => otherCatIds.has(id));
        onChange({ extraTraits: [...kept, ...ids] });
      }
    }
  };

  const toggle = (catId: string, optionId: string) => {
    const cat = nonPersonalityCats.find((c) => c.id === catId);
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

  return (
    <View>
      <PersonalityMatrixStep
        coreRole={draft.coreRole ?? null}
        vibeTone={draft.vibeTone ?? null}
        knowledgeStyle={draft.knowledgeStyle ?? null}
        spleens={draft.spleens ?? []}
        embed
        hideContinue
        onChange={(p) => {
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
        onInfo={(title, body) => Alert.alert(title, body)}
      />
      {nonPersonalityCats.map((cat) => (
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
  onInstalled: (cityId: string, cityName: string) => void;
}) {
  const [cities, setCities] = useState<CityCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpsReady, setGpsReady] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setGpsReady(false);
      try {
        const catalog = await loadCityCatalog(null);
        if (cancelled) return;
        const coords = await getCurrentCoords({ timeoutMs: 6000 });
        if (cancelled) return;
        if (coords) {
          setCities(resortCatalogByCoords(catalog, coords));
          setGpsReady(true);
        } else {
          setCities(catalog);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (city: CityCatalogItem) => {
    if (installingId) return;
    setInstallingId(city.id);
    try {
      const result = await installCityPack(city.id);
      onInstalled(city.id, result.cityName || city.name);
      setQuery('');
    } catch (err) {
      Alert.alert(
        t(lang, 'cityInstallFailed'),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setInstallingId(null);
    }
  };

  const searching = query.trim().length > 0;
  const featured =
    cities.find((c) => c.id === selectedId) ?? cities[0] ?? null;
  const gridCities = useMemo(
    () =>
      citiesForPickerGrid(cities, {
        excludeId: featured?.id ?? selectedId,
        query,
      }),
    [cities, featured?.id, selectedId, query],
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
      {featured ? (
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
            busy={installingId === featured.id}
            disabled={!!installingId}
            onPress={() => void handleSelect(featured)}
          />
        </>
      ) : null}

      <Text style={styles.citySectionLabel}>{t(lang, 'citySearchTitle')}</Text>
      <TextInput
        style={styles.citySearch}
        value={query}
        onChangeText={setQuery}
        placeholder={t(lang, 'citySearchPlaceholder')}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      {gpsReady ? (
        <Text style={styles.citySearchMeta}>{t(lang, 'gpsReady')}</Text>
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
                busy={installingId === city.id}
                disabled={!!installingId}
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
      <Text style={styles.devLabel}>Kosten-Übersicht (Cost-Ledger)</Text>
      <Text style={styles.hint}>
        Buchführung der geschätzten API-Kosten: Gemini (Text/KI), Google Maps
        und Cartesia (Stimme). Zeigt Heute / Gesamt und wofür Geld fließt.
        Das kleine Chip oben rechts auf dem Home-Screen ist nur das Runtime
        Dev-Board (Live-Status) — nicht dieselbe Ansicht.
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
            `${costs.currentSession.sessionMinutes ?? snap.sessionMinutes} Min · läuft`,
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
        Cartesia Zeichen heute: {cartesia.charsToday.toLocaleString('de-DE')} |{' '}
        Kosten heute: {cartesiaEur}
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
        <LiveQualityPanel />
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
      what: 'Dauerhafte Findus-Stimme wählen.',
      how: 'Unter Einrichtung → Stimme Hörprobe anhören und auswählen. Sprache aktuell Deutsch.',
      optimal: 'Ruhige Probe mit dem Headset, das du unterwegs nutzt.',
      keywords: ['stimme', 'audio', 'hörprobe', 'tts', 'deutsch'],
    },
    {
      id: 'settings-about',
      title: 'Einstellungen: Über dich',
      what: 'Persönlichen Kontext für Ton und Tipps hinterlegen.',
      how: 'Freitext unter Einrichtung → Über dich. Fließt in Antworten und Empfehlungen ein.',
      optimal: 'Kurz und konkret: Tempo, Begleitung, Vorlieben.',
      keywords: ['über dich', 'profil', 'persönlich'],
    },
    {
      id: 'settings-allergies',
      title: 'Einstellungen: Allergien & Unverträglichkeiten',
      what: 'Essens- und Gesundheitswarnungen personalisieren.',
      how: 'Einrichtung → Concierge-Prefs: Chips + Freitext. Auch in Express-Einrichtung.',
      optimal: '„Keine“ setzen wenn leer — sonst bekannte Allergien immer angeben.',
      keywords: ['allergie', 'unverträglichkeit', 'nüsse', 'laktose'],
    },
    {
      id: 'settings-contact',
      title: 'Einstellungen: Kontakt für Reservierungen',
      what: 'Name, E-Mail, optional Handy für Reservierungs-Kontexte.',
      how: 'Einrichtung → Kontakt. Findus bucht nichts heimlich.',
      optimal: 'E-Mail gültig halten für Rückfragen vom Restaurant.',
      keywords: ['kontakt', 'reservierung', 'email', 'telefon'],
    },
    {
      id: 'settings-city',
      title: 'Einstellungen: Stadt & Inhalte',
      what: `Stadt-Pack laden (aktuell: ${draft.cityName ?? 'noch nicht gesetzt'}).`,
      how: 'Einrichtung → Stadt: wählen und Pack installieren. GPS sortiert nahe Städte.',
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
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: UI_LAYER.overlay,
    elevation: UI_LAYER.overlay,
  },
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  close: { color: colors.accent, fontWeight: '600', fontSize: 16 },
  body: { paddingHorizontal: spacing.md, paddingBottom: 24, gap: 10 },
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  setupRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  setupRowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  setupRowBody: {
    paddingBottom: 12,
    gap: 8,
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
  cityName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  cityStats: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  devSpacer: { height: 18 },
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    elevation: 2000,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
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
