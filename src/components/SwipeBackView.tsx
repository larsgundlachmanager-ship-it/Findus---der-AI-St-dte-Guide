import React, { useEffect, useMemo, useRef } from 'react';
import {
  BackHandler,
  PanResponder,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { claimAndroidBackStep } from '../services/ui/androidBackStep';

/** Linke Kante, in der die Zurück-Geste greift (px). */
const EDGE_WIDTH = 28;
/** Mindestweg nach rechts, um zurückzugehen. */
const DX_THRESHOLD = 72;
/** Oder ausreichend schnelle Wischbewegung. */
const VX_THRESHOLD = 0.45;

type Props = {
  /** false = Geste und System-Zurück deaktiviert (z. B. erster Screen). */
  enabled?: boolean;
  /**
   * Android hardwareBackPress / System-Zurück-Geste.
   * Default false — HomeScreen/Onboarding steuern den Stack (sonst Doppel-Pop → App zu).
   */
  captureHardwareBack?: boolean;
  onBack: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Oberer Bereich ohne Edge-Capture (px) — z. B. Top-Bar mit ‹-Tag-Navigation,
   * sonst frisst die 28px-Kante den linken Pfeil.
   */
  edgeTopInset?: number;
};

/**
 * Seiten-Zurück per Geste: von der linken Kante nach rechts wischen.
 * Optional Android-System-Zurück (meist vom Parent).
 */
export function SwipeBackView({
  enabled = true,
  captureHardwareBack = false,
  onBack,
  children,
  style,
  edgeTopInset = 0,
}: Props) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const runBack = () => {
    if (!enabledRef.current) return;
    if (!claimAndroidBackStep()) return;
    onBackRef.current();
  };

  useEffect(() => {
    if (!enabled || !captureHardwareBack) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!enabledRef.current) return false;
      if (!claimAndroidBackStep()) return true; // Event verbrauchen, nicht App schließen
      onBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, [enabled, captureHardwareBack]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Nur bei Bewegung greifen — sonst blockiert die Edge Settings/Buttons
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => {
          if (!enabledRef.current) return false;
          return (
            g.dx > 10 &&
            Math.abs(g.dx) > Math.abs(g.dy) * 1.15
          );
        },
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_e, g) => {
          if (!enabledRef.current) return;
          if (g.dx >= DX_THRESHOLD || g.vx >= VX_THRESHOLD) {
            runBack();
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
          style={[
            styles.edge,
            edgeTopInset > 0 ? { top: edgeTopInset } : null,
          ]}
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
