import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import {
  ALLERGY_INTOLERANCE_OPTIONS,
  ANSWER_STYLE_OPTIONS,
  BUDGET_OPTIONS,
  DIETARY_OPTIONS,
  ENERGY_OPTIONS,
  MOBILITY_OPTIONS,
  MUST_HAVE_STYLE_OPTIONS,
  patchFromMustHaveStyles,
  TRAVEL_PARTY_OPTIONS,
} from '../constants/conciergePrefs';
import type {
  AnswerStyle,
  BudgetCategory,
  EnergyLevel,
  MobilityMode,
  MustHaveStyleId,
  TravelParty,
  UserProfile,
} from '../types/userProfile';
import { TravelModeSelector } from './TravelModeSelector';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
};

function ChipRow<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { id: T; label: string; hint: string }[];
  value: T | null | undefined;
  onSelect: (id: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onSelect(o.id)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{o.label}</Text>
            {o.hint ? <Text style={styles.chipHint}>{o.hint}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Concierge-Prefs: Gruppe, Mobilität, Energie, Budget, Essen, Allergien, Stil.
 */
export function ConciergePrefsEditor({ draft, onChange }: Props) {
  const dietary = draft.dietaryTags ?? [];
  const allergyTags = draft.allergyTags ?? [];
  const mustHaves = draft.mustHaveStyles ?? [];
  const [allergyOpen, setAllergyOpen] = useState(() =>
    (draft.allergyTags ?? []).some((t) => t !== 'keine'),
  );

  const toggleDiet = (id: string) => {
    const next = dietary.includes(id)
      ? dietary.filter((x) => x !== id)
      : [...dietary, id];
    onChange({ dietaryTags: next });
  };

  const toggleAllergy = (id: string) => {
    const withoutKeine = allergyTags.filter((x) => x !== 'keine');
    const next = withoutKeine.includes(id)
      ? withoutKeine.filter((x) => x !== id)
      : [...withoutKeine, id];
    onChange({ allergyTags: next });
  };

  const toggleMustHave = (id: MustHaveStyleId) => {
    const next = mustHaves.includes(id)
      ? mustHaves.filter((x) => x !== id)
      : [...mustHaves, id];
    onChange(patchFromMustHaveStyles(next, draft));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Mit wem reist du?</Text>
      <ChipRow
        options={TRAVEL_PARTY_OPTIONS}
        value={draft.travelParty}
        onSelect={(travelParty: TravelParty) => onChange({ travelParty })}
      />

      <Text style={styles.label}>Mobilität</Text>
      <ChipRow
        options={MOBILITY_OPTIONS}
        value={draft.mobilityMode}
        onSelect={(mobilityMode: MobilityMode) => onChange({ mobilityMode })}
      />
      <Text style={[styles.label, { marginTop: spacing.sm }]}>
        Jetzt unterwegs mit
      </Text>
      <TravelModeSelector />

      <Text style={styles.label}>Energielevel</Text>
      <ChipRow
        options={ENERGY_OPTIONS}
        value={draft.energyLevel}
        onSelect={(energyLevel: EnergyLevel) => onChange({ energyLevel })}
      />

      <Text style={styles.label}>Budget</Text>
      <ChipRow
        options={BUDGET_OPTIONS}
        value={draft.budgetCategory}
        onSelect={(budgetCategory: BudgetCategory) => {
          onChange({
            budgetCategory,
            experiencePrefs: {
              ...draft.experiencePrefs,
              budget:
                budgetCategory === 'sparsam'
                  ? 'no'
                  : budgetCategory === 'komfort'
                    ? 'yes'
                    : 'neutral',
            },
          });
        }}
      />

      <Text style={styles.label}>Must-haves</Text>
      <Text style={styles.fieldHint}>
        Mehrfachauswahl — Findus mixt Tipps (Touri, ruhig, versteckt, Nachtleben).
      </Text>
      <View style={styles.chipRow}>
        {MUST_HAVE_STYLE_OPTIONS.map((o) => {
          const on = mustHaves.includes(o.id);
          return (
            <Pressable
              key={o.id}
              onPress={() => toggleMustHave(o.id)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{o.label}</Text>
              {o.hint ? <Text style={styles.chipHint}>{o.hint}</Text> : null}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Antwortstil</Text>
      <ChipRow
        options={ANSWER_STYLE_OPTIONS}
        value={draft.answerStyle ?? 'short'}
        onSelect={(answerStyle: AnswerStyle) => onChange({ answerStyle })}
      />

      <Text style={styles.label}>Ernährung</Text>
      <View style={styles.chipRow}>
        {DIETARY_OPTIONS.map((o) => {
          const on = dietary.includes(o.id);
          return (
            <Pressable
              key={o.id}
              onPress={() => toggleDiet(o.id)}
              style={[styles.chipSmall, on && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Allergien & Unverträglichkeiten</Text>
      <Text style={styles.fieldHint}>
        Tippen — Findus meidet unpassende Essenstipps.
      </Text>
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
                    allergyTags: allergyTags.filter((x) => x !== 'keine'),
                  });
                }
              }}
              style={[styles.chipSmall, on && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {allergyOpen ? (
        <View style={styles.chipRow}>
          {ALLERGY_INTOLERANCE_OPTIONS.map((o) => {
            const on = allergyTags.includes(o.id);
            return (
              <Pressable
                key={o.id}
                onPress={() => toggleAllergy(o.id)}
                style={[styles.chipSmall, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        placeholder="Sonstiges Freitext (z. B. Kiwi, Penicillin…)"
        placeholderTextColor={colors.textMuted}
        value={draft.allergies ?? ''}
        onChangeText={(allergies) => onChange({ allergies })}
      />

      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.switchTitle}>Hinweise & Erinnerungen</Text>
          <Text style={styles.switchHint}>
            Orte in der Nähe plus Push-Erinnerungen vor Bus/Bahn und Flug
            (auch bei gesperrtem Bildschirm).
          </Text>
        </View>
        <Switch
          value={draft.notificationsEnabled !== false}
          onValueChange={(notificationsEnabled) =>
            onChange({ notificationsEnabled })
          }
          trackColor={{ false: '#444', true: colors.accent }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  label: {
    marginTop: spacing.sm,
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minWidth: '46%',
    flexGrow: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  chipSmall: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.15)',
  },
  chipLabel: { color: colors.text, fontWeight: '700', fontSize: 12 },
  chipHint: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  fieldHint: { color: colors.textMuted, fontSize: 12, marginTop: -2 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  switchRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  switchCopy: { flex: 1 },
  switchTitle: { color: colors.text, fontWeight: '700', fontSize: 13 },
  switchHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
