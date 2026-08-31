/**
 * Explore-Chip: X von Y · Z % + Recenter + Norden-Kompass.
 * GPS: 1. Tipp zentrieren · 2. Tipp in 5 s Follow.
 * Kompass: 1. Tipp Norden oben · 2. Tipp in 5 s dreht mit.
 * Nadel zeigt geografisch Norden (gegenläufig zur Kartendrehung).
 * Extra-Button: Kompass kalibrieren (Acht durch die Luft).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../constants/theme';
import { UI_LAYER } from '../../constants/uiLayers';
import { useHomeMapUiStore } from '../../store/useHomeMapUiStore';

type Props = {
  line: string;
  top: number;
  /** MapLibre-Bearing: 0 = Norden oben. Nadel dreht gegenläufig mit. */
  mapBearingDeg?: number;
  onRecenter: () => void;
  onRecenterLock?: () => void;
  onNorthUp: () => void;
  onNorthLongPress?: () => void;
  onCalibrate?: () => void;
  /** Blauer Punkt bleibt in der Mitte (zweiter GPS-Tipp). */
  locationFollow?: boolean;
  /** Karte dreht mit dem Handy (zweiter Kompass-Tipp). */
  headingFollow?: boolean;
  needsCalibration?: boolean;
  calibrating?: boolean;
};

export const HomeMapExploreChip = React.memo(function HomeMapExploreChip({
  line,
  top,
  mapBearingDeg,
  onRecenter,
  onRecenterLock,
  onNorthUp,
  onNorthLongPress,
  onCalibrate,
  locationFollow = false,
  headingFollow = false,
  needsCalibration = false,
  calibrating = false,
}: Props) {
  const storeBearing = useHomeMapUiStore((s) => s.mapBearing);
  const raw =
    typeof mapBearingDeg === 'number' && Number.isFinite(mapBearingDeg)
      ? mapBearingDeg
      : storeBearing;
  const needleDeg = -raw;
  return (
    <View style={[styles.wrap, { top }]} pointerEvents="box-none">
      <View style={styles.chip}>
        <Text style={styles.text} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <Pressable
        onPressIn={onRecenter}
        onLongPress={onRecenterLock ?? onRecenter}
        delayLongPress={380}
        style={[styles.btn, locationFollow && styles.btnLocked]}
        accessibilityRole="button"
        accessibilityLabel={
          locationFollow
            ? 'Standort-Fix aus. Karte folgt dir und bleibt nach Norden ausgerichtet.'
            : 'Auf meine Position zentrieren. Nochmal innerhalb von 5 Sekunden: Fix-Modus — Karte folgt dir, Norden oben.'
        }
        hitSlop={8}
      >
        <Feather
          name="crosshair"
          size={22}
          color={locationFollow ? '#FFFFFF' : colors.text}
        />
      </Pressable>
      <Pressable
        onPressIn={onNorthUp}
        onLongPress={onNorthLongPress}
        delayLongPress={380}
        style={[styles.btn, headingFollow && styles.btnLocked]}
        accessibilityRole="button"
        accessibilityLabel={
          headingFollow
            ? 'Blickrichtung-Follow aus. Karte zeigt wieder nach Norden.'
            : 'Norden oben. Nochmal innerhalb von 5 Sekunden: Karte dreht mit der Blickrichtung.'
        }
        hitSlop={8}
      >
        <View style={{ transform: [{ rotate: `${needleDeg}deg` }] }}>
          <View style={styles.needleNorth} />
          <View
            style={[
              styles.needleSouth,
              headingFollow && styles.needleSouthOnBlue,
            ]}
          />
        </View>
      </Pressable>
      <Pressable
        onPressIn={() => onCalibrate?.()}
        style={[
          styles.btn,
          (needsCalibration || calibrating) && styles.btnCalibrate,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Kompass kalibrieren"
        hitSlop={8}
      >
        <View style={styles.eight}>
          <View style={[styles.eightLoop, styles.eightLeft]} />
          <View style={[styles.eightLoop, styles.eightRight]} />
        </View>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: UI_LAYER.hud,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    flex: 1,
    backgroundColor: 'rgba(15, 44, 36, 0.88)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  text: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 44, 36, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  btnLocked: {
    backgroundColor: '#1A73E8',
    borderColor: '#1A73E8',
    borderWidth: 1.5,
  },
  btnCalibrate: {
    borderColor: colors.thinking,
    borderWidth: 1.5,
  },
  eight: {
    width: 22,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eightLoop: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.thinking,
  },
  eightLeft: { left: 0 },
  eightRight: { right: 0 },
  needleNorth: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#E24B4B',
  },
  needleSouth: {
    width: 0,
    height: 0,
    marginTop: 1,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.text,
  },
  needleSouthOnBlue: {
    borderTopColor: '#FFFFFF',
  },
});
