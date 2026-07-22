import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Poi } from '../db/types';
import { colors, spacing } from '../constants/theme';
import { triggerPoiArrival } from '../services/poiTriggerService';
import { useFinnusStore } from '../store/useFinnusStore';

interface Props {
  pois: Poi[];
  visible: boolean;
  disabled?: boolean;
}

export function SimulationPicker({ pois, visible, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!visible) return null;

  async function selectPoi(poi: Poi) {
    setOpen(false);
    setBusy(true);
    try {
      useFinnusStore.getState().setLastVisitedPoiId(null);
      await triggerPoiArrival(poi.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        style={[
          styles.trigger,
          (busy || disabled) && styles.triggerDisabled,
        ]}
        onPress={() => setOpen(true)}
        disabled={busy || disabled}
      >
        <Text style={styles.triggerLabel}>Ort wechseln (GPS-Simulation)</Text>
        <Text style={styles.triggerHint}>
          {busy ? 'Findus erzählt…' : `${pois.length} POIs`}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Ort wählen</Text>
            <ScrollView>
              {pois.map((poi) => (
                <Pressable
                  key={poi.id}
                  style={styles.item}
                  onPress={() => void selectPoi(poi)}
                >
                  <Text style={styles.itemName}>{poi.name}</Text>
                  <Text style={styles.itemMeta}>
                    {poi.lat.toFixed(5)}, {poi.lng.toFixed(5)} ·{' '}
                    {poi.radius_meters} m
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  trigger: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  triggerDisabled: {
    opacity: 0.6,
  },
  triggerLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  triggerHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.md,
    maxHeight: '55%',
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  item: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  itemMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
});
