/**
 * Erleben-Prefs — SSOT für Settings (voll) und Express (lite).
 * Entspricht der Standardeinrichtung „Was willst du erleben?“.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import {
  ACCESSIBILITY_NEED_OPTIONS,
  BUDGET_OPTIONS,
  ENERGY_OPTIONS,
  MUST_HAVE_STYLE_OPTIONS,
  TAXI_PREF_OPTIONS,
  TOURIST_MODE_OPTIONS,
  TRAVEL_MODE_OPTIONS,
  TRAVEL_PARTY_OPTIONS,
  patchFromMustHaveStyles,
  type TravelModeId,
} from '../constants/conciergePrefs';
import {
  EXPERIENCE_CARDS,
  EXPERIENCE_CATEGORY_TITLES,
  EXPRESS_INTEREST_IDS,
  TRAVEL_STYLE_CARD_IDS,
} from '../constants/onboardingOptions';
import type {
  BudgetCategory,
  EnergyLevel,
  MobilityPrefs,
  MustHaveStyleId,
  SwipePreference,
  TouristVsInsider,
  TravelParty,
  UserProfile,
} from '../types/userProfile';
import {
  TRAVEL_PERIOD_PRESETS,
  matchTravelPeriodPreset,
  type TravelPeriodPreset,
} from '../constants/travelPeriod';
import { EqualChipRow } from './EqualChipRow';

type Mode = 'full' | 'lite';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  mode?: Mode;
};

const SKIP_CARD_IDS = new Set([
  'jahreszahlen',
  'geschichte',
  'barrierearm',
  'kurztrip',
  'budget',
]);

export function ExperiencePrefsEditor({
  draft,
  onChange,
  mode = 'full',
}: Props) {
  const lite = mode === 'lite';
  const periodPreset = matchTravelPeriodPreset(draft.travelPeriod);

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

  const setPref = (id: string, value: SwipePreference) => {
    const nextPrefs = { ...draft.experiencePrefs, [id]: value };
    const patch: Partial<UserProfile> = { experiencePrefs: nextPrefs };
    if (id === 'weg_vom_trubel' && value === 'yes') patch.touristMode = 'insider';
    if (id === 'typisch_touri' && value === 'yes') patch.touristMode = 'tourist';
    onChange(patch);
  };

  const cyclePref = (id: string) => {
    const cur = draft.experiencePrefs[id] ?? 'neutral';
    const next: SwipePreference =
      cur === 'neutral' ? 'yes' : cur === 'yes' ? 'no' : 'neutral';
    setPref(id, next);
  };

  const setMobility = (
    key: keyof MobilityPrefs,
    value: NonNullable<MobilityPrefs[typeof key]>,
  ) => {
    onChange({
      mobilityPrefs: { ...(draft.mobilityPrefs ?? {}), [key]: value },
    });
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
        ...(
          ['mobilitaet', 'tempo', 'essen', 'stil'] as const
        ).map((id) => ({
          id,
          title: EXPERIENCE_CATEGORY_TITLES[id].de,
          cards: EXPERIENCE_CARDS.filter((c) => {
            if (c.category !== id || SKIP_CARD_IDS.has(c.id)) return false;
            if (id === 'stil') {
              return (TRAVEL_STYLE_CARD_IDS as readonly string[]).includes(c.id);
            }
            if (id === 'mobilitaet') {
              // Detail-Mobilität + „Wie reist du?“ ersetzen die Swipe-Karten.
              return false;
            }
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

      {!lite ? (
        <View style={styles.group}>
          <Text style={styles.label}>Must-sees oder Geheimtipps?</Text>
          <EqualChipRow count={TOURIST_MODE_OPTIONS.length}>
            {TOURIST_MODE_OPTIONS.map((o) => {
              const on = draft.touristMode === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() =>
                    onChange({ touristMode: o.id as TouristVsInsider })
                  }
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={styles.chipLabel}>{o.label}</Text>
                </Pressable>
              );
            })}
          </EqualChipRow>
          <Text style={styles.label}>Must-haves (Mehrfach)</Text>
          <EqualChipRow count={MUST_HAVE_STYLE_OPTIONS.length}>
            {MUST_HAVE_STYLE_OPTIONS.map((o) => {
              const on = (draft.mustHaveStyles ?? []).includes(o.id);
              return (
                <Pressable
                  key={o.id}
                  onPress={() => {
                    const cur = draft.mustHaveStyles ?? [];
                    const next = (
                      on ? cur.filter((x) => x !== o.id) : [...cur, o.id]
                    ) as MustHaveStyleId[];
                    onChange(patchFromMustHaveStyles(next, draft));
                  }}
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
        <Text style={styles.label}>Tourlänge (Stops)</Text>
        <EqualChipRow count={3}>
          {(
            [
              { id: 'more_stops' as const, label: 'Mehr Stops' },
              { id: 'balanced' as const, label: 'Mittelmaß' },
              { id: 'fewer_stops' as const, label: 'Weniger Stops' },
            ] as const
          ).map((o) => {
            const on = draft.tourLengthPref === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() =>
                  onChange({
                    tourLengthPref: o.id,
                    experiencePrefs: {
                      ...draft.experiencePrefs,
                      tour_stops:
                        o.id === 'more_stops'
                          ? 'yes'
                          : o.id === 'fewer_stops'
                            ? 'no'
                            : 'neutral',
                      kurztrip:
                        o.id === 'fewer_stops'
                          ? 'yes'
                          : o.id === 'more_stops'
                            ? 'no'
                            : 'neutral',
                    },
                  })
                }
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </EqualChipRow>

        <Text style={styles.label}>Budget — Preisorientierung</Text>
        <Text style={styles.hint}>
          Ungefährer Tagesrahmen, an dem ich Empfehlungen ausrichte.
        </Text>
        <Text style={styles.hint}>Ungefähre Preisorientierung pro Tag.</Text>
        <EqualChipRow count={BUDGET_OPTIONS.length}>
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
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>{o.label}</Text>
                <Text style={styles.chipHint}>{o.hint}</Text>
              </Pressable>
            );
          })}
        </EqualChipRow>
      </View>

      {!lite ? (
        <View style={styles.group}>
          <Text style={styles.label}>Energie</Text>
          <EqualChipRow count={ENERGY_OPTIONS.length}>
            {ENERGY_OPTIONS.map((o) => {
              const on = draft.energyLevel === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() =>
                    onChange({ energyLevel: o.id as EnergyLevel })
                  }
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={styles.chipLabel}>{o.label}</Text>
                </Pressable>
              );
            })}
          </EqualChipRow>

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

          <Text style={styles.label}>Mobilität</Text>
          <Text style={styles.hint}>Wähle deine Präferenzen</Text>

          <Text style={styles.label}>Wie reist du?</Text>
          <EqualChipRow count={TRAVEL_MODE_OPTIONS.length}>
            {TRAVEL_MODE_OPTIONS.map((o) => {
              const on = (draft.travelModes ?? []).includes(o.id);
              return (
                <Pressable
                  key={o.id}
                  onPress={() => {
                    const cur = draft.travelModes ?? [];
                    const next = (
                      on ? cur.filter((x) => x !== o.id) : [...cur, o.id]
                    ) as TravelModeId[];
                    onChange({ travelModes: next });
                  }}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={styles.chipLabel}>{o.label}</Text>
                </Pressable>
              );
            })}
          </EqualChipRow>

          {(
            [
              {
                key: 'walk' as const,
                label: 'Zu Fuß',
                opts: [
                  { id: 'primary', label: 'Primär' },
                  { id: 'rather_not', label: 'Eher nicht' },
                ],
              },
              {
                key: 'transit' as const,
                label: 'ÖPNV',
                opts: [
                  { id: 'love', label: 'Super gerne' },
                  { id: 'if_needed', label: 'Wenn nötig' },
                  { id: 'avoid', label: 'Vermeiden' },
                ],
              },
              {
                key: 'bike' as const,
                label: 'Fahrrad',
                opts: [
                  { id: 'own', label: 'Habe ich' },
                  { id: 'rent', label: 'Würde leihen' },
                  { id: 'no', label: 'Nein' },
                ],
              },
              {
                key: 'scooter' as const,
                label: 'E-Scooter',
                opts: [
                  { id: 'own', label: 'Habe ich' },
                  { id: 'rent', label: 'Würde leihen' },
                  { id: 'no', label: 'Nein' },
                ],
              },
            ] as const
          ).map((row) => (
            <View key={row.key} style={{ marginBottom: spacing.sm }}>
              <Text style={styles.hint}>{row.label}</Text>
              <EqualChipRow count={row.opts.length}>
                {row.opts.map((o) => {
                  const on = (draft.mobilityPrefs ?? {})[row.key] === o.id;
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => setMobility(row.key, o.id as never)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={styles.chipLabel}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </EqualChipRow>
            </View>
          ))}

          <View style={{ marginBottom: spacing.sm }}>
            <Text style={styles.hint}>Taxi</Text>
            <EqualChipRow count={TAXI_PREF_OPTIONS.length}>
              {TAXI_PREF_OPTIONS.map((o) => {
                const taxi = (draft.mobilityPrefs ?? {}).taxi;
                const car = (draft.mobilityPrefs ?? {}).car;
                const on =
                  taxi === o.id ||
                  (!taxi &&
                    ((o.id === 'love' && car === 'taxi_love') ||
                      (o.id === 'if_saves_time' && car === 'taxi_saves_time') ||
                      (o.id === 'no' &&
                        (car === 'none' || car === 'own_avoid'))));
                return (
                  <Pressable
                    key={o.id}
                    onPress={() =>
                      onChange({
                        mobilityPrefs: {
                          ...(draft.mobilityPrefs ?? {}),
                          taxi: o.id,
                          car: o.car,
                        },
                      })
                    }
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={styles.chipLabel}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </EqualChipRow>
          </View>

          <Text style={styles.label}>Barriere / besondere Bedürfnisse?</Text>
          <EqualChipRow count={2}>
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
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={styles.chipLabel}>{o.label}</Text>
                </Pressable>
              );
            })}
          </EqualChipRow>
          {draft.accessibilityCare ? (
            <EqualChipRow count={ACCESSIBILITY_NEED_OPTIONS.length}>
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
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={styles.chipLabel}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </EqualChipRow>
          ) : null}
        </View>
      ) : (
        <Text style={styles.hint}>
          Details zu Mobilität, Essen und Barriere findest du später in den
          Einstellungen.
        </Text>
      )}

      <View style={styles.group}>
        <Text style={styles.label}>
          {lite
            ? 'Jetzt aber — was spricht dich an'
            : 'Interessen / Orte'}
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
                    styles.chip,
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
        <>
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
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
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
    marginTop: spacing.sm,
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
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
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
