/**
 * Google-Maps-Feel: bei GPS-Lock sitzt der Pfeil fest in der Bildschirmmitte.
 * Mit Heading-Up (Karte dreht mit Blickrichtung): Pfeil bleibt TIPP NACH OBEN —
 * nur die Karte dreht darunter. Ohne Heading-Up: Overlay folgt dem Gerät.
 *
 * Übergang: Opacity-Crossfade (kein hartes Ein-/Ausblenden) — Map-Pfeil bleibt
 * darunter auf GPS, damit Unlock nicht „klein → Pop“ macht.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

/** user-arrow.png ist 128px; MapLibre iconSize 0.5 → 64px auf dem Screen. */
const PUCK_PX = 64;
const FADE_MS = 180;

type Props = {
  active: boolean;
  /**
   * true = Blickrichtung oben (GPS+Kompass-Lock): kein Screen-Rotate —
   * sonst doppelte Drehung mit der Kamera.
   */
  freezeScreenUp?: boolean;
};

export function GpsLockCenterPuck({ active, freezeScreenUp = true }: Props) {
  const rotateRef = useRef<View>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;
  const [mounted, setMounted] = useState(active);

  useEffect(() => {
    if (active) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: FADE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.96,
        duration: FADE_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [active, opacity, scale]);

  useEffect(() => {
    if (!mounted) return;
    // Heading-Up: Spitze immer zum oberen Bildschirmrand — Karte trägt die Rotation.
    if (freezeScreenUp) {
      rotateRef.current?.setNativeProps({
        style: { transform: [{ rotate: '0deg' }] },
      });
      return;
    }
    const { subscribeMapHeading } = require('../../services/navigation/liveDeviceHeading') as {
      subscribeMapHeading: (cb: (deg: number) => void) => () => void;
    };
    const { getMapDisplayHeadingDegSticky } = require('../../services/navigation/liveDeviceHeading') as {
      getMapDisplayHeadingDegSticky: () => number | null;
    };
    const apply = (deg: number) => {
      if (!Number.isFinite(deg)) return;
      const b = ((deg % 360) + 360) % 360;
      rotateRef.current?.setNativeProps({
        style: { transform: [{ rotate: `${b}deg` }] },
      });
    };
    const sticky = getMapDisplayHeadingDegSticky();
    if (sticky != null) apply(sticky);
    return subscribeMapHeading(apply);
  }, [mounted, freezeScreenUp]);

  if (!mounted) return null;

  return (
    <View pointerEvents="none" style={styles.anchor} accessibilityElementsHidden>
      <Animated.View
        style={[styles.fade, { opacity, transform: [{ scale }] }]}
      >
        <View ref={rotateRef} style={styles.rotate}>
          <Image
            source={require('../../assets/homeMap/user-arrow.png')}
            style={styles.arrow}
            resizeMode="contain"
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  fade: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotate: {
    width: PUCK_PX + 4,
    height: PUCK_PX + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    width: PUCK_PX,
    height: PUCK_PX,
  },
});
