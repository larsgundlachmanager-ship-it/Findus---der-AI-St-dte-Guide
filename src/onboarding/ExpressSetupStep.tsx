import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  MicConsentBlock,
  micConsentIsValid,
} from '../components/legal/MicConsentBlock';
import { LegalView } from '../components/legal/LegalView';
import { AgeLifeSlider } from './AgeLifeSlider';
import { SpeechMicButton } from '../components/SpeechMicButton';
import { colors, spacing } from '../constants/theme';
import { BUDGET_OPTIONS } from '../constants/conciergePrefs';
import {
  CHARACTER_CATEGORIES,
  EXPERIENCE_CARDS,
  EXPRESS_INTEREST_IDS,
} from '../constants/onboardingOptions';
import {
  TRAVEL_PERIOD_PRESETS,
  matchTravelPeriodPreset,
  type TravelPeriodPreset,
} from '../constants/travelPeriod';
import type {
  BudgetCategory,
  MicListenMode,
  SwipePreference,
  UserProfile,
} from '../types/userProfile';
import {
  startListening,
  stopListening,
  isSttAvailable,
} from '../services/sttService';
import { appendSpeechSegment } from '../utils/speechText';
import { showPermissionMissingAlert } from '../utils/permissionAlerts';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  onNext: (override?: Partial<UserProfile>) => void;
};

/**
 * Express nach Stadt: Über dich, Charakter-Lite, Zeitraum, Budget,
 * kurze Interessen, Mikrofon (Fließtext + Popup).
 */
export function ExpressSetupStep({ draft, onChange, onNext }: Props) {
  const [consentChecked, setConsentChecked] = useState(
    !!draft.hasAcceptedAudioConsent,
  );
  const [showLegal, setShowLegal] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<TravelPeriodPreset>(() =>
    matchTravelPeriodPreset(draft.travelPeriod),
  );
  const [micTarget, setMicTarget] = useState<'want' | 'avoid' | null>(null);
  const micTargetRef = useRef<'want' | 'avoid' | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantBaseRef = useRef('');
  const avoidBaseRef = useRef('');

  const personality = CHARACTER_CATEGORIES.find((c) => c.id === 'characters');
  const tonality = CHARACTER_CATEGORIES.find((c) => c.id === 'tonalities');
  const expressCards = useMemo(
    () =>
      EXPERIENCE_CARDS.filter((c) =>
        (EXPRESS_INTEREST_IDS as readonly string[]).includes(c.id),
      ),
    [],
  );

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

  const setPeriod = (preset: TravelPeriodPreset) => {
    setPeriodPreset(preset);
    if (preset === 'custom') {
      if (matchTravelPeriodPreset(draft.travelPeriod) !== 'custom') {
        onChange({ travelPeriod: '' });
      }
      return;
    }
    const hit = TRAVEL_PERIOD_PRESETS.find((p) => p.id === preset);
    onChange({ travelPeriod: hit?.value ?? '' });
  };

  const toggleInterest = (id: string) => {
    const cur = draft.experiencePrefs[id] ?? 'neutral';
    const next: SwipePreference =
      cur === 'yes' ? 'neutral' : cur === 'neutral' ? 'yes' : 'yes';
    onChange({
      experiencePrefs: { ...draft.experiencePrefs, [id]: next },
    });
  };

  const canContinue =
    draft.firstName.trim().length > 0 &&
    draft.lastName.trim().length > 0 &&
    !!draft.cityId &&
    !!draft.budgetCategory &&
    (draft.travelPeriod?.trim().length ?? 0) > 0 &&
    draft.characters.length >= 1 &&
    draft.tonalities.length >= 1 &&
    micConsentIsValid(draft.micListenMode ?? null, consentChecked);

  const handleContinue = () => {
    if (!canContinue || !draft.micListenMode) return;
    const now = new Date().toISOString();
    const voiceOn = draft.micListenMode === 'hear';
    const partyFromSocial =
      draft.socialDynamics[0] === 'familie'
        ? 'family'
        : draft.socialDynamics[0] === 'date'
          ? 'date'
          : draft.socialDynamics[0] === 'zu_zweit'
            ? 'couple'
            : draft.socialDynamics[0] === 'freundesgruppe'
              ? 'friends'
              : 'solo';

    onNext({
      onboardingMode: 'express',
      hasAcceptedAudioConsent: voiceOn,
      audioConsentAt: voiceOn ? now : null,
      hasAcceptedPrivacyPolicy: true,
      privacyAcceptedAt: draft.privacyAcceptedAt ?? now,
      micListenMode: draft.micListenMode,
      travelParty: draft.travelParty ?? partyFromSocial,
      mobilityMode: draft.mobilityMode ?? 'foot',
      energyLevel: draft.energyLevel ?? 'medium',
      touristMode:
        draft.touristMode ??
        (draft.experiencePrefs.weg_vom_trubel === 'yes'
          ? 'insider'
          : draft.experiencePrefs.typisch_touri === 'yes'
            ? 'tourist'
            : 'mix'),
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
        keyboardShouldPersistTaps="handled"
      >
        <StepTitle>Express-Einrichtung</StepTitle>
        <StepSubtitle>
          Kurz registrieren, Charakter anreißen, Zeitraum & Budget — fertig.
        </StepSubtitle>

        <Text style={styles.label}>Über dich</Text>
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
          placeholder="E-Mail (optional)"
          placeholderTextColor={colors.textMuted}
          value={draft.email}
          onChangeText={(email) => onChange({ email })}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Text style={styles.subLabel}>Erzähl kurz etwas über dich</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="Hobbies, Stimmung, was dir wichtig ist…"
          placeholderTextColor={colors.textMuted}
          value={draft.aboutMe ?? ''}
          onChangeText={(aboutMe) => onChange({ aboutMe })}
          multiline
          textAlignVertical="top"
        />
        <Text style={styles.subLabel}>Alter</Text>
        <AgeLifeSlider
          age={draft.age}
          yearsLabel="Jahre"
          onChange={(age) => onChange({ age })}
        />

        {personality ? (
          <>
            <Text style={styles.label}>{personality.titleDe}</Text>
            <View style={styles.chipWrap}>
              {personality.options.map((o) => {
                const on = draft.characters.includes(o.id);
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => onChange({ characters: [o.id] })}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={styles.chipText}>
                      {o.emoji} {o.labelDe}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {tonality ? (
          <>
            <Text style={styles.label}>{tonality.titleDe}</Text>
            <View style={styles.chipWrap}>
              {tonality.options.map((o) => {
                const on = draft.tonalities.includes(o.id);
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => onChange({ tonalities: [o.id] })}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={styles.chipText}>
                      {o.emoji} {o.labelDe}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Kurz: Interessen</Text>
        <Text style={styles.hint}>
          Tippen zum Anmachen — Jahreszahlen, Essen, Vibes …
        </Text>
        <View style={styles.chipWrap}>
          {expressCards.map((c) => {
            const on = draft.experiencePrefs[c.id] === 'yes';
            return (
              <Pressable
                key={c.id}
                onPress={() => toggleInterest(c.id)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipText}>
                  {c.emoji} {c.labelDe}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Was willst du erleben?</Text>
        <View style={styles.micRow}>
          <TextInput
            style={[styles.input, styles.multiline, styles.micInput]}
            placeholder="z. B. Streetfood, Rooftops, Museen …"
            placeholderTextColor={colors.textMuted}
            value={draft.wantToExperience}
            onChangeText={(wantToExperience) => onChange({ wantToExperience })}
            multiline
          />
          <SpeechMicButton
            active={micTarget === 'want'}
            onPress={() => void startMic('want')}
          />
        </View>
        <Text style={styles.label}>Was willst du nicht erleben?</Text>
        <View style={styles.micRow}>
          <TextInput
            style={[styles.input, styles.multiline, styles.micInput]}
            placeholder="z. B. Warteschlangen, Kitschtouri …"
            placeholderTextColor={colors.textMuted}
            value={draft.avoidExperience}
            onChangeText={(avoidExperience) => onChange({ avoidExperience })}
            multiline
          />
          <SpeechMicButton
            active={micTarget === 'avoid'}
            onPress={() => void startMic('avoid')}
          />
        </View>

        <Text style={styles.label}>Reisezeitraum</Text>
        <View style={styles.chipWrap}>
          {TRAVEL_PERIOD_PRESETS.map((p) => {
            const on = periodPreset === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => setPeriod(p.id)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipText}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {periodPreset === 'custom' ? (
          <TextInput
            style={styles.input}
            placeholder="z. B. 3.–10. August"
            placeholderTextColor={colors.textMuted}
            value={draft.travelPeriod ?? ''}
            onChangeText={(travelPeriod) => onChange({ travelPeriod })}
          />
        ) : null}

        <Text style={styles.label}>Budget — ungefähr wie viel?</Text>
        <View style={styles.budgetRow}>
          {BUDGET_OPTIONS.map((b) => {
            const on = draft.budgetCategory === b.id;
            return (
              <Pressable
                key={b.id}
                onPress={() =>
                  onChange({ budgetCategory: b.id as BudgetCategory })
                }
                style={[styles.budgetChip, on && styles.chipOn]}
              >
                <Text style={styles.budgetLabel}>{b.label}</Text>
                <Text style={styles.budgetHint}>{b.hint}</Text>
              </Pressable>
            );
          })}
        </View>

        <MicConsentBlock
          compact
          mode={draft.micListenMode ?? null}
          consentChecked={consentChecked}
          onChangeMode={(micListenMode: MicListenMode) =>
            onChange({ micListenMode })
          }
          onChangeConsent={setConsentChecked}
          onOpenPrivacy={() => setShowLegal(true)}
        />

        <View style={styles.footer}>
          <PrimaryButton
            label="Weiter zur Erklärung"
            onPress={handleContinue}
            disabled={!canContinue}
          />
        </View>
      </ScrollView>

      <LegalView visible={showLegal} onClose={() => setShowLegal(false)} />
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  scroll: {
    paddingBottom: spacing.xl * 2,
    gap: spacing.sm,
  },
  label: {
    marginTop: spacing.md,
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  subLabel: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  micRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  micInput: { flex: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.18)',
  },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  budgetRow: { flexDirection: 'row', gap: 8 },
  budgetChip: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
  },
  budgetLabel: { color: colors.text, fontWeight: '700', fontSize: 13 },
  budgetHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  footer: { marginTop: spacing.lg },
});
