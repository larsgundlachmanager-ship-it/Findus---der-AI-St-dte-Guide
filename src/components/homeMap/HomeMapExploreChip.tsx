/**
 * Explore-Chip: X von Y · Z % + Recenter + Kompass + Kalibrieren.
 * GPS: ein Tipp zentriert + Fixierung (bei Bedarf Straßenzoom).
 * Kompass: 1. Tipp Norden oben · 2. Tipp in 5 s dreht mit Blickrichtung.
 * Nadel = klassischer Kompass (rot/weiß), live via Reanimated.
 * Extra-Button: Kompass kalibrieren (Acht) — immer tippbar.
 */

import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
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
  /** Blauer Punkt bleibt in der Mitte (GPS-Fix). */
  locationFollow?: boolean;
  /** Karte dreht mit dem Handy (zweiter Kompass-Tipp). */
  headingFollow?: boolean;
  needsCalibration?: boolean;
  calibrating?: boolean;
};

function unwrapToward(current: number, target: number): number {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return current + delta;
}

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
  // Live 1:1 mit Kartendrehung — kürzester Weg, kein withTiming (sonst Nachlauf).
  const needleDeg = useSharedValue(-raw);
  const needleAbsRef = useRef(-raw);
  useEffect(() => {
    const next = unwrapToward(needleAbsRef.current, -raw);
    needleAbsRef.current = next;
    needleDeg.value = next;
  }, [raw, needleDeg]);
  const needleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${needleDeg.value}deg` }],
  }));
  const calibrateHot = needsCalibration || calibrating;
  return (
    <View style={[styles.wrap, { top }]} pointerEvents="box-none">
      <View style={styles.chip}>
        <Text style={styles.text} numberOfLines={1}>
          {line}
        </Text>
      </View>
      <Pressable
        onPress={onRecenter}
        onLongPress={onRecenterLock ?? onRecenter}
        delayLongPress={380}
        style={[styles.btn, locationFollow && styles.btnLocked]}
        accessibilityRole="button"
        accessibilityLabel={
          locationFollow
            ? 'Standort-Fix aus. Karte folgt dir nicht mehr.'
            : 'Auf meine Position zentrieren und fixieren. Der Kompass bleibt unverändert.'
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
        onPress={onNorthUp}
        onLongPress={onNorthLongPress}
        delayLongPress={380}
        style={[styles.btn, headingFollow && styles.btnLocked]}
        accessibilityRole="button"
        accessibilityLabel={
          headingFollow
            ? 'Blickrichtung-Follow aus. Karte zeigt wieder nach Norden.'
            : 'Karte nach Norden ausrichten. Nochmal innerhalb von 5 Sekunden: Karte dreht mit deiner Blickrichtung. Der Standort-Fix bleibt unverändert.'
        }
        hitSlop={8}
      >
        <Reanimated.View style={[styles.compassDial, needleStyle]}>
          <View
            style={[
              styles.needleNorth,
              headingFollow && styles.needleOnFollow,
            ]}
          />
          <View
            style={[
              styles.needleSouth,
              headingFollow && styles.needleSouthOnFollow,
            ]}
          />
          <View
            style={[
              styles.needleHub,
              headingFollow && styles.needleHubOnFollow,
            ]}
          />
        </Reanimated.View>
      </Pressable>
      <Pressable
        onPress={() => onCalibrate?.()}
        style={[
          styles.btn,
          styles.btnCalibrate,
          calibrateHot && styles.btnCalibrateHot,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Kompass kalibrieren"
        hitSlop={12}
      >
        <View style={styles.eight}>
          <View
            style={[
              styles.eightLoop,
              styles.eightLeft,
              calibrateHot && styles.eightLoopHot,
            ]}
          />
          <View
            style={[
              styles.eightLoop,
              styles.eightRight,
              calibrateHot && styles.eightLoopHot,
            ]}
          />
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
    elevation: UI_LAYER.hud + 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    flex: 1,
    backgroundColor: 'rgba(15, 44, 36, 0.92)',
    borderRadius: 20,
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
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 44, 36, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    elevation: 28,
    overflow: 'hidden',
  },
  btnLocked: {
    backgroundColor: '#1A73E8',
    borderColor: '#1A73E8',
    borderWidth: 1.5,
  },
  btnCalibrate: {
    borderColor: 'rgba(255,255,255,0.28)',
    borderWidth: 1,
  },
  btnCalibrateHot: {
    borderColor: colors.thinking,
    borderWidth: 1.5,
  },
  compassDial: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  needleNorth: {
    position: 'absolute',
    top: 1,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#E53935',
  },
  needleSouth: {
    position: 'absolute',
    bottom: 1,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(255,255,255,0.88)',
  },
  needleHub: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: '#E53935',
    zIndex: 2,
  },
  needleOnFollow: {
    borderBottomColor: '#FFFFFF',
  },
  needleSouthOnFollow: {
    borderTopColor: 'rgba(255,255,255,0.55)',
  },
  needleHubOnFollow: {
    backgroundColor: '#1A73E8',
    borderColor: '#FFFFFF',
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
    borderColor: 'rgba(255,255,255,0.7)',
  },
  eightLoopHot: {
    borderColor: colors.thinking,
  },
  eightLeft: { left: 0 },
  eightRight: { right: 0 },
});
