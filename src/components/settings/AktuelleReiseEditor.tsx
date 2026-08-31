/**
 * Aktuelle Reise — SSOT für Standard-Einrichtung, Express (lite) und Einstellungen.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';
import {
  BUDGET_OPTIONS,
  ENERGY_OPTIONS,
  MOBILITY_OPTIONS,
  MUST_HAVE_STYLE_OPTIONS,
  patchFromMustHaveStyles,
  patchFromTourLength,
  TOUR_LENGTH_OPTIONS,
  TRAVEL_PARTY_OPTIONS,
} from '../../constants/conciergePrefs';
import { CHARACTER_CATEGORIES } from '../../constants/onboardingOptions';
import {
  EXPERIENCE_CARDS,
  EXPERIENCE_CATEGORY_TITLES,
  EXPRESS_INTEREST_IDS,
  TRAVEL_STYLE_CARD_IDS,
} from '../../constants/onboardingOptions';
import {
  TRAVEL_PERIOD_PRESETS,
  matchTravelPeriodPreset,
  type TravelPeriodPreset,
} from '../../constants/travelPeriod';
import type {
  BudgetCategory,
  EnergyLevel,
  MobilityMode,
  MustHaveStyleId,
  SwipePreference,
  TourLengthPref,
  TravelParty,
  UserProfile,
} from '../../types/userProfile';
import { EqualChipRow } from '../EqualChipRow';
import { TravelModeSelector } from '../TravelModeSelector';
import { StartBaseSettingsBlock } from './StartBaseSettingsBlock';

type Mode = 'full' | 'lite';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  mode?: Mode;
};

const MOTIVES_CATEGORY = CHARACTER_CATEGORIES.find((c) => c.id === 'motives');
const MOTIVES_MAX = MOTIVES_CATEGORY?.maxSelect ?? 3;

const SKIP_CARD_IDS = new Set([
  'jahreszahlen',
  'geschichte',
  'barrierearm',
  'kurztrip',
  'budget',
]);

function ChipRow<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T | null | undefined;
  onSelect: (id: T) => void;
}) {
  return (
    <EqualChipRow count={Math.min(options.length, 4)}>
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
    </EqualChipRow>
  );
}

export function AktuelleReiseEditor({
  draft,
  onChange,
  mode = 'full',
}: Props) {
  const lite = mode === 'lite';
  const motives = draft.motives ?? [];
  const mustHaves = draft.mustHaveStyles ?? [];
  const periodPreset = matchTravelPeriodPreset(draft.travelPeriod);

  const motiveOptions = useMemo(
    () =>
      (MOTIVES_CATEGORY?.options ?? []).map((o) => ({
        id: o.id,
        label: `${o.emoji} ${o.labelDe}`,
      })),
    [],
  );

  const setPeriod = (preset: TravelPeriodPreset) => {
    if (preset === 'custom') {
      if (matchTravelPeriodPreset(draft.travelPeriod) !== 'custom') {
        onChange({ travelPeriod: '' });
      }
      return;
    }
    const hit = TRAVEL_PERIOD_PRESETS.find((p) => p.id === preset);
    onChange({ travelPeriod: hit?.value ?? '' });
  };

  const toggleMotive = (id: string) => {
    if (motives.includes(id)) {
      onChange({ motives: motives.filter((x) => x !== id) });
      return;
    }
    if (motives.length >= MOTIVES_MAX) {
      onChange({ motives: [...motives.slice(1), id] });
      return;
    }
    onChange({ motives: [...motives, id] });
  };

  const toggleMustHave = (id: MustHaveStyleId) => {
    const next = mustHaves.includes(id)
      ? mustHaves.filter((x) => x !== id)
      : [...mustHaves, id];
    onChange(patchFromMustHaveStyles(next, draft));
  };

  const cyclePref = (id: string) => {
    const cur = draft.experiencePrefs[id] ?? 'neutral';
    const next: SwipePreference =
      cur === 'neutral' ? 'yes' : cur === 'yes' ? 'no' : 'neutral';
    const patch: Partial<UserProfile> = {
      experiencePrefs: { ...draft.experiencePrefs, [id]: next },
    };
    if (id === 'weg_vom_trubel' && next === 'yes') patch.touristMode = 'insider';
    if (id === 'typisch_touri' && next === 'yes') patch.touristMode = 'tourist';
    onChange(patch);
  };

  const interestCards = lite
    ? EXPERIENCE_CARDS.filter((c) =>
        (EXPRESS_INTEREST_IDS as readonly string[]).includes(c.id),
      )
    : EXPERIENCE_CARDS.filter((c) => !SKIP_CARD_IDS.has(c.id));

  const categories = lite
    ? null
    : [
        {
          id: 'erleben',
          title: 'Jetzt aber — was spricht dich an',
          cards: EXPERIENCE_CARDS.filter(
            (c) =>
              (c.category === 'wissen' || c.category === 'vibes') &&
              !SKIP_CARD_IDS.has(c.id),
          ),
        },
        ...(['mobilitaet', 'tempo', 'essen', 'stil'] as const).map((id) => ({
          id,
          title: EXPERIENCE_CATEGORY_TITLES[id].de,
          cards: EXPERIENCE_CARDS.filter((c) => {
            if (c.category !== id || SKIP_CARD_IDS.has(c.id)) return false;
            if (id === 'stil') {
              return (TRAVEL_STYLE_CARD_IDS as readonly string[]).includes(c.id);
            }
            if (id === 'mobilitaet') return false;
            return true;
          }),
        })),
      ];

  return (
    <View style={styles.wrap}>
      {!lite ? (
        <View style={styles.group}>
          <Text style={styles.label}>Reisezeitraum</Text>
          <EqualChipRow count={TRAVEL_PERIOD_PRESETS.length}>
            {TRAVEL_PERIOD_PRESETS.map((p) => {
              const on = periodPreset === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setPeriod(p.id)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={styles.chipLabel}>{p.label}</Text>
                </Pressable>
              );
            })}
          </EqualChipRow>
          {periodPreset === 'custom' ? (
            <TextInput
              style={styles.input}
              placeholder="z. B. 3.–10. August"
              placeholderTextColor={colors.textMuted}
              value={draft.travelPeriod ?? ''}
              onChangeText={(travelPeriod) => onChange({ travelPeriod })}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.group}>
        <Text style={styles.label}>Reisezweck</Text>
        <Text style={styles.hint}>
          Bis {MOTIVES_MAX} — z. B. Urlaub, Business, Familie.
        </Text>
        <View style={styles.chipRow}>
          {motiveOptions.map((o) => {
            const on = motives.includes(o.id);
            return (
              <Pressable
                key={o.id}
                onPress={() => toggleMotive(o.id)}
                style={[styles.chipSmall, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Mit wem reist du?</Text>
        <EqualChipRow count={TRAVEL_PARTY_OPTIONS.length}>
          {TRAVEL_PARTY_OPTIONS.map((o) => {
            const on = draft.travelParty === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() => onChange({ travelParty: o.id as TravelParty })}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </EqualChipRow>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>
          Wie bewegst du dich in der Stadt während der aktuellen Reise?
        </Text>
        <Text style={styles.hint}>
          Deine Präferenz — plus, womit du gerade unterwegs bist.
        </Text>
        <ChipRow
          options={MOBILITY_OPTIONS}
          value={draft.mobilityMode}
          onSelect={(mobilityMode: MobilityMode) => onChange({ mobilityMode })}
        />
        <Text style={[styles.subLabel, { marginTop: spacing.sm }]}>
          Jetzt unterwegs mit
        </Text>
        <TravelModeSelector />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Energielevel</Text>
        <ChipRow
          options={ENERGY_OPTIONS}
          value={draft.energyLevel}
          onSelect={(energyLevel: EnergyLevel) => onChange({ energyLevel })}
        />
      </View>

      <View style={styles.group}>
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
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Tourlänge</Text>
        <EqualChipRow count={TOUR_LENGTH_OPTIONS.length}>
          {TOUR_LENGTH_OPTIONS.map((o) => {
            const on = draft.tourLengthPref === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() =>
                  onChange(patchFromTourLength(o.id as TourLengthPref, draft))
                }
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>{o.label}</Text>
                {o.hint ? <Text style={styles.chipHint}>{o.hint}</Text> : null}
              </Pressable>
            );
          })}
        </EqualChipRow>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Must-haves & Geheimtipps</Text>
        <Text style={styles.hint}>
          Mehrfach — Yorro mixt Klassiker, Lokales und Nachtleben.
        </Text>
        <EqualChipRow count={MUST_HAVE_STYLE_OPTIONS.length}>
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
        </EqualChipRow>
      </View>

      {!lite ? (
        <View style={styles.group}>
          <Text style={styles.label}>Restaurant-Niveau</Text>
          <EqualChipRow count={3}>
            {(
              [
                { id: 'fast_cheap' as const, label: 'Schnell & günstig' },
                { id: 'decent' as const, label: 'Vernünftig' },
                { id: 'highlights' as const, label: 'Highlights' },
              ] as const
            ).map((o) => {
              const on = draft.diningLevel === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => onChange({ diningLevel: o.id })}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={styles.chipLabel}>{o.label}</Text>
                </Pressable>
              );
            })}
          </EqualChipRow>
        </View>
      ) : null}

      <View style={styles.group}>
        <Text style={styles.label}>Startpunkt & Unterkunft</Text>
        <Text style={styles.hint}>
          Von hier starten die Wege — Zuhause hier, Hotel oder Ferienwohnung.
        </Text>
        <StartBaseSettingsBlock />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>
          {lite ? 'Jetzt aber — was spricht dich an' : 'Interessen / Orte'}
        </Text>
        <Text style={styles.hint}>Tippen: gerne → eher nicht → neutral</Text>
        {lite ? (
          <View style={styles.chipRow}>
            {interestCards.map((c) => {
              const pref = draft.experiencePrefs[c.id] ?? 'neutral';
              return (
                <Pressable
                  key={c.id}
                  onPress={() => cyclePref(c.id)}
                  style={[
                    styles.chipSmall,
                    pref === 'yes' && styles.chipOn,
                    pref === 'no' && styles.chipNo,
                  ]}
                >
                  <Text style={styles.chipLabel}>
                    {c.emoji} {c.labelDe}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          categories?.map((cat) =>
            cat.cards.length === 0 ? null : (
              <View key={cat.id} style={{ marginBottom: spacing.md }}>
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
                        {card.emoji} {card.labelDe}
                      </Text>
                      <Text style={styles.interestPref}>
                        {pref === 'yes'
                          ? card.yesLabelDe
                          : pref === 'no'
                            ? card.noLabelDe
                            : card.midLabelDe ?? 'Neutral'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ),
          )
        )}
      </View>

      {!lite ? (
        <View style={styles.group}>
          <Text style={styles.label}>Was willst du erleben?</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={draft.wantToExperience}
            onChangeText={(wantToExperience) => onChange({ wantToExperience })}
            placeholderTextColor={colors.textMuted}
            multiline
          />
          <Text style={styles.label}>Was willst du vermeiden?</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={draft.avoidExperience}
            onChangeText={(avoidExperience) => onChange({ avoidExperience })}
            placeholderTextColor={colors.textMuted}
            multiline
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  group: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: 'rgba(22, 54, 44, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(196, 163, 90, 0.14)',
    gap: spacing.xs,
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
  catTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 6,
  },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSmall: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipNo: {
    borderColor: 'rgba(196,80,60,0.5)',
    opacity: 0.75,
  },
  chipLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chipHint: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  interestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 6,
    backgroundColor: colors.surface,
  },
  interestYes: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  interestNo: { opacity: 0.55 },
  interestText: { color: colors.text, flex: 1, fontSize: 14 },
  interestPref: { color: colors.textMuted, fontSize: 12, marginLeft: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
