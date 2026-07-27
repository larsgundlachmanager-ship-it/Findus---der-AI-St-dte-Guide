import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import {
  voicesForLanguage,
} from '../constants/voices';
import {
  CHARACTER_CATEGORIES,
  EXPERIENCE_CARDS,
  EXPERIENCE_CATEGORY_TITLES,
} from '../constants/onboardingOptions';
import { t, voiceLabel } from '../i18n';
import type {
  AppLanguage,
  SwipePreference,
  UserProfile,
  VoiceId,
} from '../types/userProfile';
import { uiLang } from '../types/userProfile';
import {
  resetUserProfile,
  saveUserProfile,
} from '../services/userProfileService';
import {
  playVoiceSample,
  stopSpeaking,
  resetVoiceSystem,
  voicePreloader,
} from '../services/ttsService';
import {
  installCityPack,
  loadCityCatalog,
  resortCatalogByCoords,
  formatTriggerStats,
  getCityPackLinks,
  type CityCatalogItem,
  type CityPackLink,
} from '../services/cityCatalogService';
import { Chip, PrimaryButton, SecondaryButton } from '../onboarding/OnboardingUI';
import { SwipeBackView } from '../components/SwipeBackView';
import { PlayPauseIcon } from '../components/PlayPauseIcon';
import { useFinnusStore } from '../store/useFinnusStore';
import { LegalView } from '../components/legal/LegalView';
import { HelpGuideView } from '../components/legal/HelpGuideView';
import { ConciergePrefsEditor } from '../components/ConciergePrefsEditor';
import {
  getCurrentCoords,
  probeGpsFix,
  refreshLocationDiagnostics,
} from '../services/locationService';

type SettingsSection =
  | 'setup'
  | 'help'
  | 'legal'
  | 'developer';

type SetupSubSection =
  | 'voice'
  | 'about'
  | 'contact'
  | 'character'
  | 'interests'
  | 'prefs'
  | 'memory'
  | 'city';

type Props = {
  visible: boolean;
  profile: UserProfile;
  onClose: () => void;
  onSaved: (profile: UserProfile) => void;
  onReset: () => void;
};

export function SettingsScreen({
  visible,
  profile,
  onClose,
  onSaved,
  onReset,
}: Props) {
  const [draft, setDraft] = useState(profile);
  const [openSection, setOpenSection] = useState<SettingsSection | null>(null);
  const [openSetup, setOpenSetup] = useState<SetupSubSection | null>(null);
  const [previewing, setPreviewing] = useState<VoiceId | null>(null);
  const [showLegal, setShowLegal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const isPlayingAudio = useFinnusStore((s) => s.isPlayingAudio);
  const lang = draft.language;

  useEffect(() => {
    if (visible) {
      setDraft({ ...profile, speechRate: 1 });
      setOpenSection(null);
      setOpenSetup(null);
      setPreviewing(null);
      setShowLegal(false);
      setShowHelp(false);
    }
  }, [visible, profile]);

  if (!visible) {
    return null;
  }

  const patch = (p: Partial<UserProfile>) =>
    setDraft((d) => ({ ...d, ...p, speechRate: 1 }));

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

  const playPreview = async (id: VoiceId) => {
    if (previewing === id) {
      setPreviewing(null);
      await stopSpeaking();
      return;
    }
    persistPatch({ voiceId: id, language: 'de' });
    void voicePreloader.switchActiveVoice(id);
    setPreviewing(id);
    try {
      await playVoiceSample({ voiceId: id });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Hörprobe fehlgeschlagen';
      Alert.alert(t(lang, 'settingsVoice'), msg);
    } finally {
      setPreviewing(null);
    }
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
        <SwipeBackView enabled={visible} onBack={onClose}>
          <View style={styles.header}>
            <Text style={styles.title}>{t(lang, 'settings')}</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>{t(lang, 'close')}</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Accordion
              title={t(lang, 'settingsSetup')}
              open={openSection === 'setup'}
              onToggle={() => toggleSection('setup')}
            >
              <Text style={styles.hint}>
                Stimme, Charakter, Interessen, Stadt und Kontakt — alles für
                deine Personalisierung.
              </Text>

              <SetupRow
                title={t(lang, 'settingsVoice')}
                open={openSetup === 'voice'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'voice' ? null : 'voice'))
                }
              >
                {voicesForLanguage('de').map((v) => (
                  <Pressable
                    key={v.id}
                    onPress={() => {
                      persistPatch({ voiceId: v.id, language: 'de' });
                      void voicePreloader.switchActiveVoice(v.id);
                    }}
                    style={[
                      styles.voiceRow,
                      draft.voiceId === v.id && styles.voiceOn,
                    ]}
                  >
                    <Text style={styles.voiceText}>
                      {v.emoji} {voiceLabel(lang, v.id as VoiceId)}
                    </Text>
                    <Pressable
                      onPress={() => void playPreview(v.id)}
                      style={[
                        styles.playBtn,
                        previewing === v.id && styles.playBtnActive,
                      ]}
                      accessibilityLabel={
                        previewing === v.id && !isPlayingAudio
                          ? 'Wird vorbereitet'
                          : previewing === v.id
                            ? 'Pause'
                            : 'Play'
                      }
                    >
                      {previewing === v.id && !isPlayingAudio ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <PlayPauseIcon
                          paused={previewing === v.id}
                          size={14}
                        />
                      )}
                    </Pressable>
                  </Pressable>
                ))}
              </SetupRow>

              <SetupRow
                title="Über dich"
                open={openSetup === 'about'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'about' ? null : 'about'))
                }
              >
                <AboutMeEditor draft={draft} onChange={patch} />
              </SetupRow>

              <SetupRow
                title="Kontakt für Reservierungen"
                open={openSetup === 'contact'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'contact' ? null : 'contact'))
                }
              >
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
                <InterestsEditor draft={draft} onChange={patch} lang={lang} />
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
                title="Gelerntes Profil"
                open={openSetup === 'memory'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'memory' ? null : 'memory'))
                }
              >
                <LearnedProfileEditor
                  draft={draft}
                  onChange={patch}
                  persistPatch={persistPatch}
                />
              </SetupRow>

              <SetupRow
                title={t(lang, 'settingsCity')}
                open={openSetup === 'city'}
                onToggle={() =>
                  setOpenSetup((c) => (c === 'city' ? null : 'city'))
                }
              >
                <CityEditor
                  lang={lang}
                  selectedId={draft.cityId}
                  selectedName={draft.cityName}
                  onInstalled={(cityId, cityName) => {
                    persistPatch({ cityId, cityName });
                  }}
                />
              </SetupRow>

              <Text style={[styles.hint, { marginTop: spacing.sm }]}>
                Sprache: Deutsch (fest). Mikrofon-Einwilligung wurde in der
                Einrichtung gesetzt.
              </Text>
            </Accordion>

            <Pressable
              style={styles.linkRow}
              onPress={() => setShowHelp(true)}
              accessibilityRole="button"
            >
              <Text style={styles.linkRowTitle}>{t(lang, 'settingsHelp')}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>

            <Pressable
              style={styles.linkRow}
              onPress={() => setShowLegal(true)}
              accessibilityRole="button"
            >
              <Text style={styles.linkRowTitle}>{t(lang, 'settingsLegal')}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>

            <Text style={styles.affiliateFoot}>
              Partner-Buchungen sind als Anzeige gekennzeichnet. Details unter
              Impressum & Datenschutz.
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
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={t(lang, 'save')}
              onPress={() => void handleSave()}
            />
          </View>
        </SwipeBackView>
      </SafeAreaView>

      <LegalView
        embedded
        visible={showLegal}
        onClose={() => setShowLegal(false)}
      />
      <HelpGuideView
        embedded
        visible={showHelp}
        onClose={() => setShowHelp(false)}
      />
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
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.hint}>
        Erzähl Findus etwas über dich — Hobbies, Stimmung, was dir wichtig ist.
        Er nutzt das in seinen Antworten.
      </Text>
      <TextInput
        style={[styles.input, { minHeight: 96, textAlignVertical: 'top' }]}
        placeholder="Über dich…"
        placeholderTextColor={colors.textMuted}
        value={draft.aboutMe ?? ''}
        onChangeText={(aboutMe) => onChange({ aboutMe })}
        multiline
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

  return (
    <View>
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
    </View>
  );
}

function InterestsEditor({
  draft,
  onChange,
  lang,
}: {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  lang: AppLanguage;
}) {
  const categories = (
    ['wissen', 'vibes', 'mobilitaet', 'tempo', 'essen', 'stil'] as const
  ).map((id) => ({
    id,
    title: EXPERIENCE_CATEGORY_TITLES[id].de,
    cards: EXPERIENCE_CARDS.filter((c) => c.category === id),
  }));

  const setPref = (id: string, value: SwipePreference) => {
    onChange({
      experiencePrefs: { ...draft.experiencePrefs, [id]: value },
    });
  };

  const cyclePref = (id: string) => {
    const cur = draft.experiencePrefs[id] ?? 'neutral';
    const next: SwipePreference =
      cur === 'neutral' ? 'yes' : cur === 'yes' ? 'no' : 'neutral';
    setPref(id, next);
  };

  const prefLabel = (v: SwipePreference | undefined) => {
    if (v === 'yes') return t(lang, 'prefYes');
    if (v === 'no') return t(lang, 'prefNo');
    return t(lang, 'neutral');
  };

  return (
    <View>
      {categories.map((cat) => (
        <View key={cat.id} style={styles.catBlock}>
          <Text style={styles.catTitle}>{cat.title}</Text>
          {cat.cards.map((card) => {
            const pref = draft.experiencePrefs[card.id] ?? 'neutral';
            return (
              <Pressable
                key={card.id}
                onPress={() => cyclePref(card.id)}
                style={[
                  styles.interestRow,
                  pref === 'yes' && styles.interestYes,
                  pref === 'no' && styles.interestNo,
                ]}
              >
                <Text style={styles.interestText}>
                  {card.emoji}{' '}
                  {uiLang(lang) === 'de' ? card.labelDe : card.labelEn}
                </Text>
                <Text style={styles.interestPref}>{prefLabel(pref)}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      <Text style={styles.inputLabel}>{t(lang, 'wantExperience')}</Text>
      <TextInput
        value={draft.wantToExperience}
        onChangeText={(wantToExperience) => onChange({ wantToExperience })}
        style={[styles.input, styles.multiline]}
        placeholderTextColor={colors.textMuted}
        multiline
      />
      <Text style={styles.inputLabel}>{t(lang, 'avoidExperience')}</Text>
      <TextInput
        value={draft.avoidExperience}
        onChangeText={(avoidExperience) => onChange({ avoidExperience })}
        style={[styles.input, styles.multiline]}
        placeholderTextColor={colors.textMuted}
        multiline
      />
    </View>
  );
}

function LearnedProfileEditor({
  draft,
  onChange,
  persistPatch,
}: {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  persistPatch: (p: Partial<UserProfile>) => void;
}) {
  const facts = draft.learnedFacts ?? [];
  const diet =
    draft.personaEngine?.preferences?.dietaryRestrictions ?? [];
  const dislikes = draft.personaEngine?.preferences?.dislikes ?? [];

  const clearLearned = () => {
    const next = {
      learnedFacts: [] as string[],
      personaEngine: {
        ...(draft.personaEngine ?? {}),
        preferences: {
          ...(draft.personaEngine?.preferences ?? {}),
          dietaryRestrictions: [],
          dislikes: [],
        },
      },
    };
    onChange(next);
    persistPatch(next);
  };

  return (
    <View>
      <Text style={styles.hint}>
        Findus merkt sich spontan Gesagtes („Ich bin Vegetarier“) und filtert
        Empfehlungen danach.
      </Text>
      {facts.length === 0 && diet.length === 0 && dislikes.length === 0 ? (
        <Text style={styles.hint}>Noch nichts gelernt — einfach während der Tour sagen.</Text>
      ) : (
        <>
          {facts.map((f) => (
            <Text key={f} style={styles.interestText}>
              • {f}
            </Text>
          ))}
          {diet.map((d) => (
            <Text key={`d-${d}`} style={styles.interestText}>
              🥗 {d}
            </Text>
          ))}
          {dislikes.map((d) => (
            <Text key={`x-${d}`} style={styles.interestText}>
              ✕ {d}
            </Text>
          ))}
          <Pressable onPress={clearLearned} style={styles.playBtn}>
            <Text style={styles.voiceText}>Gelerntes löschen</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function CityEditor({
  lang,
  selectedId,
  selectedName,
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
  const [cityLinks, setCityLinks] = useState<CityPackLink[]>([]);
  const [gpsReady, setGpsReady] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedId) {
        setCityLinks([]);
        return;
      }
      try {
        const links = await getCityPackLinks(selectedId);
        if (!cancelled) setCityLinks(links);
      } catch {
        if (!cancelled) setCityLinks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const handleSelect = async (city: CityCatalogItem) => {
    if (installingId) return;
    setInstallingId(city.id);
    try {
      const result = await installCityPack(city.id);
      onInstalled(city.id, result.cityName || city.name);
    } catch (err) {
      Alert.alert(
        t(lang, 'cityInstallFailed'),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setInstallingId(null);
    }
  };

  const openCityLink = async (link: CityPackLink) => {
    try {
      const can = await Linking.canOpenURL(link.url);
      if (!can) {
        Alert.alert(t(lang, 'settingsCityLinkOpen'), link.url);
        return;
      }
      await Linking.openURL(link.url);
    } catch (err) {
      Alert.alert(
        t(lang, 'settingsCityLinkOpen'),
        err instanceof Error ? err.message : String(err),
      );
    }
  };

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
    <View>
      <Text style={styles.hint}>
        {t(lang, 'settingsCityCurrent')}: {selectedName ?? '—'}
      </Text>

      {cityLinks.length > 0 ? (
        <View style={styles.cityLinksBox}>
          <Text style={styles.cityLinksTitle}>
            {t(lang, 'settingsCityLinks')}
          </Text>
          {cityLinks.map((link) => (
            <Pressable
              key={link.id}
              onPress={() => void openCityLink(link)}
              style={styles.cityLinkRow}
              accessibilityRole="link"
              accessibilityLabel={link.title}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cityLinkTitle}>{link.title}</Text>
                {link.description ? (
                  <Text style={styles.cityLinkDesc} numberOfLines={2}>
                    {link.description}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.cityLinkChevron}>↗</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {cities.map((city, index) => {
        const selected = city.id === selectedId;
        const busy = installingId === city.id;
        const showNearbyLabel = gpsReady && index === 0;
        return (
          <View key={city.id}>
            {showNearbyLabel ? (
              <Text style={styles.citySectionLabel}>{t(lang, 'nearby')}</Text>
            ) : gpsReady && index === 1 ? (
              <Text style={styles.citySectionLabel}>{t(lang, 'otherCities')}</Text>
            ) : null}
            <Pressable
              onPress={() => void handleSelect(city)}
              disabled={!!installingId}
              style={[styles.cityRow, selected && styles.cityOn]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cityName}>
                  {city.symbol ?? '📍'} {city.name}
                  {city.distanceKm != null
                    ? ` · ${city.distanceKm.toFixed(1)} ${t(lang, 'kmAway')}`
                    : ''}
                </Text>
                <Text style={styles.cityStats}>
                  {formatTriggerStats({
                    triggerCount: city.triggerCount,
                    zoneCount: city.zoneCount,
                    factCount: city.factCount,
                  })}
                </Text>
              </View>
              {busy ? (
                <ActivityIndicator color={colors.accent} />
              ) : selected ? (
                <Text style={styles.langCheck}>✓</Text>
              ) : null}
            </Pressable>
          </View>
        );
      })}
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
  const gpsAccuracyM = useFinnusStore((s) => s.gpsAccuracyM);
  const lastGpsAtMs = useFinnusStore((s) => s.lastGpsAtMs);
  const lastGpsLat = useFinnusStore((s) => s.lastGpsLat);
  const lastGpsLng = useFinnusStore((s) => s.lastGpsLng);
  const gpsServicesEnabled = useFinnusStore((s) => s.gpsServicesEnabled);
  const ttsProvider =
    draft.ttsProvider === 'kokoro' ? 'kokoro' : 'openai';

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
      <View style={styles.devRow}>
        <View style={styles.devCopy}>
          <Text style={styles.devLabel}>{t(lang, 'ttsProvider')}</Text>
          <Text style={styles.hint}>{t(lang, 'ttsProviderHint')}</Text>
        </View>
      </View>
      <View style={styles.ttsSwitchRow}>
        <Pressable
          onPress={() => {
            setTtsProvider('openai');
            persistPatch({ ttsProvider: 'openai' });
          }}
          style={[
            styles.ttsChip,
            ttsProvider === 'openai' && styles.ttsChipOn,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: ttsProvider === 'openai' }}
        >
          <Text
            style={[
              styles.ttsChipText,
              ttsProvider === 'openai' && styles.ttsChipTextOn,
            ]}
          >
            {t(lang, 'ttsProviderOpenAi')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setTtsProvider('kokoro');
            persistPatch({ ttsProvider: 'kokoro' });
          }}
          style={[
            styles.ttsChip,
            ttsProvider === 'kokoro' && styles.ttsChipOn,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: ttsProvider === 'kokoro' }}
        >
          <Text
            style={[
              styles.ttsChipText,
              ttsProvider === 'kokoro' && styles.ttsChipTextOn,
            ]}
          >
            {t(lang, 'ttsProviderKokoro')}
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

const styles = StyleSheet.create({
  /** Vollfläche über Home — kein RN-Modal (Android: Nested Modals = nur Dunkelheit). */
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 1000,
    elevation: 1000,
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
    marginBottom: 8,
    fontWeight: '700',
    fontSize: 13,
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
  cityLinksBox: {
    marginTop: 10,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 8,
  },
  cityLinksTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cityLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cityLinkTitle: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 15,
  },
  cityLinkDesc: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  cityLinkChevron: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: '700',
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
});
