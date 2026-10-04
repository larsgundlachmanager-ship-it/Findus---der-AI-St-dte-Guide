/**
 * Gast | Anmelden | Registrieren — vor Profil-Details.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  OnboardingShell,
  PrimaryButton,
  SecondaryButton,
  StepSubtitle,
  StepTitle,
} from './OnboardingUI';
import { SocialAuthButtons } from '../components/account/SocialAuthButtons';
import { colors, spacing } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

export type AuthGateChoice = 'guest' | 'login' | 'register';

type Props = {
  onGuest: () => void;
  onMagicLink: (
    email: string,
    mode: 'login' | 'register',
  ) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
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
  /** Nach erfolgreichem Magic-Link-Send (Parent setzt Status). */
  magicLinkSent?: boolean;
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
  magicLinkSent,
}: Props) {
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const kbInset = useKeyboardInset();
  const scrollRef = useRef<ScrollView>(null);
  const emailOk = /@/.test(email.trim());
  const waitingForLink = linkSent || !!magicLinkSent;

  useEffect(() => {
    if (magicLinkSent) setLinkSent(true);
  }, [magicLinkSent]);

  useEffect(() => {
    if (kbInset > 80 && showEmail) {
      const t = setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 80);
      return () => clearTimeout(t);
    }
  }, [kbInset, showEmail]);

  const sendLink = async (): Promise<boolean> => {
    const trimmed = email.trim();
    if (!/@/.test(trimmed) || busy) return false;
    const r = await onMagicLink(trimmed, 'register');
    return !!r?.ok;
  };

  if (isSignedIn && onContinueSignedIn) {
    return (
      <OnboardingShell style={styles.shell}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <StepTitle>Konto bereit</StepTitle>
          <StepSubtitle>
            {`Du bist angemeldet${signedInEmail ? ` als ${signedInEmail}` : ''}. Weiter mit diesem Konto — Stempel und Prefs bleiben.`}
          </StepSubtitle>
          <View style={styles.stack}>
            <PrimaryButton
              label="Weiter mit Konto"
              onPress={onContinueSignedIn}
              disabled={!!busy}
            />
            {onSwitchAccount ? (
              <SecondaryButton
                label="Anderes Konto"
                onPress={onSwitchAccount}
                disabled={!!busy}
              />
            ) : null}
            <SecondaryButton
              label="Stattdessen als Gast"
              onPress={onGuest}
              disabled={!!busy}
            />
          </View>
          {statusMessage ? (
            <Text style={styles.status}>{statusMessage}</Text>
          ) : null}
        </ScrollView>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell style={styles.shell}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          kbInset > 0 && { paddingBottom: kbInset + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
              <Text style={styles.fieldLabel}>E-Mail-Adresse</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                onFocus={() => {
                  setTimeout(
                    () => scrollRef.current?.scrollToEnd({ animated: true }),
                    120,
                  );
                }}
              />
              {waitingForLink ? (
                <View style={styles.sentBox}>
                  <Text style={styles.sentTitle}>Mail ist unterwegs</Text>
                  <Text style={styles.sentBody}>
                    Wir haben dir einen Magic Link geschickt
                    {email.trim() ? ` an ${email.trim()}` : ''}. Tippe den Link
                    in der Mail — Yorro öffnet sich und meldet dich an. Schau
                    ggf. auch im Spam.
                  </Text>
                  <PrimaryButton
                    label="Magic Link erneut senden"
                    onPress={() => void sendLink()}
                    disabled={!emailOk || !!busy}
                  />
                </View>
              ) : (
                <PrimaryButton
                  label="Magic Link senden"
                  onPress={() => {
                    void (async () => {
                      const ok = await sendLink();
                      if (!ok) return;
                      setLinkSent(true);
                      Alert.alert(
                        'Magic Link gesendet',
                        `Wir haben dir eine E-Mail${email.trim() ? ` an ${email.trim()}` : ''} geschickt. Tippe den Link darin — Yorro öffnet sich und bestätigt dein Konto.`,
                        [{ text: 'OK' }],
                      );
                    })();
                  }}
                  disabled={!emailOk || !!busy}
                />
              )}
            </View>
          ) : null}
          {!waitingForLink ? (
            <SecondaryButton
              label="Als Gast weiter"
              onPress={onGuest}
              disabled={!!busy}
            />
          ) : (
            <SecondaryButton
              label="Stattdessen als Gast weiter"
              onPress={onGuest}
              disabled={!!busy}
            />
          )}
        </View>
        {statusMessage ? (
          <Text style={styles.status}>{statusMessage}</Text>
        ) : null}
      </ScrollView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  stack: { gap: spacing.md, marginTop: spacing.lg },
  emailBox: { gap: spacing.sm },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    minHeight: 52,
    fontSize: 17,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  sentBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.12)',
  },
  sentTitle: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  sentBody: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  status: {
    marginTop: spacing.md,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
