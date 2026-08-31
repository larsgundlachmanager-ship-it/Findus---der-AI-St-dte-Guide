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
      <StepTitle>Kopfhörer rein. Die Stadt läuft mit.</StepTitle>
      <StepSubtitle>
        Yorro ist dein Stadtguide für den Städtetrip — am Ort erzählt er, du
        fragst mit der Stimme. Einrichtung einmal, dann läuft der Trip.
      </StepSubtitle>

      <View style={styles.card}>
        <Text style={styles.badge}>Empfohlen</Text>
        <Text style={styles.cardTitle}>Express-Einrichtung</Text>
        <Text style={styles.cardBody}>
          Nur das Nötigste — danach Kopfhörer rein.
        </Text>
        <PrimaryButton
          label="Express starten"
          onPress={() => onChoose('express')}
        />
      </View>

      <View style={[styles.card, styles.cardSecondary]}>
        <Text style={styles.badge}>Ausführlich</Text>
        <Text style={styles.cardTitle}>Standard-Einrichtung</Text>
        <Text style={styles.cardBody}>
          Für den perfekt zugeschnittenen Yorro — Feinschliff auch später in
          den Einstellungen.
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
    fontSize: 16,
    fontWeight: '700',
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
});
