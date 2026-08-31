import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { useFinnusStore } from '../store/useFinnusStore';
import { getNavigationRoutePlan } from '../services/navigation';
import { clearNavigationHard } from '../services/navigation/hardNavOverride';
import {
  getTopQuickAddTargets,
  loadNavSearchHistory,
  recordNavSearch,
} from '../services/navigation/navSearchHistory';
import { DraggableStopList } from './DraggableStopList';
import { SwipeBackView } from './SwipeBackView';
import {
  computeCityExploreProgress,
} from '../services/discovery/cityExploreProgress';
import { ensureActiveCityCoverageBounds } from '../services/discovery/cityCoverageBounds';
import { getCachedUserProfile } from '../services/userProfileService';
import {
  getWalkTrackSnapshot,
  loadWalkTrack,
} from '../services/discovery/walkTrackService';
import { useGpsStore } from '../store/useGpsStore';
import {
  hydrateVisitLog,
  importStampsIntoVisitLog,
} from '../services/timeline/visitLog';
import {
  normalizePassportTab,
  type PassportTab,
  type PassportTabLegacy,
} from './Header';
import {
  getPlanBikeMPerMin,
  getPlanWalkMPerMin,
} from '../services/mobility/paceProfile';
import {
  buildStampRecapShareText,
  buildTripInviteShareText,
  shareFindusText,
} from '../services/share/shareMoment';

type Props = {
  visible: boolean;
  onClose: () => void;
  initialTab?: PassportTabLegacy;
  onQuickNavAdd?: (prompt: string) => void;
};

function formatKm(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/**
 * Stempelkarte / Reisepass — Overlay statt RN-Modal
 * (Android blockiert Modals oft während aktiver Navigation).
 */
export const VisitPassportModal = React.memo(function VisitPassportModal({
  visible,
  onClose,
  initialTab,
  onQuickNavAdd,
}: Props) {
  const visitedHistory = useFinnusStore((s) => s.visitedHistory);
  const pois = useFinnusStore((s) => s.pois);
  const navActive = useFinnusStore((s) => s.navActive);
  const navVisible = useFinnusStore((s) => s.navVisible);
  const multiStopTour = useFinnusStore((s) => s.multiStopTour);
  const [tab, setTab] = useState<PassportTab>('discover');
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [quickAdds, setQuickAdds] = useState(getTopQuickAddTargets());
  const [routeListDragging, setRouteListDragging] = useState(false);
  const [coverageTick, setCoverageTick] = useState(0);
  const lastGpsLat = useGpsStore((s) => s.lat);
  const lastGpsLng = useGpsStore((s) => s.lng);
  const transportMode = useFinnusStore((s) => s.transportMode);

  const navigating = navActive && navVisible;
  const routePlan = navigating || multiStopTour ? getNavigationRoutePlan() : null;
  const insets = useSafeAreaInsets();
  const hasRoute =
    !!multiStopTour ||
    (navigating && (routePlan?.stops.length ?? 0) > 0) ||
    navigating;

  useEffect(() => {
    if (!visible) return;
    void loadWalkTrack().then(() => setCoverageTick((n) => n + 1));
    void ensureActiveCityCoverageBounds().then(() =>
      setCoverageTick((n) => n + 1),
    );
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    void hydrateVisitLog().then(() => {
      importStampsIntoVisitLog(visitedHistory, (poiId) => {
        const p = pois.find((x) => x.id === poiId);
        return p ? { lat: p.lat, lng: p.lng } : null;
      });
    });
  }, [visible, visitedHistory.length, pois]);

  useEffect(() => {
    if (!visible) return;
    if (initialTab) {
      setTab(normalizePassportTab(initialTab));
      return;
    }
    if (hasRoute && (multiStopTour || navigating)) {
      setTab('route');
    } else {
      setTab('discover');
    }
  }, [visible, hasRoute, multiStopTour, navigating, initialTab]);

  useEffect(() => {
    if (!visible) return;
    void loadNavSearchHistory().then((h) => {
      setNavHistory(h);
      setQuickAdds(getTopQuickAddTargets());
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setCoverageTick((n) => n + 1), 8_000);
    return () => clearInterval(id);
  }, [visible]);

  const userLoc = useMemo(() => {
    if (
      lastGpsLat != null &&
      lastGpsLng != null &&
      Number.isFinite(lastGpsLat) &&
      Number.isFinite(lastGpsLng)
    ) {
      return { lat: lastGpsLat, lng: lastGpsLng };
    }
    return null;
  }, [lastGpsLat, lastGpsLng]);

  const exploreProgress = useMemo(() => {
    if (!visible) {
      return {
        seenPlaces: 0,
        totalPlaces: 0,
        placePercent: 0,
        areaPercent: 0,
        cityName: null,
        cityId: null,
        line: '',
      };
    }
    void coverageTick;
    const cityId = (getCachedUserProfile()?.cityId ?? '').trim().toLowerCase();
    return computeCityExploreProgress({
      pois,
      visitedHistory,
      walkTrack: getWalkTrackSnapshot(),
      userLoc,
      cityId: cityId || null,
    });
  }, [visible, pois, userLoc, coverageTick, visitedHistory]);

  const onClearRoute = useCallback(() => {
    void clearNavigationHard({ silent: true });
  }, []);

  // Alte Stempel ohne lat/lng aus aktuellem Pack nachziehen (einmalig soft).
  useEffect(() => {
    if (!visible || !pois.length) return;
    const activeCity =
      (getCachedUserProfile()?.cityId ?? '').trim().toLowerCase() || null;
    const cur = useFinnusStore.getState().visitedHistory;
    let changed = false;
    const next = cur.map((e) => {
      if (e.lat != null && e.lng != null) return e;
      const stampCity = (e.cityId ?? '').trim().toLowerCase();
      if (stampCity && activeCity && stampCity !== activeCity) return e;
      const nameNorm = (e.name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
      const p = pois.find((x) => {
        if (x.id !== e.poiId) return false;
        const pn = (x.name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
        return (
          !nameNorm ||
          !pn ||
          pn === nameNorm ||
          pn.includes(nameNorm) ||
          nameNorm.includes(pn)
        );
      });
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return e;
      changed = true;
      return {
        ...e,
        lat: p.lat,
        lng: p.lng,
        cityId: e.cityId ?? activeCity,
      };
    });
    if (changed) {
      useFinnusStore.setState({ visitedHistory: next });
      void import('../services/navigation/stampPassportPersistence').then((m) =>
        m.saveStampPassport(next),
      );
    }
  }, [visible, pois, visitedHistory.length]);

  const onQuickAdd = useCallback(
    (prompt: string) => {
      void recordNavSearch(prompt);
      onQuickNavAdd?.(prompt);
    },
    [onQuickNavAdd],
  );

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable
        style={styles.backdropTap}
        onPress={onClose}
        accessibilityLabel="Schließen"
      />
      <SwipeBackView
        enabled={visible}
        captureHardwareBack={false}
        onBack={onClose}
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.kicker}>🎫 Stempelkarte</Text>
            <Text style={styles.title}>
              {multiStopTour?.title ?? 'Deine Tour'}
            </Text>
            <Text style={styles.subtitle}>
              {exploreProgress.line}
              {multiStopTour ? ` · ${multiStopTour.stops.length} Stopps` : ''}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
            <Text style={styles.closeText}>Fertig</Text>
          </Pressable>
        </View>

        <View style={styles.tabs}>
          {(
            [
              { id: 'discover' as const, label: 'Entdeckung' },
              { id: 'route' as const, label: 'Route' },
            ] as const
          ).map((t) => (
            <Pressable
              key={t.id}
              style={[styles.tab, tab === t.id && styles.tabActive]}
              onPress={() => setTab(t.id)}
            >
              <Text
                style={[styles.tabText, tab === t.id && styles.tabTextActive]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'discover' ? (
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.discoverScroll}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.statsBlock}>
              <Text style={styles.statsTitle}>Deine Entdeckungen</Text>
              {exploreProgress.cityName ? (
                <Text style={styles.statsCity}>{exploreProgress.cityName}</Text>
              ) : null}
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {exploreProgress.areaPercent} %
                  </Text>
                  <Text style={styles.statLabel}>Fläche erkundet</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>
                    {exploreProgress.seenPlaces}
                    {exploreProgress.totalPlaces > 0
                      ? ` / ${exploreProgress.totalPlaces}`
                      : ''}
                  </Text>
                  <Text style={styles.statLabel}>
                    Orte
                    {exploreProgress.placePercent > 0
                      ? ` · ${exploreProgress.placePercent} %`
                      : ''}
                  </Text>
                </View>
              </View>
              <Text style={styles.statsHint}>
                Yorro merkt sich, wo du warst — je mehr du unterwegs bist, desto
                vollständiger wird dein Entdeckungsstand.
              </Text>
              <View style={styles.shareRow}>
                <Pressable
                  style={styles.shareChip}
                  onPress={() => {
                    void shareFindusText(
                      buildStampRecapShareText({
                        cityName: exploreProgress.cityName,
                        seenPlaces: exploreProgress.seenPlaces,
                        areaPercent: exploreProgress.areaPercent,
                      }),
                      exploreProgress.cityName ?? 'Stempelkarte',
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Entdeckungen teilen"
                >
                  <Text style={styles.shareChipTxt}>Entdeckungen teilen</Text>
                </Pressable>
                <Pressable
                  style={styles.shareChip}
                  onPress={() => {
                    void shareFindusText(
                      buildTripInviteShareText({
                        cityName: exploreProgress.cityName,
                      }),
                      'Yorro mitnehmen',
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Freund einladen"
                >
                  <Text style={styles.shareChipTxt}>Freund einladen</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        ) : null}

        {tab === 'route' ? (
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.list}
            nestedScrollEnabled
            scrollEnabled={!routeListDragging}
            keyboardShouldPersistTaps="handled"
          >
            {multiStopTour?.stops?.length ? (
              <DraggableStopList
                stops={multiStopTour.stops}
                currentIndex={multiStopTour.currentIndex}
                onDraggingChange={setRouteListDragging}
              />
            ) : routePlan ? (
              (() => {
                const bike = transportMode === 'bicycle';
                const mpm = bike ? getPlanBikeMPerMin() : getPlanWalkMPerMin();
                const remaining = routePlan.remainingM;
                const mins = Math.max(
                  1,
                  Math.round(remaining / Math.max(1, mpm)),
                );
                const eta = bike ? `~${mins} Min Rad` : `~${mins} Min Fuß`;
                return (
                  <View style={styles.routeStop}>
                    <Text style={styles.routeStopIcon}>→</Text>
                    <View style={styles.routeStopCopy}>
                      <Text style={styles.routeStopMeta} numberOfLines={1}>
                        {formatKm(remaining)} · {eta}
                      </Text>
                      <Text style={styles.routeStopText} numberOfLines={2}>
                        {routePlan.destinationName}
                      </Text>
                    </View>
                  </View>
                );
              })()
            ) : !hasRoute ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyEmoji}>🧭</Text>
                <Text style={styles.empty}>
                  Noch keine aktive Route. Sag Yorro wohin — oder nutze Schnell
                  hinzufügen unten.
                </Text>
              </View>
            ) : null}

            {hasRoute ? (
              <Pressable
                style={styles.clearRouteBtn}
                onPress={onClearRoute}
                accessibilityRole="button"
                accessibilityLabel="Route löschen"
              >
                <Text style={styles.clearRouteTxt}>Route löschen</Text>
              </Pressable>
            ) : null}

            <View style={styles.quickBlock}>
              <Text style={styles.quickTitle}>Schnell hinzufügen</Text>
              <View style={styles.quickRow}>
                {quickAdds.map((q) => (
                  <Pressable
                    key={q.label}
                    style={styles.quickChip}
                    onPress={() => onQuickAdd(q.prompt)}
                  >
                    <Text style={styles.quickChipTxt} numberOfLines={1}>
                      {q.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {navHistory.length > 0 ? (
                <>
                  <Text style={styles.quickSubtitle}>Letzte Suchanfragen</Text>
                  {navHistory.slice(0, 5).map((q) => (
                    <Pressable
                      key={q}
                      style={styles.historyRow}
                      onPress={() => onQuickAdd(q)}
                    >
                      <Text style={styles.historyTxt} numberOfLines={1}>
                        {q}
                      </Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
            </View>
          </ScrollView>
        ) : null}
      </SwipeBackView>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay,
    elevation: UI_LAYER.overlay,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    height: '88%',
    maxHeight: '88%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.lg,
    zIndex: 1,
    elevation: 1,
  },
  discoverScroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: 14,
  },
  bodyScroll: {
    flex: 1,
    minHeight: 0,
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
    gap: 10,
    flexGrow: 1,
  },
  statsBlock: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  statsTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  statsCity: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statDivider: {
    width: 1,
    height: 48,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  statValue: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 32,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  statsHint: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  shareRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.md,
  },
  shareChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.16)',
  },
  shareChipTxt: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
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
  routeStop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  routeStopIcon: {
    width: 22,
    color: colors.accent,
    fontWeight: '800',
    fontSize: 18,
    marginTop: 2,
  },
  routeStopCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  routeStopMeta: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  routeStopText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  quickBlock: {
    marginTop: spacing.md,
    gap: 8,
  },
  quickTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  quickSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 6,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  quickChipTxt: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 13,
  },
  historyRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyTxt: {
    color: colors.text,
    fontSize: 14,
  },
  clearRouteBtn: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(217, 107, 92, 0.55)',
    backgroundColor: 'rgba(217, 107, 92, 0.22)',
  },
  clearRouteTxt: {
    color: colors.danger,
    fontWeight: '800',
    fontSize: 15,
  },
});
