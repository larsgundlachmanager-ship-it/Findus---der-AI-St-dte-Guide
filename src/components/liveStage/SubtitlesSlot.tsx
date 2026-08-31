/**
 * Eine Untertitel-Zeile, linksbündig, Wort für Wort 1:1 zur Stimme.
 *
 * - Zeile füllen von links (Satzende knüpft an, keine neue Zeile)
 * - Zeile voll → 280ms ausfaden, dann neu von links
 * - 5s ohne neues Wort → langsam ausblenden
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, spacing } from '../../constants/theme';
import { UI_LAYER } from '../../constants/uiLayers';
import { getAudioOutputMode } from '../../services/userProfileService';
import { useUiScaleStore } from '../../services/ui/uiScale';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  SUBTITLE_IDLE_FADE_MS,
  SUBTITLE_IDLE_HOLD_MS,
  SUBTITLE_LINE_FADE_MS,
  SUBTITLE_RISE_EASING,
  SUBTITLE_RISE_MS,
  SUBTITLE_RISE_PX,
  SUBTITLE_WIDTH_SAFETY_PX,
  SUBTITLE_WORD_GAP,
  subtitleFeedAdvance,
  subtitleWordRevealDelayMs,
} from '../../utils/subtitleWholeWords';

type Props = { text: string | null };
type Word = { id: string; text: string };

const RISE_EASE = Easing.bezier(
  SUBTITLE_RISE_EASING[0],
  SUBTITLE_RISE_EASING[1],
  SUBTITLE_RISE_EASING[2],
  SUBTITLE_RISE_EASING[3],
);

function estW(text: string, fontSize: number): number {
  let u = 0;
  for (const ch of text) {
    if (/[mwMWÄÖÜ@%]/.test(ch)) u += 1.05;
    else if (/[ilI.,:;!'’…|]/.test(ch)) u += 0.36;
    else if (/[jftJr\-–—]/.test(ch)) u += 0.48;
    else if (/[0-9]/.test(ch)) u += 0.58;
    else if (/[A-ZÄÖÜ]/.test(ch)) u += 0.72;
    else u += 0.56;
  }
  return Math.max(fontSize * 0.4, Math.ceil(u * fontSize * 1.06));
}

function rowW(words: { text: string }[], fontSize: number, gap: number): number {
  if (!words.length) return 0;
  let px = 0;
  for (let i = 0; i < words.length; i += 1) {
    if (i) px += gap;
    px += estW(words[i]!.text, fontSize);
  }
  return px;
}

function canFit(
  words: { text: string }[],
  next: string,
  areaW: number,
  fontSize: number,
  gap: number,
): boolean {
  const w =
    areaW > 60
      ? areaW
      : Math.max(180, Dimensions.get('window').width - spacing.md * 2);
  const need = (words.length ? gap : 0) + estW(next, fontSize);
  return rowW(words, fontSize, gap) + need <= w - SUBTITLE_WIDTH_SAFETY_PX;
}

const WordView = React.memo(function WordView({
  text,
  fontSize,
  lineHeight,
  animate,
}: {
  text: string;
  fontSize: number;
  lineHeight: number;
  animate: boolean;
}) {
  const ty = useSharedValue(animate ? SUBTITLE_RISE_PX : 0);
  const op = useSharedValue(animate ? 0.15 : 1);
  const started = useRef(false);

  useEffect(() => {
    if (!animate || started.current) return;
    started.current = true;
    ty.value = withTiming(0, { duration: SUBTITLE_RISE_MS, easing: RISE_EASE });
    op.value = withTiming(1, { duration: SUBTITLE_RISE_MS, easing: RISE_EASE });
  }, [animate, op, ty]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
    opacity: op.value,
  }));

  return (
    <Animated.Text
      allowFontScaling={false}
      numberOfLines={1}
      style={[styles.word, { fontSize, lineHeight, height: lineHeight }, style]}
    >
      {text}
    </Animated.Text>
  );
});

const FadeLine = React.memo(function FadeLine({
  words,
  fontSize,
  lineHeight,
  gap,
  fadeId,
  onDone,
}: {
  words: Word[];
  fontSize: number;
  lineHeight: number;
  gap: number;
  fadeId: string;
  onDone: (id: string) => void;
}) {
  const op = useSharedValue(1);
  const started = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    op.value = withTiming(
      0,
      { duration: SUBTITLE_LINE_FADE_MS, easing: Easing.out(Easing.cubic) },
      (ok) => {
        if (ok) runOnJS(doneRef.current)(fadeId);
      },
    );
  }, [fadeId, op]);

  const style = useAnimatedStyle(() => ({ opacity: op.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.lane, styles.fadeAbs, { height: lineHeight, gap }, style]}
    >
      {words.map((w) => (
        <Animated.Text
          key={w.id}
          allowFontScaling={false}
          numberOfLines={1}
          style={[styles.word, { fontSize, lineHeight, height: lineHeight }]}
        >
          {w.text}
        </Animated.Text>
      ))}
    </Animated.View>
  );
});

export const SubtitlesSlot = React.memo(function SubtitlesSlot({ text }: Props) {
  const textMul = useUiScaleStore((s) => s.textMul);
  const speaking = useFinnusStore((s) => s.isAudiblySpeaking);
  const playing = useFinnusStore((s) => s.isPlayingAudio);
  const busy = speaking || playing;

  const display = (text ?? '').replace(/\s+/g, ' ').trim();
  const feedWords = useMemo(
    () => (display ? display.split(/\s+/).filter(Boolean) : []),
    [display],
  );

  const fontSize = Math.round(16 * textMul);
  const lineHeight = Math.round(22 * textMul);
  const gapX = SUBTITLE_WORD_GAP;

  const [areaW, setAreaW] = useState(() =>
    Math.max(180, Math.round(Dimensions.get('window').width - spacing.md * 2)),
  );
  const [line, setLine] = useState<Word[]>([]);
  const [riseId, setRiseId] = useState<string | null>(null);
  const [fade, setFade] = useState<{ id: string; words: Word[] } | null>(null);

  const lineR = useRef<Word[]>([]);
  const emittedR = useRef<string[]>([]);
  const seqR = useRef(0);
  const fadingR = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleOp = useSharedValue(1);
  const idleOn = useRef(false);
  const queueR = useRef<string[]>([]);
  const dripTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drippingR = useRef(false);
  const karaokeR = useRef(false);
  const areaWR = useRef(areaW);
  const fontSizeR = useRef(fontSize);
  const gapXR = useRef(gapX);
  areaWR.current = areaW;
  fontSizeR.current = fontSize;
  gapXR.current = gapX;

  const stopDrip = useCallback(() => {
    if (dripTimer.current) {
      clearTimeout(dripTimer.current);
      dripTimer.current = null;
    }
    drippingR.current = false;
    queueR.current = [];
    karaokeR.current = false;
  }, []);

  const clearAll = useCallback(() => {
    stopDrip();
    lineR.current = [];
    emittedR.current = [];
    seqR.current = 0;
    fadingR.current = false;
    setLine([]);
    setRiseId(null);
    setFade(null);
  }, [stopDrip]);

  const onFadeDone = useCallback((id: string) => {
    setFade((cur) => {
      if (cur?.id !== id) return cur;
      fadingR.current = false;
      return null;
    });
  }, []);

  /** Volle Zeile: Overlay-Fade wenn frei, Live-Zeile immer neu. */
  const recycleLine = useCallback((from: Word[]): Word[] => {
    if (!from.length) return from;
    if (!fadingR.current) {
      fadingR.current = true;
      setFade({ id: `f${seqR.current}`, words: [...from] });
    }
    return [];
  }, []);

  const commitWord = useCallback(
    (w: string) => {
      let next = [...lineR.current];
      if (!canFit(next, w, areaWR.current, fontSizeR.current, gapXR.current)) {
        next = recycleLine(next);
      }
      const id = `w${seqR.current++}`;
      next = [...next, { id, text: w }];
      lineR.current = next;
      setLine(next);
      setRiseId(id);
    },
    [recycleLine],
  );

  const pumpDrip = useCallback(() => {
    if (dripTimer.current) return;
    const run = () => {
      dripTimer.current = null;
      const w = queueR.current.shift();
      if (!w) {
        drippingR.current = false;
        karaokeR.current = false;
        return;
      }
      commitWord(w);
      if (queueR.current.length === 0) {
        drippingR.current = false;
        karaokeR.current = false;
        return;
      }
      const delay = subtitleWordRevealDelayMs(
        w,
        queueR.current.length,
        karaokeR.current,
      );
      dripTimer.current = setTimeout(run, delay);
    };
    drippingR.current = true;
    run();
  }, [commitWord]);

  useEffect(() => {
    if (!display) {
      clearAll();
      return;
    }

    const step = subtitleFeedAdvance(emittedR.current, feedWords);
    if (step.reset) {
      stopDrip();
      clearAll();
    }
    const pending = step.pending;
    if (pending.length === 0) return;
    emittedR.current = [...emittedR.current, ...pending];
    if (
      pending.length === 1 &&
      queueR.current.length === 0 &&
      !drippingR.current
    ) {
      commitWord(pending[0]!);
      return;
    }
    if (pending.length > 2) karaokeR.current = true;
    queueR.current.push(...pending);
    pumpDrip();
  }, [display, feedWords, clearAll, commitWord, pumpDrip, stopDrip]);

  useEffect(() => {
    if (!riseId) return;
    const t = setTimeout(() => setRiseId(null), SUBTITLE_RISE_MS + 40);
    return () => clearTimeout(t);
  }, [riseId]);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (dripTimer.current) clearTimeout(dripTimer.current);
    },
    [],
  );

  const finishIdle = useCallback(() => {
    idleOn.current = false;
    useFinnusStore.getState().setSubtitleText(null);
    clearAll();
    idleOp.value = 1;
  }, [clearAll, idleOp]);

  useEffect(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (busy) {
      idleOn.current = false;
      idleOp.value = 1;
      return;
    }
    if (!display) return;
    try {
      const mode = getAudioOutputMode();
      if (mode === 'mute' || mode === 'text_only') return;
    } catch {
      /* ignore */
    }
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      const st = useFinnusStore.getState();
      if (st.isAudiblySpeaking || st.isPlayingAudio || idleOn.current) return;
      idleOn.current = true;
      idleOp.value = withTiming(
        0,
        { duration: SUBTITLE_IDLE_FADE_MS, easing: Easing.out(Easing.cubic) },
        (ok) => {
          if (ok) runOnJS(finishIdle)();
        },
      );
    }, SUBTITLE_IDLE_HOLD_MS);
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [busy, display, feedWords.length, line, finishIdle, idleOp]);

  const idleStyle = useAnimatedStyle(() => ({ opacity: idleOp.value }));

  if (!display && !fade) return null;

  return (
    <View
      style={styles.wrap}
      pointerEvents="none"
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 40 && Math.abs(w - areaW) > 2) setAreaW(w);
      }}
    >
      <Animated.View style={[styles.stage, { height: lineHeight }, idleStyle]}>
        {fade ? (
          <FadeLine
            fadeId={fade.id}
            words={fade.words}
            fontSize={fontSize}
            lineHeight={lineHeight}
            gap={gapX}
            onDone={onFadeDone}
          />
        ) : null}

        <View style={[styles.lane, { height: lineHeight, gap: gapX }]}>
          {line.map((w) => (
            <WordView
              key={w.id}
              text={w.text}
              fontSize={fontSize}
              lineHeight={lineHeight}
              animate={w.id === riseId}
            />
          ))}
        </View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: UI_LAYER.subtitles,
    elevation: UI_LAYER.subtitles,
  },
  stage: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  lane: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'flex-start',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fadeAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 2,
    overflow: 'hidden',
  },
  word: {
    color: colors.text,
    fontWeight: '700',
    flexShrink: 0,
    includeFontPadding: false,
    textAlign: 'left',
    textAlignVertical: 'center',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: Platform.OS === 'android' ? 3 : 5,
  },
});
