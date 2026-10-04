/**
 * Untere Home-Leiste: Timeline · Orte · Einstellungen
 * Karte ist dauerhaft an — kein Aus-Toggle.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  icon: React.ComponentProps<typeof Ionicons>['name'];
  action: DockAction;
  a11y: string;
}> = [
  {
    id: 'timeline',
    label: 'Timeline',
    icon: 'time-outline',
    action: 'onTimeline',
    a11y: 'Timeline und Routenplanung',
  },
  {
    id: 'places',
    label: 'Orte',
    icon: 'search-outline',
    action: 'onPlaces',
    a11y: 'Orte finden',
  },
  {
    id: 'settings',
    label: 'Einst.',
    icon: 'settings-outline',
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
      style={[styles.bar, { paddingBottom: Math.max(6, safePad.bottom) }]}
      pointerEvents="box-none"
    >
      {ITEMS.map((item) => (
        <Pressable
          key={item.id}
          ref={itemRef(item.id) as React.RefObject<View> | undefined}
          // Press-In = Frame-1 Open (wie Mic); onPress Guard für kurze Taps ohne PressIn-Hit.
          onPressIn={handlers[item.action]}
          onPress={handlers[item.action]}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          android_ripple={{ color: 'rgba(255,255,255,0.14)', borderless: false }}
          accessibilityRole="button"
          accessibilityLabel={item.a11y}
          collapsable={false}
        >
          <Ionicons name={item.icon} size={22} color={colors.text} />
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
    elevation: UI_LAYER.hud + 40,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.sm,
    paddingTop: 7,
    // Deckend — Karte läuft full-bleed darunter; Dock bleibt undurchsichtig.
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 5,
    borderRadius: 10,
  },
  btnPressed: {
    opacity: 0.8,
  },
  label: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
