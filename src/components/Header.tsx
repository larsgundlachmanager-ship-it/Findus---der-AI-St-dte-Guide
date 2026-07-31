/**
 * Top-Left Live HUD — Idle / POI Reached / Active Navigation (Masterbook V5).
 * Tippen öffnet Stempelkarte/Karte/Route. Turn-by-Turn bleibt am Kompass.
 *
 * GPS / distance ticks only re-render NavHudMeta — not the shell or settings.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  evaluateProactiveHud,
  getActiveHudTip,
  getHudTickerLines,
  HUD_ENGINE_INTERVAL_MS,
  subscribeHudTip,
  tickProactiveReminderEngine,
  type HudTipCandidate,
} from '../services/ui/hudTicker';
import {
  loadHudHintPrefs,
  markHudRouteOverlayUsed,
  markHudStempelkarteUsed,
  shouldShowRouteOverlayHint,
  shouldShowStempelkarteHint,
} from '../services/ui/hudHintPrefs';
import { markFeatureTipCompleted } from '../services/ai/featureTips';
import { presenceHint } from '../runtime/uiModule';
import { resolvePlacePresence } from '../services/geo/placePresence';

const STEMPELKARTE_HINT = 'Tippen für Stempelkarte';
const ROUTE_HINT = 'Tippen für geplante Route';

export type PassportTab = 'discover' | 'route' | 'timeline';

/** Legacy aliases from older 3-tab UI */
export type PassportTabLegacy = 'stamps' | 'map' | 'route' | PassportTab;

export function normalizePassportTab(
  tab?: PassportTabLegacy | null,
): PassportTab {
  if (tab === 'route') return 'route';
  if (tab === 'timeline') return 'timeline';
  return 'discover';
}

type Props = {
  onOpenSettings?: () => void;
  onOpenPlanning?: () => void;
  planningBadgeCount?: number;
  onOpenPassport?: (opts?: { tab?: PassportTab }) => void;
  /** Long-press HUD → Findus erzählt mehr zum aktuellen Inhalt */
  onTellMore?: (prompt: string) => void;
  /** Optionaler Messpunkt für UI-Tutorials (📍 Top-Left HUD) */
  locationRef?: React.RefObject<View | null>;
  settingsRef?: React.RefObject<View | null>;
  /** Messpunkt Kalender / Tagesplan */
  planningRef?: React.RefObject<View | null>;
  settingsDisabled?: boolean;
};

function formatKm(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

type HudMode = 'idle' | 'poi' | 'nav';

/**
 * Distance / progress line — isolated so meter ticks don't re-render HUD shell.
 * Selector returns a primitive string (Object.is) so identical labels skip render.
 */
const NavHudMeta = React.memo(function NavHudMeta({
  showRouteHint,
}: {
  showRouteHint: boolean;
}) {
  const meta = useFinnusStore((s) => {
    const tour = s.multiStopTour;
    const isMultiStop = tour != null && tour.stops.length > 1;
    const footTotalM = tour ? tour.estimatedDistanceM : s.navTotalDistanceM;
    const remaining = s.navDistanceM ?? footTotalM;
    const stopProg = isMultiStop
      ? `Stop ${Math.min(tour!.currentIndex + 1, tour!.stops.length)}/${tour!.stops.length}`
      : null;
    const parts = [
      stopProg,
      s.navLegDistanceM != null && s.navLegDistanceM > 0
        ? `Nächster Punkt ${formatKm(s.navLegDistanceM)}`
        : null,
      remaining != null ? `Gesamt noch ${formatKm(remaining)}` : null,
      s.navPhase === 'in_transit'
        ? 'ÖPNV'
        : s.navPhase === 'walk_to_stop'
          ? 'Zur Haltestelle'
          : null,
      showRouteHint ? ROUTE_HINT : null,
    ].filter(Boolean);
    return parts.join(' · ') || 'Route aktiv';
  });

  return (
    <Text style={styles.meta} numberOfLines={2}>
      {meta}
    </Text>
  );
});

export const Header = React.memo(function Header({
  onOpenSettings,
  onOpenPlanning,
  planningBadgeCount = 0,
  onOpenPassport,
  onTellMore,
  locationRef,
  settingsRef,
  planningRef,
  settingsDisabled,
}: Props) {
  // Primitive / stable selectors only — no continuous GPS / meter fields here.
  const currentLocationName = useFinnusStore((s) => s.currentLocationName);
  const currentPoiId = useFinnusStore((s) => s.currentPoiId);
  const currentPoiKind = useFinnusStore((s) => {
    if (s.currentPoiId == null) return null;
    const p = s.pois.find((x) => x.id === s.currentPoiId);
    return p?.kind ?? null;
  });
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);
  const isAudiblySpeaking = useFinnusStore((s) => s.isAudiblySpeaking);
  const navActive = useFinnusStore((s) => s.navActive);
  const navVisible = useFinnusStore((s) => s.navVisible);
  const navTargetName = useFinnusStore((s) => s.navTargetName);
  const navNextTargetName = useFinnusStore((s) => s.navNextTargetName);
  const multiStopCount = useFinnusStore(
    (s) => s.multiStopTour?.stops.length ?? 0,
  );
  const multiStopIndex = useFinnusStore(
    (s) => s.multiStopTour?.currentIndex ?? 0,
  );
  const multiStopName = useFinnusStore(
    (s) => s.multiStopTour?.stops[s.multiStopTour.currentIndex]?.name ?? null,
  );
  const stampCount = useFinnusStore((s) => s.visitedHistory.length);
  const findusPresence = useFinnusStore((s) => s.findusPresence);

  const navigating = navActive && navVisible;
  const openPassportRef = useRef(onOpenPassport);
  openPassportRef.current = onOpenPassport;

  const [hintTick, setHintTick] = useState(0);
  const refreshHints = useCallback(() => {
    void loadHudHintPrefs().then(() => {
      setHintTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    refreshHints();
  }, [refreshHints]);

  const [activeTip, setActiveTip] = useState<HudTipCandidate | null>(null);
  const tickerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    evaluateProactiveHud({ force: true });
    void tickProactiveReminderEngine({ force: true });
    setActiveTip(getActiveHudTip());
    const unsub = subscribeHudTip(() => {
      setActiveTip(getActiveHudTip());
    });
    const interval = setInterval(() => {
      evaluateProactiveHud({ force: true });
      void tickProactiveReminderEngine({ force: true });
    }, HUD_ENGINE_INTERVAL_MS);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!activeTip) return;
    tickerOpacity.setValue(0.35);
    Animated.timing(tickerOpacity, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [activeTip?.id, activeTip?.text, tickerOpacity]);

  const hud = useMemo(() => {
    const showStampHint = shouldShowStempelkarteHint(stampCount);
    const isMultiStop = multiStopCount > 1;
    const showRouteHint = isMultiStop && shouldShowRouteOverlayHint();
    const pin = '📍';

    // Level 1 (highest): Wegpunkt / Ort erreicht — Pfeil + Name (+ Pin)
    if (currentPoiId != null && currentLocationName?.trim()) {
      const isMain = currentPoiKind === 'area' || currentPoiKind === 'legacy';
      const name = currentLocationName.trim();
      return {
        mode: 'poi' as HudMode,
        label: isAudiblySpeaking ? 'Ort · Findus erzählt' : 'Wegpunkt',
        title: `→ ${pin} ${name}`,
        meta: isAudiblySpeaking
          ? 'Findus erzählt · Lang drücken für mehr'
          : isMain
            ? 'Hauptort · Tippen: Stempelkarte · Lang: mehr erfahren'
            : 'Ort · Tippen: Stempelkarte · Lang: mehr erfahren',
        openTab: 'discover' as PassportTab,
        markRoute: false,
        showRouteHint: false,
        presence: findusPresence,
        tellMorePrompt: `Erzähl mir mehr über ${name} — spannend und kurz.`,
      };
    }

    // Level 2: aktive Navigation
    if (navigating) {
      const waypoint =
        navNextTargetName?.trim() ||
        navTargetName?.trim() ||
        multiStopName ||
        'Ziel';
      const navMetaParts: string[] = [];
      const presenceLine = presenceHint(findusPresence);
      if (presenceLine) navMetaParts.push(presenceLine);
      navMetaParts.push('Lang drücken: mehr zur Route');

      return {
        mode: 'nav' as HudMode,
        label: 'Navigation',
        title: `Navigiere zu: ${waypoint}`,
        meta: navMetaParts.join(' · ') || undefined,
        openTab: 'route' as PassportTab,
        markRoute: true,
        showRouteHint,
        presence: findusPresence,
        tellMorePrompt: `Kurz: wie komme ich zu ${waypoint} und worauf soll ich achten?`,
      };
    }

    // Level 3: Live-Berater — Geofence-Snap (Hotel/Stillstand ≠ „Unterwegs“)
    const presence = resolvePlacePresence();
    const place = currentLocationName?.trim() || 'der Gegend';
    const idleMetaParts: string[] = [];
    const presenceLine = presenceHint(findusPresence);
    if (presenceLine) idleMetaParts.push(presenceLine);
    if (__DEV__ && isSimulationMode) idleMetaParts.push('Simulation');
    if (stampCount > 0) idleMetaParts.push(`${stampCount} Stempel`);
    if (showStampHint) {
      idleMetaParts.push('Tippen: Stempelkarte');
    }
    idleMetaParts.push('Lang: mehr dazu');

    const tellPlace =
      presence.role === 'hotel'
        ? presence.hotelName
        : presence.role === 'poi'
          ? presence.poiName
          : place;

    return {
      mode: 'idle' as HudMode,
      label: presence.label,
      title: presence.title,
      meta: idleMetaParts.join(' · '),
      openTab: 'discover' as PassportTab,
      markRoute: false,
      showRouteHint: false,
      presence: findusPresence,
      tellMorePrompt: `Was wäre jetzt bei ${tellPlace} am hilfreichsten für mich? Kurz und konkret.`,
    };
  }, [
    navigating,
    navNextTargetName,
    navTargetName,
    multiStopCount,
    multiStopIndex,
    multiStopName,
    stampCount,
    currentPoiId,
    currentPoiKind,
    currentLocationName,
    isSimulationMode,
    isAudiblySpeaking,
    findusPresence,
    hintTick,
  ]);

  // Idle: Live-Berater — mehrere Erinnerungszeilen + Top-Tipp
  const [reminderLines, setReminderLines] = useState<string[]>([]);
  useEffect(() => {
    const refresh = () => setReminderLines(getHudTickerLines());
    refresh();
    const id = setInterval(refresh, HUD_ENGINE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const showingTicker = Boolean(activeTip) && hud.mode === 'idle';
  const titleLine = hud.title;
  const idleReminderMeta = (() => {
    const lines = [
      activeTip?.text,
      ...(activeTip?.meta ? [activeTip.meta] : []),
      ...reminderLines.filter((l) => l !== activeTip?.text),
    ].filter(Boolean) as string[];
    return lines.slice(0, 4).join(' · ');
  })();
  const metaLine =
    hud.mode === 'idle' && idleReminderMeta
      ? `${idleReminderMeta} · Lang drücken: mehr`
      : showingTicker && activeTip
        ? [activeTip.text, activeTip.meta, 'Lang drücken: mehr'].filter(Boolean).join(' · ')
        : hud.meta || null;

  const handleOpenPassport = useCallback(() => {
    void markHudStempelkarteUsed();
    void markFeatureTipCompleted('visit_passport');
    if (hud.openTab === 'route' || hud.markRoute) {
      void markHudRouteOverlayUsed();
    }
    openPassportRef.current?.({ tab: hud.openTab });
    setTimeout(refreshHints, 80);
  }, [hud.openTab, hud.markRoute, refreshHints]);

  const handleTellMore = useCallback(() => {
    const tip = getActiveHudTip();
    const base =
      hud.mode === 'idle' && tip
        ? `Erzähl mir mehr zu diesem Hinweis: „${tip.text}“. ${tip.meta ?? ''}`.trim()
        : hud.tellMorePrompt;
    onTellMore?.(base);
  }, [hud.mode, hud.tellMorePrompt, onTellMore]);

  return (
    <View style={styles.row} pointerEvents="box-none">
      <View
        ref={locationRef as React.RefObject<View> | undefined}
        collapsable={false}
        style={{ flex: 1 }}
      >
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handleOpenPassport}
          onLongPress={onTellMore ? handleTellMore : undefined}
          delayLongPress={420}
          disabled={!onOpenPassport && !onTellMore}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={
            hud.mode === 'nav'
              ? 'Stempelkarte und Navigation. Lang drücken für mehr Infos.'
              : 'Stempelkarte. Lang drücken für mehr Infos.'
          }
          style={[
            styles.locationPress,
            hud.mode === 'nav' && styles.locationPressNav,
            hud.mode === 'poi' && styles.locationPressPoi,
          ]}
        >
          <View style={styles.labelRow}>
            <View
              style={[
                styles.modeDot,
                hud.mode === 'nav' && styles.modeDotNav,
                hud.mode === 'poi' && styles.modeDotPoi,
                hud.mode === 'idle' && styles.modeDotIdle,
                hud.presence === 'offline' && styles.modeDotOffline,
                hud.presence === 'degraded' && styles.modeDotDegraded,
              ]}
            />
            <Text style={styles.label}>{hud.label}</Text>
          </View>
          <Animated.View style={{ opacity: showingTicker ? tickerOpacity : 1 }}>
            <Text style={styles.location} numberOfLines={2}>
              {titleLine}
            </Text>
          </Animated.View>
          {hud.mode === 'nav' ? (
            <>
              <NavHudMeta showRouteHint={hud.showRouteHint} />
              {hud.meta ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {hud.meta}
                </Text>
              ) : null}
            </>
          ) : metaLine ? (
            <Text style={styles.meta} numberOfLines={2}>
              {metaLine}
            </Text>
          ) : null}
        </TouchableOpacity>
      </View>

      <View
        ref={settingsRef as React.RefObject<View> | undefined}
        collapsable={false}
        style={styles.settingsWrap}
        pointerEvents="auto"
      >
        <View style={styles.rightActions}>
          <View
            ref={planningRef as React.RefObject<View> | undefined}
            collapsable={false}
          >
          <TouchableOpacity
            onPress={() => onOpenPlanning?.()}
            disabled={!onOpenPlanning}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
            activeOpacity={0.75}
            style={[
              styles.settingsBtn,
              !onOpenPlanning && styles.settingsBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Tagesplan"
          >
            <Text style={styles.settingsIcon}>📅</Text>
            {planningBadgeCount > 0 ? (
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>
                  {planningBadgeCount > 9 ? '9+' : String(planningBadgeCount)}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => onOpenSettings?.()}
            disabled={settingsDisabled || !onOpenSettings}
            hitSlop={{ top: 16, bottom: 16, left: 8, right: 16 }}
            activeOpacity={0.75}
            style={[
              styles.settingsBtn,
              (settingsDisabled || !onOpenSettings) && styles.settingsBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Einstellungen"
            accessibilityState={{ disabled: settingsDisabled || !onOpenSettings }}
          >
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    zIndex: UI_LAYER.hud,
    elevation: UI_LAYER.hud,
  },
  locationPress: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 4,
    paddingRight: spacing.sm,
  },
  locationPressNav: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.sm,
  },
  locationPressPoi: {
    borderLeftWidth: 3,
    borderLeftColor: colors.wave,
    paddingLeft: spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  modeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
  },
  modeDotNav: {
    backgroundColor: colors.accent,
  },
  modeDotPoi: {
    backgroundColor: colors.wave,
  },
  modeDotIdle: {
    backgroundColor: colors.textMuted,
  },
  modeDotOffline: {
    backgroundColor: colors.danger,
  },
  modeDotDegraded: {
    backgroundColor: '#E8B84A',
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  location: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  meta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  settingsWrap: {
    marginTop: 2,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  settingsBtnDisabled: {
    opacity: 0.45,
  },
  settingsIcon: {
    fontSize: 20,
  },
  planBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.thinking,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  planBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});
