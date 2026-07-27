import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { useFinnusStore } from '../store/useFinnusStore';
import { getNavigationRoutePlan } from '../services/navigation';
import {
  emojiForPlace,
  stampBulletWithEmoji,
  toStampBullets,
} from '../services/navigation/stampBullets';

type Props = {
  visible: boolean;
  onClose: () => void;
};

function formatKm(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/**
 * Stempelkarte / Reisepass: besuchte Orte der Tour.
 */
export function VisitPassportModal({ visible, onClose }: Props) {
  const visitedHistory = useFinnusStore((s) => s.visitedHistory);
  const pois = useFinnusStore((s) => s.pois);
  const navActive = useFinnusStore((s) => s.navActive);
  const navVisible = useFinnusStore((s) => s.navVisible);
  const [tab, setTab] = useState<'stamps' | 'route'>('stamps');

  const navigating = navActive && navVisible;
  const routePlan = navigating ? getNavigationRoutePlan() : null;
  const showRouteTab = navigating && (routePlan?.stops.length ?? 0) > 1;

  const stamps = useMemo(() => {
    const seen = new Set<number>();
    const out: Array<{
      poiId: number;
      name: string;
      kind: string;
      emoji: string;
      bullets: string[];
      at: number;
    }> = [];
    for (const e of visitedHistory) {
      if (seen.has(e.poiId)) continue;
      seen.add(e.poiId);
      const poi = pois.find((p) => p.id === e.poiId);
      const short = toStampBullets(e.keyFacts, 3);
      out.push({
        poiId: e.poiId,
        name: e.name,
        kind: e.kind,
        emoji: emojiForPlace({
          kind: e.kind,
          category: poi?.category,
          name: e.name,
        }),
        bullets: short.map((b, i) => stampBulletWithEmoji(b, i)),
        at: e.visitedAt,
      });
    }
    return out.reverse();
  }, [pois, visitedHistory]);

  const areaTotal = useMemo(
    () =>
      pois.filter((p) => p.kind === 'area' || p.kind === 'legacy' || !p.kind)
        .length,
    [pois],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.kicker}>🎫 Stempelkarte</Text>
              <Text style={styles.title}>Deine Tour</Text>
              <Text style={styles.subtitle}>
                {stamps.length}
                {areaTotal > 0 ? ` / ~${areaTotal}` : ''} Orte entdeckt
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Text style={styles.closeText}>Fertig</Text>
            </Pressable>
          </View>

          {showRouteTab ? (
            <View style={styles.tabs}>
              <Pressable
                style={[styles.tab, tab === 'stamps' && styles.tabActive]}
                onPress={() => setTab('stamps')}
              >
                <Text
                  style={[
                    styles.tabText,
                    tab === 'stamps' && styles.tabTextActive,
                  ]}
                >
                  Verlauf
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tab, tab === 'route' && styles.tabActive]}
                onPress={() => setTab('route')}
              >
                <Text
                  style={[
                    styles.tabText,
                    tab === 'route' && styles.tabTextActive,
                  ]}
                >
                  Route
                </Text>
              </Pressable>
            </View>
          ) : null}

          {tab === 'route' && routePlan ? (
            <ScrollView contentContainerStyle={styles.list}>
              <View style={styles.routeSummary}>
                <Text style={styles.routeLine}>
                  Ziel: {routePlan.destinationName}
                </Text>
                <Text style={styles.routeLine}>
                  Nächster Punkt: {routePlan.nextPointName} (
                  {formatKm(routePlan.legM)})
                </Text>
                <Text style={styles.routeLine}>
                  Noch {formatKm(routePlan.remainingM)}
                  {routePlan.totalM != null
                    ? ` · Gesamt ${formatKm(routePlan.totalM)}`
                    : ''}
                </Text>
              </View>
              {routePlan.stops.map((stop, i) => (
                <View key={`${stop.name}-${i}`} style={styles.routeStop}>
                  <Text style={styles.routeStopIcon}>
                    {stop.done ? '✓' : i === routePlan.stops.findIndex((s) => !s.done) ? '→' : '○'}
                  </Text>
                  <Text
                    style={[
                      styles.routeStopText,
                      stop.done && styles.routeStopDone,
                    ]}
                  >
                    {stop.name}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {stamps.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyEmoji}>🗺️</Text>
                <Text style={styles.empty}>
                  Noch keine Stempel — sobald Findus an einem Ort erzählt,
                  landet er hier.
                </Text>
              </View>
            ) : (
              stamps.map((s, i) => (
                <View key={`${s.poiId}-${s.at}`} style={styles.card}>
                  <View style={styles.stampSeal}>
                    <Text style={styles.stampEmoji}>{s.emoji}</Text>
                    <Text style={styles.stampNum}>#{stamps.length - i}</Text>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {s.name}
                    </Text>
                    <Text style={styles.cardMeta}>
                      {new Date(s.at).toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                    {s.bullets.length > 0 ? (
                      s.bullets.map((b) => (
                        <Text key={b} style={styles.bullet} numberOfLines={2}>
                          {b}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.bullet}>✨ Hier warst du dabei</Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  closeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: 14,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  emptyEmoji: {
    fontSize: 36,
    marginBottom: spacing.sm,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.bg,
    padding: spacing.md,
  },
  stampSeal: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  stampEmoji: {
    fontSize: 22,
    lineHeight: 26,
  },
  stampNum: {
    color: colors.accent,
    fontWeight: '800',
    fontSize: 10,
    marginTop: 1,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 8,
  },
  bullet: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 3,
    opacity: 0.88,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  tabText: {
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 13,
  },
  tabTextActive: {
    color: colors.accent,
  },
  routeSummary: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.bg,
    padding: spacing.md,
    gap: 6,
  },
  routeLine: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  routeStop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  routeStopIcon: {
    width: 22,
    color: colors.accent,
    fontWeight: '800',
    fontSize: 14,
  },
  routeStopText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  routeStopDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
});
