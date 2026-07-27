import React from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import {
  ANSWER_STYLE_OPTIONS,
  BUDGET_OPTIONS,
  DIETARY_OPTIONS,
  ENERGY_OPTIONS,
  MOBILITY_OPTIONS,
  TOURIST_MODE_OPTIONS,
  TRAVEL_PARTY_OPTIONS,
} from '../constants/conciergePrefs';
import type {
  AnswerStyle,
  BudgetCategory,
  EnergyLevel,
  MobilityMode,
  TouristVsInsider,
  TravelParty,
  UserProfile,
} from '../types/userProfile';

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
 * Concierge-Prefs: Gruppe, Mobilität, Energie, Budget, Essen, Stil, Benachrichtigungen.
 */
export function ConciergePrefsEditor({ draft, onChange }: Props) {
  const dietary = draft.dietaryTags ?? [];

  const toggleDiet = (id: string) => {
    const next = dietary.includes(id)
      ? dietary.filter((x) => x !== id)
      : [...dietary, id];
    onChange({ dietaryTags: next });
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

      <Text style={styles.label}>Must-sees oder Geheimtipps?</Text>
      <ChipRow
        options={TOURIST_MODE_OPTIONS}
        value={draft.touristMode}
        onSelect={(touristMode: TouristVsInsider) => onChange({ touristMode })}
      />

      <Text style={styles.label}>Antwortstil</Text>
      <ChipRow
        options={ANSWER_STYLE_OPTIONS}
        value={draft.answerStyle}
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

      <Text style={styles.label}>Allergien (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="z. B. Nüsse, Laktose…"
        placeholderTextColor={colors.textMuted}
        value={draft.allergies ?? ''}
        onChangeText={(allergies) => onChange({ allergies })}
      />

      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <Text style={styles.switchTitle}>Hinweise zu Orten</Text>
          <Text style={styles.switchHint}>
            Findus darf dich auf nahe Sehenswürdigkeiten hinweisen.
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
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  chipSmall: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.15)',
  },
  chipLabel: { color: colors.text, fontWeight: '700', fontSize: 13 },
  chipHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: spacing.sm,
  },
  switchCopy: { flex: 1 },
  switchTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  switchHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
