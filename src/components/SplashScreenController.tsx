import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Image, StyleSheet, Text, View } from 'react-native';
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
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { startVoiceBuffer } from '../services/AudioVoiceService';
import { enableCartesiaProductMode } from '../services/ttsService';
import { voicePreloader } from '../services/tts/voicePreloader';
import { APP_BRAND_NAME } from '../constants/brand';
import {
  SPLASH_BUILD_MS,
  SPLASH_HARD_FAILSAFE_MS,
  peekSplashSignals,
  waitForSplashReveal,
} from '../services/homeMap/splashReadyGate';
import type { VoiceId } from '../types/userProfile';

/** Sehr dunkel, aber nicht pechschwarz. */
export const SPLASH_BG = '#141416';
export const SPLASH_GOLD = '#FCC70A';
export const SPLASH_GOLD_SOFT = 'rgba(252, 199, 10, 0.5)';

const HOLD_SHIMMER_MS = 2_600;
const CURTAIN_MS = 980;
const LOGO_SIZE = 248;

const BRAND_TAGLINE = 'Kopfhörer rein. Die Stadt läuft mit.';
const BRAND_SUBLINE = 'Städtetrip · Audio-Guide';

const DETAILED_LOGO = require('../../assets/splash-logo-clear.png');

type Props = {
  onFinish: () => void;
  /** Vorhang startet — Chrome/Mic tippbar, Interactive Window. */
  onInteractive?: () => void;
  priorityVoiceId?: VoiceId;
};

type Landmark = {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0–1 innerhalb des Build-Progress */
  at: number;
  /** Von wo es einfliegt (px relativ) */
  fromX: number;
  fromY: number;
  fromRot: number;
};

/**
 * Landmarks fliegen einzeln ein und docken ans Y —
 * kein Strecken/Clip-Wachstum (das wirkte billig).
 */
const LANDMARKS: Landmark[] = [
  { key: 'path', x: 0.38, y: 0.48, w: 0.24, h: 0.4, at: 0.04, fromX: 0, fromY: 72, fromRot: 0 },
  // ORRO voll abdecken (oben/unten/seitlich — Tops der Buchstaben nicht clippen)
  { key: 'or-l', x: 0.02, y: 0.6, w: 0.4, h: 0.4, at: 0.1, fromX: -48, fromY: 54, fromRot: -10 },
  { key: 'or-r', x: 0.58, y: 0.6, w: 0.4, h: 0.4, at: 0.14, fromX: 48, fromY: 54, fromRot: 10 },
  { key: 'bridge', x: 0.36, y: 0.46, w: 0.28, h: 0.12, at: 0.2, fromX: 0, fromY: 48, fromRot: 0 },
  { key: 'colo', x: 0.32, y: 0.34, w: 0.36, h: 0.18, at: 0.28, fromX: -8, fromY: 64, fromRot: -6 },
  { key: 'trees', x: 0.34, y: 0.28, w: 0.16, h: 0.18, at: 0.34, fromX: -36, fromY: 52, fromRot: -8 },
  { key: 'dome', x: 0.44, y: 0.26, w: 0.18, h: 0.16, at: 0.38, fromX: 28, fromY: 48, fromRot: 7 },
  { key: 'l-city', x: 0.04, y: 0.28, w: 0.32, h: 0.28, at: 0.44, fromX: -78, fromY: 36, fromRot: -14 },
  { key: 'r-city', x: 0.64, y: 0.28, w: 0.32, h: 0.28, at: 0.5, fromX: 78, fromY: 36, fromRot: 14 },
  { key: 'l-towers', x: 0.06, y: 0.06, w: 0.3, h: 0.3, at: 0.58, fromX: -72, fromY: -56, fromRot: -16 },
  { key: 'r-tower', x: 0.64, y: 0.02, w: 0.3, h: 0.34, at: 0.64, fromX: 72, fromY: -60, fromRot: 16 },
  { key: 'l-tip', x: 0.12, y: 0.0, w: 0.18, h: 0.14, at: 0.72, fromX: -40, fromY: -68, fromRot: -12 },
  { key: 'r-tip', x: 0.7, y: 0.0, w: 0.18, h: 0.12, at: 0.76, fromX: 40, fromY: -68, fromRot: 12 },
];

function LandmarkPiece({
  item,
  progress,
}: {
  item: Landmark;
  progress: SharedValue<number>;
}) {
  const left = item.x * LOGO_SIZE;
  const top = item.y * LOGO_SIZE;
  const width = item.w * LOGO_SIZE;
  const height = item.h * LOGO_SIZE;

  const style = useAnimatedStyle(() => {
    const start = item.at;
    const end = Math.min(0.92, start + 0.11);
    const t = interpolate(
      progress.value,
      [start, end],
      [0, 1],
      Extrapolation.CLAMP,
    );
    // Ease-out cubic im Worklet — weiter fliegen + spürbarer Scale
    const e = 1 - Math.pow(1 - t, 3);
    const overshoot = interpolate(e, [0, 0.82, 1], [0, 1.08, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(t, [0, 0.12, 1], [0, 1, 1], Extrapolation.CLAMP),
      transform: [
        {
          translateX: interpolate(e, [0, 1], [item.fromX, 0], Extrapolation.CLAMP),
        },
        {
          translateY: interpolate(e, [0, 1], [item.fromY, 0], Extrapolation.CLAMP),
        },
        {
          scale: interpolate(e, [0, 1], [0.28, 1], Extrapolation.CLAMP) * overshoot,
        },
        {
          rotate: `${interpolate(e, [0, 1], [item.fromRot, 0], Extrapolation.CLAMP)}deg`,
        },
      ],
    };
  });

  const flashStyle = useAnimatedStyle(() => {
    const start = item.at;
    const end = Math.min(0.95, start + 0.08);
    const t = interpolate(
      progress.value,
      [start, start + 0.03, end],
      [0, 1, 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity: t * 0.55,
      transform: [{ scale: interpolate(t, [0, 1], [0.6, 1.35], Extrapolation.CLAMP) }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.landmarkWrap, { left, top, width, height }, style]}
    >
      <Animated.View pointerEvents="none" style={[styles.landmarkFlash, flashStyle]} />
      <View style={styles.landmarkClip}>
        <Image
          source={DETAILED_LOGO}
          style={{
            position: 'absolute',
            left: -left,
            top: -top,
            width: LOGO_SIZE,
            height: LOGO_SIZE,
          }}
          resizeMode="contain"
        />
      </View>
    </Animated.View>
  );
}

function Spark({
  progress,
  seed,
}: {
  progress: SharedValue<number>;
  seed: number;
}) {
  const angle = (seed * 47) % 360;
  const dist = 28 + (seed % 5) * 14;
  const cos = Math.cos((angle * Math.PI) / 180);
  const sin = Math.sin((angle * Math.PI) / 180);
  const style = useAnimatedStyle(() => {
    const wave = (progress.value * 2.2 + seed * 0.09) % 1;
    const alive = interpolate(progress.value, [0.05, 0.2, 0.85, 1], [0, 1, 1, 0]);
    const reach = interpolate(wave, [0, 1], [0.2, 1.15]);
    return {
      opacity: alive * interpolate(wave, [0, 0.3, 0.7, 1], [0, 0.9, 0.35, 0]),
      transform: [
        { translateX: cos * dist * reach },
        { translateY: sin * dist * reach - wave * 22 },
        { scale: interpolate(wave, [0, 0.5, 1], [0.3, 1.1, 0.4]) },
      ],
    };
  });

  return <Animated.View pointerEvents="none" style={[styles.spark, style]} />;
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
    const start = 0.06 + index * 0.07;
    const t = interpolate(
      progress.value,
      [start, start + 0.28],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: t,
      transform: [
        { translateY: interpolate(t, [0, 1], [14, 0], Extrapolation.CLAMP) },
        { scale: interpolate(t, [0, 1], [0.78, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Animated.Text style={[styles.brandLetter, style]}>{char}</Animated.Text>
  );
}

export function SplashScreenController({
  onFinish,
  onInteractive,
  priorityVoiceId = 'sebastian',
}: Props) {
  const finishedRef = useRef(false);
  /** Block chrome until curtain fade starts — then Mic/Settings tappable. */
  const [blockTouches, setBlockTouches] = useState(true);
  const interactiveNotifiedRef = useRef(false);
  const { width: winW, height: winH } = Dimensions.get('window');

  const build = useSharedValue(0);
  const logoSettle = useSharedValue(0);
  const piecesFade = useSharedValue(1);
  const logoFloat = useSharedValue(0);
  const glowPulse = useSharedValue(0);
  const brandProgress = useSharedValue(0);
  const casket = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);
  const taglineY = useSharedValue(12);
  const ambient = useSharedValue(0);
  const sweep = useSharedValue(0);
  const pulseRing = useSharedValue(0);
  const stageScale = useSharedValue(0.92);
  const contentOpacity = useSharedValue(1);
  const curtain = useSharedValue(0);

  const letters = useMemo(() => APP_BRAND_NAME.split(''), []);
  const sparkSeeds = useMemo(() => Array.from({ length: 14 }, (_, i) => i), []);

  const notifyInteractive = () => {
    if (interactiveNotifiedRef.current) return;
    interactiveNotifiedRef.current = true;
    try {
      onInteractive?.();
    } catch {
      /* soft */
    }
  };

  const finishOnce = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setBlockTouches(false);
    notifyInteractive();
    onFinish();
  };

  const playCurtainAndFinish = (maxCurtainMs = CURTAIN_MS) => {
    // Chrome (Mic/Settings) usable as soon as splash visually fades — not after full curtain.
    setBlockTouches(false);
    notifyInteractive();
    const dur = Math.max(120, Math.min(CURTAIN_MS, maxCurtainMs));
    contentOpacity.value = withTiming(0, {
      duration: Math.round(dur * 0.65),
      easing: Easing.in(Easing.cubic),
    });
    stageScale.value = withTiming(1.12, {
      duration: dur,
      easing: Easing.inOut(Easing.cubic),
    });
    curtain.value = withTiming(
      1,
      { duration: dur, easing: Easing.inOut(Easing.cubic) },
      (done) => {
        if (done) runOnJS(finishOnce)();
      },
    );
  };

  useEffect(() => {
    enableCartesiaProductMode();
    startVoiceBuffer({ speechRate: 1, priorityVoiceId });

    ambient.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );

    pulseRing.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.out(Easing.cubic) }),
      -1,
      false,
    );

    // Landmarks docken nacheinander an
    build.value = withTiming(1, {
      duration: SPLASH_BUILD_MS,
      easing: Easing.bezier(0.16, 0.84, 0.24, 1),
    });

    // Lichtschweif über fertiges Y
    sweep.value = withDelay(
      SPLASH_BUILD_MS - 500,
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
    );

    logoSettle.value = withDelay(
      SPLASH_BUILD_MS - 360,
      withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }),
    );
    piecesFade.value = withDelay(
      SPLASH_BUILD_MS - 120,
      withTiming(0, { duration: 380, easing: Easing.out(Easing.quad) }),
    );

    stageScale.value = withSequence(
      withSpring(1.03, { damping: 14, stiffness: 120 }),
      withTiming(1, { duration: 420, easing: Easing.inOut(Easing.quad) }),
    );

    logoFloat.value = withDelay(
      SPLASH_BUILD_MS,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );

    glowPulse.value = withDelay(
      300,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.35, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );

    casket.value = withDelay(
      SPLASH_BUILD_MS - 120,
      withSpring(1, { damping: 13, stiffness: 140 }),
    );
    brandProgress.value = withDelay(
      SPLASH_BUILD_MS - 40,
      withTiming(1, { duration: 640, easing: Easing.out(Easing.cubic) }),
    );
    // Text früh im Hold — soll ≥1 s lesbar stehen, bevor der Vorhang darf
    taglineOpacity.value = withDelay(
      SPLASH_BUILD_MS + 80,
      withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) }),
    );
    taglineY.value = withDelay(
      SPLASH_BUILD_MS + 80,
      withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }),
    );

    let cancelled = false;
    void voicePreloader.warmActiveVoice(priorityVoiceId).catch((err) => {
      console.warn('[splash] VoicePreloader-Warmup:', err);
    });
    void (async () => {
      try {
        await waitForSplashReveal();
      } catch (err) {
        console.warn('[splash] Ready-Gate:', err);
      }
      if (cancelled) return;
      const started = peekSplashSignals().startedAt;
      const elapsed = started ? Date.now() - started : 0;
      const remain = SPLASH_HARD_FAILSAFE_MS - elapsed;
      // Hart: Vorhang inkl. Curtain nie über 5 s — sonst sofort öffnen.
      if (remain <= 280) {
        finishOnce();
        return;
      }
      playCurtainAndFinish(Math.min(CURTAIN_MS, remain - 40));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityVoiceId]);

  const stageStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [
      { scale: stageScale.value },
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

  const piecesStyle = useAnimatedStyle(() => ({
    opacity: piecesFade.value,
  }));

  const settledLogoStyle = useAnimatedStyle(() => ({
    opacity: logoSettle.value,
    transform: [
      {
        scale: interpolate(logoSettle.value, [0, 1], [0.97, 1], Extrapolation.CLAMP),
      },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      glowPulse.value,
      [0, 1],
      [0.2, 0.55],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        scale: interpolate(
          glowPulse.value,
          [0, 1],
          [0.88, 1.2],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const ringStyle = useAnimatedStyle(() => {
    const t = pulseRing.value;
    return {
      opacity: interpolate(t, [0, 0.2, 1], [0.35, 0.2, 0], Extrapolation.CLAMP),
      transform: [
        { scale: interpolate(t, [0, 1], [0.55, 1.85], Extrapolation.CLAMP) },
      ],
    };
  });

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      sweep.value,
      [0, 0.25, 0.7, 1],
      [0, 0.45, 0.2, 0],
      Extrapolation.CLAMP,
    ),
    transform: [
      {
        translateX: interpolate(
          sweep.value,
          [0, 1],
          [-LOGO_SIZE * 0.7, LOGO_SIZE * 0.7],
          Extrapolation.CLAMP,
        ),
      },
      { rotate: '-22deg' },
    ],
  }));

  const casketStyle = useAnimatedStyle(() => {
    const t = casket.value;
    return {
      opacity: t,
      transform: [
        { translateY: interpolate(t, [0, 1], [18, 0], Extrapolation.CLAMP) },
        { scale: interpolate(t, [0, 1], [0.9, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value * contentOpacity.value,
    transform: [{ translateY: taglineY.value }],
  }));

  const ambientAStyle = useAnimatedStyle(() => ({
    opacity:
      contentOpacity.value *
      interpolate(ambient.value, [0, 1], [0.1, 0.22], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(ambient.value, [0, 1], [0, -14], Extrapolation.CLAMP),
      },
    ],
  }));

  const ambientBStyle = useAnimatedStyle(() => ({
    opacity:
      contentOpacity.value *
      interpolate(ambient.value, [0, 1], [0.16, 0.08], Extrapolation.CLAMP),
    transform: [
      {
        translateX: interpolate(ambient.value, [0, 1], [0, 18], Extrapolation.CLAMP),
      },
    ],
  }));

  const curtainTopStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          curtain.value,
          [0, 1],
          [0, -(winH * 0.56 + 28)],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const curtainBottomStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          curtain.value,
          [0, 1],
          [0, winH * 0.56 + 28],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  // Gold-Naht erst beim Vorhang-Öffnen — nicht schon während Branding-Hold.
  const curtainEdgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      curtain.value,
      [0, 0.04, 0.14, 0.55, 1],
      [0, 0.85, 1, 0.45, 0],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View style={styles.root} pointerEvents={blockTouches ? 'auto' : 'none'}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.curtainPanel,
          styles.curtainTop,
          { height: winH * 0.52 + 8, width: winW },
          curtainTopStyle,
        ]}
      >
        <Animated.View
          style={[styles.curtainGoldEdge, styles.curtainGoldBottom, curtainEdgeStyle]}
        />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.curtainPanel,
          styles.curtainBottom,
          { height: winH * 0.52 + 8, width: winW },
          curtainBottomStyle,
        ]}
      >
        <Animated.View
          style={[styles.curtainGoldEdge, styles.curtainGoldTop, curtainEdgeStyle]}
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[styles.ambientOrb, styles.ambientA, ambientAStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.ambientOrb, styles.ambientB, ambientBStyle]}
      />

      <Animated.View style={[styles.centerCol, stageStyle]}>
        {/* Logo exakt in Bildschirmmitte; Branding hängt darunter */}
        <View style={styles.logoCenterSlot}>
          <View style={styles.stage}>
            <Animated.View pointerEvents="none" style={[styles.pulseRing, ringStyle]} />
            <Animated.View pointerEvents="none" style={[styles.glow, glowStyle]} />

            <View style={styles.logoFrame}>
              <Animated.View style={[styles.piecesLayer, piecesStyle]}>
                {LANDMARKS.map((item) => (
                  <LandmarkPiece key={item.key} item={item} progress={build} />
                ))}
              </Animated.View>

              <Animated.View
                pointerEvents="none"
                style={[styles.settledLogo, settledLogoStyle]}
              >
                <Image
                  source={DETAILED_LOGO}
                  style={styles.logoImage}
                  accessibilityLabel={`${APP_BRAND_NAME} Logo`}
                  resizeMode="contain"
                />
                <Animated.View
                  pointerEvents="none"
                  style={[styles.sweepBand, sweepStyle]}
                />
              </Animated.View>

              <View style={styles.sparkHub} pointerEvents="none">
                {sparkSeeds.map((seed) => (
                  <Spark key={`spark-${seed}`} progress={build} seed={seed} />
                ))}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.brandBelow}>
          <Animated.View style={[styles.casket, casketStyle]}>
            <View style={styles.casketInner}>
              <View style={styles.casketJewel} />
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
              <View style={styles.casketJewel} />
            </View>
            <View style={styles.casketRail} />
          </Animated.View>

          <Animated.View style={taglineStyle}>
            <Text style={styles.tagline}>{BRAND_TAGLINE}</Text>
            <Text style={styles.subline}>{BRAND_SUBLINE}</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ambientOrb: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(252, 199, 10, 0.08)',
    zIndex: 3,
  },
  ambientA: {
    top: '10%',
    left: '-20%',
  },
  ambientB: {
    bottom: '6%',
    right: '-24%',
    width: 340,
    height: 340,
    borderRadius: 170,
  },
  centerCol: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    zIndex: 4,
  },
  logoCenterSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  brandBelow: {
    position: 'absolute',
    top: '50%',
    marginTop: LOGO_SIZE / 2 + 18,
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 28,
  },
  stage: {
    width: LOGO_SIZE + 120,
    height: LOGO_SIZE + 120,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  pulseRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 1.5,
    borderColor: 'rgba(252, 199, 10, 0.35)',
  },
  glow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(252, 199, 10, 0.22)',
  },
  logoFrame: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    overflow: 'visible',
    backgroundColor: 'transparent',
    zIndex: 2,
  },
  piecesLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'visible',
  },
  landmarkWrap: {
    position: 'absolute',
  },
  landmarkClip: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  landmarkFlash: {
    position: 'absolute',
    left: '15%',
    top: '15%',
    right: '15%',
    bottom: '15%',
    borderRadius: 40,
    backgroundColor: 'rgba(255, 230, 140, 0.7)',
  },
  settledLogo: {
    ...StyleSheet.absoluteFillObject,
  },
  logoImage: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  sweepBand: {
    position: 'absolute',
    top: -30,
    bottom: -30,
    width: 48,
    backgroundColor: 'rgba(255, 245, 200, 0.28)',
  },
  sparkHub: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spark: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: SPLASH_GOLD,
  },
  casket: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(252, 199, 10, 0.5)',
    backgroundColor: 'rgba(252, 199, 10, 0.06)',
    minWidth: 196,
    alignItems: 'center',
    overflow: 'hidden',
  },
  casketInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  casketJewel: {
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: SPLASH_GOLD,
    transform: [{ rotate: '45deg' }],
    opacity: 0.9,
    marginHorizontal: 12,
  },
  casketRail: {
    marginTop: 10,
    width: 72,
    height: 2,
    borderRadius: 2,
    backgroundColor: SPLASH_GOLD,
    opacity: 0.75,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  brandLetter: {
    color: SPLASH_GOLD,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 1.2,
    textShadowColor: 'rgba(252, 199, 10, 0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  tagline: {
    marginTop: 14,
    color: 'rgba(252, 199, 10, 0.88)',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.25,
    textAlign: 'center',
  },
  subline: {
    marginTop: 6,
    color: 'rgba(244, 239, 230, 0.45)',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  curtainPanel: {
    position: 'absolute',
    left: 0,
    backgroundColor: SPLASH_BG,
    zIndex: 1,
  },
  curtainTop: {
    top: 0,
  },
  curtainBottom: {
    bottom: 0,
  },
  curtainGoldEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: SPLASH_GOLD,
    shadowColor: SPLASH_GOLD,
    shadowOpacity: 0.65,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  curtainGoldBottom: {
    bottom: 0,
  },
  curtainGoldTop: {
    top: 0,
  },
});
