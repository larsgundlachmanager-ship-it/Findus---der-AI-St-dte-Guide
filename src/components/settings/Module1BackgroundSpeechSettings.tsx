/**
 * Modul 1: wann Yorro im Hintergrund / bei gesperrtem Display sprechen darf.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';
import {
  getModule1BackgroundSpeechModeSync,
  loadModule1BackgroundSpeechPrefs,
  patchModule1BackgroundSpeechPrefs,
  type Module1BackgroundSpeechMode,
} from '../../services/speech/module1BackgroundSpeechPrefs';

const OPTS: {
  id: Module1BackgroundSpeechMode;
  label: string;
  hint: string;
}[] = [
  {
    id: 'always',
    label: 'Immer',
    hint: 'Auch bei gesperrtem Handy / App zu',
  },
  {
    id: 'headphones',
    label: 'Nur Kopfhörer',
    hint: 'Hintergrund nur mit BT/Kabel',
  },
  {
    id: 'app_open',
    label: 'Nur App offen',
    hint: 'Nie automatisch im Hintergrund',
  },
];

export function Module1BackgroundSpeechSettings() {
  const [mode, setMode] = useState<Module1BackgroundSpeechMode>(
    getModule1BackgroundSpeechModeSync(),
  );

  useEffect(() => {
    void loadModule1BackgroundSpeechPrefs().then((p) => setMode(p.mode));
  }, []);

  const update = useCallback(async (next: Module1BackgroundSpeechMode) => {
    const p = await patchModule1BackgroundSpeechPrefs({ mode: next });
    setMode(p.mode);
  }, []);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Modul 1 — Hintergrund-Audio</Text>
      <Text style={styles.hint}>
        Darf Yorro an Orten erzählen, wenn die App zu ist oder das Handy
        gesperrt? Standard: Immer.
      </Text>
      <View style={styles.row}>
        {OPTS.map((opt) => {
          const on = mode === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => void update(opt.id)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${opt.label}: ${opt.hint}`}
            >
              <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                {opt.label}
              </Text>
              <Text style={styles.chipHint}>{opt.hint}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: spacing.md },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexGrow: 1,
    minWidth: '30%',
    maxWidth: '100%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  chipLabelOn: {
    color: colors.accent,
  },
  chipHint: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
});
