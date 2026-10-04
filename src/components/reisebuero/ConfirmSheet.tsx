import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../constants/theme';

export type ConfirmZone = 'red' | 'yellow' | 'green';

type Props = {
  title: string;
  body: string;
  zone?: ConfirmZone;
  must?: string[];
  nice?: string[];
  /** Optionaler Score-Hinweis (z. B. Brief %). */
  scoreHint?: string;
  /** Hero-Emoji oben; sonst Zone-Default. */
  hero?: string;
  primaryLabel: string;
  cancelLabel?: string;
  /** Ein-Button-Hinweis (z. B. Mikrofon) — Cancel entfällt. */
  singleAction?: boolean;
  primaryTone?: 'accent' | 'danger' | 'green';
  onCancel?: () => void;
  onPrimary: () => void;
};

function zoneHero(zone: ConfirmZone): string {
  if (zone === 'green') return '✨';
  if (zone === 'yellow') return '🪴';
  return '📝';
}

function zoneTint(zone: ConfirmZone): string {
  if (zone === 'green') return colors.online;
  if (zone === 'yellow') return colors.accent;
  return colors.danger;
}

/**
 * Hübsches Bottom-Sheet für Reisebüro-Confirms (Suche, Löschen, Hinweise).
 * Ersetzt systemweite Alert.alert — gleiche Optik in Hub/Brief/Magazin.
 */
export function ConfirmSheet({
  title,
  body,
  zone = 'yellow',
  must = [],
  nice = [],
  scoreHint,
  hero,
  primaryLabel,
  cancelLabel = 'Abbrechen',
  singleAction = false,
  primaryTone = 'accent',
  onCancel,
  onPrimary,
}: Props) {
  const insets = useSafeAreaInsets();
  const tint = zoneTint(zone);
  const primaryBg =
    primaryTone === 'danger'
      ? colors.danger
      : primaryTone === 'green'
        ? colors.online
        : colors.accent;

  return (
    <View style={styles.scrim} pointerEvents="box-none">
      <Pressable
        style={styles.dismiss}
        onPress={onCancel ?? onPrimary}
        accessibilityLabel="Schließen"
      />
      <View
        style={[
          styles.sheet,
          {
            paddingBottom: Math.max(insets.bottom, 16) + 8,
            borderTopColor: `${tint}55`,
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: `${tint}99` }]} />

        <View style={styles.heroRow}>
          <View style={[styles.heroBubble, { borderColor: `${tint}44`, backgroundColor: `${tint}18` }]}>
            <Text style={styles.heroEmoji}>{hero || zoneHero(zone)}</Text>
          </View>
          {scoreHint ? (
            <View style={[styles.scorePill, { borderColor: `${tint}66` }]}>
              <View style={[styles.scoreDot, { backgroundColor: tint }]} />
              <Text style={[styles.scoreText, { color: tint }]}>{scoreHint}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>

        {must.length ? (
          <View style={styles.chipBlock}>
            <Text style={styles.chipHeading}>Noch offen fürs Beste</Text>
            <View style={styles.chipRow}>
              {must.map((m) => (
                <View key={`m-${m}`} style={[styles.chip, styles.chipMust]}>
                  <Feather name="circle" size={8} color={colors.accent} style={styles.chipIcon} />
                  <Text style={styles.chipMustText}>{m}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {nice.length ? (
          <View style={styles.chipBlock}>
            <Text style={styles.chipHeading}>Optional · Feinschliff</Text>
            <View style={styles.chipRow}>
              {nice.map((m) => (
                <View key={`n-${m}`} style={[styles.chip, styles.chipNice]}>
                  <Text style={styles.chipNiceText}>{m}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={[styles.actions, singleAction && styles.actionsSingle]}>
          {!singleAction && onCancel ? (
            <Pressable
              onPress={onCancel}
              style={styles.cancelBtn}
              accessibilityLabel={cancelLabel}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onPrimary}
            style={[
              styles.primaryBtn,
              { backgroundColor: primaryBg },
              singleAction && styles.primaryFull,
            ]}
            accessibilityLabel={primaryLabel}
          >
            <Feather
              name={
                primaryTone === 'danger'
                  ? 'trash-2'
                  : singleAction
                    ? 'check'
                    : 'search'
              }
              size={16}
              color={colors.bg}
              style={styles.primaryIcon}
            />
            <Text style={styles.primaryText}>{primaryLabel}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 22, 18, 0.72)',
    justifyContent: 'flex-end',
    zIndex: 40,
  },
  dismiss: { ...StyleSheet.absoluteFillObject },
  sheet: {
    marginHorizontal: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1.5,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 6,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  heroBubble: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  heroEmoji: { fontSize: 26 },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  scoreDot: { width: 8, height: 8, borderRadius: 4 },
  scoreText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: -2,
  },
  chipBlock: { gap: 8, marginTop: 2 },
  chipHeading: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    maxWidth: '100%',
  },
  chipIcon: { marginRight: 6 },
  chipMust: {
    backgroundColor: 'rgba(196, 163, 90, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(196, 163, 90, 0.35)',
  },
  chipMustText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  chipNice: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipNiceText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'column',
    gap: 10,
    marginTop: 10,
  },
  actionsSingle: { marginTop: 6 },
  cancelBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  cancelText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  primaryBtn: {
    flexDirection: 'row',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryFull: { width: '100%' },
  primaryIcon: { marginTop: 1 },
  primaryText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
});
