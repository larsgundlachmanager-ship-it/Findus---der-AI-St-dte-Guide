import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { colors, spacing } from '../constants/theme';
import { useFinnusStore } from '../store/useFinnusStore';
import { fadeAndStopNavigation } from '../services/navigation/navigationService';
import {
  formatRemainingStations,
  isTransitMode,
} from '../services/navigation/transportMode';
import type { TransportMode } from '../services/navigation/navigationTypes';

export type FindusMood = 'idle' | 'listening' | 'thinking' | 'speaking';

const MOOD_LINE: Record<FindusMood, string> = {
  idle: 'Ich bin hier – bereit für dich',
  listening: 'Ich höre dich…',
  thinking: 'Einen Moment, ich denke nach…',
  speaking: 'Ich erzähle…',
};

const ARROW_SPRING = { damping: 22, stiffness: 95, mass: 0.85 };

function formatDistance(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatNavProgress(
  distanceM: number | null,
  transportMode: TransportMode | null,
  remainingStations: number | null,
): string {
  if (transportMode && isTransitMode(transportMode)) {
    return formatRemainingStations(remainingStations);
  }
  return formatDistance(distanceM);
}

function unwrapToward(current: number, target: number): number {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return current + delta;
}

/**
 * Eine durchgängige Findus-Präsenz.
 * Bei aktiver Navigation morph’t der Kreis zum Kompass-Pfeil.
 */
export function AudioWave({
  mood,
  compact,
}: {
  mood: FindusMood;
  /** Weniger Vertikalraum – Findus sitzt oben, Platz für Spickzettel darunter. */
  compact?: boolean;
}) {
  return <LivingPresence mood={mood} compact={compact} />;
}

function LivingPresence({
  mood,
  compact,
}: {
  mood: FindusMood;
  compact?: boolean;
}) {
  const navActive = useFinnusStore((s) => s.navActive);
  const navVisible = useFinnusStore((s) => s.navVisible);
  const navBearingRel = useFinnusStore((s) => s.navBearingRel);
  const navDistanceM = useFinnusStore((s) => s.navDistanceM);
  const transportMode = useFinnusStore((s) => s.transportMode);
  const remainingStations = useFinnusStore((s) => s.remainingStations);
  const attentionCue = useFinnusStore((s) => s.attentionCue);
  const findusPresence = useFinnusStore((s) => s.findusPresence);
  const navigating = navActive && navVisible;

  const float = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const spinBack = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const talk = useRef(new Animated.Value(0)).current;
  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;

  const rotation = useSharedValue(0);
  const rotationAbsRef = useRef(0);

  const speaking = mood === 'speaking';
  const tempo =
    mood === 'speaking'
      ? 0.55
      : mood === 'thinking'
        ? 0.7
        : mood === 'listening'
          ? 0.85
          : 1;

  const presenceColor =
    findusPresence === 'ok' ? colors.online : colors.offline;

  const accent = navigating
    ? colors.accent
    : mood === 'listening'
      ? colors.danger
      : mood === 'thinking'
        ? presenceColor
        : mood === 'speaking'
          ? presenceColor
          : presenceColor;

  useEffect(() => {
    let deg = navBearingRel ?? 0;
    if (attentionCue === 'left') deg = -90;
    else if (attentionCue === 'right') deg = 90;
    else if (attentionCue === 'behind') deg = 180;
    const unwrapped = unwrapToward(rotationAbsRef.current, deg);
    rotationAbsRef.current = unwrapped;
    rotation.value = withSpring(unwrapped, ARROW_SPRING);
  }, [navBearingRel, attentionCue, rotation]);

  useEffect(() => {
    if (navigating && !speaking) {
      float.setValue(0.5);
      breath.setValue(0.5);
      glow.setValue(0.6);
      spin.setValue(0);
      spinBack.setValue(0);
      return;
    }

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2800 * tempo,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2800 * tempo,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: (speaking ? 320 : 2000) * tempo,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: (speaking ? 280 : 2000) * tempo,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: (speaking ? 420 : 1600) * tempo,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: (speaking ? 380 : 1600) * tempo,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: (speaking ? 7000 : 14000) * tempo,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    const spinBackLoop = Animated.loop(
      Animated.timing(spinBack, {
        toValue: 1,
        duration: (speaking ? 11000 : 22000) * tempo,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    floatLoop.start();
    breathLoop.start();
    glowLoop.start();
    spinLoop.start();
    spinBackLoop.start();

    return () => {
      floatLoop.stop();
      breathLoop.stop();
      glowLoop.stop();
      spinLoop.stop();
      spinBackLoop.stop();
    };
  }, [breath, float, glow, navigating, speaking, spin, spinBack, tempo]);

  useEffect(() => {
    if (!speaking) {
      talk.setValue(0);
      ringA.setValue(0);
      ringB.setValue(0);
      return;
    }

    const talkLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(talk, {
          toValue: 1,
          duration: 140,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(talk, {
          toValue: 0.35,
          duration: 110,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(talk, {
          toValue: 0.85,
          duration: 160,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(talk, {
          toValue: 0.15,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(talk, {
          toValue: 0.7,
          duration: 180,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(talk, {
          toValue: 0,
          duration: 220,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.delay(120),
      ]),
    );

    const makeRing = (value: Animated.Value, delayMs: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(value, {
            toValue: 1,
            duration: 1100,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      );

    const ringLoopA = makeRing(ringA, 0);
    const ringLoopB = makeRing(ringB, 550);

    talkLoop.start();
    ringLoopA.start();
    ringLoopB.start();

    return () => {
      talkLoop.stop();
      ringLoopA.stop();
      ringLoopB.stop();
      talk.setValue(0);
      ringA.setValue(0);
      ringB.setValue(0);
    };
  }, [navigating, ringA, ringB, speaking, talk]);

  const translateY = float.interpolate({
    inputRange: [0, 1],
    outputRange: speaking ? [4, -6] : [8, -10],
  });

  const coreScale = Animated.multiply(
    breath.interpolate({
      inputRange: [0, 1],
      outputRange: speaking ? [0.94, 1.08] : [0.92, 1.05],
    }),
    talk.interpolate({
      inputRange: [0, 1],
      outputRange: [1, speaking ? 1.12 : 1],
    }),
  );

  const coreSquashY = talk.interpolate({
    inputRange: [0, 1],
    outputRange: [1, speaking ? 0.9 : 1],
  });
  const coreSquashX = talk.interpolate({
    inputRange: [0, 1],
    outputRange: [1, speaking ? 1.08 : 1],
  });

  const mouthScaleY = talk.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0.35, 0.75, 1.15],
  });
  const mouthOpacity = speaking
    ? talk.interpolate({
        inputRange: [0, 0.2, 1],
        outputRange: [0.25, 0.55, 0.85],
      })
    : 0;

  const haloScale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: (navigating && !speaking)
      ? [1.08, 1.08]
      : speaking
        ? [1.02, 1.22]
        : [0.96, 1.12],
  });
  const haloOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: (navigating && !speaking)
      ? [0.35, 0.35]
      : speaking
        ? [0.28, 0.55]
        : [0.18, 0.42],
  });

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const rotateBack = spinBack.interpolate({
    inputRange: [0, 1],
    outputRange: ['360deg', '0deg'],
  });

  const ringScaleA = ringA.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1.75],
  });
  const ringOpacityA = ringA.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0.45, 0.3, 0],
  });
  const ringScaleB = ringB.interpolate({
    inputRange: [0, 1],
    outputRange: [0.75, 1.9],
  });
  const ringOpacityB = ringB.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0.35, 0.22, 0],
  });

  const sparks = useMemo(
    () => [
      { size: 5, offset: 0 },
      { size: 4, offset: 120 },
      { size: 6, offset: 240 },
    ],
    [],
  );

  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const navProgress = formatNavProgress(
    navDistanceM,
    transportMode,
    remainingStations,
  );

  const moodLine = navigating
    ? attentionCue
      ? `Schau ${attentionCue === 'behind' ? 'zurück' : attentionCue === 'left' ? 'links' : 'rechts'}`
      : navProgress.startsWith('Noch')
        ? navProgress
        : `Noch ${navProgress}`
    : MOOD_LINE[mood];

  return (
    <View
      style={[styles.wrap, compact ? styles.wrapCompact : null]}
      accessibilityLabel={
        navigating
          ? `Kompass – ${navProgress}`
          : `Findus – ${MOOD_LINE[mood]}`
      }
    >
      <Animated.View
        style={[styles.presenceBlock, { transform: [{ translateY }] }]}
      >
        <View style={[styles.stage, compact ? styles.stageCompact : null]}>
          {speaking ? (
            <>
              <Animated.View
                style={[
                  styles.speechRing,
                  {
                    borderColor: accent,
                    opacity: ringOpacityA,
                    transform: [{ scale: ringScaleA }],
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.speechRing,
                  {
                    borderColor: accent,
                    opacity: ringOpacityB,
                    transform: [{ scale: ringScaleB }],
                  },
                ]}
              />
            </>
          ) : null}

          <Animated.View
            style={[
              styles.halo,
              {
                backgroundColor: accent,
                opacity: haloOpacity,
                transform: [{ scale: haloScale }],
              },
            ]}
          />

          {!navigating ? (
            <>
              <Animated.View style={[styles.orbit, { transform: [{ rotate }] }]}>
                {sparks.map((spark, i) => (
                  <View
                    key={i}
                    style={[
                      styles.sparkAnchor,
                      { transform: [{ rotate: `${spark.offset}deg` }] },
                    ]}
                  >
                    <View
                      style={[
                        styles.spark,
                        {
                          width: speaking ? spark.size + 2 : spark.size,
                          height: speaking ? spark.size + 2 : spark.size,
                          borderRadius:
                            (speaking ? spark.size + 2 : spark.size) / 2,
                          backgroundColor: accent,
                          marginTop: -78,
                          opacity: speaking ? 1 : 0.85,
                        },
                      ]}
                    />
                  </View>
                ))}
              </Animated.View>

              <Animated.View
                style={[
                  styles.orbitInner,
                  { transform: [{ rotate: rotateBack }] },
                ]}
              >
                <View
                  style={[
                    styles.sparkAnchor,
                    { transform: [{ rotate: '90deg' }] },
                  ]}
                >
                  <View
                    style={[
                      styles.sparkDim,
                      { backgroundColor: colors.wave, marginTop: -52 },
                    ]}
                  />
                </View>
                <View
                  style={[
                    styles.sparkAnchor,
                    { transform: [{ rotate: '270deg' }] },
                  ]}
                >
                  <View
                    style={[
                      styles.sparkDim,
                      { backgroundColor: colors.wave, marginTop: -52 },
                    ]}
                  />
                </View>
              </Animated.View>
            </>
          ) : (
            <Animated.View style={[styles.compassRing, { transform: [{ rotate }] }]} />
          )}

          <Animated.View
            style={[
              styles.core,
              navigating && styles.coreCompass,
              {
                backgroundColor: accent,
                shadowColor: accent,
                transform: navigating
                  ? [{ scale: speaking ? coreScale : 1.08 }]
                  : [
                      { scale: coreScale },
                      { scaleX: coreSquashX },
                      { scaleY: coreSquashY },
                    ],
              },
            ]}
          >
            {navigating ? (
              <Pressable
                onLongPress={fadeAndStopNavigation}
                delayLongPress={3000}
                style={StyleSheet.absoluteFill}
              >
                <Reanimated.View style={[styles.arrowWrap, arrowStyle, StyleSheet.absoluteFill]}>
                  <Text style={styles.arrowGlyph}>↑</Text>
                </Reanimated.View>
              </Pressable>
            ) : (
              <>
                <View style={styles.coreHighlight} />
                {speaking ? (
                  <Animated.View
                    style={[
                      styles.mouth,
                      {
                        opacity: mouthOpacity,
                        transform: [{ scaleY: mouthScaleY }],
                      },
                    ]}
                  />
                ) : null}
              </>
            )}
          </Animated.View>
        </View>

        <Text style={styles.name}>{navigating ? 'Kompass' : 'Findus'}</Text>
        {!navigating && findusPresence !== 'ok' ? (
          <View
            style={[
              styles.presenceBadge,
              { backgroundColor: colors.offline },
            ]}
          >
            <Text style={styles.presenceBadgeText}>
              {findusPresence === 'offline' ? 'Offline' : 'Eingeschränkt'}
            </Text>
          </View>
        ) : !navigating && findusPresence === 'ok' ? (
          <View
            style={[styles.presenceBadge, { backgroundColor: colors.online }]}
          >
            <Text style={styles.presenceBadgeText}>Online</Text>
          </View>
        ) : null}
        <Text style={styles.moodLine}>{moodLine}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrapCompact: {
    flex: 0,
    justifyContent: 'flex-start',
  },
  presenceBlock: {
    alignItems: 'center',
  },
  stage: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  stageCompact: {
    width: 168,
    height: 168,
    marginBottom: spacing.sm,
  },
  halo: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
  },
  speechRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
  },
  compassRing: {
    position: 'absolute',
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 3,
    borderColor: 'rgba(196, 163, 90, 0.45)',
    borderStyle: 'dashed',
  },
  orbit: {
    position: 'absolute',
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitInner: {
    position: 'absolute',
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkAnchor: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spark: {
    opacity: 0.85,
  },
  sparkDim: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.45,
  },
  core: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 14,
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  coreCompass: {
    justifyContent: 'center',
    paddingTop: 0,
    width: 88,
    height: 88,
    borderRadius: 44,
  },
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
  coreHighlight: {
    width: 22,
    height: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  mouth: {
    marginTop: 10,
    width: 18,
    height: 10,
    borderRadius: 9,
    backgroundColor: 'rgba(8, 18, 14, 0.55)',
  },
  name: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  presenceBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'center',
  },
  presenceBadgeText: {
    color: colors.bg,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  moodLine: {
    marginTop: 6,
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
