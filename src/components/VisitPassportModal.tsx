import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { useFinnusStore } from '../store/useFinnusStore';
import { useUserMemoryStore } from '../store/useUserMemoryStore';
import { getNavigationRoutePlan } from '../services/navigation';
import {
  emojiForPlace,
  toStampSummary,
} from '../services/navigation/stampBullets';
import {
  labelForStampCategory,
  resolveStampMapCategory,
  STAMP_MAP_LEGEND,
  type StampMapCategory,
} from '../services/navigation/stampMapCategories';
import { clearNavigationHard } from '../services/navigation/hardNavOverride';
import {
  getTopQuickAddTargets,
  loadNavSearchHistory,
  recordNavSearch,
} from '../services/navigation/navSearchHistory';
import { StampCityMap } from './StampCityMap';
import { DraggableStopList } from './DraggableStopList';
import { computeAreaCoverage } from '../services/discovery/areaCoverageService';
import { ensureActiveCityCoverageBounds } from '../services/discovery/cityCoverageBounds';
import {
  getWalkTrackSnapshot,
  listWalkTrackDateKeys,
  loadWalkTrack,
} from '../services/discovery/walkTrackService';
import { useGpsStore } from '../store/useGpsStore';
import { useDayPlanStore } from '../store/useDayPlanStore';
import { todayDateKey, clockLabel } from '../types/dayPlan';
import {
  hydrateVisitLog,
  getVisitsForDate,
  listVisitDateKeys,
  listVisitMonthKeys,
  visitNodesForMap,
  importStampsIntoVisitLog,
  formatDelayLabel,
  todayVisitSummary,
} from '../services/timeline/visitLog';
import { UnifiedDayAxisView } from './UnifiedDayAxisView';
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
  const entities = useUserMemoryStore((s) => s.entities);
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
  const [historyDateKey, setHistoryDateKey] = useState(todayDateKey());
  const [historyMonth, setHistoryMonth] = useState(() => todayDateKey().slice(0, 7));
  const [visitTick, setVisitTick] = useState(0);
  const lastGpsLat = useGpsStore((s) => s.lat);
  const lastGpsLng = useGpsStore((s) => s.lng);
  const dayPlan = useDayPlanStore((s) => s.plansByDate[historyDateKey]);

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
      setVisitTick((n) => n + 1);
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

  const historyMonths = useMemo(() => {
    void visitTick;
    const fromVisits = listVisitMonthKeys();
    const fromWalk = listWalkTrackDateKeys().map((k) => k.slice(0, 7));
    const fromPlans = Object.keys(useDayPlanStore.getState().plansByDate).map(
      (k) => k.slice(0, 7),
    );
    return [...new Set([...fromVisits, ...fromWalk, ...fromPlans, historyMonth])].sort();
  }, [visitTick, historyMonth]);

  const historyDaysInMonth = useMemo(() => {
    void visitTick;
    const days = new Set<string>();
    for (const k of listVisitDateKeys()) {
      if (k.startsWith(historyMonth)) days.add(k);
    }
    for (const k of listWalkTrackDateKeys()) {
      if (k.startsWith(historyMonth)) days.add(k);
    }
    for (const k of Object.keys(useDayPlanStore.getState().plansByDate)) {
      if (k.startsWith(historyMonth)) days.add(k);
    }
    days.add(todayDateKey());
    return [...days].sort();
  }, [visitTick, historyMonth]);

  const dayVisits = useMemo(() => {
    void visitTick;
    return getVisitsForDate(historyDateKey);
  }, [visitTick, historyDateKey]);

  const mapVisitNodes = useMemo(() => {
    void visitTick;
    return visitNodesForMap(historyDateKey);
  }, [visitTick, historyDateKey]);

  /** Chronological timeline — newest first, keep revisits as separate moments. */
  const timeline = useMemo(() => {
    const out: Array<{
      poiId: number;
      name: string;
      kind: string;
      emoji: string;
      summary: string;
      at: number;
      category: StampMapCategory;
    }> = [];
    for (const e of visitedHistory) {
      const poi = pois.find((p) => p.id === e.poiId);
      const summary = toStampSummary(e.keyFacts, {
        teaser: poi?.teaser_text,
        name: e.name,
      });
      out.push({
        poiId: e.poiId,
        name: e.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim(),
        kind: e.kind,
        emoji: emojiForPlace({
          kind: e.kind,
          category: poi?.category,
          name: e.name,
        }),
        summary,
        at: e.visitedAt,
        category: resolveStampMapCategory({
          category: poi?.category,
          name: e.name,
          kind: e.kind,
          tags: poi?.tags_json,
        }),
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [pois, visitedHistory]);

  const stamps = useMemo(() => {
    const seen = new Set<number>();
    return timeline.filter((s) => {
      if (seen.has(s.poiId)) return false;
      seen.add(s.poiId);
      return true;
    });
  }, [timeline]);

  const areaTotal = useMemo(
    () =>
      pois.filter((p) => p.kind === 'area' || p.kind === 'legacy' || !p.kind)
        .length,
    [pois],
  );

  const categoryStats = useMemo(() => {
    const counts = new Map<StampMapCategory, number>();
    for (const s of stamps) {
      counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => {
        const plural = CATEGORY_PLURAL[cat] ?? labelForStampCategory(cat);
        return `${n} ${plural}`;
      });
  }, [stamps]);

  const dwellMinutes = useMemo(() => {
    let sum = 0;
    for (const e of entities) {
      if (typeof e.dwellTimeMinutes === 'number' && e.dwellTimeMinutes > 0) {
        sum += e.dwellTimeMinutes;
      }
    }
    return Math.round(sum);
  }, [entities]);

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
      <View style={styles.sheet}>
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
              {stamps.length}
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
              { id: 'timeline' as const, label: 'Zeitachse' },
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

        <View style={styles.historyBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {historyMonths.map((m) => (
              <Pressable
                key={m}
                style={[
                  styles.histChip,
                  historyMonth === m && styles.histChipOn,
                ]}
                onPress={() => {
                  setHistoryMonth(m);
                  const days = [
                    ...listVisitDateKeys(),
                    ...listWalkTrackDateKeys(),
                    ...Object.keys(useDayPlanStore.getState().plansByDate),
                  ].filter((d) => d.startsWith(m));
                  const uniq = [...new Set(days)].sort();
                  if (uniq.length) setHistoryDateKey(uniq[uniq.length - 1]!);
                  else setHistoryDateKey(`${m}-01`);
                }}
              >
                <Text
                  style={[
                    styles.histChipText,
                    historyMonth === m && styles.histChipTextOn,
                  ]}
                >
                  {m}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 6 }}
          >
            {historyDaysInMonth.map((d) => (
              <Pressable
                key={d}
                style={[
                  styles.histChip,
                  historyDateKey === d && styles.histChipOn,
                ]}
                onPress={() => setHistoryDateKey(d)}
              >
                <Text
                  style={[
                    styles.histChipText,
                    historyDateKey === d && styles.histChipTextOn,
                  ]}
                >
                  {d.slice(8)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.histSummary}>
            {todayVisitSummary(historyDateKey)} · {historyDateKey}
          </Text>
        </View>

        {tab === 'discover' ? (
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.discoverScroll}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 1 · Flüchtiger Onboarding-Text */}
            {showMapOnboarding ? (
              <View style={styles.guideCard}>
                <Text style={styles.guideTitle}>Deine Tour & Entdeckungen</Text>
                <Text style={styles.guideBody}>
                  Zoome und wische auf der Karte. Darunter filterst du
                  Kategorien — und ganz unten siehst du chronologisch, wann du
                  wo warst.
                </Text>
              </View>
            ) : null}

            {/* 2 · Interaktive Karte */}
            <View style={styles.mapBlock}>
              <View style={styles.coverageBadge}>
                <Text style={styles.coverageValue}>{areaCoverage.percent} %</Text>
                <Text style={styles.coverageLabel}>
                  {areaCoverage.cityName
                    ? `${areaCoverage.cityName} erkundet`
                    : 'Fläche erkundet'}
                </Text>
              </View>
              <StampCityMap
                pois={pois}
                visitedPoiIds={visitedPoiIds}
                showVisited={showVisited}
                enabledCategories={enabledCategories}
                height={460}
                onMapInteracted={onMapInteracted}
                historyDateKey={historyDateKey}
                visitNodes={mapVisitNodes}
                showDayRoute
              />
            </View>

            {/* 3 · Kategorien & Legende — default nur „Besucht“ */}
            <View style={styles.filterBlock}>
              <Text style={styles.filterTitle}>Kategorien & Legende</Text>
              <Text style={styles.filterHint}>
                Standard: nur Besucht. Weitere Kategorien schalten Pins hinzu.
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
                  accessibilityLabel="Besucht ein- oder ausblenden"
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
                    Besucht
                  </Text>
                </Pressable>
                {STAMP_MAP_LEGEND.map((item) => {
                  const on = enabledCategories.has(item.id);
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
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: item.color },
                          !on && styles.dotOff,
                        ]}
                      />
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
            </View>

            {/* 4 · Chronologische Stempel-Timeline */}
            <View style={styles.timelineHeader}>
              <Text style={styles.timelineTitle}>Wann warst du wo?</Text>
              <Text style={styles.timelineSub}>
                {stamps.length}
                {areaTotal > 0 ? ` von ${areaTotal}` : ''} Orten
                {categoryStats.length
                  ? ` · ${categoryStats.slice(0, 3).join(' · ')}`
                  : ''}
                {dwellMinutes > 0 ? ` · ${dwellMinutes} Min verweilt` : ''}
              </Text>
            </View>

            {timeline.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyEmoji}>🗺️</Text>
                <Text style={styles.empty}>
                  Noch keine Stempel — sobald du an einem Ort verweilst oder
                  Findus erzählt, landet er hier mit Uhrzeit.
                </Text>
              </View>
            ) : (
              timeline.map((s, i) => (
                <View key={`${s.poiId}-${s.at}-${i}`} style={styles.card}>
                  <View style={styles.stampSeal}>
                    <Text style={styles.stampEmoji}>{s.emoji}</Text>
                    <Text style={styles.stampNum}>
                      {new Date(s.at).toLocaleTimeString('de-DE', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {s.name}
                    </Text>
                    <Text style={styles.cardMeta}>
                      {new Date(s.at).toLocaleDateString('de-DE', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                      })}
                      {' · '}
                      {labelForStampCategory(s.category)}
                    </Text>
                    <Text style={styles.summary} numberOfLines={3}>
                      {s.summary}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        ) : null}

        {tab === 'timeline' ? (
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.discoverScroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.mapBlock}>
              <StampCityMap
                pois={pois}
                visitedPoiIds={visitedPoiIds}
                showVisited
                enabledCategories={new Set()}
                height={320}
                onMapInteracted={onMapInteracted}
                historyDateKey={historyDateKey}
                visitNodes={mapVisitNodes}
                showDayRoute
              />
            </View>

            <View style={styles.timelineHeader}>
              <Text style={styles.timelineTitle}>Eine Achse</Text>
              <Text style={styles.timelineSub}>
                Oben Zeitachse (bis jetzt) · unten Planung · Modul-1-Orte inklusive
              </Text>
            </View>

            <UnifiedDayAxisView
              dateKey={historyDateKey}
              refreshKey={`${visitTick}-${dayPlan?.updatedAtMs ?? 0}-${dayVisits.length}`}
              compact
            />

            <View style={styles.timelineHeader}>
              <Text style={styles.timelineTitle}>Visit-Log</Text>
              <Text style={styles.timelineSub}>
                Ankunft · Abfahrt · Verweildauer
              </Text>
            </View>
            {dayVisits.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.empty}>
                  Keine Besuche an diesem Tag — Nav, Dwell und Stempel füllen
                  das Log automatisch.
                </Text>
              </View>
            ) : (
              dayVisits.map((v) => (
                <View key={v.id} style={styles.card}>
                  <View style={styles.stampSeal}>
                    <Text style={styles.stampEmoji}>📍</Text>
                    <Text style={styles.stampNum}>
                      {clockLabel(v.arrivedAtMs)}
                    </Text>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{v.name}</Text>
                    <Text style={styles.cardMeta}>
                      {v.leftAtMs
                        ? `bis ${clockLabel(v.leftAtMs)}`
                        : 'noch vor Ort'}
                      {v.dwellMin != null ? ` · ${v.dwellMin} Min` : ''}
                      {v.delayMs != null && formatDelayLabel(v.delayMs)
                        ? ` · ${formatDelayLabel(v.delayMs)}`
                        : ''}
                      {' · '}
                      {v.source}
                    </Text>
                  </View>
                </View>
              ))
            )}
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
            {multiStopTour ? (
              <View style={styles.routeSummary}>
                <Text style={styles.routeLine}>
                  Nächster Stop ·{' '}
                  {multiStopTour.stops[multiStopTour.currentIndex]?.name ?? '—'}
                </Text>
                <Text style={styles.routeLine}>
                  Stop{' '}
                  {Math.min(
                    multiStopTour.currentIndex + 1,
                    multiStopTour.stops.length,
                  )}
                  /{multiStopTour.stops.length}
                  {' · '}~{formatKm(multiStopTour.estimatedDistanceM)} zu Fuß
                </Text>
              </View>
            ) : routePlan ? (
              <View style={styles.routeSummary}>
                <Text style={styles.routeLine}>
                  Nächster Punkt: {routePlan.nextPointName} (
                  {formatKm(routePlan.legM)})
                </Text>
                <Text style={styles.routeLine}>
                  Ziel: {routePlan.destinationName} · noch{' '}
                  {formatKm(routePlan.remainingM)}
                </Text>
              </View>
            ) : !hasRoute ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyEmoji}>🧭</Text>
                <Text style={styles.empty}>
                  Noch keine aktive Route. Sag Findus wohin — oder nutze Schnell
                  hinzufügen unten.
                </Text>
              </View>
            ) : (
              <View style={styles.routeSummary}>
                <Text style={styles.routeLine}>Route aktiv</Text>
              </View>
            )}

            {multiStopTour?.stops?.length ? (
              <DraggableStopList
                stops={multiStopTour.stops}
                currentIndex={multiStopTour.currentIndex}
                onDraggingChange={setRouteListDragging}
              />
            ) : (
              (routePlan?.stops ?? []).map((s, i, arr) => (
                  <View key={`${s.name}-${i}`} style={styles.routeStop}>
                    <Text style={styles.routeStopIcon}>
                      {s.done ? '✓' : arr.findIndex((x) => !x.done) === i ? '→' : '○'}
                    </Text>
                    <Text
                      style={[
                        styles.routeStopText,
                        s.done && styles.routeStopDone,
                      ]}
                    >
                      {s.name}
                    </Text>
                  </View>
                ))
            )}

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
      </View>
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
    paddingHorizontal: spacing.sm,
    gap: 10,
    paddingBottom: spacing.sm,
    position: 'relative',
  },
  coverageBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.md + 4,
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
    alignItems: 'center',
    gap: 8,
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
