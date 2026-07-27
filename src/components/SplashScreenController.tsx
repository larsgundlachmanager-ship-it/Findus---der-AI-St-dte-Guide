import React, { useEffect, useRef } from 'react';
import { Image, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { startVoiceBuffer } from '../services/AudioVoiceService';
import { enablePiperProductMode } from '../services/ttsService';
import { voicePreloader } from '../services/tts/voicePreloader';
import type { VoiceId } from '../types/userProfile';

export const SPLASH_BG = '#18181B';
export const SPLASH_GOLD = '#FACC15';

const MIN_SPLASH_MS = 1500;
const FADE_OUT_MS = 450;
const ICON_SIZE = 128;

type Props = {
  onFinish: () => void;
  priorityVoiceId?: VoiceId;
};

export function SplashScreenController({
  onFinish,
  priorityVoiceId = 'standard_m',
}: Props) {
  const finishedRef = useRef(false);
  const logoScale = useSharedValue(0.82);
  const logoOpacity = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);
  const containerOpacity = useSharedValue(1);

  const finishOnce = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish();
  };

  const fadeOutAndFinish = () => {
    containerOpacity.value = withTiming(
      0,
      { duration: FADE_OUT_MS, easing: Easing.out(Easing.cubic) },
      (done) => {
        if (done) {
          runOnJS(finishOnce)();
        }
      },
    );
  };

  useEffect(() => {
    enablePiperProductMode();
    startVoiceBuffer({ speechRate: 1, priorityVoiceId });

    logoOpacity.value = withTiming(1, {
      duration: 700,
      easing: Easing.out(Easing.cubic),
    });
    logoScale.value = withTiming(1, {
      duration: 900,
      easing: Easing.out(Easing.back(1.1)),
    });
    taglineOpacity.value = withDelay(
      520,
      withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }),
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
    transform: [{ scale: logoScale.value }],
  }));

  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
    transform: [{ translateY: (1 - taglineOpacity.value) * 10 }],
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
  }));

  return (
    <Animated.View style={[styles.root, containerStyle]}>
      <Animated.View style={[styles.logoWrap, logoStyle]}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.icon}
          accessibilityLabel="Findus Logo"
        />
      </Animated.View>
      <Animated.View style={taglineStyle}>
        <Text style={styles.brand}>Findus</Text>
        <Text style={styles.tagline}>Dein intelligenter Guide</Text>
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
  },
  logoWrap: {
    marginBottom: 28,
    borderRadius: 28,
    overflow: 'hidden',
    shadowColor: SPLASH_GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: 28,
  },
  brand: {
    color: SPLASH_GOLD,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tagline: {
    marginTop: 8,
    color: 'rgba(250, 204, 21, 0.82)',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
});
