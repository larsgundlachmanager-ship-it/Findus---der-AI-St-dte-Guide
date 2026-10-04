/**
 * Home-HUD: dünner Ladebalken beim Stadtwechsel (Speichern / Commit).
 * Progress nur vorwärts; bei „fertig“ ausblenden — nie zurück auf 1 %.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import {
  getCityCommitProgress,
  subscribeCityCommitProgress,
  type CityCommitProgress,
} from '../services/cityCommitProgress';

export function CityCommitProgressHost() {
  const [state, setState] = useState<CityCommitProgress>(() =>
    getCityCommitProgress(),
  );
  const [display, setDisplay] = useState<{
    cityName: string;
    done: boolean;
    progress: number;
  } | null>(() => {
    const g = getCityCommitProgress();
    return g
      ? {
          cityName: g.cityName,
          done: g.phase === 'done',
          progress: g.progress,
        }
      : null;
  });
  const width = useRef(new Animated.Value(0.08)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const peakRef = useRef(0.08);

  useEffect(() => {
    return subscribeCityCommitProgress((next) => {
      setState(next);
      if (next) {
        setDisplay({
          cityName: next.cityName,
          done: next.phase === 'done',
          progress: next.progress,
        });
      }
    });
  }, []);

  useEffect(() => {
    if (!state) {
      if (!display) return;
      // Fertig: bei 100 % kurz halten, dann soft ausblenden — kein Reset auf 8 %.
      width.setValue(1);
      peakRef.current = 1;
      Animated.timing(opacity, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setDisplay(null);
        peakRef.current = 0.08;
        width.setValue(0.08);
        opacity.setValue(1);
      });
      return;
    }

    opacity.stopAnimation();
    opacity.setValue(1);
    const target = Math.max(peakRef.current, Math.min(1, state.progress));
    peakRef.current = target;
    Animated.timing(width, {
      toValue: target,
      duration: state.phase === 'done' ? 140 : 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [state, display, width, opacity]);

  if (!display) return null;

  const pct = Math.max(
    1,
    Math.min(100, Math.round((state?.progress ?? display.progress) * 100)),
  );
  const loading = !(display.done || !state);
  const line = loading
    ? `${pct}% - Ich lade ${display.cityName}`
    : 'Geschichte bereit';

  return (
    <Animated.View
      style={[styles.wrap, { opacity }]}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={line}
      accessibilityValue={
        loading ? { now: pct, min: 0, max: 100 } : undefined
      }
    >
      <View style={styles.card}>
        <View style={styles.row}>
          {!loading ? (
            <Feather name="check" size={16} color={colors.accent} />
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {line}
          </Text>
        </View>
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              {
                width: width.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    // Unter Status/Wetter — Karte oben freier.
    top: 118,
    zIndex: UI_LAYER.hud + 20,
    elevation: UI_LAYER.hud + 20,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  track: {
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
});
