/**
 * Concierge-Prefs: stabile Profil-Prefs (Ernährung) und Trip-Compat-Wrapper.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { DIETARY_OPTIONS } from '../constants/conciergePrefs';
import type { UserProfile } from '../types/userProfile';
import { AktuelleReiseEditor } from './settings/AktuelleReiseEditor';

type Scope = 'trip' | 'profile' | 'all';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  /** trip = aktuelle Reise; profile = Ernährung; all = beides */
  scope?: Scope;
  /** Weniger Felder für Express */
  compact?: boolean;
  /** trip: full vs lite (Express) */
  mode?: 'full' | 'lite';
};

/**
 * Concierge-Prefs: Reise via AktuelleReiseEditor, Profil = Ernährung.
 */
export function ConciergePrefsEditor({
  draft,
  onChange,
  scope = 'all',
  compact = false,
  mode = 'full',
}: Props) {
  const showTrip = scope === 'trip' || scope === 'all';
  const showProfile = scope === 'profile' || scope === 'all';
  const dietary = draft.dietaryTags ?? [];

  const toggleDiet = (id: string) => {
    const next = dietary.includes(id)
      ? dietary.filter((x) => x !== id)
      : [...dietary, id];
    onChange({ dietaryTags: next });
  };

  return (
    <View style={styles.wrap}>
      {showTrip ? (
        <AktuelleReiseEditor
          draft={draft}
          onChange={onChange}
          mode={compact || mode === 'lite' ? 'lite' : 'full'}
        />
      ) : null}

      {showProfile ? (
        <>
          <Text style={styles.label}>Ernährung</Text>
          <Text style={styles.fieldHint}>
            Yorro berücksichtigt das bei Restaurant- und Essens-Tipps.
          </Text>
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
        </>
      ) : null}
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
  fieldHint: { color: colors.textMuted, fontSize: 12, marginTop: -2 },
});
