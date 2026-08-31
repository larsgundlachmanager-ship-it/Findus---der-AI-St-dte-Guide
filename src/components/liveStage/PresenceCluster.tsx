import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AudioWave, type FindusMood } from '../AudioWave';
import { UI_LAYER } from '../../constants/uiLayers';

type Props = {
  mood: FindusMood;
  /** Shrink avatar when bullets/actions claim vertical space. */
  compact?: boolean;
  /** Mini-Kreis über der Homescreen-Karte — blockiert die Karte nicht. */
  overlay?: boolean;
  onAbortBusy?: () => void;
};

/**
 * Yorro-Präsenz: volle Pane oder Mini-Overlay auf der Homescreen-Karte.
 * Bottom-Dock wird nie mitgeschoben.
 */
export const PresenceCluster = React.memo(function PresenceCluster({
  mood,
  compact,
  overlay,
  onAbortBusy,
}: Props) {
  return (
    <View
      style={[styles.wrap, overlay && styles.wrapOverlay]}
      pointerEvents="box-none"
    >
      <View
        style={[styles.inner, overlay && styles.innerOverlay]}
        pointerEvents="box-none"
      >
        <AudioWave
          mood={mood}
          compact={compact || overlay}
          overlay={overlay}
          onAbortBusy={onAbortBusy}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
    zIndex: UI_LAYER.avatar,
  },
  wrapOverlay: {
    flex: 0,
    overflow: 'visible',
    width: 'auto',
  },
  inner: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerOverlay: {
    flex: 0,
    width: 'auto',
  },
});
