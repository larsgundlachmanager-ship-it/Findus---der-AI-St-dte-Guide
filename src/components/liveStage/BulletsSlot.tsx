import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, spacing } from '../../constants/theme';
import { UI_LAYER } from '../../constants/uiLayers';
import type { ConciergeCardState } from '../../types/concierge';
import { dismissConciergeCard } from '../../services/actionHandlerService';
import {
  estimateBulletMaxChars,
  rewriteBulletToFit,
} from '../../services/concierge/parseConciergeResponse';
import {
  BULLETS_ENTERING,
  BULLETS_EXITING,
} from './stageTransitions';

type Props = {
  card: ConciergeCardState;
};

const BULLET_FONT = 14;
const BULLET_LINES = 2;

/**
 * Stichpunkte im Bottom-Dock.
 * Länge kommt aus echter Layout-Breite — nie UI-Ellipse („Pogo…“).
 */
export const BulletsSlot = React.memo(function BulletsSlot({ card }: Props) {
  const [contentW, setContentW] = useState(0);

  const maxChars = useMemo(() => {
    if (contentW <= 0) return 64;
    return estimateBulletMaxChars({
      widthPx: contentW,
      fontSize: BULLET_FONT,
      lines: BULLET_LINES,
    });
  }, [contentW]);

  const bullets = useMemo(
    () =>
      card.visualBullets
        .slice(0, 3)
        .map((b) => rewriteBulletToFit(b, maxChars))
        .filter(Boolean),
    [card.visualBullets, maxChars],
  );

  const onBulletsLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && Math.abs(w - contentW) >= 2) setContentW(w);
  };

  return (
    <Animated.View
      entering={BULLETS_ENTERING}
      exiting={BULLETS_EXITING}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={1}>
            {card.cardTitle?.trim() || 'Spickzettel'}
          </Text>
          <Pressable
            onPress={dismissConciergeCard}
            hitSlop={10}
            accessibilityLabel="Karte schließen"
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.bullets} onLayout={onBulletsLayout}>
          {bullets.map((b, i) => (
            <Text
              key={`${i}-${b.slice(0, 12)}`}
              style={styles.bullet}
              numberOfLines={BULLET_LINES}
            >
              • {b}
            </Text>
          ))}
        </View>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    flexShrink: 1,
    zIndex: UI_LAYER.bullets,
    elevation: UI_LAYER.bullets,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: 'rgba(12, 28, 22, 0.94)',
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 163, 90, 0.35)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: {
    flex: 1,
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginRight: spacing.sm,
    lineHeight: 20,
  },
  close: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  bullets: {
    gap: 6,
  },
  bullet: {
    color: colors.text,
    fontSize: BULLET_FONT,
    lineHeight: 20,
  },
});
