import React, { useEffect, useMemo, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { startVoiceBuffer } from '../services/AudioVoiceService';
import { enableCartesiaProductMode } from '../services/ttsService';
import { voicePreloader } from '../services/tts/voicePreloader';
import type { VoiceId } from '../types/userProfile';

export const SPLASH_BG = '#18181B';
export const SPLASH_GOLD = '#FCC70A';
export const SPLASH_GOLD_SOFT = 'rgba(252, 199, 10, 0.55)';

const MIN_SPLASH_MS = 2200;
const FADE_OUT_MS = 520;
const ICON_SIZE = 132;

type Props = {
  onFinish: () => void;
  priorityVoiceId?: VoiceId;
};

function RadarRing({
  progress,
  index,
}: {
  progress: SharedValue<number>;
  index: number;
}) {
  const style = useAnimatedStyle(() => {
    const local = (progress.value + index * 0.33) % 1;
    return {
      opacity: interpolate(
        local,
        [0, 0.15, 0.7, 1],
        [0, 0.45, 0.12, 0],
        Extrapolation.CLAMP,
      ),
      transform: [
        {
          scale: interpolate(
            local,
            [0, 1],
            [0.55, 2.15],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  return <Animated.View pointerEvents="none" style={[styles.ring, style]} />;
}

function BrandLetter({
  char,
  index,
  progress,
}: {
  char: string;
  index: number;
  progress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const start = 0.08 + index * 0.055;
    const t = interpolate(
      progress.value,
      [start, start + 0.22],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: t,
      transform: [
        { translateY: interpolate(t, [0, 1], [18, 0], Extrapolation.CLAMP) },
        { scale: interpolate(t, [0, 1], [0.82, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Animated.Text style={[styles.brandLetter, style]}>{char}</Animated.Text>
  );
}

export function SplashScreenController({
  onFinish,
  priorityVoiceId = 'alina',
}: Props) {
  const finishedRef = useRef(false);
  const logoScale = useSharedValue(0.55);
  const logoOpacity = useSharedValue(0);
  const logoFloat = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  const radar = useSharedValue(0);
  const brandProgress = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);
  const taglineX = useSharedValue(14);
  const horizon = useSharedValue(0);
  const ambient = useSharedValue(0);
  const containerOpacity = useSharedValue(1);

  const letters = useMemo(() => 'Findus'.split(''), []);

  const finishOnce = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish();
  };

  const fadeOutAndFinish = () => {
    containerOpacity.value = withTiming(
      0,
      { duration: FADE_OUT_MS, easing: Easing.in(Easing.cubic) },
      (done) => {
        if (done) runOnJS(finishOnce)();
      },
    );
  };

  useEffect(() => {
    enableCartesiaProductMode();
    startVoiceBuffer({ speechRate: 1, priorityVoiceId });

    // Ambient orbs breathe
    ambient.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );

    // Radar / Geofence rings
    radar.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.linear }),
      -1,
      false,
    );

    // Horizon draw
    horizon.value = withDelay(
      180,
      withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }),
    );

    // Logo entrance
    logoOpacity.value = withTiming(1, {
      duration: 520,
      easing: Easing.out(Easing.cubic),
    });
    logoScale.value = withSequence(
      withTiming(1.08, {
        duration: 680,
        easing: Easing.out(Easing.back(1.35)),
      }),
      withTiming(1, { duration: 280, easing: Easing.inOut(Easing.quad) }),
    );

    // Soft float after settle
    logoFloat.value = withDelay(
      900,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0, {
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      ),
    );

    glowPulse.value = withDelay(
      400,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: 900,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0.35, {
            duration: 900,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      ),
    );

    brandProgress.value = withDelay(
      380,
      withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }),
    );

    taglineOpacity.value = withDelay(
      980,
      withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) }),
    );
    taglineX.value = withDelay(
      980,
      withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) }),
    );

    const startedAt = Date.now();
    let cancelled = false;

    void (async () => {
      try {
        await voicePreloader.warmActiveVoice(priorityVoiceId);
      } catch (err) {
        console.warn('[splash] VoicePreloader-Warmup:', err);
      }
      if (cancelled) return;

      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
      await new Promise((resolve) => setTimeout(resolve, remaining));
      if (cancelled) return;

      fadeOutAndFinish();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityVoiceId]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [
      { scale: logoScale.value },
      {
        translateY: interpolate(
          logoFloat.value,
          [0, 1],
          [0, -7],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      glowPulse.value,
      [0, 1],
      [0.22, 0.55],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        scale: interpolate(
          glowPulse.value,
          [0, 1],
          [0.92, 1.18],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
    transform: [{ translateX: taglineX.value }],
  }));

  const horizonStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      horizon.value,
      [0, 0.3, 1],
      [0, 0.7, 0.35],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        scaleX: interpolate(
          horizon.value,
          [0, 1],
          [0.08, 1],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const ambientAStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      ambient.value,
      [0, 1],
      [0.14, 0.28],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        translateY: interpolate(
          ambient.value,
          [0, 1],
          [0, -18],
          Extrapolation.CLAMP,
        ),
      },
      {
        scale: interpolate(
          ambient.value,
          [0, 1],
          [1, 1.08],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const ambientBStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      ambient.value,
      [0, 1],
      [0.2, 0.1],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        translateX: interpolate(
          ambient.value,
          [0, 1],
          [0, 22],
          Extrapolation.CLAMP,
        ),
      },
      {
        scale: interpolate(
          ambient.value,
          [0, 1],
          [1.05, 0.95],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  return (
    <Animated.View style={[styles.root, containerStyle]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.ambientOrb, styles.ambientA, ambientAStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.ambientOrb, styles.ambientB, ambientBStyle]}
      />

      <View style={styles.stage}>
        <RadarRing progress={radar} index={0} />
        <RadarRing progress={radar} index={1} />
        <RadarRing progress={radar} index={2} />

        <Animated.View pointerEvents="none" style={[styles.glow, glowStyle]} />

        <Animated.View style={[styles.logoWrap, logoStyle]}>
          <Image
            source={require('../../assets/adaptive-icon.png')}
            style={styles.icon}
            accessibilityLabel="Findus Logo"
          />
        </Animated.View>
      </View>

      <Animated.View style={[styles.horizon, horizonStyle]} />

      <View style={styles.brandRow} accessibilityRole="text">
        {letters.map((char, index) => (
          <BrandLetter
            key={`${char}-${index}`}
            char={char}
            index={index}
            progress={brandProgress}
          />
        ))}
      </View>

      <Animated.View style={taglineStyle}>
        <Text style={styles.tagline}>Dein intelligenter Guide</Text>
        <Text style={styles.subline}>Stadt · Stimme · unterwegs</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    overflow: 'hidden',
  },
  ambientOrb: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(252, 199, 10, 0.09)',
  },
  ambientA: {
    top: '12%',
    left: '-18%',
  },
  ambientB: {
    bottom: '8%',
    right: '-22%',
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  stage: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  ring: {
    position: 'absolute',
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 1.5,
    borderColor: SPLASH_GOLD_SOFT,
  },
  glow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(252, 199, 10, 0.22)',
  },
  logoWrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: SPLASH_BG,
    borderWidth: 1,
    borderColor: 'rgba(252, 199, 10, 0.28)',
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
  horizon: {
    width: 168,
    height: 2,
    borderRadius: 2,
    backgroundColor: SPLASH_GOLD,
    marginBottom: 22,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  brandLetter: {
    color: SPLASH_GOLD,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: 0.8,
    textShadowColor: 'rgba(252, 199, 10, 0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  tagline: {
    marginTop: 10,
    color: 'rgba(252, 199, 10, 0.88)',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.25,
    textAlign: 'center',
  },
  subline: {
    marginTop: 6,
    color: 'rgba(244, 239, 230, 0.45)',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
});
