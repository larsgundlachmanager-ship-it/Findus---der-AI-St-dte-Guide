import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import {
  loadMicHintPrefs,
  shouldShowMicHint,
  shouldShowMicLockHint,
} from '../services/ui/micHintPrefs';
import {
  bootstrapUiCoachMarks,
  shouldShowCoachMic,
} from '../services/onboarding/uiCoachMarks';
import { useUiScaleStore } from '../services/ui/uiScale';

/** Nach rechts wischen (px) während Hold → Mikro fixieren (WhatsApp-Style). */
const LOCK_SWIPE_RIGHT_PX = 56;
/** Nach links wischen → Live-Chat. */
const LIVE_SWIPE_LEFT_PX = -56;

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
  /** @deprecated Wird nicht mehr angezeigt — nur noch intern für STT. */
  partialText?: string;
  /** Kleineres Mic, kein Hint-Text — z. B. Plan-Kalender */
  compact?: boolean;
}

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
  compact = false,
}: Props) {
  const pulse = React.useRef(new Animated.Value(1)).current;
  const arrowSlide = React.useRef(new Animated.Value(0)).current;
  const arrowSlideLeft = React.useRef(new Animated.Value(0)).current;
  const [showCoachHint, setShowCoachHint] = useState(true);
  const [showLockExplain, setShowLockExplain] = useState(true);
  const buttonMul = useUiScaleStore((s) => s.buttonMul);
  const textMul = useUiScaleStore((s) => s.textMul);
  const btnSize = Math.round((compact ? 52 : 84) * buttonMul);
  const coreSize = Math.round((compact ? 18 : 28) * buttonMul);
  const busySpin = !isListening && (isGenerating || isSpeaking);
  const lockedRef = useRef(false);
  const gestureFiredRef = useRef(false);

  useEffect(() => {
    lockedRef.current = isMicLocked;
    if (!isMicLocked) {
      gestureFiredRef.current = false;
    }
  }, [isMicLocked]);

  const refreshHint = useCallback(() => {
    void Promise.all([loadMicHintPrefs(), bootstrapUiCoachMarks()]).then(() => {
      setShowCoachHint(shouldShowCoachMic() || shouldShowMicHint());
      setShowLockExplain(shouldShowMicLockHint());
    });
  }, []);

  useEffect(() => {
    refreshHint();
  }, [refreshHint, isListening, isGenerating, isFinalizing, isSpeaking, isMicLocked]);

  useEffect(() => {
    if (!isListening) {
      pulse.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.14,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isListening, pulse]);

  const showSwipeGuides = isListening && !isMicLocked && !compact;

  useEffect(() => {
    if (!showSwipeGuides) {
      arrowSlide.setValue(0);
      arrowSlideLeft.setValue(0);
      return;
    }
    const loopR = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowSlide, {
          toValue: 10,
          duration: 520,
          useNativeDriver: true,
        }),
        Animated.timing(arrowSlide, {
          toValue: 0,
          duration: 520,
          useNativeDriver: true,
        }),
      ]),
    );
    const loopL = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowSlideLeft, {
          toValue: -10,
          duration: 520,
          useNativeDriver: true,
        }),
        Animated.timing(arrowSlideLeft, {
          toValue: 0,
          duration: 520,
          useNativeDriver: true,
        }),
      ]),
    );
    loopR.start();
    loopL.start();
    return () => {
      loopR.stop();
      loopL.stop();
    };
  }, [showSwipeGuides, arrowSlide, arrowSlideLeft]);

  const handlePressOut = useCallback(() => {
    onPressOut();
    setTimeout(refreshHint, 80);
  }, [onPressOut, refreshHint]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dy) > 6 || Math.abs(g.dx) > 6,
        onPanResponderGrant: () => {
          gestureFiredRef.current = false;
          onPressIn();
        },
        onPanResponderMove: (_, g) => {
          if (gestureFiredRef.current || lockedRef.current) return;
          if (Math.abs(g.dx) <= Math.abs(g.dy) * 1.2) return;
          if (g.dx >= LOCK_SWIPE_RIGHT_PX) {
            gestureFiredRef.current = true;
            onSwipeLock?.();
            return;
          }
          if (g.dx <= LIVE_SWIPE_LEFT_PX) {
            gestureFiredRef.current = true;
            onSwipeLiveChat?.();
          }
        },
        onPanResponderRelease: () => {
          handlePressOut();
        },
        onPanResponderTerminate: () => {
          handlePressOut();
        },
      }),
    [handlePressOut, onPressIn, onSwipeLock, onSwipeLiveChat],
  );

  const hint = compact
    ? null
    : isMicLocked
      ? 'Fixiert / Live — tippen zum Beenden'
      : isListening
        ? showLockExplain
          ? null
          : 'Loslassen = senden'
        : isFinalizing
          ? 'Letzte Wörter werden erkannt…'
          : busySpin
            ? 'Tippen stoppt — oder 2× auf Findus'
            : showCoachHint
              ? 'Tippen = schreiben · Halten = sprechen'
              : null;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={styles.micCluster}>
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <View
            {...panResponder.panHandlers}
            style={[
              styles.button,
              compact && styles.buttonCompact,
              {
                width: btnSize,
                height: btnSize,
                borderRadius: btnSize / 2,
              },
              isListening && styles.buttonActive,
              isMicLocked && styles.buttonLocked,
              busySpin && styles.buttonInterrupt,
            ]}
            accessibilityLabel={
              isMicLocked
                ? 'Mikrofon fixiert oder Live-Chat — tippen zum Beenden'
                : 'Mikrofon — tippen schreiben, halten sprechen, rechts fixieren, links Live-Chat'
            }
            accessibilityState={{ busy: isListening || busySpin }}
          >
            {busySpin ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <View
                style={[
                  styles.micCore,
                  compact && styles.micCoreCompact,
                  {
                    width: coreSize,
                    height: coreSize,
                    borderRadius: coreSize / 2,
                  },
                  isListening && styles.micCoreActive,
                  isMicLocked && styles.micCoreLocked,
                  compact && isListening && styles.micCoreActiveCompact,
                ]}
              />
            )}
          </View>
        </Animated.View>

        {showSwipeGuides ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.lockGuide,
              styles.liveGuide,
              {
                right: btnSize + spacing.sm,
                transform: [{ translateX: arrowSlideLeft }],
              },
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
            <Text
              style={[
                styles.lockGuideTitle,
                styles.liveGuideTitle,
                { fontSize: Math.round(showLockExplain ? 13 : 12) * textMul },
              ]}
              numberOfLines={2}
            >
              {showLockExplain
                ? 'Nach links\nLive-Chat'
                : 'Live-Chat'}
            </Text>
          </Animated.View>
        ) : null}

        {showSwipeGuides ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.lockGuide,
              {
                left: btnSize + spacing.sm,
                transform: [{ translateX: arrowSlide }],
              },
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
            {showLockExplain ? (
              <Text
                style={[
                  styles.lockGuideTitle,
                  { fontSize: Math.round(13 * textMul) },
                ]}
                numberOfLines={2}
              >
                Nach rechts{'\n'}fixieren
              </Text>
            ) : (
              <Text
                style={[
                  styles.lockGuideTitle,
                  { fontSize: Math.round(12 * textMul) },
                ]}
              >
                Fixieren
              </Text>
            )}
          </Animated.View>
        ) : null}
      </View>

      {compact ? null : (
        <View style={styles.hintSlot}>
          {hint ? (
            <Text
              style={[styles.hint, { fontSize: Math.round(13 * textMul) }]}
              numberOfLines={2}
            >
              {hint}
            </Text>
          ) : null}
          {!isListening && !isMicLocked && !busySpin && !isFinalizing && showCoachHint ? (
            <View style={styles.coachLockRow}>
              <Feather name="arrow-left" size={14} color={colors.textMuted} />
              <Text
                style={[
                  styles.coachLockText,
                  { fontSize: Math.round(12 * textMul) },
                ]}
              >
                Links = Live-Chat · Rechts = fixieren
              </Text>
              <Feather name="arrow-right" size={14} color={colors.textMuted} />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
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
  button: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  buttonCompact: {
    width: 52,
    height: 52,
    borderRadius: 26,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  buttonActive: {
    backgroundColor: colors.danger,
  },
  buttonLocked: {
    backgroundColor: '#c45a2a',
    borderWidth: 3,
    borderColor: colors.text,
  },
  /** Still pressable — signals “tap to barge in”. */
  buttonInterrupt: {
    opacity: 0.92,
  },
  micCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg,
  },
  micCoreCompact: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  micCoreActive: {
    backgroundColor: colors.text,
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  micCoreLocked: {
    backgroundColor: colors.bg,
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  micCoreActiveCompact: {
    width: 12,
    height: 12,
    borderRadius: 6,
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
  lockGuideTitle: {
    marginTop: 4,
    color: colors.text,
    fontWeight: '600',
    lineHeight: 17,
  },
  liveGuideTitle: {
    textAlign: 'right',
  },
  hintSlot: {
    marginTop: spacing.sm,
    minHeight: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  coachLockRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  coachLockText: {
    color: colors.textMuted,
    textAlign: 'center',
  },
});
