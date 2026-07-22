import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';

/**
 * Untertitel am unteren Bildschirmrand – zeigt den gerade gesprochenen Kokoro-Text.
 */
export function SubtitleOverlay({ text }: { text: string | null }) {
  if (!text?.trim()) {
    return null;
  }

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.box}>
        <Text style={styles.text}>{text.trim()}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    zIndex: 2,
  },
  box: {
    backgroundColor: 'rgba(8, 18, 14, 0.82)',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  text: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
    fontWeight: '500',
  },
});
