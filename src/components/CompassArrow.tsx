import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Reanimated, {
  Easing as ReEasing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../constants/theme';
import { useFinnusStore } from '../store/useFinnusStore';
import { fadeAndStopNavigation } from '../services/navigation/navigationService';

function unwrapToward(current: number, target: number): number {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return current + delta;
}

/** Eigene Datei: Worklets dürfen nicht neben Store-Feldern wie navRouteLoading leben. */
export const CompassArrow = React.memo(function CompassArrow() {
  const navBearingRel = useFinnusStore((s) => s.navBearingRel);
  const attentionCue = useFinnusStore((s) => s.attentionCue);

  const rotation = useSharedValue(0);
  const rotationAbsRef = useRef(0);

  useEffect(() => {
    let deg = navBearingRel ?? 0;
    if (attentionCue === 'left') deg = -90;
    else if (attentionCue === 'right') deg = 90;
    else if (attentionCue === 'behind') deg = 180;
    const prev = rotationAbsRef.current;
    const unwrapped = unwrapToward(prev, deg);
    const jump = Math.abs(unwrapped - prev);
    rotationAbsRef.current = unwrapped;
    const duration = jump >= 20 ? 28 : jump >= 8 ? 48 : 72;
    rotation.value = withTiming(unwrapped, {
      duration,
      easing: ReEasing.out(ReEasing.cubic),
    });
  }, [navBearingRel, attentionCue, rotation]);

  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Pressable
      onLongPress={() => {
        void import('../services/onboarding/uiCoachMarks').then((m) =>
          m.onUserCancelledNavLongPress(),
        );
        void fadeAndStopNavigation();
      }}
      delayLongPress={3000}
      style={StyleSheet.absoluteFill}
    >
      <Reanimated.View
        style={[styles.arrowWrap, arrowStyle, StyleSheet.absoluteFill]}
      >
        <Text style={styles.arrowGlyph}>↑</Text>
      </Reanimated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  arrowWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowGlyph: {
    fontSize: 44,
    fontWeight: '700',
    color: colors.bg,
    marginTop: -4,
  },
});
