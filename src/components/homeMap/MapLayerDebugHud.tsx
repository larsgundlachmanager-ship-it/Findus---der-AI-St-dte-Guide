/**
 * Layer-Hunt HUD — 10 Stufen, manuell weiter schalten, je ~2 Min Video.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UI_LAYER } from '../../constants/uiLayers';
import {
  advanceMapLayerDebugStep,
  getMapLayerDebugStep,
  getMapLayerDebugStepCount,
  isMapLayerDebugEnabled,
  peekMapLayerDebugMeta,
  resetMapLayerDebugStep,
  subscribeMapLayerDebug,
} from '../../services/homeMap/mapLayerDebug';

type Props = {
  onStepChange: (step: number) => void;
};

export function MapLayerDebugHud({ onStepChange }: Props) {
  const [step, setStep] = useState(getMapLayerDebugStep());
  useEffect(
    () =>
      subscribeMapLayerDebug((s) => {
        setStep(s);
        onStepChange(s);
      }),
    [onStepChange],
  );

  if (!isMapLayerDebugEnabled()) return null;

  const total = getMapLayerDebugStepCount();
  const meta = peekMapLayerDebugMeta(step);
  const atEnd = step >= total - 1;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <Text style={styles.kicker}>
          Layer-Test {step + 1}/{total}
        </Text>
        <Text style={styles.title}>{meta.title}</Text>
        <Text style={styles.hint}>{meta.hint}</Text>
        <Text style={styles.protocol}>
          10 s Pause → 2 Min frei bewegen (Video) → „Nächste Ebene“
        </Text>
        <View style={styles.row}>
          <Pressable
            style={[styles.btn, styles.btnGhost]}
            onPress={() => {
              resetMapLayerDebugStep();
            }}
          >
            <Text style={styles.btnGhostText}>Reset (Stufe 1)</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, atEnd && styles.btnDone]}
            disabled={atEnd}
            onPress={() => {
              advanceMapLayerDebugStep();
            }}
          >
            <Text style={styles.btnText}>
              {atEnd ? 'Alle Ebenen an' : 'Nächste Ebene →'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 120,
    zIndex: UI_LAYER.overlay,
  },
  card: {
    backgroundColor: 'rgba(12, 18, 16, 0.94)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(95, 168, 138, 0.55)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  kicker: {
    color: '#8FBFA8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  title: {
    color: '#F4FAF7',
    fontSize: 16,
    fontWeight: '700',
  },
  hint: {
    color: '#C8D9D0',
    fontSize: 13,
  },
  protocol: {
    color: '#9AAEA4',
    fontSize: 12,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    backgroundColor: '#5FA88A',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnDone: {
    backgroundColor: '#3A5248',
  },
  btnGhost: {
    flex: 0.85,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  btnText: {
    color: '#0B1210',
    fontWeight: '800',
    fontSize: 14,
  },
  btnGhostText: {
    color: '#E8F2ED',
    fontWeight: '600',
    fontSize: 13,
  },
});
