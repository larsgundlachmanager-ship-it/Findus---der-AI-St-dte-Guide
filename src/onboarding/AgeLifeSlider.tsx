import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';

const MIN_AGE = 6;
const MAX_AGE = 100;
const AGE_SPAN = MAX_AGE - MIN_AGE;
/** Seitenluft: Platz für Badge-Hälfte links/rechts vom Track */
const SIDE_PAD = 40;
const BADGE = 56;
const THUMB_R = 14;

type LifeStage =
  | 'baby'
  | 'football'
  | 'school'
  | 'laptop'
  | 'briefcase'
  | 'house'
  | 'vacation'
  | 'elder';

type Props = {
  age: number;
  yearsLabel: string;
  onChange: (age: number) => void;
};

/** `until` = erste Altersstufe der *nächsten* Phase (aktuell gilt für age < until) */
const STAGES: {
  id: LifeStage;
  icon: string;
  label: string;
  until: number;
}[] = [
  { id: 'baby', icon: '👶', label: 'Kindheit', until: 9 }, // bis 8
  { id: 'football', icon: '⚽', label: 'Fußball', until: 13 }, // bis 12
  { id: 'school', icon: '🏫', label: 'Schule', until: 21 }, // bis 20
  { id: 'laptop', icon: '💻', label: 'Laptop', until: 28 }, // bis 27
  { id: 'briefcase', icon: '💼', label: 'Beruf', until: 40 }, // bis 39
  { id: 'house', icon: '🏠', label: 'Zuhause', until: 55 }, // ab 40
  { id: 'vacation', icon: '🌴', label: 'Urlaub', until: 73 }, // ab 55 bis 72
  { id: 'elder', icon: '👵', label: 'Oma', until: 999 }, // ab 73
];

function clampAge(n: number) {
  return Math.max(MIN_AGE, Math.min(MAX_AGE, Math.round(n)));
}

function stageIndex(age: number) {
  const i = STAGES.findIndex((s) => age < s.until);
  return i < 0 ? STAGES.length - 1 : i;
}

/** Soft circular life-stage pictogram (no stick figures) */
function StageBadge({ age }: { age: number }) {
  const idx = Math.max(0, stageIndex(age));
  const stage = STAGES[idx];

  return (
    <View style={styles.badge}>
      <View style={styles.badgeRing} />
      <Text style={styles.badgeIcon}>{stage.icon}</Text>
    </View>
  );
}

export function AgeLifeSlider({ age, yearsLabel, onChange }: Props) {
  const clamped = clampAge(age);
  const idx = Math.max(0, stageIndex(clamped));
  const [trackWidth, setTrackWidth] = useState(0);
  const ageRef = useRef(clamped);
  const trackWidthRef = useRef(0);
  const trackPageXRef = useRef(0);
  const trackRef = useRef<View>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const bounce = useRef(new Animated.Value(1)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const prevIdx = useRef(idx);

  useEffect(() => {
    ageRef.current = clamped;
  }, [clamped]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

  useEffect(() => {
    if (prevIdx.current !== idx) {
      prevIdx.current = idx;
      fade.setValue(0.35);
      bounce.setValue(0.82);
      Animated.parallel([
        Animated.spring(bounce, {
          toValue: 1,
          friction: 5,
          tension: 160,
          useNativeDriver: false,
        }),
        Animated.timing(fade, {
          toValue: 1,
          duration: 220,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, [idx, bounce, fade]);

  const setAgeFromPageX = useCallback((pageX: number) => {
    const w = trackWidthRef.current;
    if (w <= 0) return;
    const x = pageX - trackPageXRef.current;
    const ratio = Math.max(0, Math.min(1, x / w));
    const next = clampAge(MIN_AGE + ratio * AGE_SPAN);
    if (next !== ageRef.current) {
      ageRef.current = next;
      onChangeRef.current(next);
    }
  }, []);

  const measureTrack = useCallback(() => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      trackPageXRef.current = x;
      trackWidthRef.current = width;
      setTrackWidth(width);
    });
  }, []);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          measureTrack();
          setAgeFromPageX(e.nativeEvent.pageX);
        },
        onPanResponderMove: (e) => {
          setAgeFromPageX(e.nativeEvent.pageX);
        },
      }),
    [measureTrack, setAgeFromPageX],
  );

  const thumbCenter =
    trackWidth > 0
      ? Math.round(((clamped - MIN_AGE) / AGE_SPAN) * trackWidth)
      : 0;
  // Badge-Mitte = Thumb-Mitte (exakt dieselbe X-Position)
  const badgeLeft = thumbCenter - BADGE / 2;
  const thumbLeft = thumbCenter - THUMB_R;

  const bobY = bob.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -5],
  });

  return (
    <View style={styles.root}>
      <Animated.Text
        style={[styles.ageDisplay, { transform: [{ scale: bounce }] }]}
      >
        {clamped} {yearsLabel}
      </Animated.Text>

      <View style={styles.sliderStack}>
        <View style={styles.badgeRail} pointerEvents="none">
          {trackWidth > 0 ? (
            <Animated.View
              style={[
                styles.badgeSlot,
                {
                  left: badgeLeft,
                  opacity: fade,
                  transform: [{ translateY: bobY }],
                },
              ]}
            >
              <StageBadge age={clamped} />
              <View style={styles.stem} />
            </Animated.View>
          ) : null}
        </View>

        <View
          ref={trackRef}
          style={styles.trackHit}
          onLayout={(_e: LayoutChangeEvent) => measureTrack()}
          {...pan.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel={`${clamped} ${yearsLabel}`}
          accessibilityValue={{
            min: MIN_AGE,
            max: MAX_AGE,
            now: clamped,
          }}
        >
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: thumbCenter }]} />
          </View>
          <View
            style={[styles.thumb, { left: thumbLeft }]}
            pointerEvents="none"
          >
            <View style={styles.thumbInner} />
          </View>
        </View>
      </View>

      <View style={[styles.ends, { paddingHorizontal: SIDE_PAD }]}>
        <Text style={styles.endLabel}>{MIN_AGE}</Text>
        <Text style={styles.endLabel}>{MAX_AGE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    overflow: 'visible',
  },
  ageDisplay: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: spacing.sm,
  },
  sliderStack: {
    paddingHorizontal: SIDE_PAD,
    overflow: 'visible',
  },
  badgeRail: {
    height: BADGE + 14,
    marginBottom: 2,
    overflow: 'visible',
  },
  badgeSlot: {
    position: 'absolute',
    bottom: 0,
    width: BADGE,
    alignItems: 'center',
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    backgroundColor: colors.bgElevated,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  badgeRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BADGE / 2,
    borderWidth: 3,
    borderColor: colors.accentSoft,
  },
  badgeIcon: {
    fontSize: 28,
    textAlign: 'center',
  },
  stem: {
    width: 2,
    height: 8,
    borderRadius: 1,
    backgroundColor: colors.border,
    marginTop: 2,
  },
  trackHit: {
    height: 40,
    justifyContent: 'center',
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
    opacity: 0.85,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_R * 2,
    height: THUMB_R * 2,
    borderRadius: THUMB_R,
    backgroundColor: colors.bgElevated,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    top: 6,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  thumbInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  ends: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  endLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
