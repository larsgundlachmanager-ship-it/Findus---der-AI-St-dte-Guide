import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/theme';

type Props = {
  /** true = Pause-Icon (zwei Balken), false = Play-Dreieck */
  paused?: boolean;
  size?: number;
  color?: string;
};

/**
 * Play/Pause im gleichen visuellen Stil (Farbe, Gewicht, Größe).
 * Pause als Balken statt Emoji — sonst wirkt ⏸ anders als ▶.
 */
export function PlayPauseIcon({
  paused = false,
  size = 16,
  color = colors.accent,
}: Props) {
  if (paused) {
    const barW = Math.max(3, Math.round(size * 0.22));
    const barH = Math.round(size * 0.85);
    const gap = Math.max(3, Math.round(size * 0.18));
    return (
      <View style={[styles.pauseRow, { width: size, height: size }]}>
        <View
          style={{
            width: barW,
            height: barH,
            borderRadius: 1,
            backgroundColor: color,
          }}
        />
        <View style={{ width: gap }} />
        <View
          style={{
            width: barW,
            height: barH,
            borderRadius: 1,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  return (
    <Text
      style={[
        styles.playGlyph,
        {
          color,
          fontSize: size,
          lineHeight: size + 2,
        },
      ]}
    >
      ▶
    </Text>
  );
}

const styles = StyleSheet.create({
  pauseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    fontWeight: '700',
    marginLeft: 2,
    textAlign: 'center',
  },
});
