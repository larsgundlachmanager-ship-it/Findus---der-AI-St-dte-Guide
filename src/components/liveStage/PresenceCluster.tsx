import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AudioWave, type FindusMood } from '../AudioWave';
import { UI_LAYER } from '../../constants/uiLayers';

type Props = {
  mood: FindusMood;
  /** Shrink avatar when bullets/actions claim vertical space. */
  compact?: boolean;
};

/**
 * Obere LiveStage-Spalte: Findus-Präsenz.
 * Füllt nur die Presence-Pane — Bottom-Dock wird nie mitgeschoben.
 */
export const PresenceCluster = React.memo(function PresenceCluster({
  mood,
  compact,
}: Props) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.inner} pointerEvents="box-none">
        <AudioWave mood={mood} compact={compact} />
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
  inner: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
