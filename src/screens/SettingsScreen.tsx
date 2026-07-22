import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  type CityCatalogItem,
} from '../services/cityCatalogService';
import { Chip, PrimaryButton, SecondaryButton } from '../onboarding/OnboardingUI';
import { SwipeBackView } from '../components/SwipeBackView';
import { PlayPauseIcon } from '../components/PlayPauseIcon';
import { useFinnusStore } from '../store/useFinnusStore';

type SettingsSection =
  | 'voice'
  | 'language'
  | 'character'
  | 'interests'
  | 'city'
  | 'developer';

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
  const [previewing, setPreviewing] = useState<VoiceId | null>(null);
  const isPlayingAudio = useFinnusStore((s) => s.isPlayingAudio);
  const lang = draft.language;

  useEffect(() => {
    if (visible) {
      setDraft({ ...profile, speechRate: 1 });
      setOpenSection(null);
      setPreviewing(null);
    }
  }, [visible, profile]);

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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
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
              title={t(lang, 'settingsVoice')}
              open={openSection === 'voice'}
              onToggle={() => toggleSection('voice')}
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
            </Accordion>

            <Accordion
              title={t(lang, 'settingsLanguage')}
              open={openSection === 'language'}
              onToggle={() => toggleSection('language')}
            >
              <Pressable style={[styles.langRow, styles.langOn]}>
                <Text style={styles.langFlag}>🇩🇪</Text>
                <View style={styles.langCopy}>
                  <Text style={styles.langTitle}>{t(lang, 'deutsch')}</Text>
                </View>
                <Text style={styles.langCheck}>✓</Text>
              </Pressable>
              <Text style={styles.hint}>{t(lang, 'settingsLanguageHint')}</Text>
            </Accordion>

            <Accordion
              title={t(lang, 'settingsCharacter')}
              open={openSection === 'character'}
              onToggle={() => toggleSection('character')}
            >
              <CharacterEditor draft={draft} onChange={patch} lang={lang} />
            </Accordion>

            <Accordion
              title={t(lang, 'settingsInterests')}
              open={openSection === 'interests'}
              onToggle={() => toggleSection('interests')}
            >
              <InterestsEditor draft={draft} onChange={patch} lang={lang} />
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
                  persistPatch({ cityId, cityName });
                }}
              />
            </Accordion>

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
    </Modal>
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
        onChange({ socialDynamics: ids });
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
    ['wissen', 'vibes', 'mobilitaet', 'tempo', 'essen'] as const
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const catalog = await loadCityCatalog(null);
        if (!cancelled) setCities(catalog);
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
    } catch (err) {
      Alert.alert(
        t(lang, 'cityInstallFailed'),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setInstallingId(null);
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
      {cities.map((city) => {
        const selected = city.id === selectedId;
        const busy = installingId === city.id;
        return (
          <Pressable
            key={city.id}
            onPress={() => void handleSelect(city)}
            disabled={!!installingId}
            style={[styles.cityRow, selected && styles.cityOn]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.cityName}>
                {city.symbol ?? '📍'} {city.name}
              </Text>
              <Text style={styles.cityStats}>
                {city.gpsCount} {t(lang, 'zones')} · {city.placeCount}{' '}
                {t(lang, 'places')} · {city.factCount} {t(lang, 'facts')}
              </Text>
            </View>
            {busy ? (
              <ActivityIndicator color={colors.accent} />
            ) : selected ? (
              <Text style={styles.langCheck}>✓</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function DeveloperSection({
  lang,
  onReset,
}: {
  lang: AppLanguage;
  onReset: () => void;
}) {
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const setSimulationMode = useFinnusStore((s) => s.setSimulationMode);
  const resetTourContext = useFinnusStore((s) => s.resetTourContext);

  return (
    <View>
      <View style={styles.devRow}>
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
      <View style={{ marginTop: spacing.md }}>
        <SecondaryButton label={t(lang, 'resetApp')} onPress={onReset} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  footer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
