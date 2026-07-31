/**
 * Eine scrollbare Tagesachse: Vergangenheit (Zeitachse) · Jetzt · Planung.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { DayPlanTimelineRow, TimelineLegendBar } from './DayPlanTimelineRow';
import {
  buildUnifiedDayAxis,
  formatNowLabel,
} from '../services/module5/unifiedDayAxis';

type Props = {
  dateKey: string;
  /** Tick zum Neu-Bauen (z. B. store update) */
  refreshKey?: number | string;
  compact?: boolean;
  emptyHint?: string;
};

export function UnifiedDayAxisView({
  dateKey,
  refreshKey,
  compact,
  emptyHint,
}: Props) {
  const axis = useMemo(
    () => buildUnifiedDayAxis({ dateKey }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateKey, refreshKey],
  );

  const allItems = useMemo(
    () => [...axis.past, ...axis.future].map((e) => e.item),
    [axis.past, axis.future],
  );

  if (!axis.past.length && !axis.future.length) {
    return (
      <Text style={styles.empty}>
        {emptyHint ??
          'Noch leer. Besuchte Orte erscheinen oben in der Zeitachse; Planung darunter.'}
      </Text>
    );
  }

  return (
    <View>
      <TimelineLegendBar />

      {axis.past.length ? (
        <Text style={styles.sectionLabel}>Zeitachse · bis jetzt</Text>
      ) : null}
      {axis.past.map((e) => (
        <DayPlanTimelineRow
          key={e.id}
          item={e.item}
          allItems={allItems}
          compact={compact}
        />
      ))}

      <View style={styles.nowRow}>
        <View style={styles.nowLine} />
        <Text style={styles.nowPill}>{formatNowLabel(axis.nowMs)}</Text>
        <View style={styles.nowLine} />
      </View>

      {axis.future.length ? (
        <Text style={styles.sectionLabel}>Planung · ab jetzt</Text>
      ) : (
        <Text style={styles.sectionMuted}>Noch nichts für später geplant.</Text>
      )}
      {axis.future.map((e) => (
        <DayPlanTimelineRow
          key={e.id}
          item={e.item}
          allItems={allItems}
          compact={compact}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginTop: 4,
  },
  sectionMuted: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  nowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: spacing.md,
  },
  nowLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.thinking,
    borderRadius: 1,
  },
  nowPill: {
    color: colors.text,
    fontWeight: '900',
    fontSize: 13,
    backgroundColor: 'rgba(61,124,255,0.28)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.thinking,
  },
});
