/**
 * Mikrofon-Wahl als sichtbare Buttons + separate Datenschutz-Bestätigung.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';
import { AUDIO_CONSENT_NOTICE } from '../../constants/legal';
import type { MicListenMode } from '../../types/userProfile';

type Props = {
  mode: MicListenMode | null;
  /** Audio-Opt-in (nur relevant bei Spracheingabe). */
  audioConsentChecked: boolean;
  /** Separate Datenschutz-Bestätigung (immer nötig). */
  privacyConsentChecked: boolean;
  onChangeMode: (mode: MicListenMode) => void;
  onChangeAudioConsent: (checked: boolean) => void;
  onChangePrivacyConsent: (checked: boolean) => void;
  onOpenPrivacy?: () => void;
  compact?: boolean;
};

export function MicConsentBlock({
  mode,
  audioConsentChecked,
  privacyConsentChecked,
  onChangeMode,
  onChangeAudioConsent,
  onChangePrivacyConsent,
  onOpenPrivacy,
  compact = false,
}: Props) {
  const voiceOn = mode === 'hear';
  const textOnly = mode === 'dont_hear';

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Mikrofon & Privatsphäre</Text>

      {!compact ? (
        <Text style={styles.prose} accessibilityRole="text">
          <Text style={styles.proseLead}>Was wir hören: </Text>
          Nur wenn du das Mikrofon aktiv tippst oder hältst. Deine Worte dienen
          ausschließlich der Spracherkennung für deine Anfrage. Kein Dauerhören,
          keine Aufnahme im Hintergrund. {AUDIO_CONSENT_NOTICE}
        </Text>
      ) : (
        <Text style={styles.prose}>
          Wähle sichtbar, wie du mit Yorro sprechen willst — und bestätige
          danach getrennt den Datenschutz.
        </Text>
      )}

      <Text style={styles.choiceLabel}>Wie möchtest du mitmachen?</Text>

      <Pressable
        onPress={() => {
          onChangeMode('hear');
          onChangeAudioConsent(true);
        }}
        style={[styles.modeBtn, voiceOn && styles.modeBtnOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: voiceOn }}
      >
        <Text style={[styles.modeTitle, voiceOn && styles.modeTitleOn]}>
          Spracheingabe an
        </Text>
        <Text style={styles.modeSub}>
          Mikrofon tippen oder halten — nur während der Anfrage. Du kannst
          sprechen statt tippen.
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          onChangeMode('dont_hear');
          onChangeAudioConsent(false);
        }}
        style={[styles.modeBtn, textOnly && styles.modeBtnOn]}
        accessibilityRole="button"
        accessibilityState={{ selected: textOnly }}
      >
        <Text style={[styles.modeTitle, textOnly && styles.modeTitleOn]}>
          Nur tippen
        </Text>
        <Text style={styles.modeSub}>
          Kein Mikrofon — alles muss per Tastatur getippt werden. Sprache später
          jederzeit in den Einstellungen aktivierbar.
        </Text>
      </Pressable>

      <Text style={styles.choiceLabel}>Datenschutz separat bestätigen</Text>
      <Pressable
        onPress={() => onChangePrivacyConsent(!privacyConsentChecked)}
        style={[
          styles.privacyBtn,
          privacyConsentChecked && styles.privacyBtnOn,
        ]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: privacyConsentChecked }}
      >
        <View
          style={[
            styles.checkBox,
            privacyConsentChecked && styles.checkBoxOn,
          ]}
        >
          {privacyConsentChecked ? (
            <Text style={styles.checkMark}>✓</Text>
          ) : null}
        </View>
        <View style={styles.privacyCopy}>
          <Text
            style={[
              styles.privacyTitle,
              privacyConsentChecked && styles.modeTitleOn,
            ]}
          >
            Datenschutzerklärung akzeptieren
          </Text>
          <Text style={styles.modeSub}>
            Pflicht — unabhängig von der Mikrofon-Wahl
          </Text>
        </View>
      </Pressable>

      {voiceOn ? (
        <Text style={styles.audioNote}>
          Spracheingabe: {AUDIO_CONSENT_NOTICE}
          {audioConsentChecked ? ' — Einwilligung gesetzt.' : ''}
        </Text>
      ) : null}

      {onOpenPrivacy ? (
        <Pressable onPress={onOpenPrivacy} accessibilityRole="link">
          <Text style={styles.link}>Datenschutzerklärung ansehen</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Mode gewählt + Datenschutz bestätigt; bei Sprache zusätzlich Audio-Opt-in. */
export function micConsentIsValid(
  mode: MicListenMode | null,
  audioConsentChecked: boolean,
  privacyConsentChecked: boolean,
): boolean {
  if (!privacyConsentChecked) return false;
  if (mode === 'dont_hear') return true;
  if (mode === 'hear') return audioConsentChecked;
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
  modeBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 4,
  },
  modeBtnOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.16)',
  },
  modeTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  modeTitleOn: {
    color: colors.accent,
  },
  modeSub: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  privacyBtn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  privacyBtnOn: {
    borderColor: colors.wave,
    backgroundColor: 'rgba(126, 200, 163, 0.12)',
  },
  checkBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkBoxOn: {
    borderColor: colors.wave,
    backgroundColor: colors.wave,
  },
  checkMark: {
    color: '#0B1220',
    fontWeight: '800',
    fontSize: 14,
  },
  privacyCopy: { flex: 1, gap: 2 },
  privacyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  audioNote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  link: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
    marginTop: spacing.xs,
  },
});
