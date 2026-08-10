import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { useFinnusStore } from '../store/useFinnusStore';
import { getNavigationRoutePlan } from '../services/navigation';
import {
  STAMP_MAP_LEGEND,
  colorForStampCategory,
  resolveStampMapCategory,
  type StampMapCategory,
} from '../services/navigation/stampMapCategories';
import {
  MODUL1_MAP_CATEGORY,
  MODUL1_MAP_COLORS,
} from '../services/navigation/stampMapModul1';
import { clearNavigationHard } from '../services/navigation/hardNavOverride';
import {
  getTopQuickAddTargets,
  loadNavSearchHistory,
  recordNavSearch,
} from '../services/navigation/navSearchHistory';
import { StampCityMap, type StampMapMarker } from './StampCityMap';
import { DraggableStopList } from './DraggableStopList';
import { SwipeBackView } from './SwipeBackView';
import { computeAreaCoverage } from '../services/discovery/areaCoverageService';
import { ensureActiveCityCoverageBounds } from '../services/discovery/cityCoverageBounds';
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
  loadStampPassportUxPrefs,
  markStampMapInteracted,
  shouldShowStampMapOnboarding,
} from '../services/ui/stampPassportUxPrefs';
import {
  getPlanBikeMPerMin,
  getPlanWalkMPerMin,
} from '../services/mobility/paceProfile';

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

const CATEGORY_PLURAL: Partial<Record<StampMapCategory, string>> = {
  modul1: 'Modul-1-Trigger',
  essen: 'Restaurants',
  cafe: 'Cafés',
  kultur: 'Kulturorte',
  natur: 'Naturspots',
  kirche: 'Kirchen',
  transport: 'Transit-Stops',
  hotel: 'Hotels',
  einkaufen: 'Läden',
  service: 'Services',
  freizeit: 'Freizeitorte',
  sonstiges: 'Orte',
};

/**
 * Stempelkarte / Reisepass — Overlay statt RN-Modal
 * (Android blockiert Modals oft während aktiver Navigation).
 */
export function VisitPassportModal({
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
  const [showVisited, setShowVisited] = useState(true);
  const [enabledCategories, setEnabledCategories] = useState<
    Set<StampMapCategory>
  >(() => new Set());
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [quickAdds, setQuickAdds] = useState(getTopQuickAddTargets());
  const [routeListDragging, setRouteListDragging] = useState(false);
  const [showMapOnboarding, setShowMapOnboarding] = useState(true);
  const [coverageTick, setCoverageTick] = useState(0);
  const [mapWidth, setMapWidth] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const lastGpsLat = useGpsStore((s) => s.lat);
  const lastGpsLng = useGpsStore((s) => s.lng);
  const transportMode = useFinnusStore((s) => s.transportMode);

  const navigating = navActive && navVisible;
  const routePlan = navigating || multiStopTour ? getNavigationRoutePlan() : null;
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
    void loadStampPassportUxPrefs().then(() => {
      setShowMapOnboarding(shouldShowStampMapOnboarding());
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

  const areaCoverage = useMemo(() => {
    void coverageTick;
    return computeAreaCoverage({
      pois,
      walkTrack: getWalkTrackSnapshot(),
      userLoc,
    });
  }, [pois, userLoc, coverageTick]);

  const onMapInteracted = useCallback(() => {
    void markStampMapInteracted().then(() => {
      setShowMapOnboarding(false);
    });
  }, []);

  const toggleCategory = useCallback((id: StampMapCategory) => {
    setEnabledCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const visitedPoiIds = useMemo(() => {
    const s = new Set<number>();
    for (const e of visitedHistory) s.add(e.poiId);
    return s;
  }, [visitedHistory]);

  /** Stempel ohne Match im aktuellen Pack — trotzdem auf der Karte zeigen. */
  const orphanVisited = useMemo((): StampMapMarker[] => {
    const poiById = new Map(pois.map((p) => [p.id, p]));
    const out: StampMapMarker[] = [];
    for (const e of visitedHistory) {
      const pack = poiById.get(e.poiId);
      if (pack && Number.isFinite(pack.lat) && Number.isFinite(pack.lng)) {
        continue;
      }
      const lat = e.lat;
      const lng = e.lng;
      if (
        lat == null ||
        lng == null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        continue;
      }
      const category = resolveStampMapCategory({
        category: null,
        name: e.name,
        kind: e.kind,
        tags: null,
      });
      out.push({
        id: e.poiId,
        name: e.name,
        lat,
        lng,
        visited: true,
        category,
        color: colorForStampCategory(category),
      });
    }
    return out;
  }, [visitedHistory, pois]);

  // Alte Stempel ohne lat/lng aus aktuellem Pack nachziehen (einmalig soft)
  useEffect(() => {
    if (!visible || !pois.length) return;
    const cur = useFinnusStore.getState().visitedHistory;
    let changed = false;
    const next = cur.map((e) => {
      if (e.lat != null && e.lng != null) return e;
      const p = pois.find((x) => x.id === e.poiId);
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return e;
      changed = true;
      return { ...e, lat: p.lat, lng: p.lng };
    });
    if (changed) {
      useFinnusStore.setState({ visitedHistory: next });
      void import('../services/navigation/stampPassportPersistence').then((m) =>
        m.saveStampPassport(next),
      );
    }
  }, [visible, pois, visitedHistory.length]);

  const discoveredCount = visitedPoiIds.size;

  const mapHeight = useMemo(() => {
    const w =
      mapWidth > 40
        ? mapWidth
        : Math.max(280, windowWidth - spacing.md * 2);
    return Math.round((w * 10) / 12);
  }, [mapWidth, windowWidth]);

  const areaTotal = useMemo(
    () =>
      pois.filter((p) => p.kind === 'area' || p.kind === 'legacy' || !p.kind)
        .length,
    [pois],
  );

  const onQuickAdd = useCallback(
    (prompt: string) => {
      void recordNavSearch(prompt);
      onQuickNavAdd?.(prompt);
    },
    [onQuickNavAdd],
  );

  const handleBack = useCallback(() => {
    if (showMapOnboarding) {
      setShowMapOnboarding(false);
      return;
    }
    onClose();
  }, [showMapOnboarding, onClose]);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable
        style={styles.backdropTap}
        onPress={handleBack}
        accessibilityLabel="Schließen"
      />
      <SwipeBackView enabled={visible} onBack={handleBack} style={styles.sheet}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.kicker}>🎫 Stempelkarte</Text>
            <Text style={styles.title}>
              {multiStopTour?.title ?? 'Deine Tour'}
            </Text>
            <Text style={styles.subtitle}>
              {areaCoverage.cityName
                ? `${areaCoverage.percent} % von ${areaCoverage.cityName} erkundet · `
                : areaCoverage.percent > 0
                  ? `${areaCoverage.percent} % der Gegend erkundet · `
                  : ''}
              {discoveredCount}
              {areaTotal > 0 ? ` von ${areaTotal}` : ''} Orte entdeckt
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
            {showMapOnboarding ? (
              <View style={styles.guideCard}>
                <Text style={styles.guideTitle}>Deine Entdeckungen</Text>
                <Text style={styles.guideBody}>
                  Oben filterst du Verweilt, Modul-1-Trigger, Restaurants und
                  mehr — darunter die Karte mit Fog-of-War und deinem
                  Erkundungsstand.
                </Text>
              </View>
            ) : null}

            {/* Filter oben: Verweilt · Modul 1 · Restaurants · … */}
            <View style={styles.filterBlock}>
              <Text style={styles.filterHint}>
                Tippe, um Pins auf der Karte ein- oder auszublenden. „Modul-1-Trigger“
                zeigt Orte, an denen Findus von allein sprechen würde (ohne
                Prefs wie „keine Kirchen“).
              </Text>
              <View style={styles.legendRow}>
                <Pressable
                  onPress={() => setShowVisited((v) => !v)}
                  style={[
                    styles.legendItem,
                    showVisited && styles.legendItemOn,
                    !showVisited && styles.legendItemOff,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: showVisited }}
                  accessibilityLabel="Verweilte Orte ein- oder ausblenden"
                >
                  <View style={[styles.dot, styles.dotVisited]}>
                    <Text style={styles.dotCheck}>✓</Text>
                  </View>
                  <Text
                    style={[
                      styles.legendLabel,
                      !showVisited && styles.legendLabelOff,
                    ]}
                  >
                    Verweilt
                  </Text>
                </Pressable>
                {STAMP_MAP_LEGEND.map((item) => {
                  const on = enabledCategories.has(item.id);
                  const isModul1 = item.id === MODUL1_MAP_CATEGORY;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => toggleCategory(item.id)}
                      style={[
                        styles.legendItem,
                        on && styles.legendItemOn,
                        !on && styles.legendItemOff,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${item.label}${on ? ' ausblenden' : ' einblenden'}`}
                    >
                      {isModul1 ? (
                        <View style={styles.modul1Dots}>
                          <View
                            style={[
                              styles.dot,
                              { backgroundColor: MODUL1_MAP_COLORS.neutral },
                              !on && styles.dotOff,
                            ]}
                          />
                          <View
                            style={[
                              styles.dot,
                              { backgroundColor: MODUL1_MAP_COLORS.liked },
                              !on && styles.dotOff,
                            ]}
                          />
                          <View
                            style={[
                              styles.dot,
                              { backgroundColor: MODUL1_MAP_COLORS.visited },
                              !on && styles.dotOff,
                            ]}
                          />
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: item.color },
                            !on && styles.dotOff,
                          ]}
                        />
                      )}
                      <Text
                        style={[
                          styles.legendLabel,
                          !on && styles.legendLabelOff,
                        ]}
                      >
                        {CATEGORY_PLURAL[item.id] ?? item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {enabledCategories.has(MODUL1_MAP_CATEGORY) ? (
                <View style={styles.modul1ToneRow}>
                  <View style={styles.modul1ToneItem}>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: MODUL1_MAP_COLORS.neutral },
                      ]}
                    />
                    <Text style={styles.modul1ToneLabel}>Neutral</Text>
                  </View>
                  <View style={styles.modul1ToneItem}>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: MODUL1_MAP_COLORS.liked },
                      ]}
                    />
                    <Text style={styles.modul1ToneLabel}>Gerne · offen</Text>
                  </View>
                  <View style={styles.modul1ToneItem}>
                    <View
                      style={[
                        styles.dot,
                        styles.dotVisited,
                        { backgroundColor: MODUL1_MAP_COLORS.visited },
                      ]}
                    >
                      <Text style={styles.dotCheck}>✓</Text>
                    </View>
                    <Text style={styles.modul1ToneLabel}>Schon da</Text>
                  </View>
                </View>
              ) : null}
            </View>

            {/* Karte + Prozent / Fortschritt */}
            <View
              style={styles.mapBlock}
              onLayout={(e) => setMapWidth(e.nativeEvent.layout.width)}
            >
              <View style={styles.coverageBadge}>
                <Text style={styles.coverageValue}>{areaCoverage.percent} %</Text>
                <Text style={styles.coverageLabel}>
                  {areaCoverage.cityName
                    ? `${areaCoverage.cityName} erkundet`
                    : 'Fläche erkundet'}
                </Text>
                <Text style={styles.coverageCount}>
                  {discoveredCount}
                  {areaTotal > 0 ? ` / ${areaTotal}` : ''} Orte
                </Text>
              </View>
              <StampCityMap
                pois={pois}
                visitedPoiIds={visitedPoiIds}
                showVisited={showVisited}
                orphanVisited={orphanVisited}
                enabledCategories={enabledCategories}
                height={mapHeight}
                onMapInteracted={onMapInteracted}
                showDayRoute={false}
              />
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
                  Noch keine aktive Route. Sag Findus wohin — oder nutze Schnell
                  hinzufügen unten.
                </Text>
              </View>
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

            <Pressable
              style={styles.clearRouteBtn}
              onPress={() => {
                void clearNavigationHard({ silent: true });
                onClose();
              }}
            >
              <Text style={styles.clearRouteTxt}>Route löschen</Text>
            </Pressable>
          </ScrollView>
        ) : null}
      </SwipeBackView>
    </View>
  );
}

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
  mapPane: {
    height: 280,
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    gap: 8,
    zIndex: 2,
    elevation: 4,
    backgroundColor: colors.bgElevated,
  },
  discoverScroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: 14,
  },
  filterBlock: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.bg,
    padding: spacing.md,
    gap: 8,
  },
  filterTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  filterHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  legendItemOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  legendItemOff: {
    opacity: 0.55,
  },
  legendLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  legendLabelOff: {
    color: colors.textMuted,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotOff: {
    opacity: 0.35,
  },
  modul1Dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  modul1ToneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  modul1ToneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  modul1ToneLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  dotVisited: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotCheck: {
    color: colors.bg,
    fontSize: 8,
    fontWeight: '800',
    lineHeight: 10,
  },
  timelineHeader: {
    gap: 4,
    marginTop: 4,
  },
  timelineTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  timelineSub: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  guideCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.bg,
    padding: spacing.md,
    gap: 6,
  },
  guideTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  guideBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  stampsPane: {
    flex: 1,
    minHeight: 0,
  },
  mapBlock: {
    marginHorizontal: -spacing.md,
    paddingHorizontal: 0,
    gap: 10,
    paddingBottom: spacing.sm,
    position: 'relative',
  },
  coverageBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.md,
    zIndex: UI_LAYER.sheet + 2,
    backgroundColor: 'rgba(8, 18, 14, 0.88)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 72,
  },
  coverageValue: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
  },
  coverageLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  coverageCount: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  bodyScroll: {
    flex: 1,
    minHeight: 0,
  },
  stampList: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: 14,
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  toggleText: {
    flex: 1,
    minWidth: 0,
  },
  toggleTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  toggleHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  statsBlock: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.bg,
    padding: spacing.md,
    gap: 4,
  },
  nerdBlock: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.bg,
    padding: spacing.md,
    gap: 10,
  },
  nerdTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  nerdRow: {
    gap: 2,
  },
  nerdPoi: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  nerdFact: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  statsLine: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
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
    marginBottom: 6,
  },
  summary: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.9,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  historyBar: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  histChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 6,
  },
  histChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  histChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  histChipTextOn: { color: colors.text },
  histSummary: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 6,
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
  routeStopDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
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
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(217, 107, 92, 0.22)',
  },
  clearRouteTxt: {
    color: colors.danger,
    fontWeight: '700',
  },
});
