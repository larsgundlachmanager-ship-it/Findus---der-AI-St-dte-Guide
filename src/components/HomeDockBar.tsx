/**
 * Untere Home-Leiste: Timeline · Orte · Einstellungen
 * Karte ist dauerhaft an — kein Aus-Toggle.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { useSystemSafePad } from '../hooks/useSystemSafePad';

type Props = {
  onTimeline: () => void;
  onPlaces: () => void;
  onSettings: () => void;
  /** Für Onboarding-Finger / Measure. */
  timelineRef?: React.RefObject<View | null>;
  placesRef?: React.RefObject<View | null>;
  settingsRef?: React.RefObject<View | null>;
};

type DockAction = 'onTimeline' | 'onPlaces' | 'onSettings';

const ITEMS: Array<{
  id: 'timeline' | 'places' | 'settings';
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  action: DockAction;
  a11y: string;
}> = [
  {
    id: 'timeline',
    label: 'Timeline',
    icon: 'clock',
    action: 'onTimeline',
    a11y: 'Timeline und Routenplanung',
  },
  {
    id: 'places',
    label: 'Orte',
    icon: 'search',
    action: 'onPlaces',
    a11y: 'Orte finden',
  },
  {
    id: 'settings',
    label: 'Einst.',
    icon: 'settings',
    action: 'onSettings',
    a11y: 'Einstellungen',
  },
];

export const HomeDockBar = React.memo(function HomeDockBar({
  onTimeline,
  onPlaces,
  onSettings,
  timelineRef,
  placesRef,
  settingsRef,
}: Props) {
  const safePad = useSystemSafePad();
  const handlers: Record<DockAction, () => void> = {
    onTimeline,
    onPlaces,
    onSettings,
  };
  const itemRef = (id: (typeof ITEMS)[number]['id']) =>
    id === 'timeline'
      ? timelineRef
      : id === 'places'
        ? placesRef
        : settingsRef;
  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(8, safePad.bottom) }]}
      pointerEvents="box-none"
    >
      {ITEMS.map((item) => (
        <Pressable
          key={item.id}
          ref={itemRef(item.id) as React.RefObject<View> | undefined}
          onPressIn={handlers[item.action]}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          android_ripple={{ color: 'rgba(255,255,255,0.14)', borderless: false }}
          accessibilityRole="button"
          accessibilityLabel={item.a11y}
          collapsable={false}
        >
          <Feather name={item.icon} size={20} color={colors.text} />
          <Text style={styles.label} numberOfLines={1}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  bar: {
    zIndex: UI_LAYER.hud,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.sm,
    paddingTop: 8,
    backgroundColor: 'rgba(15, 44, 36, 0.78)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    borderRadius: 12,
  },
  btnPressed: {
    opacity: 0.8,
  },
  label: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
});
