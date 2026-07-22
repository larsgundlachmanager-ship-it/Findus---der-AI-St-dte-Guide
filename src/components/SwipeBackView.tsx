import React, { useEffect, useMemo, useRef } from 'react';
import {
  BackHandler,
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/** Linke Kante, in der die Zurück-Geste greift (px). */
const EDGE_WIDTH = 28;
/** Mindestweg nach rechts, um zurückzugehen. */
const DX_THRESHOLD = 72;
/** Oder ausreichend schnelle Wischbewegung. */
const VX_THRESHOLD = 0.45;

type Props = {
  /** false = Geste und System-Zurück deaktiviert (z. B. erster Screen). */
  enabled?: boolean;
  onBack: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Seiten-Zurück per Geste: von der linken Kante nach rechts wischen.
 * Zusätzlich Android-System-Zurück (kein sichtbarer Zurück-Button).
 */
export function SwipeBackView({
  enabled = true,
  onBack,
  children,
  style,
}: Props) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, [enabled]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => enabledRef.current,
        onMoveShouldSetPanResponder: (_e, g) => {
          if (!enabledRef.current) return false;
          return (
            g.dx > 10 &&
            Math.abs(g.dx) > Math.abs(g.dy) * 1.15
          );
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_e, g) => {
          if (!enabledRef.current) return;
          if (g.dx >= DX_THRESHOLD || g.vx >= VX_THRESHOLD) {
            onBackRef.current();
          }
        },
      }),
    [],
  );

  return (
    <View style={[styles.fill, style]}>
      {children}
      {enabled ? (
        <View
          style={styles.edge}
          {...pan.panHandlers}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  edge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: EDGE_WIDTH,
    zIndex: 50,
  },
});
