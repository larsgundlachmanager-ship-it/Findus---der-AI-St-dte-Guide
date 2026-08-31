/**
 * Kompass-Kalibrierung: Acht-Animation auf der UI-Thread, Live-Feedback.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, spacing } from '../../constants/theme';
import { UI_LAYER } from '../../constants/uiLayers';
import {
  getHeadingAccuracy,
  getMapDisplayHeadingDeg,
  markCompassUserCalibrated,
  subscribeMapHeading,
} from '../../services/navigation/liveDeviceHeading';
import { headingAccuracyIsPoor } from '../../services/homeMap/homeMapCompass';

type Phase = 'prompt' | 'sensing' | 'done';

const MIN_CALIBRATE_MS = 4000;
const MIN_TRAVEL_DEG = 420;

type Props = {
  visible: boolean;
  cityId?: string | null;
  onClose: () => void;
};

function shortestDelta(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d <= -180) d += 360;
  return Math.abs(d);
}

export function CompassCalibrateModal({ visible, cityId, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('prompt');
  const travelRef = useRef({ last: null as number | null, sum: 0, since: 0 });
  const t = useSharedValue(0);

  useEffect(() => {
    if (!visible) {
      setPhase('prompt');
      travelRef.current = { last: null, sum: 0, since: 0 };
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.linear }),
      -1,
      false,
    );
  }, [visible, t]);

  useEffect(() => {
    if (!visible) return;
    let lastNote = 0;
    const note = (deg: number) => {
      const rec = travelRef.current;
      if (!rec.since) rec.since = Date.now();
      if (rec.last != null) rec.sum += shortestDelta(rec.last, deg);
      rec.last = deg;
      const acc = getHeadingAccuracy();
      const poor = headingAccuracyIsPoor(acc, Platform.OS);
      const elapsed = Date.now() - rec.since;
      setPhase((prev) => {
        if (prev === 'done') return prev;
        let next = prev;
        if (rec.sum > 80 && prev === 'prompt') next = 'sensing';
        const longEnough = elapsed >= MIN_CALIBRATE_MS;
        const movedEnough = rec.sum >= MIN_TRAVEL_DEG && !poor;
        const overtime = elapsed > 9000 && rec.sum > 180;
        if (longEnough && (movedEnough || overtime)) next = 'done';
        if (next === 'done') markCompassUserCalibrated(cityId);
        return next;
      });
    };
    const unsub = subscribeMapHeading((deg) => {
      const now = Date.now();
      if (now - lastNote < 200) return;
      lastNote = now;
      note(deg);
    });
    const poll = setInterval(() => {
      const heading = getMapDisplayHeadingDeg();
      if (heading == null) return;
      note(heading);
    }, 280);
    return () => {
      unsub();
      clearInterval(poll);
    };
  }, [visible, cityId]);

  const beadStyle = useAnimatedStyle(() => {
    const a = t.value * Math.PI * 2;
    return {
      transform: [
        { translateX: Math.sin(a) * 46 },
        { translateY: Math.sin(a) * Math.cos(a) * 28 },
      ],
    };
  });

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.94 + t.value * 0.06 }],
  }));

  if (!visible) return null;

  const title =
    phase === 'done'
      ? 'Passt — Kompass sitzt'
      : phase === 'sensing'
        ? 'Weiter die große Acht'
        : 'Große Acht in der Luft';
  const body =
    phase === 'done'
      ? 'Fertig. In dieser Stadt sitzt der Kompass. Beim Gehen justiert GPS nur noch nach.'
      : phase === 'sensing'
        ? 'Mindestens vier Sekunden — große Acht, nicht nur leicht wackeln. Weg von Magneten, Schlüsseln und Lautsprechern.'
        : 'Handy vom Tisch nehmen und mindestens vier Sekunden als große Acht durch die Luft bewegen.';

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.stage}>
          {phase === 'done' ? (
            <Reanimated.Text
              style={[styles.checkMark, checkStyle]}
              accessibilityLabel="Kalibrierung fertig"
            >
              ✓
            </Reanimated.Text>
          ) : (
            <>
              <View style={[styles.loop, { left: 28 }]} />
              <View style={[styles.loop, { right: 28 }]} />
              <Reanimated.View
                style={[
                  styles.bead,
                  beadStyle,
                  { backgroundColor: colors.thinking },
                ]}
              />
            </>
          )}
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable
          onPressIn={onClose}
          style={styles.ok}
          accessibilityRole="button"
          accessibilityLabel={phase === 'done' ? 'Fertig' : 'Schließen'}
        >
          <Text style={styles.okTxt}>
            {phase === 'done' ? 'Fertig' : 'Schließen'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.hud + 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 22, 18, 0.45)',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stage: {
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  loop: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: 'rgba(61, 124, 255, 0.45)',
  },
  checkMark: {
    color: colors.online,
    fontSize: 72,
    fontWeight: '700',
    lineHeight: 80,
    textAlign: 'center',
  },
  bead: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.thinking,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  ok: {
    alignSelf: 'flex-end',
    marginTop: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  okTxt: {
    color: colors.thinking,
    fontSize: 16,
    fontWeight: '700',
  },
});
