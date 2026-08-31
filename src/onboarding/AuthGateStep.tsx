/**
 * Gast | Anmelden | Registrieren — vor Profil-Details.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  OnboardingShell,
  PrimaryButton,
  SecondaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import { SocialAuthButtons } from '../components/account/SocialAuthButtons';
import { colors, spacing } from '../constants/theme';

export type AuthGateChoice = 'guest' | 'login' | 'register';

type Props = {
  onGuest: () => void;
  onMagicLink: (email: string, mode: 'login' | 'register') => void;
  onGoogle: () => void;
  onApple: () => void;
  /** Session schon da — ohne erneuten Login weiter. */
  onContinueSignedIn?: () => void;
  /** Angemeldete E-Mail (Anzeige). */
  signedInEmail?: string | null;
  /** true = Session bestätigt (Magic Link / OAuth / Refresh). */
  isSignedIn?: boolean;
  /** Anderes Konto: Session verwerfen und Login neu. */
  onSwitchAccount?: () => void;
  busy?: boolean;
  statusMessage?: string | null;
};

export function AuthGateStep({
  onGuest,
  onMagicLink,
  onGoogle,
  onApple,
  onContinueSignedIn,
  signedInEmail,
  isSignedIn,
  onSwitchAccount,
  busy,
  statusMessage,
}: Props) {
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const emailOk = /@/.test(email.trim());

  if (isSignedIn && onContinueSignedIn) {
    return (
      <OnboardingShell>
        <StepTitle>Konto bereit</StepTitle>
        <StepSubtitle>
          {`Du bist angemeldet${signedInEmail ? ` als ${signedInEmail}` : ''}. Zurück war kein Problem — einfach weiter, oder als Gast ohne Konto.`}
        </StepSubtitle>
        <View style={styles.stack}>
          <PrimaryButton
            label="Weiter"
            onPress={onContinueSignedIn}
            disabled={!!busy}
          />
          <SecondaryButton
            label="Als Gast weiter"
            onPress={onGuest}
            disabled={!!busy}
          />
          {onSwitchAccount ? (
            <SecondaryButton
              label="Anderes Konto"
              onPress={onSwitchAccount}
              disabled={!!busy}
            />
          ) : null}
        </View>
        {statusMessage ? (
          <Text style={styles.status}>{statusMessage}</Text>
        ) : null}
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell>
      <StepTitle>Konto oder Gast?</StepTitle>
      <StepSubtitle>
        Mit Konto bleiben Stempelkarte, Fog, Pläne und Prefs auf dem neuen Gerät.
        Als Gast reicht der Vorname — alles bleibt nur lokal.
      </StepSubtitle>

      <View style={styles.stack}>
        <SocialAuthButtons
          onGoogle={onGoogle}
          onApple={onApple}
          busy={busy}
        />
        <SecondaryButton
          label="Per E-Mail (Magic Link)"
          onPress={() => setShowEmail(true)}
          disabled={!!busy}
        />
        {showEmail ? (
          <View style={styles.emailBox}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!busy}
            />
            <PrimaryButton
              label="Magic Link senden"
              onPress={() => onMagicLink(email.trim(), 'register')}
              disabled={!emailOk || !!busy}
            />
          </View>
        ) : null}
        <SecondaryButton
          label="Als Gast weiter"
          onPress={onGuest}
          disabled={!!busy}
        />
      </View>
      {statusMessage ? (
        <Text style={styles.status}>{statusMessage}</Text>
      ) : null}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, marginTop: spacing.lg },
  emailBox: { gap: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  status: {
    marginTop: spacing.md,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
