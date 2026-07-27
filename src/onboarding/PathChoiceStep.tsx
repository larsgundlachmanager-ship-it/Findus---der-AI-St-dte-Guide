import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  OnboardingShell,
  PrimaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import { colors, spacing } from '../constants/theme';
import type { OnboardingMode } from '../types/userProfile';

type Props = {
  onChoose: (mode: OnboardingMode) => void;
};

/**
 * Einstieg: Express vs. Standard.
 */
export function PathChoiceStep({ onChoose }: Props) {
  return (
    <OnboardingShell>
      <StepTitle>Willkommen bei Findus</StepTitle>
      <StepSubtitle>
        Dein KI-Reise-Concierge. Wähle, wie gründlich wir dich kennenlernen
        sollen.
      </StepSubtitle>

      <View style={styles.card}>
        <Text style={styles.badge}>~ 1 Minute</Text>
        <Text style={styles.cardTitle}>Express-Einrichtung</Text>
        <Text style={styles.cardBody}>
          Stadt, Über dich, Charakter-Kurzprofil, Zeitraum und Budget — plus
          Mikrofon. Danach die kurze Erklärung, und los.
        </Text>
        <PrimaryButton
          label="Express starten"
          onPress={() => onChoose('express')}
        />
      </View>

      <View style={[styles.card, styles.cardSecondary]}>
        <Text style={styles.badge}>Dauer: ca. 2–3 Minuten</Text>
        <Text style={styles.cardTitle}>Standard-Einrichtung</Text>
        <Text style={styles.cardBody}>
          Für den perfekt zugeschnittenen Findus: Stimme, Charakter,
          Reisekontext, Interessen und Stil — Schritt für Schritt.
        </Text>
        <PrimaryButton
          label="Standard starten"
          onPress={() => onChoose('standard')}
        />
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.1)',
    gap: spacing.sm,
  },
  cardSecondary: {
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  badge: {
    alignSelf: 'flex-start',
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
});
