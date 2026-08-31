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
  ensureSunsetHudFresh,
  subscribeSunsetHud,
} from '../services/ui/sunsetHorizonSpots';
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
import { formatNavHudTitle, formatRemainingStations } from '../services/navigation/transportMode';
import {
  bikeMinutesForDistanceM,
  formatDurationMinutesDe,
  walkMinutesForDistanceM,
} from '../services/navigation/travelEta';
import { getCachedUserProfile } from '../services/userProfileService';
import { resolvePersonaEngine } from '../services/personaEngine';
import { resolveActiveTravelMode } from '../services/navigation/travelModeContext';
import { pickNavHudEta } from '../services/navigation/navHudEta';
import { stripNavDestLeak } from '../services/navigation/streetAddressQuery';

const ROUTE_HINT = 'Tippen für geplante Route';
const TAP_TIPS_HINT = 'tippen für Tipps';
/** Auto-Weiter nur alle 10 Sekunden. */
const AUTO_ROTATE_MS = 10_000;
/** Nach User-Swipe: Auto-Rotate pausiert. */
const USER_PAUSE_MS = 10_000;
/** Horizontal-Padding der Live-Karten (locationPress). */
const HUD_TEXT_PAD_X = spacing.md * 2;

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
  /** Karte läuft darunter — kein harter grüner Balken. */
  overlay?: boolean;
  /** Home-Dock übernimmt Kalender / Stempel / Einstellungen. */
  hideTools?: boolean;
  /** Live-Anzeige volle Breite (kein Seiten-Padding, Karten = Screen-Width). */
  fullBleedLive?: boolean;
};

function formatKm(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Straßen-/Adress-Labels nicht als „via …“ im HUD — nur echte Landmarken. */
function isRoadLikeNavLabel(name: string): boolean {
  const t = name.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (
    /\b(straße|strasse|str\.|allee|weg|platz|gasse|ring|damm|chaussee|ufer|allee)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // Hausnummer / reine Adresse
  if (/\d{1,4}[a-z]?\s*$/iu.test(t) && t.length <= 40) return true;
  return false;
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
    const nextLandmark = s.navNextTargetName?.trim() || null;
    const destName =
      (isMultiStop
        ? tour!.stops[tour!.currentIndex]?.name
        : null) ||
      s.navTargetName ||
      'Ziel';
    const destShort = stripNavDestLeak(destName.replace(/\s+/g, ' ').trim());
    const landmarkBit =
      nextLandmark &&
      nextLandmark.toLowerCase() !== destShort.toLowerCase() &&
      !isRoadLikeNavLabel(nextLandmark) &&
      !/^[A-Z]\.\s+\w+/u.test(nextLandmark)
        ? `via ${nextLandmark}`
        : null;
    const travel = resolveActiveTravelMode().mode;
    const mobility =
      travel === 'bike'
        ? 'bike'
        : resolvePersonaEngine(getCachedUserProfile()).mobilityMode;
    let walkFallback: number | null = null;
    if (remaining != null && remaining > 0) {
      walkFallback =
        travel === 'bike' || mobility === 'bike'
          ? bikeMinutesForDistanceM(remaining)
          : walkMinutesForDistanceM(remaining);
    }
    const lastStopEndMs = tour
      ? [...tour.stops]
          .reverse()
          .find((st) => st.endMs != null && Number.isFinite(st.endMs))?.endMs ??
        null
      : null;
    const rideStartMs = tour
      ? tour.stops.find((st) => {
          const ms = st.vehicleStartMs;
          return (
            ms != null &&
            Number.isFinite(ms) &&
            (st.role === 'alight' || st.role === 'board' || Boolean(st.line))
          );
        })?.vehicleStartMs ?? null
      : null;
    const hudEta = pickNavHudEta({
      lastStopEndMs,
      rideStartMs,
      navEtaMin: s.navEtaMin,
      remainingM: remaining,
      walkFallbackMin: walkFallback,
      nowMs: Date.now(),
    });
    const totalEtaMin = hudEta.etaMin;
    const stopProg = isMultiStop
      ? `Stop ${Math.min(tour!.currentIndex + 1, tour!.stops.length)}/${tour!.stops.length}`
      : null;
    const arriveClock =
      hudEta.arriveMs != null
        ? new Date(hudEta.arriveMs).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : null;
    const transitHud = Boolean(
      tour?.stops.some(
        (st) =>
          st.role === 'alight' || st.role === 'board' || Boolean(st.line),
      ) || tour?.liveMeta,
    );
    const distEta = transitHud
      ? totalEtaMin != null
        ? formatDurationMinutesDe(totalEtaMin, 'short')
        : null
      : remaining != null
        ? totalEtaMin != null
          ? `${formatKm(remaining)} · ${formatDurationMinutesDe(totalEtaMin, 'short')}`
          : formatKm(remaining)
        : null;
    const parts = [
      stopProg,
      landmarkBit,
      distEta,
      arriveClock ? `Ankunft ${arriveClock}` : null,
      s.navPhase === 'in_transit'
        ? 'ÖPNV'
        : s.navPhase === 'walk_to_stop'
          ? 'Zur Haltestelle'
          : null,
      s.navPhase === 'in_transit' && s.remainingStations != null
        ? formatRemainingStations(s.remainingStations)
        : null,
      showRouteHint ? ROUTE_HINT : null,
    ].filter(Boolean);
    return parts.join(' · ') || 'Route aktiv';
  });

  return (
    <Text style={styles.meta} numberOfLines={2} ellipsizeMode="tail">
      {meta}
    </Text>
  );
});

const NavHudTitle = React.memo(function NavHudTitle() {
  const title = useFinnusStore((s) => {
    const tour = s.multiStopTour;
    const open = (tour?.stops ?? []).filter((x) => !x.done);
    const finalStop =
      open.length > 1
        ? open.find((x) => x.role === 'dest') ?? open[open.length - 1]
        : null;
    const name =
      (tour?.title && /^Reise\b/i.test(tour.title.trim())
        ? tour.title.trim()
        : null) ||
      (finalStop?.name && finalStop.name.trim()) ||
      (tour != null && tour.stops.length > 1
        ? tour.title.replace(/^ÖPNV\s*→\s*/i, '').trim()
        : null) ||
      s.navTargetName?.trim() ||
      'Ziel';
    const clean = stripNavDestLeak(name.replace(/\s+/g, ' ').trim());
    return formatNavHudTitle(clean, s.transportMode);
  });
  return (
    <Text style={styles.location} numberOfLines={2} ellipsizeMode="tail">
      {title}
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
  overlay,
  hideTools,
  fullBleedLive,
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
  const lastNavTapRef = useRef<{ key: string; at: number } | null>(null);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    evaluateProactiveHud({ force: true });
    void tickProactiveReminderEngine({ force: true });
    void ensureMealHudFresh({ force: true });
    void ensureNearbyAmenityHudFresh({ force: true });
    void ensureSunsetHudFresh({ force: true });
    const unsubTip = subscribeHudTip(() => {
      setCardTick((n) => n + 1);
    });
    const unsubMeal = subscribeMealHud(() => {
      setCardTick((n) => n + 1);
    });
    const unsubAmenity = subscribeNearbyAmenityHud(() => {
      setCardTick((n) => n + 1);
    });
    const unsubSunset = subscribeSunsetHud(() => {
      setCardTick((n) => n + 1);
    });
    const interval = setInterval(() => {
      evaluateProactiveHud({ force: false });
      void tickProactiveReminderEngine({ force: false });
      void ensureMealHudFresh();
      void ensureNearbyAmenityHudFresh();
      void ensureSunsetHudFresh();
      setCardTick((n) => n + 1);
    }, Math.min(HUD_ENGINE_INTERVAL_MS, 120_000));
    return () => {
      unsubTip();
      unsubMeal();
      unsubAmenity();
      unsubSunset();
      clearInterval(interval);
    };
  }, []);

  const mode: HudMode = useMemo(() => {
    if (currentPoiId != null && currentLocationName?.trim()) return 'poi';
    if (navigating) return 'nav';
    return 'idle';
  }, [currentPoiId, currentLocationName, navigating]);

  const [laneW, setLaneW] = useState(() =>
    Math.max(120, Dimensions.get('window').width - HUD_TEXT_PAD_X),
  );
  const cardWidth = laneW;
  const cardWidthRef = useRef(cardWidth);
  cardWidthRef.current = cardWidth;

  const cards: LiveHudCard[] = useMemo(() => {
    return buildLiveHudCards({ mode, textWidthPx: laneW });
  }, [
    mode,
    laneW,
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

  const scrollToLogical = useCallback((logical: number, animated: boolean) => {
    const w = cardWidthRef.current;
    const len = cardsLenRef.current;
    if (len <= 1) {
      scrollRef.current?.scrollTo({ x: logical * w, animated });
      return;
    }
    // +1 wegen führendem Clone
    scrollRef.current?.scrollTo({ x: (logical + 1) * w, animated });
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollToLogical(cardIndexRef.current, false);
    });
  }, [cardWidth, scrollToLogical]);

  // Nur bei Mode-Wechsel zurücksetzen — NICHT bei jedem Karten-Inhalt-Update
  useEffect(() => {
    setCardIndex(0);
    cardIndexRef.current = 0;
    requestAnimationFrame(() => {
      const w = cardWidthRef.current;
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
      const w = cardWidthRef.current;
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
    openPassportRef.current?.({ tab: openTab });
    if (openTab === 'route' || mode === 'nav') {
      void markHudRouteOverlayUsed();
    }
    setShowStampCoach(false);
    setTimeout(refreshHints, 80);
  }, [openTab, mode, refreshHints]);

  const handleOpenStampMap = useCallback(() => {
    void markHudStempelkarteUsed();
    void markFeatureTipCompleted('visit_passport');
    void import('../services/onboarding/uiCoachMarks').then((m) =>
      m.onUserOpenedStampMap(),
    );
    openPassportRef.current?.({ tab: openTab });
    setShowStampCoach(false);
    setTimeout(refreshHints, 80);
  }, [openTab, refreshHints]);

  const handleTellMore = useCallback(() => {
    void markHudLongPressMoreUsed().then(refreshHints);
    // Nav aktiv / Route-Karte → Stempelkarte Route-Tab
    if (
      mode === 'nav' ||
      activeCard?.openRoutePassport ||
      activeCard?.id?.startsWith('nav-')
    ) {
      if (onOpenPlanCalendar) onOpenPlanCalendar();
      else handleOpenPassport();
      void markHudRouteOverlayUsed().then(refreshHints);
      return;
    }
    // Gastro-HUD → Pitch (1–2 Optionen), nicht still Nav zum ersten Treffer
    if (activeCard?.id?.startsWith('meal-') || activeCard?.id === 'sunset-spots') {
      const prompt =
        activeCard.tellMorePrompt ||
        'Mittagessen in der Nähe — zwei kurze Optionen zum Auswählen.';
      onTellMore?.(prompt);
      return;
    }
    // Konkreter Ort auf der Live-Karte → Navigation starten (Debounce)
    const dest = activeCard?.navDest;
    if (
      dest &&
      Number.isFinite(dest.lat) &&
      Number.isFinite(dest.lng) &&
      dest.name.trim()
    ) {
      const now = Date.now();
      const key = `${dest.name}|${dest.lat.toFixed(4)},${dest.lng.toFixed(4)}`;
      if (
        lastNavTapRef.current &&
        lastNavTapRef.current.key === key &&
        now - lastNavTapRef.current.at < 8_000
      ) {
        return;
      }
      lastNavTapRef.current = { key, at: now };
      useFinnusStore.getState().setNavRouteLoading(true);
      useFinnusStore.getState().setIsGenerating(true);
      void import('../services/navigation/handsFreeNav').then((m) =>
        m.commitHandsFreeNavStart({
          name: dest.name.trim(),
          lat: dest.lat,
          lng: dest.lng,
        }),
      );
      return;
    }
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
      activeCard?.tellMorePrompt || 'Was wäre jetzt am hilfreichsten?';
    onTellMore?.(prompt);
  }, [
    activeCard,
    handleOpenPassport,
    mode,
    onTellMore,
    onOpenPlanCalendar,
    refreshHints,
  ]);

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
    // Route/NavDest brauchen kein onTellMore — Passport/Start reichen
    if (
      mode === 'nav' ||
      activeCard?.openRoutePassport ||
      activeCard?.navDest
    ) {
      handleTellMore();
      return;
    }
    if (!onTellMore) return;
    handleTellMore();
  }, [activeCard, handleTellMore, mode, onTellMore]);

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
    <View
      style={[
        styles.hudBlock,
        overlay && !fullBleedLive && styles.hudBlockOverlay,
        fullBleedLive && styles.hudBlockFullBleed,
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.topRow} pointerEvents="box-none">
        <View
          ref={locationRef as React.RefObject<View> | undefined}
          collapsable={false}
          style={styles.titleSide}
          onLayout={(e) => {
            const outer = Math.round(e.nativeEvent.layout.width);
            const inner = Math.max(120, outer - HUD_TEXT_PAD_X);
            if (Math.abs(inner - laneW) >= 2) setLaneW(inner);
          }}
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
                          : `${c.title}. Tippen: Tipps. Wischen: nächste Karte. Unten: Timeline · Orte · Einst.`
                      }
                    >
                      <Text
                        style={styles.location}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {c.title}
                      </Text>
                      {c.meta ? (
                        <Text
                          style={styles.meta}
                          numberOfLines={2}
                          ellipsizeMode="tail"
                        >
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
                  ? 'Live-Anzeige. Tippen für Tipps zur Route. Unten: Timeline · Orte · Einst.'
                  : 'Live-Anzeige. Tippen für Tipps. Unten: Timeline · Orte · Einst.'
              }
              style={[
                styles.locationPress,
                mode === 'nav' && styles.locationPressNav,
                mode === 'poi' && styles.locationPressPoi,
              ]}
            >
              <Animated.View style={{ opacity: fade }}>
                {mode === 'nav' ? (
                  <NavHudTitle />
                ) : (
                  <Text
                    style={styles.location}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {activeCard?.title ?? titleFallback}
                  </Text>
                )}
                {mode === 'poi' && isAudiblySpeaking ? null : activeCard?.meta &&
                  mode !== 'nav' ? (
                  <Text
                    style={styles.meta}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
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

        {hideTools ? null : (
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
                onLongPress={handleOpenStampMap}
                delayLongPress={380}
                disabled={!onOpenPassport}
                hitSlop={{ top: 8, bottom: 12, left: 8, right: 8 }}
                activeOpacity={0.75}
                style={[
                  styles.settingsBtn,
                  !onOpenPassport && styles.settingsBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Orte und Stempelkarte — unten Orte oder Fortschritts-Chip."
              >
                <Feather name="map" size={20} color={colors.text} />
              </TouchableOpacity>
              {showStampCoach ? (
                <Text style={styles.coachArrow} numberOfLines={1}>
                  ← Karte
                </Text>
              ) : null}
            </View>
          </View>
        </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  hudBlock: {
    width: '100%',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    zIndex: UI_LAYER.hud,
    elevation: UI_LAYER.hud,
    backgroundColor: colors.bg,
  },
  hudBlockOverlay: {
    backgroundColor: 'transparent',
  },
  /** Volle Breite + solider Cut zur Karte darunter. */
  hudBlockFullBleed: {
    paddingHorizontal: 0,
    backgroundColor: colors.bg,
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
    alignSelf: 'stretch',
    alignItems: 'stretch',
    paddingTop: 0,
  },
  locationPress: {
    width: '100%',
    alignSelf: 'stretch',
    paddingVertical: 2,
    paddingHorizontal: spacing.md,
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
    width: '100%',
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'left',
    textShadowColor: 'rgba(15,44,36,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  meta: {
    width: '100%',
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 15,
    maxHeight: 36,
    textShadowColor: 'rgba(15,44,36,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
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
