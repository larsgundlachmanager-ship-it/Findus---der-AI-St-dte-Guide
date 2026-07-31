/**
 * Gemeinsame farbige DayPlan-Timeline-Zeile (Planung + Stempelkarte Zeitachse).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { clockLabel, type DayPlanItem } from '../types/dayPlan';
import { effectiveTimes } from '../services/module5/planVsActual';
import {
  classifyTimelineItem,
  type TimelineVisual,
} from '../services/module5/timelineVisual';

const PLAN_LEAD_MS = 30 * 60_000;

/** Plan-Zeile nur wenn mind. 30 Min vorher geplant — ohne Durchstreichen. */
function shouldShowPlanLabel(item: DayPlanItem): boolean {
  if (item.startMs == null) return false;
  if (item.actualStartMs == null) return false;
  const created =
    typeof item.meta?.createdAtMs === 'number' ? item.meta.createdAtMs : null;
  if (created != null) {
    return item.startMs - created >= PLAN_LEAD_MS;
  }
  // Fallback: nur wenn Ist klar vom Plan abweicht und Plan in der Zukunft lag
  return Math.abs(item.actualStartMs - item.startMs) >= 3 * 60_000;
}

type Props = {
  item: DayPlanItem;
  allItems: DayPlanItem[];
  compact?: boolean;
};

export function DayPlanTimelineRow({ item, allItems, compact }: Props) {
  const vis = classifyTimelineItem(item, allItems);
  const eff = effectiveTimes(item);
  const showStart = eff.startMs;
  const showEnd = eff.endMs;
  const delayMs = eff.delayMs;
  const delayLabel =
    delayMs != null && Math.abs(delayMs) >= 3 * 60_000
      ? `${delayMs > 0 ? '+' : ''}${Math.round(delayMs / 60_000)} Min`
      : null;
  const hasIst = eff.isActual;
  const timed = item.timed && item.startMs != null;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: item.meta?.optimizePreview
            ? 'rgba(232,145,58,0.22)'
            : vis.cardBg,
          borderColor: item.meta?.optimizePreview
            ? '#E8913A'
            : vis.borderColor,
          borderWidth:
            item.meta?.optimizePreview || vis.tone !== 'default' ? 1 : 0,
        },
      ]}
    >
      <View style={styles.rail}>
        {vis.showArrow ? (
          <Text style={[styles.arrow, { color: vis.railColor }]}>
            {vis.arrowLabel ?? '→'}
          </Text>
        ) : (
          <View
            style={[
              timed || hasIst ? styles.tick : styles.dot,
              { backgroundColor: vis.railColor },
              item.status === 'done' && styles.tickDone,
              item.status === 'in_progress' && styles.tickLive,
            ]}
          />
        )}
        <View style={[styles.railLine, { backgroundColor: vis.railColor + '55' }]} />
      </View>

      <View style={[styles.card, compact && styles.cardCompact]}>
        <View style={styles.topRow}>
          <Text style={styles.emoji}>{vis.modeEmoji}</Text>
          {showStart != null ? (
            <Text
              style={[
                styles.time,
                vis.boldTime && styles.timeBold,
                vis.tone === 'conflict' && styles.timeConflict,
                vis.tone === 'trigger' && styles.timeTrigger,
                vis.tone === 'wish' && styles.timeWish,
              ]}
            >
              {hasIst ? 'Ist ' : ''}
              {clockLabel(showStart)}
              {showEnd ? ` – ${clockLabel(showEnd)}` : ''}
            </Text>
          ) : (
            <Text style={styles.timeMuted}>Punkt · heute noch</Text>
          )}
          {vis.badgeLabel ? (
            <View
              style={[
                styles.badge,
                vis.tone === 'conflict' && styles.badgeConflict,
                vis.tone === 'trigger' && styles.badgeTrigger,
                vis.tone === 'uncertain' && styles.badgeUncertain,
                vis.tone === 'wish' && styles.badgeWish,
              ]}
            >
              <Text style={styles.badgeText}>{vis.badgeLabel}</Text>
            </View>
          ) : null}
          {delayLabel ? (
            <Text style={styles.delayBadge}>{delayLabel}</Text>
          ) : null}
        </View>

        {hasIst && shouldShowPlanLabel(item) ? (
          <Text style={styles.planMuted}>
            Plan {clockLabel(item.startMs!)}
            {item.endMs ? ` – ${clockLabel(item.endMs)}` : ''}
          </Text>
        ) : null}

        <Text
          style={[styles.title, vis.boldTime && styles.titleBold]}
          numberOfLines={compact ? 2 : 3}
        >
          {item.title}
        </Text>

        {vis.hint ? (
          <Text style={styles.hint} numberOfLines={2}>
            {vis.hint}
          </Text>
        ) : null}

        {!compact && item.notes ? (
          <Text style={styles.notes} numberOfLines={2}>
            {item.notes}
          </Text>
        ) : null}

        {item.placeName && item.placeName !== item.title ? (
          <Text style={styles.meta}>{item.placeName}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function TimelineLegendBar() {
  return (
    <View style={styles.legend}>
      <View style={[styles.legendDot, { backgroundColor: '#3DCF7A' }]} />
      <Text style={styles.legendText}>Trigger</Text>
      <View style={[styles.legendDot, { backgroundColor: '#3D7CFF' }]} />
      <Text style={styles.legendText}>Wunsch</Text>
      <View style={[styles.legendDot, { backgroundColor: '#E8913A' }]} />
      <Text style={styles.legendText}>Unsicher</Text>
      <View style={[styles.legendDot, { backgroundColor: '#D96B5C' }]} />
      <Text style={styles.legendText}>Konflikt</Text>
      <Text style={styles.legendModes}>🚶🚆🚕✈️</Text>
    </View>
  );
}

/** Exported for tests / passport cards */
export function toneForItem(
  item: DayPlanItem,
  all: DayPlanItem[],
): TimelineVisual {
  return classifyTimelineItem(item, all);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    minHeight: 64,
    marginBottom: 8,
    borderRadius: 12,
    paddingVertical: 6,
    paddingRight: spacing.sm,
  },
  rail: { width: 28, alignItems: 'center' },
  tick: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginTop: 4,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  tickDone: { opacity: 0.45 },
  tickLive: { backgroundColor: colors.online },
  arrow: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 0,
    lineHeight: 20,
  },
  railLine: {
    flex: 1,
    width: 2,
    marginTop: 2,
  },
  card: { flex: 1, paddingBottom: 4, paddingLeft: spacing.sm },
  cardCompact: { paddingBottom: 0 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  emoji: { fontSize: 16 },
  time: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  timeBold: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
  },
  timeConflict: { color: colors.danger },
  timeTrigger: { color: colors.online },
  timeWish: { color: colors.thinking },
  timeMuted: { color: colors.wave, fontSize: 12, fontWeight: '700' },
  planMuted: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  titleBold: { fontSize: 16, fontWeight: '800' },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
    fontStyle: 'italic',
  },
  notes: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeConflict: { backgroundColor: 'rgba(217,107,92,0.35)' },
  badgeTrigger: { backgroundColor: 'rgba(61,207,122,0.35)' },
  badgeUncertain: { backgroundColor: 'rgba(232,145,58,0.35)' },
  badgeWish: { backgroundColor: 'rgba(61,124,255,0.35)' },
  badgeText: { color: colors.text, fontSize: 11, fontWeight: '800' },
  delayBadge: {
    color: colors.offline,
    fontSize: 11,
    fontWeight: '800',
    backgroundColor: 'rgba(232,145,58,0.22)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 11, marginRight: 8 },
  legendModes: { color: colors.textMuted, fontSize: 12, marginLeft: 'auto' },
});
