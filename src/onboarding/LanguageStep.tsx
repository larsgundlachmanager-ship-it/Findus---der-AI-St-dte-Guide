/**
 * Sprache zuerst — Flaggen. MVP: nur Deutsch aktiv.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  OnboardingShell,
  PrimaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import { colors, spacing } from '../constants/theme';
import type { AppLanguage } from '../types/userProfile';

type LangOption = {
  id: AppLanguage | 'en' | 'fr' | 'es';
  flag: string;
  label: string;
  enabled: boolean;
};

const LANGS: LangOption[] = [
  { id: 'de', flag: '🇩🇪', label: 'Deutsch', enabled: true },
  { id: 'en', flag: '🇬🇧', label: 'English', enabled: false },
  { id: 'fr', flag: '🇫🇷', label: 'Français', enabled: false },
  { id: 'es', flag: '🇪🇸', label: 'Español', enabled: false },
];

type Props = {
  selected: AppLanguage;
  onSelect: (lang: AppLanguage) => void;
  onNext: () => void;
};

export function LanguageStep({ selected, onSelect, onNext }: Props) {
  return (
    <OnboardingShell>
      <StepTitle>Sprache</StepTitle>
      <StepSubtitle>
        Wir starten mit der Sprache deines Geräts — aktuell ist Deutsch verfügbar.
      </StepSubtitle>
      <View style={styles.grid}>
        {LANGS.map((lang) => {
          const active = lang.enabled && selected === lang.id;
          return (
            <Pressable
              key={lang.id}
              disabled={!lang.enabled}
              onPress={() => lang.enabled && onSelect(lang.id as AppLanguage)}
              style={[
                styles.card,
                active && styles.cardActive,
                !lang.enabled && styles.cardDisabled,
              ]}
            >
              <Text style={styles.flag}>{lang.flag}</Text>
              <Text style={[styles.label, !lang.enabled && styles.labelMuted]}>
                {lang.label}
              </Text>
              {!lang.enabled ? (
                <Text style={styles.soon}>bald</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <PrimaryButton label="Weiter mit Deutsch" onPress={onNext} />
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  card: {
    width: '47%',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  cardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft ?? colors.surface,
  },
  cardDisabled: {
    opacity: 0.45,
  },
  flag: { fontSize: 36, marginBottom: 8 },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  labelMuted: { color: colors.textMuted },
  soon: { marginTop: 4, fontSize: 12, color: colors.textMuted },
});
