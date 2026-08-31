import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, presenceIdleColor, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { CompassArrow } from './CompassArrow';
import {
  selectNavRouteLoading,
  useFinnusStore,
} from '../store/useFinnusStore';
import type { FindusPresence } from '../store/useFinnusStore';
import {
  formatNavHudTitle,
  formatRemainingStations,
  isTransitMode,
} from '../services/navigation/transportMode';
import type { TransportMode } from '../services/navigation/navigationTypes';
import { getVoiceSettingsForTour } from '../services/ttsService';
import { speakAssistantText } from '../services/AudioVoiceService';
import {
  buildHealthStatusReply,
  evaluateFindusHealth,
} from '../services/findusHealthService';

export type FindusMood = 'idle' | 'followup' | 'listening' | 'thinking' | 'speaking';

const MOOD_LINE: Record<Exclude<FindusMood, 'idle' | 'followup'>, string> = {
  listening: 'Ich höre zu…',
  thinking: 'Einen Moment… · 2× tippen stoppt',
  speaking: 'Ich erzähle… · 2× tippen stoppt',
};

const PRESENCE_LINE: Record<FindusPresence, string> = {
  ok: 'Bereit — frag mich einfach',
  degraded: 'Bereit — tippe für Details',
  offline: 'Offline — lokale Funktionen',
};

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

function presenceAccent(presence: FindusPresence): string {
  return presenceIdleColor(presence);
}

const NavStatusLine = React.memo(function NavStatusLine() {
  const line = useFinnusStore((s) => {
    const place =
      s.navTargetName?.trim() ||
      s.multiStopTour?.stops[s.multiStopTour.currentIndex]?.name?.trim() ||
      'Ziel';
    const hint = s.navTurnHint?.trim();
    // Abbiegehinweis kurz, sonst nur 🚶/🚴 → Ort
    if (hint) return hint;
    const cue = s.attentionCue;
    if (cue === 'behind') return 'Schau zurück';
    if (cue === 'left') return 'Schau links';
    if (cue === 'right') return 'Schau rechts';
    if (s.transportMode && isTransitMode(s.transportMode)) {
      const stations = formatNavProgress(
        s.navDistanceM,
        s.transportMode,
        s.remainingStations,
      );
      if (stations.startsWith('Noch')) return `${stations} · ${place}`;
    }
    return formatNavHudTitle(place, s.transportMode);
  });

  return <Text style={styles.moodLine}>{line}</Text>;
});

export const AudioWave = React.memo(function AudioWave({
  mood,
  compact,
  overlay,
  onAbortBusy,
}: {
  mood: FindusMood;
  compact?: boolean;
  overlay?: boolean;
  /** Doppel-Tipp während Denken/Sprechen → Abbruch */
  onAbortBusy?: () => void;
}) {
  return (
    <LivingPresence
      mood={mood}
      compact={compact}
      overlay={overlay}
      onAbortBusy={onAbortBusy}
    />
  );
});

function LivingPresence({
  mood,
  compact,
  overlay,
  onAbortBusy,
}: {
  mood: FindusMood;
  compact?: boolean;
  overlay?: boolean;
  onAbortBusy?: () => void;
}) {
  const navActive = useFinnusStore((s) => s.navActive);
  const navVisible = useFinnusStore((s) => s.navVisible);
  const findusPresence = useFinnusStore((s) => s.findusPresence);
  const navRouteLoading = useFinnusStore(selectNavRouteLoading);
  const navigating = navActive && navVisible;

  const float = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const loaderSpin = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const talk = useRef(new Animated.Value(0)).current;
  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;

  const speaking = mood === 'speaking';
  const thinking = mood === 'thinking';
  const listening = mood === 'listening';
  const standby = !speaking && !thinking && !listening;
  const offlineStill = findusPresence === 'offline' && standby;

  const idleAccent = presenceAccent(findusPresence);

  const accent = listening
    ? colors.danger
    : thinking
      ? colors.thinking
      : speaking
        ? colors.accent
        : idleAccent;

  const onPresenceTap = useCallback(async () => {
    if (!standby) return;
    if (findusPresence !== 'degraded' && findusPresence !== 'offline') return;
    const reply = buildHealthStatusReply(evaluateFindusHealth());
    const voice = await getVoiceSettingsForTour();
    await speakAssistantText(reply, {
      voiceId: voice.voiceId,
      speechRate: voice.speechRate,
    });
  }, [findusPresence, standby]);

  useEffect(() => {
    if (offlineStill) {
      float.setValue(0.5);
      breath.setValue(0.5);
      glow.setValue(0.5);
      return;
    }

    const tempo = speaking ? 0.55 : thinking ? 0.75 : 1;

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 3000 * tempo,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 3000 * tempo,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: (speaking ? 320 : thinking ? 900 : 2200) * tempo,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: (speaking ? 280 : thinking ? 900 : 2200) * tempo,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: (speaking ? 420 : 1800) * tempo,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: (speaking ? 380 : 1800) * tempo,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    floatLoop.start();
    breathLoop.start();
    glowLoop.start();

    return () => {
      floatLoop.stop();
      breathLoop.stop();
      glowLoop.stop();
    };
  }, [breath, float, glow, offlineStill, speaking, thinking]);

  useEffect(() => {
    if (!thinking) {
      loaderSpin.setValue(0);
      return;
    }

    const spinLoop = Animated.loop(
      Animated.timing(loaderSpin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spinLoop.start();
    return () => spinLoop.stop();
  }, [loaderSpin, thinking]);

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
  }, [ringA, ringB, speaking, talk]);

  const translateY = float.interpolate({
    inputRange: [0, 1],
    outputRange: speaking ? [3, -5] : [6, -8],
  });

  const coreScale = Animated.multiply(
    breath.interpolate({
      inputRange: [0, 1],
      outputRange: speaking ? [0.94, 1.08] : standby ? [0.96, 1.04] : [0.92, 1.06],
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
        outputRange: [0.45, 0.75, 1],
      })
    : 0;

  const haloScale = offlineStill
    ? 1.04
    : breath.interpolate({
        inputRange: [0, 1],
        outputRange: speaking ? [1.02, 1.22] : standby ? [0.98, 1.1] : [1, 1.14],
      });
  const haloOpacity = offlineStill
    ? 0.24
    : glow.interpolate({
        inputRange: [0, 1],
        outputRange: speaking
          ? [0.28, 0.55]
          : standby
            ? [0.16, 0.38]
            : [0.22, 0.48],
      });

  const loaderRotate = loaderSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
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

  const statusLine = useMemo(() => {
    if (navRouteLoading) return 'Route wird gesucht — kurz warten…';
    if (listening) return MOOD_LINE.listening;
    if (thinking) return 'Ich schau kurz nach — einen Moment…';
    if (speaking) return MOOD_LINE.speaking;
    return PRESENCE_LINE[findusPresence];
  }, [findusPresence, listening, navRouteLoading, speaking, thinking]);

  const canTapHealth =
    standby &&
    (findusPresence === 'degraded' || findusPresence === 'offline');
  const canAbortBusy =
    Boolean(onAbortBusy) && (thinking || speaking) && !navigating;

  const busyTapTimesRef = useRef<number[]>([]);
  const handlePresencePress = useCallback(() => {
    if (canTapHealth) {
      void onPresenceTap();
      return;
    }
    if (!canAbortBusy || !onAbortBusy) return;
    const now = Date.now();
    const windowMs = 520;
    busyTapTimesRef.current = [
      ...busyTapTimesRef.current.filter((t) => now - t < windowMs),
      now,
    ];
    if (busyTapTimesRef.current.length >= 2) {
      busyTapTimesRef.current = [];
      onAbortBusy();
    }
  }, [canAbortBusy, canTapHealth, onAbortBusy, onPresenceTap]);

  return (
    <Pressable
      onPress={
        canTapHealth || canAbortBusy ? handlePresencePress : undefined
      }
      disabled={!canTapHealth && !canAbortBusy}
      style={[
        styles.wrap,
        compact ? styles.wrapCompact : null,
        overlay ? styles.wrapOverlay : null,
      ]}
      accessibilityLabel={
        navigating ? 'Kompass – Navigation aktiv' : `Yorro – ${statusLine}`
      }
      accessibilityHint={
        canAbortBusy
          ? 'Zweimal tippen zum Abbrechen'
          : canTapHealth
            ? 'Tippen für Status'
            : undefined
      }
      accessibilityRole={canTapHealth || canAbortBusy ? 'button' : undefined}
    >
      <Animated.View
        style={[styles.presenceBlock, { transform: [{ translateY }] }]}
      >
        <View
          style={[
            styles.stage,
            compact ? styles.stageCompact : null,
            overlay ? styles.stageOverlay : null,
          ]}
        >
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

          {thinking ? (
            <Animated.View
              style={[
                styles.loaderRing,
                {
                  borderTopColor: accent,
                  borderRightColor: accent,
                  transform: [{ rotate: loaderRotate }],
                },
              ]}
            />
          ) : null}

          <Animated.View
            style={[
              styles.halo,
              overlay ? styles.haloOverlay : null,
              {
                backgroundColor: accent,
                opacity: haloOpacity,
                transform: [{ scale: haloScale }],
              },
            ]}
          />

          <Animated.View
            style={[
              styles.core,
              navigating && !speaking && styles.coreCompass,
              overlay && navigating && !speaking
                ? styles.coreCompassOverlay
                : null,
              {
                backgroundColor: accent,
                shadowColor: accent,
                transform:
                  navigating && !speaking
                    ? [{ scale: 1.06 }]
                    : [
                        { scale: coreScale },
                        { scaleX: coreSquashX },
                        { scaleY: coreSquashY },
                      ],
              },
            ]}
          >
            {navigating && !speaking ? (
              <CompassArrow />
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

        {overlay ? null : (
          <>
            <Text style={styles.name}>
              {navigating && !speaking ? 'Kompass' : 'Yorro'}
            </Text>
            <View style={styles.statusSlot}>
              {navigating && !navRouteLoading && !speaking && !thinking ? (
                <NavStatusLine />
              ) : (
                <Text style={styles.moodLine} numberOfLines={1}>
                  {statusLine}
                </Text>
              )}
            </View>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: UI_LAYER.avatar,
    elevation: UI_LAYER.avatar,
  },
  wrapCompact: {
    // Visuell kleiner — Layout-Höhe bleibt flex:1 in der Presence-Pane
    justifyContent: 'center',
  },
  wrapOverlay: {
    flex: 0,
    width: 'auto',
    height: 'auto',
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
  stageOverlay: {
    width: 96,
    height: 96,
    marginBottom: 0,
    overflow: 'hidden',
  },
  halo: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
  },
  haloOverlay: {
    width: 78,
    height: 78,
    borderRadius: 39,
  },
  speechRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
  },
  loaderRing: {
    position: 'absolute',
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 4,
    borderColor: 'transparent',
    borderTopColor: colors.thinking,
    borderRightColor: colors.thinking,
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
  coreCompassOverlay: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  coreHighlight: {
    width: 22,
    height: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  mouth: {
    marginTop: 10,
    width: 22,
    height: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(8, 18, 14, 0.72)',
  },
  name: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  /** Feste Slot-Höhe — Thinking/Speaking ändert den Text, nicht die Layout-Höhe. */
  statusSlot: {
    marginTop: 6,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  moodLine: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
  },
});
