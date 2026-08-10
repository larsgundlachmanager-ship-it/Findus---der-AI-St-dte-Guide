/**
 * Kompakter Transportmodus-Wähler: Zu Fuß / Zweirad / Öffis.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  TRAVEL_MODE_OPTIONS,
  type TravelMode,
} from '../services/navigation/travelModeContext';

type Props = {
  /** Kompakt für Header/Mic-Kontext. */
  compact?: boolean;
};

export const TravelModeSelector = React.memo(function TravelModeSelector({
  compact,
}: Props) {
  const preferred = useFinnusStore((s) => s.preferredTravelMode);
  const setPreferred = useFinnusStore((s) => s.setPreferredTravelMode);

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {TRAVEL_MODE_OPTIONS.map((o) => {
        const on = preferred === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() =>
              setPreferred(on ? null : (o.id as TravelMode))
            }
            style={[styles.chip, on && styles.chipOn, compact && styles.chipCompact]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{o.label}</Text>
            {!compact ? (
              <Text style={styles.hint}>{o.hint}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rowCompact: {
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 88,
  },
  chipCompact: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 0,
    borderRadius: 10,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  labelOn: {
    color: colors.accent,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
});
