/**
 * Express-Einrichtung = verkürzte Standardeinrichtung:
 * Profil → Schnellprofile → Stimme → Aktuelle Reise (lite).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  OnboardingShell,
  PrimaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import { NamePronunciationEditor } from '../components/settings/NamePronunciationEditor';
import { AgeLifeSlider } from './AgeLifeSlider';
import { VoiceSelectorList } from '../components/VoiceSelectorList';
import { AktuelleReiseEditor } from '../components/settings/AktuelleReiseEditor';
import { EqualChipRow } from '../components/EqualChipRow';
import { colors, spacing } from '../constants/theme';
import {
  ALLERGY_INTOLERANCE_OPTIONS,
  ANSWER_STYLE_OPTIONS,
} from '../constants/conciergePrefs';
import {
  expressGoldenCombos,
  matchGoldenCombo,
  type GoldenCombo,
} from '../constants/personalityMatrix';
import { voiceForGoldenCombo } from '../services/persona/personalityVoiceMap';
import type { AnswerStyle, UserProfile, VoiceId } from '../types/userProfile';
import { voicePreloader } from '../services/ttsService';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  onNext: (override?: Partial<UserProfile>) => void;
};

type MissingItem = { id: string; label: string };

function listMissingExpress(draft: UserProfile): MissingItem[] {
  const missing: MissingItem[] = [];
  const isGuest = draft.accountMode === 'guest';
  if (!draft.firstName.trim()) missing.push({ id: 'firstName', label: 'Vorname' });
  if (!isGuest && !draft.lastName.trim()) {
    missing.push({ id: 'lastName', label: 'Nachname' });
  }
  if (!isGuest && !/@/.test(draft.email.trim())) {
    missing.push({ id: 'email', label: 'E-Mail' });
  }
  if (!isGuest && (draft.phoneNumber ?? '').replace(/\D/g, '').length < 6) {
    missing.push({ id: 'phone', label: 'Telefon' });
  }
  if (!isGuest && !draft.gender) {
    missing.push({ id: 'gender', label: 'Geschlecht' });
  }
  if (!(typeof draft.age === 'number' && draft.age >= 12 && draft.age <= 100)) {
    missing.push({ id: 'age', label: 'Alter' });
  }
  const combo = matchGoldenCombo({
    coreRole: draft.coreRole,
    vibeTone: draft.vibeTone,
    knowledgeStyle: draft.knowledgeStyle,
    spleens: draft.spleens,
  });
  if (!combo) missing.push({ id: 'character', label: 'Persönlichkeit' });
  if (!draft.voiceId) missing.push({ id: 'voice', label: 'Stimme' });
  if (!(draft.motives ?? []).length) {
    missing.push({ id: 'motives', label: 'Reisezweck' });
  }
  if (!draft.travelParty) missing.push({ id: 'party', label: 'Mit wem' });
  if (!draft.mobilityMode) missing.push({ id: 'mobility', label: 'Mobilität' });
  if (!draft.energyLevel) missing.push({ id: 'energy', label: 'Energie' });
  if (!draft.budgetCategory) missing.push({ id: 'budget', label: 'Budget' });
  if (!draft.tourLengthPref) {
    missing.push({ id: 'tours', label: 'Tourlänge' });
  }
  if (!draft.cityId) missing.push({ id: 'city', label: 'Stadt' });
  return missing;
}

export function ExpressSetupStep({ draft, onChange, onNext }: Props) {
  const [allergyOpen, setAllergyOpen] = useState(() => {
    const tags = draft.allergyTags ?? [];
    return tags.some((t) => t !== 'keine');
  });

  const goldenPresets = useMemo(() => expressGoldenCombos(), []);

  const selectedCombo: GoldenCombo | null = useMemo(
    () =>
      matchGoldenCombo({
        coreRole: draft.coreRole,
        vibeTone: draft.vibeTone,
        knowledgeStyle: draft.knowledgeStyle,
        spleens: draft.spleens,
      }),
    [draft.coreRole, draft.vibeTone, draft.knowledgeStyle, draft.spleens],
  );

  const recommendedVoice = selectedCombo
    ? voiceForGoldenCombo(selectedCombo, draft.gender)
    : null;

  const missing = useMemo(() => listMissingExpress(draft), [draft]);
  const canContinue = missing.length === 0;
  const isGuest = draft.accountMode === 'guest';

  useEffect(() => {
    if (!selectedCombo || !recommendedVoice) return;
    if (draft.voicePinnedByUser) return;
    if (draft.voiceId === recommendedVoice) return;
    onChange({
      voiceId: recommendedVoice,
      voicePinnedByUser: false,
    });
    void voicePreloader.switchActiveVoice(recommendedVoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCombo?.id, draft.gender]);

  const applyCombo = (combo: GoldenCombo) => {
    const voiceId = voiceForGoldenCombo(combo, draft.gender);
    onChange({
      coreRole: combo.coreRole,
      vibeTone: combo.vibeTone,
      knowledgeStyle: combo.knowledgeStyle,
      spleens: [...combo.spleens],
      voiceId,
      voicePinnedByUser: false,
      characters: [combo.id],
      tonalities: [combo.vibeTone],
    });
    void voicePreloader.switchActiveVoice(voiceId);
  };

  const toggleAllergy = (id: string) => {
    const cur = (draft.allergyTags ?? []).filter((x) => x !== 'keine');
    const next = cur.includes(id)
      ? cur.filter((x) => x !== id)
      : [...cur, id];
    onChange({ allergyTags: next });
  };

  const handleContinue = () => {
    if (!canContinue) return;
    const now = new Date().toISOString();
    const voiceOn = (draft.micListenMode ?? 'hear') === 'hear';
    onNext({
      onboardingMode: 'express',
      hasAcceptedAudioConsent: voiceOn,
      audioConsentAt: voiceOn ? now : null,
      hasAcceptedPrivacyPolicy: true,
      privacyAcceptedAt: draft.privacyAcceptedAt ?? now,
      micListenMode: draft.micListenMode ?? 'hear',
      travelParty: draft.travelParty ?? 'solo',
      mobilityMode: draft.mobilityMode ?? 'foot',
      energyLevel: draft.energyLevel ?? 'medium',
      mustHaveStyles: draft.mustHaveStyles ?? [],
      touristMode: draft.touristMode ?? 'mix',
      answerStyle: draft.answerStyle ?? 'short',
      notificationsEnabled: draft.notificationsEnabled !== false,
      dataSaverMode: false,
      experiencePrefs: {
        ...draft.experiencePrefs,
        budget:
          draft.budgetCategory === 'sparsam'
            ? 'no'
            : draft.budgetCategory === 'komfort'
              ? 'yes'
              : 'neutral',
      },
    });
  };

  return (
    <OnboardingShell style={styles.shell}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
      >
        <StepTitle>Express-Einrichtung</StepTitle>
        <StepSubtitle>
          Wie die Standardeinrichtung — nur kürzer. Alles Weitere jederzeit in
          den Einstellungen.
        </StepSubtitle>

        <View style={styles.group}>
          <Text style={styles.label}>Über dich</Text>
          {isGuest ? (
            <Text style={styles.hint}>
              Als Gast reicht der Vorname. E-Mail/Telefon bei der ersten
              Reservierung.
            </Text>
          ) : null}
          <TextInput
            style={styles.input}
            placeholder="Vorname *"
            placeholderTextColor={colors.textMuted}
            value={draft.firstName}
            onChangeText={(firstName) => onChange({ firstName })}
            autoCapitalize="words"
            autoCorrect={false}
            autoComplete="off"
            showSoftInputOnFocus
          />
          <NamePronunciationEditor draft={draft} onChange={onChange} />
          <TextInput
            style={styles.input}
            placeholder={isGuest ? 'Nachname' : 'Nachname *'}
            placeholderTextColor={colors.textMuted}
            value={draft.lastName}
            onChangeText={(lastName) => onChange({ lastName })}
            autoCapitalize="words"
          />
          <TextInput
            style={styles.input}
            placeholder={isGuest ? 'E-Mail' : 'E-Mail *'}
            placeholderTextColor={colors.textMuted}
            value={draft.email}
            onChangeText={(email) => onChange({ email })}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder={isGuest ? 'Handy' : 'Handy *'}
            placeholderTextColor={colors.textMuted}
            value={draft.phoneNumber ?? ''}
            onChangeText={(phoneNumber) => onChange({ phoneNumber })}
            keyboardType="phone-pad"
          />
          <Text style={styles.subLabel}>Geschlecht</Text>
          <EqualChipRow count={4}>
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
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={styles.chipText}>{o.label}</Text>
                </Pressable>
              );
            })}
          </EqualChipRow>
          <Text style={styles.subLabel}>Alter</Text>
          <AgeLifeSlider
            age={draft.age}
            yearsLabel="Jahre"
            onChange={(age) => onChange({ age })}
          />
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>Allergien</Text>
          <EqualChipRow count={2}>
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
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={styles.chipText}>{o.label}</Text>
                </Pressable>
              );
            })}
          </EqualChipRow>
          {allergyOpen ? (
            <EqualChipRow count={ALLERGY_INTOLERANCE_OPTIONS.length}>
              {ALLERGY_INTOLERANCE_OPTIONS.map((o) => {
                const on = (draft.allergyTags ?? []).includes(o.id);
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => toggleAllergy(o.id)}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={styles.chipText}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </EqualChipRow>
          ) : null}
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>Wie soll ich sein?</Text>
          <Text style={styles.hint}>
            Schnellprofile — Tonalität, Wissen und Spleens setze ich passend mit.
          </Text>
          <View style={styles.presetCol}>
            {goldenPresets.map((combo) => {
              const on = selectedCombo?.id === combo.id;
              return (
                <Pressable
                  key={combo.id}
                  onPress={() => applyCombo(combo)}
                  style={[styles.presetCard, on && styles.presetCardOn]}
                >
                  <Text style={styles.presetEmoji}>{combo.emoji}</Text>
                  <View style={styles.presetCopy}>
                    <Text style={styles.presetTitle}>{combo.labelDe}</Text>
                    <Text style={styles.presetHint} numberOfLines={2}>
                      {combo.infoDe}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.subLabel, { marginTop: spacing.sm }]}>
            Antwortstil
          </Text>
          <EqualChipRow count={ANSWER_STYLE_OPTIONS.length}>
            {ANSWER_STYLE_OPTIONS.map((o) => {
              const on = (draft.answerStyle ?? 'short') === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => onChange({ answerStyle: o.id as AnswerStyle })}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={styles.chipText}>{o.label}</Text>
                </Pressable>
              );
            })}
          </EqualChipRow>
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>Stimme</Text>
          <Text style={styles.hint}>
            Alle Stimmen wie in der Standardeinrichtung.
            {recommendedVoice
              ? ` Empfehlung: ${recommendedVoice}.`
              : ' Wähle zuerst ein Schnellprofil.'}
          </Text>
          <VoiceSelectorList
            selectedVoiceId={draft.voiceId}
            recommendedVoiceId={recommendedVoice ?? undefined}
            onSelectVoice={(voiceId: VoiceId) => {
              onChange({ voiceId, voicePinnedByUser: true });
              void voicePreloader.switchActiveVoice(voiceId);
            }}
          />
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>Aktuelle Reise</Text>
          <AktuelleReiseEditor
            draft={draft}
            onChange={onChange}
            mode="lite"
          />
        </View>

        <View style={styles.footer}>
          <PrimaryButton
            label="Weiter zur Erklärung"
            onPress={handleContinue}
            disabled={!canContinue}
          />
          {!canContinue ? (
            <Text style={styles.missingHint}>
              Noch offen: {missing.map((m) => m.label).join(', ')}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  scroll: {
    paddingBottom: spacing.xl * 2,
    gap: spacing.md,
  },
  group: {
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: 'rgba(22, 54, 44, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(196, 163, 90, 0.14)',
    gap: spacing.sm,
  },
  label: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  subLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  missingHint: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.surface,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.18)',
  },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  presetCol: { gap: spacing.sm },
  presetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  presetCardOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  presetEmoji: { fontSize: 28 },
  presetCopy: { flex: 1 },
  presetTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  presetHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  footer: { marginTop: spacing.sm },
});
