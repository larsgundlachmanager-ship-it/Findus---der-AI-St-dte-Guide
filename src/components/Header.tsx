/**
 * Top-Left Live HUD — Idle / POI / Navigation (Masterbook V5).
 * Titel auf einer Höhe mit Kalender/Zahnrad; Idle: swipebare Live-Karten.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { useFinnusStore } from '../store/useFinnusStore';
import { requestOpenPlanCalendar } from '../module2/timeline/planCalendarUiStore';
import {
  evaluateProactiveHud,
  HUD_ENGINE_INTERVAL_MS,
  subscribeHudTip,
  tickProactiveReminderEngine,
} from '../services/ui/hudTicker';
import {
  buildLiveHudCards,
  type LiveHudCard,
} from '../services/ui/liveHudCards';
import {
  ensureMealHudFresh,
  subscribeMealHud,
} from '../services/ui/liveHudMealSuggestions';
import {
  ensureNearbyAmenityHudFresh,
  subscribeNearbyAmenityHud,
} from '../services/ui/liveHudNearbyAmenities';
import {
  loadHudHintPrefs,
  markHudLongPressMoreUsed,
  markHudRouteOverlayUsed,
  markHudStempelkarteUsed,
  shouldShowLongPressMoreHint,
  shouldShowRouteOverlayHint,
} from '../services/ui/hudHintPrefs';
import { markFeatureTipCompleted } from '../services/ai/featureTips';
import {
  bootstrapUiCoachMarks,
  onUserOpenedPlanCalendar,
  onUserOpenedSettings,
  shouldShowCoachPlanCalendar,
  shouldShowCoachSettings,
  shouldShowCoachStamp,
} from '../services/onboarding/uiCoachMarks';
import { presenceHint } from '../runtime/uiModule';
import { formatNavHudTitle } from '../services/navigation/transportMode';
import {
  bikeMinutesForDistanceM,
  walkMinutesForDistanceM,
} from '../services/navigation/travelEta';
import { getCachedUserProfile } from '../services/userProfileService';
import { resolvePersonaEngine } from '../services/personaEngine';
import { resolveActiveTravelMode } from '../services/navigation/travelModeContext';

const ROUTE_HINT = 'Tippen für geplante Route';
const TAP_TIPS_HINT = 'tippen für Tipps';
/** Auto-Weiter nur alle 10 Sekunden. */
const AUTO_ROTATE_MS = 10_000;
/** Nach User-Swipe: Auto-Rotate pausiert. */
const USER_PAUSE_MS = 10_000;

export type PassportTab = 'discover' | 'route';

/** Legacy aliases from older 3-tab UI */
export type PassportTabLegacy = 'stamps' | 'map' | 'route' | 'timeline' | PassportTab;

export function normalizePassportTab(
  tab?: PassportTabLegacy | null,
): PassportTab {
  if (tab === 'route') return 'route';
  return 'discover';
}

type Props = {
  onOpenSettings?: () => void;
  onOpenPlanCalendar?: () => void;
  onOpenPassport?: (opts?: { tab?: PassportTab }) => void;
  onTellMore?: (prompt: string) => void;
  locationRef?: React.RefObject<View | null>;
  /** Nur Zahnrad — nicht der ganze rechte Block. */
  settingsRef?: React.RefObject<View | null>;
  /** Tagesplanung / Timeline-Kalender-Icon. */
  planCalendarRef?: React.RefObject<View | null>;
  /** Stempelkarte unter dem Zahnrad (Dreieck-Layout). */
  stampMapRef?: React.RefObject<View | null>;
  settingsDisabled?: boolean;
};

function formatKm(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

type HudMode = 'idle' | 'poi' | 'nav';

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
    const nextWp =
      (isMultiStop
        ? tour!.stops[tour!.currentIndex]?.name
        : null) ||
      s.navNextTargetName ||
      s.navTargetName;
    const travel = resolveActiveTravelMode().mode;
    const mobility =
      travel === 'bike'
        ? 'bike'
        : resolvePersonaEngine(getCachedUserProfile()).mobilityMode;
    const totalEtaMin =
      remaining != null && remaining > 0
        ? travel === 'bike' || mobility === 'bike'
          ? bikeMinutesForDistanceM(remaining)
          : walkMinutesForDistanceM(remaining)
        : null;
    const stopProg = isMultiStop
      ? `Stop ${Math.min(tour!.currentIndex + 1, tour!.stops.length)}/${tour!.stops.length}`
      : null;
    const parts = [
      stopProg,
      nextWp ? nextWp : null,
      remaining != null
        ? totalEtaMin != null
          ? `Gesamt ${formatKm(remaining)} · ~${totalEtaMin} Min`
          : `Gesamt ${formatKm(remaining)}`
        : null,
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
  onOpenPlanCalendar,
  onOpenPassport,
  onTellMore,
  locationRef,
  settingsRef,
  planCalendarRef,
  stampMapRef,
  settingsDisabled,
}: Props) {
  const currentLocationName = useFinnusStore((s) => s.currentLocationName);
  const currentPoiId = useFinnusStore((s) => s.currentPoiId);
  const isAudiblySpeaking = useFinnusStore((s) => s.isAudiblySpeaking);
  const navActive = useFinnusStore((s) => s.navActive);
  const navVisible = useFinnusStore((s) => s.navVisible);
  const navTargetName = useFinnusStore((s) => s.navTargetName);
  const transportMode = useFinnusStore((s) => s.transportMode);
  const multiStopCount = useFinnusStore(
    (s) => s.multiStopTour?.stops.length ?? 0,
  );
  const multiStopName = useFinnusStore(
    (s) => s.multiStopTour?.stops[s.multiStopTour.currentIndex]?.name ?? null,
  );
  const findusPresence = useFinnusStore((s) => s.findusPresence);
  const stampCount = useFinnusStore((s) => s.visitedHistory.length);

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

  const [cardTick, setCardTick] = useState(0);
  const [cardIndex, setCardIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const userSwiping = useRef(false);
  /** Bis wann Auto-Rotate pausiert (User hat eingegriffen). */
  const autoResumeAtMs = useRef(0);
  const cardsLenRef = useRef(1);
  const cardIndexRef = useRef(0);
  const didSwipeRef = useRef(false);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    evaluateProactiveHud({ force: true });
    void tickProactiveReminderEngine({ force: true });
    void ensureMealHudFresh({ force: true });
    void ensureNearbyAmenityHudFresh({ force: true });
    const unsubTip = subscribeHudTip(() => {
      setCardTick((n) => n + 1);
    });
    const unsubMeal = subscribeMealHud(() => {
      setCardTick((n) => n + 1);
    });
    const unsubAmenity = subscribeNearbyAmenityHud(() => {
      setCardTick((n) => n + 1);
    });
    const interval = setInterval(() => {
      evaluateProactiveHud({ force: false });
      void tickProactiveReminderEngine({ force: false });
      void ensureMealHudFresh();
      void ensureNearbyAmenityHudFresh();
      setCardTick((n) => n + 1);
    }, Math.min(HUD_ENGINE_INTERVAL_MS, 120_000));
    return () => {
      unsubTip();
      unsubMeal();
      unsubAmenity();
      clearInterval(interval);
    };
  }, []);

  const mode: HudMode = useMemo(() => {
    if (currentPoiId != null && currentLocationName?.trim()) return 'poi';
    if (navigating) return 'nav';
    return 'idle';
  }, [currentPoiId, currentLocationName, navigating]);

  const cards: LiveHudCard[] = useMemo(() => {
    return buildLiveHudCards({ mode });
  }, [
    mode,
    cardTick,
    currentLocationName,
    currentPoiId,
    navTargetName,
    transportMode,
    multiStopCount,
    multiStopName,
    hintTick,
  ]);

  cardsLenRef.current = cards.length;
  cardIndexRef.current = cardIndex;

  /** Endlos-Karussell: [last, ...cards, first] — logischer Index bleibt 0..n-1. */
  const loopCards = useMemo((): LiveHudCard[] => {
    if (cards.length <= 1) return cards;
    return [cards[cards.length - 1]!, ...cards, cards[0]!];
  }, [cards]);

  const loopEnabled = mode === 'idle' && cards.length > 1;

  const scrollToLogical = useCallback(
    (logical: number, animated: boolean) => {
      const w = Math.max(120, Dimensions.get('window').width - 120);
      const len = cardsLenRef.current;
      if (len <= 1) {
        scrollRef.current?.scrollTo({ x: logical * w, animated });
        return;
      }
      // +1 wegen führendem Clone
      scrollRef.current?.scrollTo({ x: (logical + 1) * w, animated });
    },
    [],
  );

  // Nur bei Mode-Wechsel zurücksetzen — NICHT bei jedem Karten-Inhalt-Update
  useEffect(() => {
    setCardIndex(0);
    cardIndexRef.current = 0;
    const w = Math.max(120, Dimensions.get('window').width - 120);
    // Idle-Loop startet auf erstem echten Slot (Index 1)
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        x: mode === 'idle' && cardsLenRef.current > 1 ? w : 0,
        animated: false,
      });
    });
  }, [mode]);

  // Index clamp wenn Karten weniger werden
  useEffect(() => {
    if (cardIndex >= cards.length && cards.length > 0) {
      const next = cards.length - 1;
      setCardIndex(next);
      cardIndexRef.current = next;
      scrollToLogical(next, false);
    }
  }, [cards.length, cardIndex, scrollToLogical]);

  // Auto-rotate: ein stabiles Interval, liest Refs — kein Restart bei jedem Rebuild
  useEffect(() => {
    if (mode !== 'idle') return;
    const id = setInterval(() => {
      if (userSwiping.current) return;
      if (Date.now() < autoResumeAtMs.current) return;
      const len = cardsLenRef.current;
      if (len <= 1) return;
      const w = Math.max(120, Dimensions.get('window').width - 120);
      const prev = cardIndexRef.current;
      const next = (prev + 1) % len;
      cardIndexRef.current = next;
      setCardIndex(next);
      // Von letzter Karte → Clone der ersten (animiert), danach Jump im onScrollEnd
      if (prev === len - 1 && next === 0) {
        scrollRef.current?.scrollTo({ x: (len + 1) * w, animated: true });
      } else {
        scrollRef.current?.scrollTo({ x: (next + 1) * w, animated: true });
      }
      fade.setValue(0.55);
      Animated.timing(fade, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    }, AUTO_ROTATE_MS);
    return () => clearInterval(id);
  }, [mode, fade]);

  const pauseAutoRotate = useCallback(() => {
    userSwiping.current = true;
    didSwipeRef.current = true;
    autoResumeAtMs.current = Date.now() + USER_PAUSE_MS;
  }, []);

  const showRouteHint = multiStopCount > 1 && shouldShowRouteOverlayHint();
  const showTipsHint = shouldShowLongPressMoreHint();
  const [showPlanCoach, setShowPlanCoach] = useState(false);
  const [showSettingsCoach, setShowSettingsCoach] = useState(false);
  const [showStampCoach, setShowStampCoach] = useState(false);
  useEffect(() => {
    void bootstrapUiCoachMarks().then(() => {
      setShowPlanCoach(shouldShowCoachPlanCalendar());
      setShowSettingsCoach(shouldShowCoachSettings());
      setShowStampCoach(shouldShowCoachStamp(stampCount));
    });
  }, [hintTick, stampCount]);
  void hintTick;

  const activeCard = cards[Math.min(cardIndex, cards.length - 1)] ?? cards[0];

  const openTab: PassportTab = mode === 'nav' ? 'route' : 'discover';

  const handleOpenPassport = useCallback(() => {
    void markHudStempelkarteUsed();
    void markFeatureTipCompleted('visit_passport');
    void import('../services/onboarding/uiCoachMarks').then((m) =>
      m.onUserOpenedStampMap(),
    );
    if (openTab === 'route' || mode === 'nav') {
      void markHudRouteOverlayUsed();
    }
    openPassportRef.current?.({ tab: openTab });
    setShowStampCoach(false);
    setTimeout(refreshHints, 80);
  }, [openTab, mode, refreshHints]);

  const handleTellMore = useCallback(() => {
    void markHudLongPressMoreUsed().then(refreshHints);
    // Wetter-HUD: eigener Tagescheck — kein Concierge/Planning (keine offenen Pläne)
    if (
      activeCard?.id === 'weather-live' ||
      activeCard?.tellMorePrompt === '__WEATHER_DAY_CHECK__'
    ) {
      void import('../services/ui/weatherDayPlanCheck').then((m) =>
        m.runWeatherLiveDayCheck(),
      );
      return;
    }
    const prompt =
      activeCard?.tellMorePrompt ||
      (mode === 'nav'
        ? `Kurz: wie komme ich zu ${navTargetName || 'Ziel'}?`
        : 'Was wäre jetzt am hilfreichsten?');
    onTellMore?.(prompt);
  }, [activeCard, mode, navTargetName, onTellMore, refreshHints]);

  const cardWidth = Math.max(120, Dimensions.get('window').width - 120);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const page = Math.round(x / Math.max(1, cardWidth));
      const len = cards.length;
      let logical = page;
      if (len > 1) {
        if (page <= 0) {
          // Clone der letzten → echte letzte
          logical = len - 1;
          scrollRef.current?.scrollTo({
            x: len * cardWidth,
            animated: false,
          });
        } else if (page >= len + 1) {
          // Clone der ersten → echte erste
          logical = 0;
          scrollRef.current?.scrollTo({
            x: cardWidth,
            animated: false,
          });
        } else {
          logical = page - 1;
        }
      } else {
        logical = Math.max(0, Math.min(len - 1, page));
      }
      setCardIndex(logical);
      cardIndexRef.current = logical;
      userSwiping.current = false;
      autoResumeAtMs.current = Date.now() + USER_PAUSE_MS;
      // Swipe-Flag kurz halten, damit Tap nach Swipe nicht Tips feuert
      setTimeout(() => {
        didSwipeRef.current = false;
      }, 280);
    },
    [cardWidth, cards.length],
  );

  const onCardTap = useCallback(() => {
    if (didSwipeRef.current || userSwiping.current) return;
    if (!onTellMore) return;
    handleTellMore();
  }, [handleTellMore, onTellMore]);

  const titleFallback =
    mode === 'poi' && currentLocationName?.trim()
      ? `📍 ${currentLocationName.trim()}`
      : mode === 'nav'
        ? formatNavHudTitle(
            navTargetName?.trim() || multiStopName?.trim() || 'Ziel',
            transportMode,
          )
        : activeCard?.title ?? '📍';

  const presenceLine = presenceHint(findusPresence);

  return (
    <View style={styles.hudBlock} pointerEvents="box-none">
      <View style={styles.topRow} pointerEvents="box-none">
        <View
          ref={locationRef as React.RefObject<View> | undefined}
          collapsable={false}
          style={styles.titleSide}
        >
          {loopEnabled ? (
            <View style={styles.locationPress}>
              <Animated.View style={{ opacity: fade }}>
                <ScrollView
                  ref={scrollRef}
                  horizontal
                  pagingEnabled
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  snapToInterval={cardWidth}
                  snapToAlignment="start"
                  disableIntervalMomentum
                  onScrollBeginDrag={pauseAutoRotate}
                  onMomentumScrollEnd={onScrollEnd}
                  style={{ width: cardWidth }}
                >
                  {loopCards.map((c, i) => (
                    <Pressable
                      key={`${c.id}__${i}`}
                      onPress={onCardTap}
                      style={{ width: cardWidth }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        c.id === 'weather-live'
                          ? `${c.title}. Tippen: Wetter und Tipps. Wischen: nächste Karte.`
                          : `${c.title}. Tippen: Tipps. Wischen: nächste Karte. Stempelkarte: Karten-Icon unter dem Zahnrad.`
                      }
                    >
                      <Text style={styles.location} numberOfLines={1}>
                        {c.title}
                      </Text>
                      {c.meta ? (
                        <Text style={styles.meta} numberOfLines={2}>
                          {c.meta}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                </ScrollView>
              </Animated.View>
              {showTipsHint && onTellMore ? (
                <Text style={styles.hintMini} numberOfLines={1}>
                  {TAP_TIPS_HINT}
                </Text>
              ) : null}
            </View>
          ) : (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                if (onTellMore) handleTellMore();
              }}
              disabled={!onTellMore}
              hitSlop={{ top: 6, bottom: 8, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={
                mode === 'nav'
                  ? 'Live-Anzeige. Tippen für Tipps zur Route. Stempelkarte: Karten-Icon unter dem Zahnrad.'
                  : 'Live-Anzeige. Tippen für Tipps. Stempelkarte: Karten-Icon unter dem Zahnrad.'
              }
              style={[
                styles.locationPress,
                mode === 'nav' && styles.locationPressNav,
                mode === 'poi' && styles.locationPressPoi,
              ]}
            >
              <Animated.View style={{ opacity: fade }}>
                <Text style={styles.location} numberOfLines={2}>
                  {activeCard?.title ?? titleFallback}
                </Text>
                {mode === 'poi' && isAudiblySpeaking ? null : activeCard?.meta &&
                  mode !== 'nav' ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    {activeCard.meta}
                  </Text>
                ) : null}
              </Animated.View>

              {mode === 'nav' ? (
                <>
                  <NavHudMeta showRouteHint={showRouteHint} />
                  {presenceLine ? (
                    <Text style={styles.meta} numberOfLines={1}>
                      {presenceLine}
                    </Text>
                  ) : null}
                  {cards[1] ? (
                    <Text style={styles.meta} numberOfLines={1}>
                      {cards[1].title}
                    </Text>
                  ) : null}
                </>
              ) : null}

              {showTipsHint && onTellMore ? (
                <Text style={styles.hintMini} numberOfLines={1}>
                  {TAP_TIPS_HINT}
                </Text>
              ) : null}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.settingsWrap} pointerEvents="auto">
          <View style={styles.rightCluster}>
            <View style={styles.rightTopRow}>
              <View
                ref={planCalendarRef as React.RefObject<View> | undefined}
                collapsable={false}
                style={styles.coachBtnCol}
              >
                <TouchableOpacity
                  onPress={() => {
                    void onUserOpenedPlanCalendar().then(() =>
                      setShowPlanCoach(false),
                    );
                    if (onOpenPlanCalendar) onOpenPlanCalendar();
                    else requestOpenPlanCalendar();
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                  activeOpacity={0.75}
                  style={styles.settingsBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Planung und Zeitachse"
                >
                  <Feather name="calendar" size={20} color={colors.text} />
                </TouchableOpacity>
                {showPlanCoach ? (
                  <Text style={styles.coachArrow} numberOfLines={1}>
                    ← Tagesplanung
                  </Text>
                ) : null}
              </View>
              <View
                ref={settingsRef as React.RefObject<View> | undefined}
                collapsable={false}
                style={styles.coachBtnCol}
              >
                <TouchableOpacity
                  onPress={() => {
                    void onUserOpenedSettings().then(() =>
                      setShowSettingsCoach(false),
                    );
                    onOpenSettings?.();
                  }}
                  disabled={settingsDisabled || !onOpenSettings}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
                  activeOpacity={0.75}
                  style={[
                    styles.settingsBtn,
                    (settingsDisabled || !onOpenSettings) &&
                      styles.settingsBtnDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Einstellungen"
                  accessibilityState={{
                    disabled: settingsDisabled || !onOpenSettings,
                  }}
                >
                  <Feather name="settings" size={20} color={colors.text} />
                </TouchableOpacity>
                {showSettingsCoach ? (
                  <Text style={styles.coachArrow} numberOfLines={1}>
                    ← Einstellungen
                  </Text>
                ) : null}
              </View>
            </View>
            <View
              ref={stampMapRef as React.RefObject<View> | undefined}
              collapsable={false}
              style={[styles.coachBtnCol, styles.stampUnderGear]}
            >
              <TouchableOpacity
                onPress={handleOpenPassport}
                disabled={!onOpenPassport}
                hitSlop={{ top: 8, bottom: 12, left: 8, right: 8 }}
                activeOpacity={0.75}
                style={[
                  styles.settingsBtn,
                  !onOpenPassport && styles.settingsBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Stempelkarte"
              >
                <Feather name="map" size={20} color={colors.text} />
              </TouchableOpacity>
              {showStampCoach ? (
                <Text style={styles.coachArrow} numberOfLines={1}>
                  ← Stempelkarte
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  hudBlock: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs ?? 4,
    zIndex: UI_LAYER.hud,
    elevation: UI_LAYER.hud,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleSide: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2,
  },
  locationPress: {
    width: '100%',
    paddingVertical: 2,
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
  location: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },
  meta: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 15,
    maxHeight: 30,
  },
  hintMini: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
    opacity: 0.85,
  },
  settingsWrap: {
    flexShrink: 0,
    marginTop: 0,
  },
  /** Dreieck oben rechts: Kalender + Zahnrad, Stempelkarte darunter am Zahnrad. */
  rightCluster: {
    alignItems: 'flex-end',
    gap: 4,
  },
  rightTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  stampUnderGear: {
    alignSelf: 'flex-end',
  },
  coachBtnCol: {
    alignItems: 'center',
    maxWidth: 72,
  },
  coachArrow: {
    marginTop: 2,
    fontSize: 9,
    lineHeight: 11,
    color: colors.accent,
    textAlign: 'center',
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  settingsBtnDisabled: {
    opacity: 0.45,
  },
});
