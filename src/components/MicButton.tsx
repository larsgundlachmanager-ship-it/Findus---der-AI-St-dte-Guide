import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Reanimated, {
  Easing,
  cancelAnimation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { colors, presenceIdleColor, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { useFinnusStore } from '../store/useFinnusStore';
import type { FindusMood } from './AudioWave';
import {
  loadMicHintPrefs,
  markMicHoldUsed,
  markMicLockUsed,
  markMicTapUsed,
} from '../services/ui/micHintPrefs';
import {
  bootstrapUiCoachMarks,
  markUiCoachDone,
} from '../services/onboarding/uiCoachMarks';
import { useUiScaleStore } from '../services/ui/uiScale';
import { HOME_MIC_HIT_PAD } from './liveStage';
import { getLastMicLevel } from '../services/sttService';
import {
  resolveMicHoldSwipe,
  resolveMicHoldSwipeOnRelease,
} from './micHoldGesture';
import * as Haptics from 'expo-haptics';

/** Yorro-Mund — nur sichtbar während TTS. */
function MouthIcon({ size, color }: { size: number; color: string }) {
  const w = size;
  const h = Math.round(size * 0.62);
  return (
    <View
      style={{
        width: w,
        height: h,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={{
          width: Math.round(w * 0.98),
          height: Math.round(h * 0.88),
          borderRadius: Math.round(h),
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: Math.round(w * 0.52),
          height: Math.round(h * 0.36),
          borderRadius: Math.round(h * 0.25),
          backgroundColor: '#0A1814',
          top: Math.round(h * 0.32),
        }}
      />
    </View>
  );
}

/** Visuelle Mic-Zustände (Priorität: listening/locked > thinking > speaking > idle). */
export type MicVisualState = 'idle' | 'thinking' | 'speaking' | 'listening' | 'locked';

const STATE_INDEX: Record<MicVisualState, number> = {
  idle: 0,
  thinking: 1,
  speaking: 2,
  listening: 3,
  locked: 4,
};

const LOCK_ORANGE = '#c45a2a';

const STATE_COLORS = [
  colors.online,
  colors.thinking,
  colors.accent,
  colors.danger,
  LOCK_ORANGE,
] as const;

const LEVEL_BAR_COUNT = 5;
const LEVEL_POLL_MS = 90;
const COLOR_BLEND_MS = 120;
const ICON_BLEND_MS = 280;
const THINK_PULSE_MS = 900;
const SPIN_MS = 980;

interface Props {
  onPressIn: () => void;
  onPressOut: () => void;
  /** Während Halten nach rechts wischen → Aufnahme fixieren. */
  onSwipeLock?: () => void;
  /** Während Halten nach links wischen → Live-Chat. */
  onSwipeLiveChat?: () => void;
  isListening: boolean;
  /** Fixiert: Finger los, Mikro läuft weiter. */
  isMicLocked?: boolean;
  isFinalizing?: boolean;
  isGenerating: boolean;
  /** Live-TTS — Spinner nur dann + beim Nachdenken */
  isSpeaking?: boolean;
  /** Yorro-Stimmung steuert die Mic-Farbe. */
  mood?: FindusMood;
  /** Doppel-Tipp während Denken/Sprechen → Abbruch */
  onAbortBusy?: () => void;
  /** @deprecated Wird nicht mehr angezeigt — nur noch intern für STT. */
  partialText?: string;
  /** Kleineres Mic, kein Hint-Text — z. B. Plan-Kalender */
  compact?: boolean;
}

function resolveMicVisualState(opts: {
  isListening: boolean;
  isMicLocked: boolean;
  isSpeaking: boolean;
  isGenerating: boolean;
  isFinalizing: boolean;
  mood?: FindusMood;
}): MicVisualState {
  // Aufnahme schlägt Denken — sonst bleibt der Button blau während Lock/Hold.
  if (opts.isMicLocked) return 'locked';
  if (opts.isListening || opts.mood === 'listening') return 'listening';
  if (
    opts.isGenerating ||
    opts.isFinalizing ||
    opts.mood === 'thinking'
  ) {
    return 'thinking';
  }
  if (opts.isSpeaking || opts.mood === 'speaking') return 'speaking';
  return 'idle';
}

const LevelBar = React.memo(function LevelBar({
  heightSv,
  compact,
  maxHeight,
}: {
  heightSv: SharedValue<number>;
  compact: boolean;
  maxHeight: number;
}) {
  const style = useAnimatedStyle(() => ({
    height: interpolate(heightSv.value, [0, 1], [maxHeight * 0.2, maxHeight]),
    opacity: interpolate(heightSv.value, [0, 0.15, 1], [0.4, 0.75, 1]),
  }));
  return (
    <Reanimated.View
      style={[styles.levelBar, compact && styles.levelBarCompact, style]}
    />
  );
});

export const MicButton = React.memo(function MicButton({
  onPressIn,
  onPressOut,
  onSwipeLock,
  onSwipeLiveChat,
  isListening,
  isMicLocked = false,
  isFinalizing = false,
  isGenerating,
  isSpeaking = false,
  mood,
  onAbortBusy,
  compact = false,
}: Props) {
  const arrowSlide = useSharedValue(0);
  const arrowSlideLeft = useSharedValue(0);
  const stateProgress = useSharedValue(0);
  const pulse = useSharedValue(1);
  const thinkRing = useSharedValue(0);
  const speakRingA = useSharedValue(0);
  const speakRingB = useSharedValue(0);
  const speakRingC = useSharedValue(0);
  const levelSmooth = useSharedValue(0);
  const levelFallback = useSharedValue(0);
  const bar0 = useSharedValue(0.18);
  const bar1 = useSharedValue(0.18);
  const bar2 = useSharedValue(0.18);
  const bar3 = useSharedValue(0.18);
  const bar4 = useSharedValue(0.18);
  const barHeights = useMemo(
    () => [bar0, bar1, bar2, bar3, bar4],
    [bar0, bar1, bar2, bar3, bar4],
  );

  // Glyph-Layer: Mic | Spin | Mouth | Bars — soft crossfade
  const micOp = useSharedValue(1);
  const spinOp = useSharedValue(0);
  const mouthOp = useSharedValue(0);
  const barsOp = useSharedValue(0);
  const spinRot = useSharedValue(0);
  const mouthTalk = useSharedValue(1);

  const lastBusyTapRef = useRef(0);
  const findusPresence = useFinnusStore((s) => s.findusPresence);
  const idleTint = useSharedValue(presenceIdleColor(findusPresence));
  const pressHot = useSharedValue(0);
  const buttonMul = useUiScaleStore((s) => s.buttonMul);
  const btnSize = Math.round((compact ? 52 : 84) * buttonMul);
  const iconSize = Math.round((compact ? 22 : 30) * buttonMul);

  const visualState = resolveMicVisualState({
    isListening,
    isMicLocked,
    isSpeaking,
    isGenerating,
    isFinalizing,
    mood,
  });
  const busySpin = visualState === 'thinking' || visualState === 'speaking';
  const lockedRef = useRef(false);
  const gestureFiredRef = useRef(false);
  const lastDxRef = useRef(0);
  const lastDyRef = useRef(0);

  useEffect(() => {
    idleTint.value = presenceIdleColor(findusPresence);
  }, [findusPresence, idleTint]);

  useEffect(() => {
    lockedRef.current = isMicLocked;
    if (!isMicLocked) {
      gestureFiredRef.current = false;
    }
  }, [isMicLocked]);

  useEffect(() => {
    // Alte Prefs/Coach-Marks als erledigt markieren, damit nichts wieder auftaucht.
    void Promise.all([
      loadMicHintPrefs(),
      bootstrapUiCoachMarks(),
      markMicTapUsed(),
      markMicHoldUsed(),
      markMicLockUsed(),
      markUiCoachDone('mic'),
    ]).catch(() => undefined);
  }, []);

  // Farbe fließend zwischen Zuständen
  useEffect(() => {
    stateProgress.value = withTiming(STATE_INDEX[visualState], {
      duration: COLOR_BLEND_MS,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [visualState, stateProgress]);

  // Icon-Crossfade + Spin / Mouth-Talk
  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    const show = (target: MicVisualState) => {
      micOp.value = withTiming(target === 'idle' ? 1 : 0, {
        duration: ICON_BLEND_MS,
        easing: ease,
      });
      spinOp.value = withTiming(target === 'thinking' ? 1 : 0, {
        duration: ICON_BLEND_MS,
        easing: ease,
      });
      mouthOp.value = withTiming(target === 'speaking' ? 1 : 0, {
        duration: ICON_BLEND_MS,
        easing: ease,
      });
      barsOp.value = withTiming(
        target === 'listening' || target === 'locked' ? 1 : 0,
        {
          duration: ICON_BLEND_MS,
          easing: ease,
        },
      );
    };
    show(visualState);

    cancelAnimation(spinRot);
    cancelAnimation(mouthTalk);
    if (visualState === 'thinking') {
      spinRot.value = 0;
      spinRot.value = withRepeat(
        withTiming(1, { duration: SPIN_MS, easing: Easing.linear }),
        -1,
        false,
      );
      mouthTalk.value = withTiming(1, { duration: 160 });
    } else if (visualState === 'speaking') {
      spinRot.value = withTiming(spinRot.value, { duration: 1 });
      mouthTalk.value = withRepeat(
        withSequence(
          withTiming(1.18, {
            duration: 140,
            easing: Easing.out(Easing.quad),
          }),
          withTiming(0.82, {
            duration: 110,
            easing: Easing.in(Easing.quad),
          }),
          withTiming(1.12, {
            duration: 160,
            easing: Easing.out(Easing.quad),
          }),
          withTiming(0.88, { duration: 100 }),
          withTiming(1.08, {
            duration: 180,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(1, {
            duration: 200,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      );
    } else {
      spinRot.value = withTiming(spinRot.value % 1, { duration: 1 });
      mouthTalk.value = withTiming(1, { duration: 180 });
    }
  }, [visualState, micOp, spinOp, mouthOp, barsOp, spinRot, mouthTalk]);

  // Pulse / Ringe / Bars je Zustand — weiches Ein-/Ausblenden
  useEffect(() => {
    cancelAnimation(pulse);
    cancelAnimation(thinkRing);
    cancelAnimation(speakRingA);
    cancelAnimation(speakRingB);
    cancelAnimation(speakRingC);
    cancelAnimation(levelFallback);

    if (visualState === 'listening' || visualState === 'locked') {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 380, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 380, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
      thinkRing.value = 0;
      speakRingA.value = 0;
      speakRingB.value = 0;
      speakRingC.value = 0;
      levelFallback.value = withRepeat(
        withSequence(
          withTiming(0.35, { duration: 520, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.12, { duration: 480, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
      return;
    }

    if (visualState === 'speaking') {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 260, easing: Easing.inOut(Easing.quad) }),
          withTiming(1.02, { duration: 200 }),
          withTiming(1.14, { duration: 300, easing: Easing.out(Easing.quad) }),
          withTiming(1, { duration: 240 }),
        ),
        -1,
        false,
      );
      thinkRing.value = withTiming(0, { duration: 200 });
      levelSmooth.value = withTiming(0, { duration: 200 });
      levelFallback.value = withTiming(0, { duration: 200 });
      speakRingA.value = 0;
      speakRingB.value = 0;
      speakRingC.value = 0;
      const makeRing = (delay: number) =>
        withRepeat(
          withSequence(
            withTiming(0, { duration: Math.max(1, delay) }),
            withTiming(1, {
              duration: 1050,
              easing: Easing.out(Easing.cubic),
            }),
            withTiming(0, { duration: 1 }),
          ),
          -1,
          false,
        );
      speakRingA.value = makeRing(1);
      speakRingB.value = makeRing(360);
      speakRingC.value = makeRing(720);
      return;
    }

    if (visualState === 'thinking') {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.08, {
            duration: THINK_PULSE_MS,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(1, {
            duration: THINK_PULSE_MS,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      );
      thinkRing.value = 0;
      thinkRing.value = withRepeat(
        withSequence(
          withTiming(1, {
            duration: 1400,
            easing: Easing.out(Easing.cubic),
          }),
          withTiming(0, { duration: 1 }),
        ),
        -1,
        false,
      );
      speakRingA.value = withTiming(0, { duration: 220 });
      speakRingB.value = withTiming(0, { duration: 220 });
      speakRingC.value = withTiming(0, { duration: 220 });
      levelSmooth.value = withTiming(0, { duration: 200 });
      levelFallback.value = withTiming(0, { duration: 200 });
      return;
    }

    // idle
    pulse.value = withTiming(1, { duration: COLOR_BLEND_MS });
    thinkRing.value = withTiming(0, { duration: 250 });
    speakRingA.value = withTiming(0, { duration: 220 });
    speakRingB.value = withTiming(0, { duration: 220 });
    speakRingC.value = withTiming(0, { duration: 220 });
    levelSmooth.value = withTiming(0, { duration: 220 });
    levelFallback.value = withTiming(0, { duration: 220 });
    for (const bar of barHeights) {
      bar.value = withTiming(0.12, { duration: 200 });
    }
  }, [
    visualState,
    pulse,
    thinkRing,
    speakRingA,
    speakRingB,
    speakRingC,
    levelSmooth,
    levelFallback,
    barHeights,
  ]);

  // Live-Pegel aus STT volumechange → Bars
  useEffect(() => {
    if (visualState !== 'listening' && visualState !== 'locked') return;
    let hasRealSample = false;
    const tick = () => {
      const sample = getLastMicLevel();
      if (sample > 0.02) hasRealSample = true;
      const target = hasRealSample
        ? Math.max(0.08, sample)
        : Math.max(0.08, levelFallback.value);
      levelSmooth.value = withTiming(target, {
        duration: 70,
        easing: Easing.out(Easing.quad),
      });
      const mid = (LEVEL_BAR_COUNT - 1) / 2;
      for (let i = 0; i < LEVEL_BAR_COUNT; i++) {
        const dist = Math.abs(i - mid) / mid;
        const phase = 0.55 + 0.45 * (1 - dist);
        const jitter = 0.85 + 0.15 * Math.sin(Date.now() / (90 + i * 37) + i);
        const h = Math.min(1, target * phase * jitter);
        barHeights[i].value = withTiming(h, { duration: 75 });
      }
    };
    tick();
    const id = setInterval(tick, LEVEL_POLL_MS);
    return () => clearInterval(id);
  }, [visualState, levelSmooth, levelFallback, barHeights]);

  const showSwipeGuides = isListening && !isMicLocked && !compact;

  useEffect(() => {
    cancelAnimation(arrowSlide);
    cancelAnimation(arrowSlideLeft);
    if (!showSwipeGuides) {
      arrowSlide.value = 0;
      arrowSlideLeft.value = 0;
      return;
    }
    arrowSlide.value = withRepeat(
      withSequence(
        withTiming(10, { duration: 520, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 520, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    arrowSlideLeft.value = withRepeat(
      withSequence(
        withTiming(-10, { duration: 520, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 520, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [showSwipeGuides, arrowSlide, arrowSlideLeft]);

  const handlePressOut = useCallback(() => {
    pressHot.value = 0;
    onPressOut();
  }, [onPressOut, pressHot]);

  const fireHoldSwipe = useCallback(
    (kind: 'lock' | 'live') => {
      if (gestureFiredRef.current || lockedRef.current) return;
      gestureFiredRef.current = true;
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        /* soft */
      }
      if (kind === 'lock') {
        pressHot.value = 0;
        stateProgress.value = 4;
        onSwipeLock?.();
        return;
      }
      onSwipeLiveChat?.();
    },
    [onSwipeLock, onSwipeLiveChat, pressHot, stateProgress],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          gestureFiredRef.current = false;
          lastDxRef.current = 0;
          lastDyRef.current = 0;
          pressHot.value = 1;
          stateProgress.value = 3;
          barsOp.value = 1;
          micOp.value = 0;
          // Live-Chat: erster Tipp beendet — kein Busy-Doppel-Tipp davor.
          let liveOn = false;
          try {
            const {
              isLiveChatActive,
            } = require('../services/handsFree/liveChatSession') as {
              isLiveChatActive: () => boolean;
            };
            liveOn = isLiveChatActive();
          } catch {
            liveOn = false;
          }
          if (
            !liveOn &&
            onAbortBusy &&
            (mood === 'thinking' || mood === 'speaking' || busySpin) &&
            !isListening &&
            !isMicLocked
          ) {
            const now = Date.now();
            if (now - lastBusyTapRef.current < 400) {
              lastBusyTapRef.current = 0;
              pressHot.value = 0;
              onAbortBusy();
              return;
            }
            lastBusyTapRef.current = now;
          }
          onPressIn();
        },
        onPanResponderMove: (_, g) => {
          lastDxRef.current = g.dx;
          lastDyRef.current = g.dy;
          const kind = resolveMicHoldSwipe(g.dx, g.dy);
          if (kind) fireHoldSwipe(kind);
        },
        onPanResponderRelease: () => {
          if (!gestureFiredRef.current && !lockedRef.current) {
            const kind = resolveMicHoldSwipeOnRelease(
              lastDxRef.current,
              lastDyRef.current,
            );
            if (kind) fireHoldSwipe(kind);
          }
          handlePressOut();
        },
        onPanResponderTerminate: () => {
          handlePressOut();
        },
      }),
    [
      handlePressOut,
      onPressIn,
      fireHoldSwipe,
      onAbortBusy,
      mood,
      busySpin,
      isListening,
      isMicLocked,
      pressHot,
      stateProgress,
      barsOp,
      micOp,
    ],
  );

  const buttonAnimStyle = useAnimatedStyle(() => {
    const locked = isMicLocked;
    const idx = locked ? 4 : pressHot.value > 0.5 ? 3 : stateProgress.value;
    const bg = interpolateColor(
      idx,
      [0, 1, 2, 3, 4],
      [
        idleTint.value,
        STATE_COLORS[1],
        STATE_COLORS[2],
        STATE_COLORS[3],
        STATE_COLORS[4],
      ],
    );
    return {
      backgroundColor: bg,
      transform: [{ scale: pulse.value }],
    };
  });

  const thinkRingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(thinkRing.value, [0, 0.2, 1], [0, 0.45, 0]),
    transform: [
      {
        scale: interpolate(thinkRing.value, [0, 1], [0.92, 1.48]),
      },
    ],
  }));

  const speakRingStyleA = useAnimatedStyle(() => ({
    opacity: interpolate(speakRingA.value, [0, 0.01, 0.15, 1], [0, 0.55, 0.35, 0]),
    transform: [
      { scale: interpolate(speakRingA.value, [0, 1], [0.92, 1.55]) },
    ],
  }));
  const speakRingStyleB = useAnimatedStyle(() => ({
    opacity: interpolate(speakRingB.value, [0, 0.01, 0.15, 1], [0, 0.5, 0.28, 0]),
    transform: [
      { scale: interpolate(speakRingB.value, [0, 1], [0.92, 1.55]) },
    ],
  }));
  const speakRingStyleC = useAnimatedStyle(() => ({
    opacity: interpolate(speakRingC.value, [0, 0.01, 0.15, 1], [0, 0.45, 0.22, 0]),
    transform: [
      { scale: interpolate(speakRingC.value, [0, 1], [0.92, 1.55]) },
    ],
  }));

  const micGlyphStyle = useAnimatedStyle(() => ({
    opacity: micOp.value,
    transform: [
      { scale: interpolate(micOp.value, [0, 1], [0.72, 1]) },
      { rotate: `${interpolate(micOp.value, [0, 1], [-12, 0])}deg` },
    ],
  }));
  const spinGlyphStyle = useAnimatedStyle(() => ({
    opacity: spinOp.value,
    transform: [
      { scale: interpolate(spinOp.value, [0, 1], [0.55, 1]) },
      { rotate: `${spinRot.value * 360}deg` },
    ],
  }));
  const mouthGlyphStyle = useAnimatedStyle(() => ({
    opacity: mouthOp.value,
    transform: [
      { scale: interpolate(mouthOp.value, [0, 1], [0.65, 1]) },
      { scaleY: mouthTalk.value },
    ],
  }));
  const levelWrapStyle = useAnimatedStyle(() => ({
    opacity: barsOp.value,
    transform: [{ scale: interpolate(barsOp.value, [0, 1], [0.8, 1]) }],
  }));

  const arrowRightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: arrowSlide.value }],
  }));
  const arrowLeftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: arrowSlideLeft.value }],
  }));

  const ringBox = {
    width: btnSize + 18,
    height: btnSize + 18,
    borderRadius: (btnSize + 18) / 2,
  };
  const spinSize = Math.round(iconSize * 1.15);

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={styles.micCluster}>
        {/* Thinking: blauer Atem-Ring */}
        <Reanimated.View
          pointerEvents="none"
          style={[
            styles.speakRing,
            ringBox,
            { borderColor: colors.thinking },
            thinkRingStyle,
          ]}
        />
        {/* Speaking: Wellen-Ringe */}
        <Reanimated.View
          pointerEvents="none"
          style={[
            styles.speakRing,
            ringBox,
            { borderColor: colors.accent },
            speakRingStyleA,
          ]}
        />
        <Reanimated.View
          pointerEvents="none"
          style={[
            styles.speakRing,
            ringBox,
            { borderColor: colors.accent },
            speakRingStyleB,
          ]}
        />
        <Reanimated.View
          pointerEvents="none"
          style={[
            styles.speakRing,
            ringBox,
            { borderColor: colors.accent },
            speakRingStyleC,
          ]}
        />

        <View
          {...panResponder.panHandlers}
          style={{
            width: btnSize + HOME_MIC_HIT_PAD,
            height: btnSize + HOME_MIC_HIT_PAD,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessibilityRole="button"
          accessibilityLabel={
            visualState === 'locked'
              ? 'Mikro fixiert — tippen zum Senden'
              : visualState === 'listening'
                ? 'Mikro an — rechts wischen fixiert, links Live-Chat, loslassen sendet'
                : visualState === 'speaking'
                  ? 'Yorro spricht — halten zum Unterbrechen, tippen zum Schreiben'
                  : visualState === 'thinking'
                    ? 'Yorro denkt nach — halten zum Sprechen, 2× tippen zum Stoppen'
                    : 'Mikrofon — halten spricht, tippen schreibt, rechts fixieren, links Live-Chat'
          }
          accessibilityState={{ busy: isListening || busySpin }}
        >
        <Reanimated.View
          style={[
            styles.button,
            compact && styles.buttonCompact,
            {
              width: btnSize,
              height: btnSize,
              borderRadius: btnSize / 2,
            },
            isMicLocked && styles.buttonLocked,
            busySpin && styles.buttonInterrupt,
            buttonAnimStyle,
          ]}
        >
          {/* Idle: Mikrofon */}
          <Reanimated.View
            pointerEvents="none"
            style={[styles.glyphLayer, micGlyphStyle]}
          >
            <Feather name="mic" size={iconSize} color={colors.bg} />
          </Reanimated.View>

          {/* Thinking (blau): drehendes Rad */}
          <Reanimated.View
            pointerEvents="none"
            style={[styles.glyphLayer, spinGlyphStyle]}
          >
            <View
              style={[
                styles.spinWheel,
                {
                  width: spinSize,
                  height: spinSize,
                  borderRadius: spinSize / 2,
                  borderWidth: Math.max(3, Math.round(spinSize * 0.14)),
                },
              ]}
            />
          </Reanimated.View>

          {/* Speaking: Mund (redet) */}
          <Reanimated.View
            pointerEvents="none"
            style={[styles.glyphLayer, mouthGlyphStyle]}
          >
            <MouthIcon size={iconSize + 2} color={colors.bg} />
          </Reanimated.View>

          {/* Listening: Pegel-Bars */}
          <Reanimated.View
            pointerEvents="none"
            style={[
              styles.levelBars,
              compact && styles.levelBarsCompact,
              levelWrapStyle,
            ]}
          >
            {barHeights.map((bar, i) => (
              <LevelBar
                key={`lvl-${i}`}
                heightSv={bar}
                compact={compact}
                maxHeight={compact ? 14 : 22}
              />
            ))}
          </Reanimated.View>
        </Reanimated.View>
        </View>

        {showSwipeGuides ? (
          <Reanimated.View
            pointerEvents="none"
            style={[
              styles.lockGuide,
              styles.liveGuide,
              {
                right: btnSize + spacing.sm,
              },
              arrowLeftStyle,
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={styles.lockArrowRow}>
              <Feather
                name="message-circle"
                size={Math.round(16 * buttonMul)}
                color={colors.accent}
                style={styles.lockIcon}
              />
              <Feather
                name="arrow-left"
                size={Math.round(22 * buttonMul)}
                color={colors.accent}
              />
            </View>
          </Reanimated.View>
        ) : null}

        {showSwipeGuides ? (
          <Reanimated.View
            pointerEvents="none"
            style={[
              styles.lockGuide,
              {
                left: btnSize + spacing.sm,
              },
              arrowRightStyle,
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={styles.lockArrowRow}>
              <Feather name="arrow-right" size={Math.round(22 * buttonMul)} color={colors.accent} />
              <Feather
                name="lock"
                size={Math.round(16 * buttonMul)}
                color={colors.accent}
                style={styles.lockIcon}
              />
            </View>
          </Reanimated.View>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingBottom: 0,
    paddingTop: 0,
    zIndex: UI_LAYER.mic,
    elevation: UI_LAYER.mic,
  },
  wrapCompact: {
    paddingBottom: 0,
    paddingTop: 0,
  },
  micCluster: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakRing: {
    position: 'absolute',
    borderWidth: 2.5,
    backgroundColor: 'transparent',
  },
  button: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.online,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    overflow: 'visible',
  },
  buttonCompact: {
    width: 52,
    height: 52,
    borderRadius: 26,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  buttonLocked: {
    borderWidth: 3,
    borderColor: colors.text,
  },
  /** Still pressable — signals “tap to barge in”. */
  buttonInterrupt: {
    opacity: 0.92,
  },
  glyphLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinWheel: {
    borderColor: 'transparent',
    borderTopColor: colors.bg,
    borderRightColor: colors.bg,
  },
  levelBars: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3.5,
  },
  levelBarsCompact: {
    gap: 2.5,
  },
  levelBar: {
    width: 3.5,
    borderRadius: 2,
    backgroundColor: colors.bg,
    minHeight: 3,
  },
  levelBarCompact: {
    width: 2.5,
  },
  lockGuide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    minWidth: 110,
    paddingLeft: 2,
  },
  liveGuide: {
    alignItems: 'flex-end',
    paddingLeft: 0,
    paddingRight: 2,
  },
  lockArrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lockIcon: {
    marginLeft: 2,
  },
});
