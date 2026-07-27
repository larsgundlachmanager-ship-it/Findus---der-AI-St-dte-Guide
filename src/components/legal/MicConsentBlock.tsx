import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';
import { AUDIO_CONSENT_NOTICE } from '../../constants/legal';
import type { MicListenMode } from '../../types/userProfile';

type Props = {
  mode: MicListenMode | null;
  consentChecked: boolean;
  onChangeMode: (mode: MicListenMode) => void;
  onChangeConsent: (checked: boolean) => void;
  onOpenPrivacy?: () => void;
  /** Nur Auswahl Voice/Tippen — Transparenz-Fließtext ausblenden (wenn schon erklärt). */
  compact?: boolean;
};

/**
 * Mikrofon-Consent als Fließtext (nicht klickbare Kacheln) + einfache Auswahl.
 * Opt-in kommt als Popup, wenn Spracheingabe gewählt wird.
 */
export function MicConsentBlock({
  mode,
  consentChecked,
  onChangeMode,
  onChangeConsent,
  onOpenPrivacy,
  compact = false,
}: Props) {
  const voiceOn = mode === 'hear';
  const textOnly = mode === 'dont_hear';

  const chooseVoice = () => {
    Alert.alert(
      'Spracheingabe erlauben?',
      `Findus nutzt deine Spracheingaben nur, während du das Mikrofon tippst oder hältst — ausschließlich zur Spracherkennung für deine Anfrage.\n\n${AUDIO_CONSENT_NOTICE}`,
      [
        {
          text: 'Lieber tippen',
          style: 'cancel',
          onPress: () => {
            onChangeMode('dont_hear');
            onChangeConsent(false);
          },
        },
        {
          text: 'Erlauben',
          onPress: () => {
            onChangeMode('hear');
            onChangeConsent(true);
          },
        },
      ],
    );
  };

  const chooseTextOnly = () => {
    onChangeMode('dont_hear');
    onChangeConsent(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Mikrofon & Privatsphäre</Text>

      {!compact ? (
        <Text style={styles.prose} accessibilityRole="text">
          <Text style={styles.proseLead}>Was wir hören: </Text>
          Nur wenn du das Mikrofon aktiv tippst oder hältst. Deine Worte dienen
          ausschließlich der Spracherkennung für deine Anfrage. Kein Dauerhören,
          keine Aufnahme im Hintergrund — Audio wird nicht an Dritte zu
          Werbezwecken verkauft. {AUDIO_CONSENT_NOTICE}
        </Text>
      ) : (
        <Text style={styles.prose}>
          Kurz wählen, wie du mit Findus sprechen möchtest. Wie Fragen stellen
          funktioniert, erklärt Findus dir gleich danach in der Tour.
        </Text>
      )}

      <Text style={styles.choiceLabel}>Wie möchtest du mitmachen?</Text>

      <Pressable
        onPress={chooseVoice}
        style={styles.choiceRow}
        accessibilityRole="radio"
        accessibilityState={{ selected: voiceOn }}
      >
        <Text style={styles.bullet}>{voiceOn ? '●' : '○'}</Text>
        <Text style={[styles.choiceText, voiceOn && styles.choiceTextOn]}>
          Spracheingabe an — Mikrofon tippen oder halten
          {voiceOn && consentChecked ? ' (aktiv)' : ''}
        </Text>
      </Pressable>

      <Pressable
        onPress={chooseTextOnly}
        style={styles.choiceRow}
        accessibilityRole="radio"
        accessibilityState={{ selected: textOnly }}
      >
        <Text style={styles.bullet}>{textOnly ? '●' : '○'}</Text>
        <Text style={[styles.choiceText, textOnly && styles.choiceTextOn]}>
          Nur tippen — kein Mikrofon
          {textOnly ? ' (aktiv)' : ''}
        </Text>
      </Pressable>

      {onOpenPrivacy ? (
        <Pressable onPress={onOpenPrivacy} accessibilityRole="link">
          <Text style={styles.link}>Datenschutzerklärung ansehen</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Spracheingabe braucht Opt-in; „Nur tippen“ reicht ohne Audio-Consent. */
export function micConsentIsValid(
  mode: MicListenMode | null,
  consentChecked: boolean,
): boolean {
  if (mode === 'dont_hear') return true;
  if (mode === 'hear') return consentChecked;
  return false;
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(196, 163, 90, 0.35)',
  },
  heading: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '700',
  },
  prose: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  proseLead: {
    color: colors.text,
    fontWeight: '700',
  },
  choiceLabel: {
    marginTop: spacing.xs,
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  bullet: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 22,
    width: 18,
  },
  choiceText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  choiceTextOn: {
    color: colors.text,
    fontWeight: '600',
  },
  link: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
    marginTop: spacing.xs,
  },
});
