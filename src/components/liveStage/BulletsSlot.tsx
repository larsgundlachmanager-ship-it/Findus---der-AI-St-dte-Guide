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
  isProgramBulletCard,
  MAX_PROGRAM_LIST_BULLETS,
  MAX_VISUAL_BULLETS,
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
/** Masterbook: je Stichpunkt bis 2 Zeilen — nie UI-Ellipse. */
const BULLET_LINES = 2;

/**
 * Stichpunkte im Bottom-Dock.
 * Länge kommt aus echter Layout-Breite — nie UI-Ellipse („Pogo…“).
 * Hardfacts: max 3. Programm-Liste: max 7.
 */
export const BulletsSlot = React.memo(function BulletsSlot({ card }: Props) {
  const [contentW, setContentW] = useState(0);
  const programList = isProgramBulletCard(card.cardTitle);
  const maxBullets = programList
    ? MAX_PROGRAM_LIST_BULLETS
    : MAX_VISUAL_BULLETS;

  const maxChars = useMemo(() => {
    // Vor Messung: eng, damit erster Paint nie „…“ zeigt
    if (contentW <= 0) return 48;
    return estimateBulletMaxChars({
      widthPx: contentW,
      fontSize: BULLET_FONT,
      lines: BULLET_LINES,
      bulletPrefixPx: 22,
    });
  }, [contentW]);

  const bullets = useMemo(
    () =>
      card.visualBullets
        .slice(0, maxBullets)
        .map((b) => rewriteBulletToFit(b, maxChars))
        .filter(Boolean),
    [card.visualBullets, maxBullets, maxChars],
  );

  const onBulletsLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && Math.abs(w - contentW) >= 2) {
      setContentW(w);
      void import('../../module2/reboot/pipeline/bulletUiBudget').then(
        ({ noteBulletUiMeasurement }) =>
          noteBulletUiMeasurement({ widthPx: w, fontSize: BULLET_FONT }),
      );
    }
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
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {(() => {
                const raw = card.cardTitle?.trim() ?? '';
                if (!raw || /^[\[\]{}]+$/u.test(raw)) {
                  const wake = card.visualBullets?.some((b) =>
                    /\bwecker\b|⏰/iu.test(b),
                  );
                  return wake ? 'Wecker' : 'Spickzettel';
                }
                return raw;
              })()}
            </Text>
            {card.cardSubtitle?.trim() &&
            card.cardSubtitle.trim().toLowerCase() !==
              (card.cardTitle || '').trim().toLowerCase() ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {card.cardSubtitle.trim()}
              </Text>
            ) : null}
          </View>
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
              ellipsizeMode="clip"
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  titleBlock: {
    flex: 1,
    marginRight: spacing.sm,
  },
  title: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
    lineHeight: 20,
  },
  subtitle: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.15,
    lineHeight: 16,
  },
  close: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 4,
    paddingTop: 1,
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
