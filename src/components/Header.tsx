import React, { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { useFinnusStore } from '../store/useFinnusStore';
import { formatCompassNavLabel } from './CompassNavOverlay';

type Props = {
  onOpenSettings?: () => void;
  onOpenPassport?: () => void;
  settingsRef?: React.RefObject<View | null>;
  settingsDisabled?: boolean;
};

type HeaderPanel = 'nav' | 'place';

function formatKm(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function Header({
  onOpenSettings,
  onOpenPassport,
  settingsRef,
  settingsDisabled,
}: Props) {
  const currentLocationName = useFinnusStore((s) => s.currentLocationName);
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const visitedHistory = useFinnusStore((s) => s.visitedHistory);
  const navActive = useFinnusStore((s) => s.navActive);
  const navVisible = useFinnusStore((s) => s.navVisible);
  const navTargetName = useFinnusStore((s) => s.navTargetName);
  const navDistanceM = useFinnusStore((s) => s.navDistanceM);
  const navNextTargetName = useFinnusStore((s) => s.navNextTargetName);
  const navLegDistanceM = useFinnusStore((s) => s.navLegDistanceM);
  const navTotalDistanceM = useFinnusStore((s) => s.navTotalDistanceM);
  const transportMode = useFinnusStore((s) => s.transportMode);
  const remainingStations = useFinnusStore((s) => s.remainingStations);

  const navigating = navActive && navVisible;
  const [panel, setPanel] = useState<HeaderPanel>('nav');
  const [placeIndex, setPlaceIndex] = useState(0);

  const visitedPlaces = useMemo(() => {
    const seen = new Set<number>();
    const out: Array<{ name: string }> = [];
    for (const e of visitedHistory) {
      if (seen.has(e.poiId)) continue;
      seen.add(e.poiId);
      out.push({ name: e.name });
    }
    return out.reverse();
  }, [visitedHistory]);

  const placeTitle =
    placeIndex === 0
      ? (currentLocationName ?? 'Unterwegs')
      : (visitedPlaces[placeIndex - 1]?.name ?? currentLocationName ?? 'Unterwegs');

  const cyclePanel = (dir: 1 | -1) => {
    if (navigating) {
      if (panel === 'nav') {
        setPanel('place');
        setPlaceIndex(0);
        return;
      }
      if (dir > 0) {
        if (placeIndex < visitedPlaces.length) {
          setPlaceIndex((i) => i + 1);
        } else {
          setPanel('nav');
          setPlaceIndex(0);
        }
      } else {
        if (placeIndex > 0) {
          setPlaceIndex((i) => i - 1);
        } else {
          setPanel('nav');
        }
      }
      return;
    }
    if (visitedPlaces.length <= 1) return;
    setPlaceIndex((i) => {
      const next = i + dir;
      if (next < 0) return visitedPlaces.length;
      if (next > visitedPlaces.length) return 0;
      return next;
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -28) cyclePanel(1);
        else if (g.dx > 28) cyclePanel(-1);
      },
    }),
  ).current;

  const dist = formatCompassNavLabel({
    distanceM: navDistanceM,
    transportMode,
    remainingStations,
  });

  const label = navigating
    ? panel === 'nav'
      ? 'Navigation · Wischen für Ort'
      : placeIndex === 0
        ? 'Aktueller Ort · Wischen'
        : 'Verlauf · Wischen'
    : visitedPlaces.length > 0
      ? 'Standort · Wischen · Tippen für Verlauf'
      : 'Standort · Tippen für Verlauf';

  const title = navigating
    ? panel === 'nav'
      ? (navTargetName ?? 'Ziel')
      : placeTitle
    : placeTitle;

  const metaNav =
    panel === 'nav' ? (
      <Text style={styles.meta} numberOfLines={2}>
        {dist ? `Noch ${dist}` : 'Route aktiv'}
        {navNextTargetName && navNextTargetName !== navTargetName
          ? ` · Nächster: ${navNextTargetName}`
          : ''}
        {navLegDistanceM != null && navLegDistanceM > 0
          ? ` (${formatKm(navLegDistanceM)})`
          : ''}
        {navTotalDistanceM != null
          ? ` · Gesamt ${formatKm(navTotalDistanceM)}`
          : ''}
      </Text>
    ) : placeIndex > 0 ? (
      <Text style={styles.meta}>
        Stempel {placeIndex} von {visitedPlaces.length}
      </Text>
    ) : null;

  const metaIdle =
    __DEV__ && isSimulationMode ? (
      <Text style={styles.meta}>Simulation</Text>
    ) : visitedPlaces.length > 0 ? (
      <Text style={styles.meta}>
        {visitedPlaces.length} Stempel
        {placeIndex > 0 ? ` · ${placeIndex}/${visitedPlaces.length}` : ''}
      </Text>
    ) : null;

  const locationContent = (
    <>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.location} numberOfLines={2}>
        {title}
      </Text>
      {navigating ? metaNav : metaIdle}
    </>
  );

  return (
    <View style={styles.row} pointerEvents="box-none">
      <Pressable
        style={styles.locationBlock}
        onPress={onOpenPassport}
        disabled={!onOpenPassport}
        accessibilityRole="button"
        accessibilityLabel={
          navigating
            ? 'Verlauf und Route öffnen'
            : 'Verlauf und Stempelkarte öffnen'
        }
        {...panResponder.panHandlers}
      >
        {locationContent}
      </Pressable>

      <View
        ref={settingsRef as React.RefObject<View> | undefined}
        collapsable={false}
        style={styles.settingsWrap}
        pointerEvents="auto"
      >
        <Pressable
          onPress={() => {
            onOpenSettings?.();
          }}
          disabled={settingsDisabled || !onOpenSettings}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
          style={({ pressed }) => [
            styles.settingsBtn,
            pressed && styles.settingsBtnPressed,
            (settingsDisabled || !onOpenSettings) && styles.settingsBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Einstellungen"
          accessibilityState={{ disabled: settingsDisabled || !onOpenSettings }}
        >
          <Text style={styles.settingsIcon}>⚙️</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    zIndex: 100,
    elevation: 100,
  },
  locationBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: spacing.sm,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  location: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 26,
    flexShrink: 1,
  },
  meta: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  settingsWrap: {
    flexShrink: 0,
    zIndex: 101,
    elevation: 101,
  },
  settingsBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 0,
  },
  settingsBtnPressed: {
    opacity: 0.75,
    backgroundColor: colors.bgElevated,
  },
  settingsBtnDisabled: {
    opacity: 0.55,
  },
  settingsIcon: {
    fontSize: 22,
  },
});
