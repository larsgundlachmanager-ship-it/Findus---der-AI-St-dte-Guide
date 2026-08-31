/**
 * Planungsmodul-UI — Ist-Zeitachse + Zukunftsplan + offene Pläne + Mic.
 * Overlay (kein RN-Modal), analog VisitPassportModal.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { shouldShowEndClock } from '../services/flights/flightTimelineCopy';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { todayDateKey } from '../utils/dateKeys';
import { stopAccordionFacts } from '../module2/timeline/stopAccordionFacts';
// session.dayKey steuert „Plan für morgen“ etc.
import { useWallClockMs } from '../hooks/useWallClockMs';
import { useDeferredReady } from '../hooks/useDeferredReady';
import { cleanupTimelineDuplicates } from '../module2/timeline/cleanupTimelineDuplicates';
import {
  buildDayTimeline,
  collectMonthDayMarks,
  daysInMonth,
  formatMonthTitleDe,
  mondayIndexForMonth,
  monthKeyFromDateKey,
  shiftDateKey,
  shiftMonthKey,
  type TimelineNode,
  type TimelineTone,
} from '../module2/timeline/buildDayTimeline';
import {
  requestPlanScroll,
  usePlanCalendarUiStore,
  type PlanShortAnswer,
} from '../module2/timeline/planCalendarUiStore';
import { useFuturePlanStore, type FuturePlanStop } from '../module2/timeline/futurePlanState';
import { useHistoricalTimelineStore } from '../module2/timeline/historicalTimelineState';
import { useUiScaleStore } from '../services/ui/uiScale';
import {
  planStopIdFromTimelineNodeId,
  addPlanStop,
  removePlanStop,
  reschedulePlanStop,
  setStopTransport,
  reorderTimedPlanStops,
  clearDayPlan,
} from '../module2/timeline/planLiveEdits';
import {
  applyLiveNavTransport,
  clearLiveNavFromPlan,
  isLiveNavLegId,
  LIVE_NAV_LEG_ID,
  upsertLiveNavFromStore,
} from '../module2/timeline/syncLiveNavToPlan';
import { formatDurationMinutesDe } from '../services/navigation/travelEta';
import type { FuturePlanTransport } from '../module2/timeline/futurePlanState';
import {
  focusOpenPlanNext,
  moveOpenPlan,
  removeOpenPlan,
  reorderOpenPlan,
} from '../module2/timeline/openPlanEdits';
import { MicButton } from './MicButton';
import { SwipeBackView } from './SwipeBackView';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { handleQuickAction } from '../services/actionHandlerService';
import type { QuickAction } from '../types/concierge';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  hydrateVisitLog,
  importStampsIntoVisitLog,
} from '../services/timeline/visitLog';
import { enqueueSpeech, stopVoiceOnUserTap, isSpeechActive } from '../module2/speech/speechQueue';
import { clearNavigationHard } from '../services/navigation/hardNavOverride';
import { reorderUpcomingTourStops } from '../services/navigation/multiStopTour';
import {
  detectOfferKind,
  isSafeOfferUrl,
  offerLabel,
} from '../module2/planning/offerActionUtils';
import { shortenActionLabel, stripMapsActionPrefix, MAPS_ACTION_EMOJI } from '../services/concierge/actionLabelShorten';
import { hasTimeOverlap } from '../module2/planning/planConflictResolve';

const OPEN_ROW_H = 56;
const TL_ROW_H = 72;

function PlaceActionChips({ node }: { node: TimelineNode }) {
  const mapsUrl = (node.mapsUrl ?? '').trim();
  const menuUrl =
    node.menuUrl && isSafeOfferUrl(node.menuUrl) ? node.menuUrl : '';
  const websiteUrl =
    node.websiteUrl &&
    isSafeOfferUrl(node.websiteUrl) &&
    node.websiteUrl !== menuUrl
      ? node.websiteUrl
      : '';
  const reserveUrl = (node.reserveUrl ?? '').trim();
  const badge = (node.badge ?? '').trim();
  if (!mapsUrl && !menuUrl && !websiteUrl && !reserveUrl && !badge) return null;
  return (
    <View style={styles.proposalActions}>
      {badge ? (
        <View style={styles.proposalActionBtn}>
          <Text style={styles.proposalActionText}>{badge}</Text>
        </View>
      ) : null}
      {mapsUrl ? (
        <Pressable
          style={styles.proposalActionBtn}
          hitSlop={6}
          onPress={(e) => {
            e?.stopPropagation?.();
            void Linking.openURL(mapsUrl);
          }}
        >
          <Text style={styles.proposalActionText}>
            {/lageplan/i.test(mapsUrl)
              ? 'Lageplan'
              : `${MAPS_ACTION_EMOJI} Maps`}
          </Text>
        </Pressable>
      ) : null}
      {menuUrl ? (
        <Pressable
          style={styles.proposalActionBtn}
          hitSlop={6}
          onPress={(e) => {
            e?.stopPropagation?.();
            void Linking.openURL(menuUrl);
          }}
        >
          <Text style={styles.proposalActionText}>
            {offerLabel(detectOfferKind(node.title)).label}
          </Text>
        </Pressable>
      ) : null}
      {websiteUrl ? (
        <Pressable
          style={styles.proposalActionBtn}
          hitSlop={6}
          onPress={(e) => {
            e?.stopPropagation?.();
            void Linking.openURL(websiteUrl);
          }}
        >
          <Text style={styles.proposalActionText}>🌐 Website</Text>
        </Pressable>
      ) : null}
      {reserveUrl ? (
        <Pressable
          style={styles.proposalActionBtn}
          hitSlop={6}
          onPress={(e) => {
            e?.stopPropagation?.();
            void Linking.openURL(reserveUrl);
          }}
        >
          <Text style={styles.proposalActionText}>
            {/friseur|haar|salon|barber|termin/i.test(node.title)
              ? '📅 Termin buchen'
              : '🍽 Tisch reservieren'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function isMapsQuickAction(a: QuickAction): boolean {
  if (a.type !== 'OPEN_URL') return false;
  const url = a.payload?.url ?? '';
  return (
    /google\.[^/]*\/maps|maps\.google|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(
      url,
    ) || /^(?:🗺️|🗺|MAP)\b/iu.test(a.label)
  );
}

type ViewMode = 'day' | 'month';

/** Max. nachladen — nie alle auf einmal (sonst JS-Freeze / Blackscreen). */
const MONTHS_BEFORE = 26;
const MONTH_CHUNK = 2;
const MONTHS_AFTER = 12;

type Props = {
  visible: boolean;
  onClose: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
  onSwipeLock?: () => void;
  onSwipeLiveChat?: () => void;
  isListening: boolean;
  isMicLocked?: boolean;
  isFinalizing?: boolean;
  isGenerating: boolean;
  isAudiblySpeaking?: boolean;
  onShortAnswerPrompt?: (prompt: string) => void;
};

function formatClock(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return dt.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
}

function toneStyles(tone: TimelineTone): {
  border: string;
  dot: string;
  bg: string;
} {
  switch (tone) {
    case 'change':
      // Aktiver Fokus: blauer Rand, kein blauer Flächen-Hintergrund
      return { border: colors.thinking, dot: colors.thinking, bg: colors.surface };
    case 'conflict':
      return { border: colors.danger, dot: colors.danger, bg: 'rgba(217,107,92,0.14)' };
    case 'trigger':
      return { border: colors.thinking, dot: colors.thinking, bg: colors.surface };
    case 'reality':
      return { border: colors.wave, dot: colors.wave, bg: colors.surface };
    default:
      return { border: colors.border, dot: colors.textMuted, bg: colors.surface };
  }
}

function kickOpenPlanResearch(stopId: string): void {
  try {
    useFinnusStore.getState().setIsGenerating(true);
  } catch {
    /* soft */
  }
  // Sync Instant-Bridge (vor async Import) — Concierge-Härte.
  try {
    const seed = /:hotel$/i.test(stopId)
      ? 'Hotel Unterkunft suchen'
      : /:car$/i.test(stopId)
        ? 'Mietwagen suchen'
        : 'Offenen Plan recherchieren';
    const { pickFloskelForUserText } = require('../services/speech/floskelEngine') as {
      pickFloskelForUserText: (s: string) => { phrase: string };
    };
    const phrase = pickFloskelForUserText(seed).phrase?.trim();
    if (phrase) {
      const { enqueueSpeech } = require('../module2/speech/speechQueue') as {
        enqueueSpeech: (o: {
          kind: 'bridging' | 'main';
          text: string;
          turnId: string;
        }) => void;
      };
      enqueueSpeech({
        kind: 'bridging',
        text: phrase,
        turnId: `open_plan_bridge_${Date.now()}`,
      });
    }
  } catch {
    /* soft */
  }
  void import('../module2/planning/runPlanningModule').then(async (m) => {
    try {
      m.overrideOpenWishFromStop(stopId);
      await m.resumeOpenWishResearch(stopId, { skipBridge: true });
    } finally {
      try {
        useFinnusStore.getState().setIsGenerating(false);
      } catch {
        /* soft */
      }
    }
  });
}

function SwipeDeleteTrack({
  enabled,
  swipeX,
  panHandlers,
  armed,
  onConfirmDelete,
  children,
}: {
  enabled: boolean;
  swipeX: Animated.Value;
  panHandlers?: object;
  armed?: boolean;
  onConfirmDelete?: () => void;
  children: React.ReactNode;
}) {
  if (!enabled) {
    return <View style={{ flex: 1 }}>{children}</View>;
  }
  return (
    <View style={styles.swipeTrack}>
      <Pressable
        pointerEvents={armed ? 'auto' : 'none'}
        onPress={() => onConfirmDelete?.()}
        style={styles.swipeReveal}
      >
        <Text style={styles.swipeRevealText}>Löschen</Text>
      </Pressable>
      <Animated.View
        style={[
          {
            flex: 1,
            backgroundColor: colors.bg,
            borderRadius: 12,
            transform: [{ translateX: swipeX }],
          },
        ]}
        {...(panHandlers ?? {})}
      >
        {children}
      </Animated.View>
    </View>
  );
}

function TimelineRowInner({
  node,
  selected,
  onSelect,
  onNavTransport,
  onNavStart,
  onSwipeDelete,
  routeComputing,
  accordion,
  isFirst,
  isLast,
  nextAtMs,
}: {
  node: TimelineNode;
  selected?: boolean;
  onSelect?: (node: TimelineNode) => void;
  /** Nav-Leg: Modus in derselben Zeile wählen */
  onNavTransport?: (node: TimelineNode, mode: FuturePlanTransport) => void;
  /** Nav-Leg tippen → true wenn Navigation gestartet */
  onNavStart?: (node: TimelineNode) => boolean;
  /** Rechts-Wischen → Löschen bestätigen */
  onSwipeDelete?: (node: TimelineNode) => void;
  /** Route wird neu berechnet */
  routeComputing?: boolean;
  /** Aufgeklappte Stop-Karte: ±15 + Navigation + Löschen */
  accordion?: {
    hardFixed: boolean;
    canNav: boolean;
    onMinus15: () => void;
    onPlus15: () => void;
    onStartNav: () => void;
    onDelete: () => void;
  } | null;
  isFirst?: boolean;
  isLast?: boolean;
  nextAtMs?: number | null;
}) {
  const tone = toneStyles(node.tone);
  const axisColor =
    node.lane === 'now' ? colors.thinking : tone.dot;
  const isFallback = node.routeEstimate === 'fallback' || routeComputing;
  const [navExpanded, setNavExpanded] = React.useState(
    Boolean(node.journeyDetail) || node.kind === 'nav_leg',
  );
  const [swipeArmed, setSwipeArmed] = React.useState(false);
  const swipeX = React.useRef(new Animated.Value(0)).current;
  const swipeLastDx = React.useRef(0);

  const hasTime = node.atMs != null;
  const isNav = node.kind === 'nav_leg';
  const isOpenBand = node.isOpenBand === true || node.kind === 'wish';
  const isChoice =
    node.isProposal === true ||
    node.id.includes('choice_') ||
    /^[🥇🥈❓]/.test(node.title);
  const planStopId = planStopIdFromTimelineNodeId(node.id) ?? node.id;
  const isFtCommitted = planStopId.startsWith('ft:');
  const compactNav =
    isNav &&
    (!isFtCommitted ||
      node.transport === 'walk' ||
      node.navRole === 'path');
  const showEndClock = shouldShowEndClock(node.endMs, nextAtMs, node.atMs);
  const isLiveNav = isLiveNavLegId(planStopId);
  const editable =
    node.lane === 'future' && !isNav && !node.realityLocked;
  const canSwipeDelete =
    Boolean(onSwipeDelete) &&
    !isChoice &&
    node.kind !== 'reality' &&
    node.lane !== 'now' &&
    (Boolean(planStopIdFromTimelineNodeId(node.id)) ||
      isLiveNav ||
      node.groupId === 'live_journey' ||
      planStopId.startsWith('ft:') ||
      planStopId.startsWith('wake_'));

  // Hooks vor Early-Returns (Rules of Hooks)
  const swipePan = React.useMemo(
    () =>
      canSwipeDelete
        ? PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            onMoveShouldSetPanResponder: (_e, g) =>
              Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
            onMoveShouldSetPanResponderCapture: (_e, g) =>
              Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
            onPanResponderTerminationRequest: () => false,
            onPanResponderMove: (_e, g) => {
              swipeLastDx.current = g.dx;
              if (g.dx > 0) swipeX.setValue(Math.min(96, g.dx));
            },
            onPanResponderRelease: (_e, g) => {
              const dx = Math.max(g.dx, swipeLastDx.current);
              swipeLastDx.current = 0;
              if (dx > 56) {
                setSwipeArmed(true);
                Animated.spring(swipeX, {
                  toValue: 88,
                  useNativeDriver: true,
                }).start();
                return;
              }
              setSwipeArmed(false);
              Animated.spring(swipeX, {
                toValue: 0,
                useNativeDriver: true,
              }).start();
            },
            onPanResponderTerminate: () => {
              swipeLastDx.current = 0;
              setSwipeArmed(false);
              Animated.spring(swipeX, {
                toValue: 0,
                useNativeDriver: true,
              }).start();
            },
          })
        : null,
    [canSwipeDelete, node, onSwipeDelete, swipeX],
  );

  if (node.lane === 'now') {
    // Vertikale Achse + dünne horizontale Linie durch den Plan (kein blaues Feld)
    const hideAbove = Boolean(isFirst && !isLast);
    const hideBelow = Boolean(isLast && !isFirst);
    return (
      <View style={styles.row} accessibilityRole="text">
        <View style={styles.timeCol}>
          <Text style={[styles.timeText, styles.nowTimeText]}>
            {formatClock(node.atMs)}
          </Text>
        </View>
        <View style={styles.axisCol}>
          <View
            style={[
              styles.axisLine,
              { backgroundColor: colors.thinking },
              hideAbove && styles.axisLineHidden,
            ]}
          />
          <View style={styles.nowAxisDot} />
          <View
            style={[
              styles.axisLine,
              { backgroundColor: colors.thinking },
              hideBelow && styles.axisLineHidden,
            ]}
          />
        </View>
        <View style={styles.nowLineRow}>
          <View style={styles.nowLine} />
          <Text style={styles.nowLineLabel}>Jetzt</Text>
          <View style={styles.nowLine} />
        </View>
      </View>
    );
  }

  const cardShellStyle = [
    styles.card,
    { borderColor: tone.border, backgroundColor: tone.bg },
    (node.tone === 'change' || node.tone === 'trigger') &&
      !selected &&
      styles.cardToneStrong,
    selected && styles.cardSelected,
    isChoice && styles.proposalCard,
    isOpenBand && styles.openBandCard,
  ];

  // Achsen-Emoji separat; Medaillen/❓ bei Auswahl-Vorschlägen behalten
  const titlePlain = isChoice
    ? node.title.replace(/^👉\s*/u, '').trim()
    : node.title
        .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}❓👉]\s*/u, '')
        .trim();

  // Proposals: Maps/Speisekarte am Top-Board (mirroredActions), nicht unter der Karte
  const showPlaceActions =
    Boolean(
      node.mapsUrl ||
        node.menuUrl ||
        node.reserveUrl ||
        node.websiteUrl ||
        node.badge,
    ) &&
    !isChoice &&
    !isOpenBand &&
    node.lane === 'future';

  const rowAxisColor = isOpenBand ? colors.thinking : axisColor;

  // Navigation: Trigger/Erinnerung = rot; Wege = blau; Schätzung = neutrales ?
  if (compactNav) {
    const role = node.navRole;
    const isAlarmNav = role === 'reminder' || role === 'trigger';
    const navColor = isAlarmNav
      ? colors.danger
      : isFallback
        ? colors.textMuted
        : colors.thinking;
    return (
      <View style={styles.navRow}>
        <View style={styles.timeCol}>
          {hasTime && !isFallback ? (
            <Text style={[styles.navTimeText, { color: navColor }]}>
              {formatClock(node.atMs)}
            </Text>
          ) : (
            <Text style={[styles.navTimeText, { color: navColor }]}>
              {isFallback ? '?' : '·'}
            </Text>
          )}
          {node.endMs != null && !isFallback && showEndClock ? (
            <Text style={styles.navEndTime}>{formatClock(node.endMs)}</Text>
          ) : null}
        </View>
        <View style={styles.axisCol}>
          <View
            style={[
              styles.axisLineDashed,
              { borderColor: navColor },
              isFirst && !isLast && styles.axisLineHidden,
            ]}
          />
          <View
            style={[
              styles.navAxisTick,
              {
                backgroundColor: isFallback ? 'transparent' : navColor,
                borderWidth: isFallback ? 1.5 : 0,
                borderColor: navColor,
                borderRadius: isFallback ? 8 : 4,
              },
            ]}
          />
          <View
            style={[
              styles.axisLineDashed,
              { borderColor: navColor },
              isLast && !isFirst && styles.axisLineHidden,
            ]}
          />
        </View>
        <SwipeDeleteTrack
          enabled={Boolean(isLiveNav && swipePan)}
          swipeX={swipeX}
          panHandlers={swipePan?.panHandlers}
          armed={swipeArmed}
          onConfirmDelete={() => onSwipeDelete?.(node)}
        >
        <View style={styles.navCopy}>
          <Pressable
            onPress={() => {
              // Termin in der nächsten Stunde → Nav starten; sonst Akkordeon
              if (onNavStart?.(node)) return;
              if (
                node.transport === 'transit' ||
                node.journeyDetail ||
                node.subtitle
              ) {
                setNavExpanded((v) => !v);
              }
            }}
          >
            <View style={styles.navTitleRow}>
              <Text
                style={[styles.navLabel, { color: navColor, flex: 1 }]}
                numberOfLines={2}
              >
                {isFallback ? '❔ ' : node.emoji ? `${node.emoji} ` : ''}
                {titlePlain || node.title}
                {node.transport === 'transit' && !routeComputing
                  ? navExpanded
                    ? ' ▾'
                    : ' ▸'
                  : ''}
              </Text>
              {routeComputing ? (
                <ActivityIndicator
                  size="small"
                  color={colors.thinking}
                  style={{ marginLeft: 6 }}
                />
              ) : null}
              {onNavTransport && !isFtCommitted && !isLiveNav ? (
                <View style={styles.navModeRow}>
                  {(
                    [
                      ['walk', '🚶'],
                      ['bike', '🚲'],
                      ['transit', '🚌'],
                      ['taxi', '🚕'],
                    ] as const
                  ).map(([mode, emoji]) => {
                    const active =
                      node.transport === mode ||
                      (mode === 'walk' &&
                        (!node.transport || node.transport === 'unknown')) ||
                      (mode === 'taxi' && node.transport === 'car');
                    return (
                      <Pressable
                        key={mode}
                        hitSlop={6}
                        style={[
                          styles.navModeBtn,
                          active && styles.navModeBtnActive,
                          routeComputing && { opacity: 0.55 },
                        ]}
                        disabled={false}
                        onPress={() => onNavTransport(node, mode)}
                      >
                        <Text style={styles.navModeBtnText}>{emoji}</Text>
                      </Pressable>
                    );
                  })}
                  {node.transport === 'taxi' || node.transport === 'car' ? (
                    <Pressable
                      hitSlop={6}
                      style={styles.navModeBtn}
                      onPress={() => {
                        const airport = useFuturePlanStore
                          .getState()
                          .plan.stops.find(
                            (s) =>
                              s.id.startsWith('ft:') && s.id.endsWith(':airport'),
                          );
                        const stop =
                          useFuturePlanStore
                            .getState()
                            .plan.stops.find((s) => s.id === planStopId) ??
                          airport;
                        void handleQuickAction({
                          type: 'BOOK_UBER',
                          label: 'Uber vorbestellen',
                          payload: {
                            destName: airport?.title ?? stop?.title ?? node.title,
                            destLat: airport?.lat ?? stop?.lat,
                            destLng: airport?.lng ?? stop?.lng,
                          },
                        });
                      }}
                    >
                      <Text style={styles.navModeBtnText}>Uber</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
            {routeComputing ? (
              <Text style={styles.navSub} numberOfLines={1}>
                Route wird berechnet…
              </Text>
            ) : node.subtitle ? (
              <Text
                style={styles.navSub}
                numberOfLines={navExpanded ? undefined : 2}
              >
                {isFallback
                  ? '~ unterwegs (folgt in Sekunden)'
                  : node.subtitle}
              </Text>
            ) : isFallback ? (
              <Text style={styles.navSub} numberOfLines={1}>
                ~ unterwegs (folgt in Sekunden)
              </Text>
            ) : null}
            {navExpanded && node.journeyDetail && !isFallback ? (
              <Text style={[styles.navSub, { marginTop: 4 }]}>
                {node.journeyDetail}
              </Text>
            ) : null}
          </Pressable>
          {node.badge ? <PlaceActionChips node={node} /> : null}
        </View>
        </SwipeDeleteTrack>
    </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.timeCol}>
        {hasTime ? (
          <Text style={styles.timeText}>{formatClock(node.atMs)}</Text>
        ) : (
          <Text style={styles.timeText}>·</Text>
        )}
        {node.endMs != null && showEndClock ? (
          <Text style={styles.endTime}>{formatClock(node.endMs)}</Text>
        ) : node.untilNow ? (
          <Text style={styles.endTime}>bis jetzt</Text>
        ) : null}
      </View>

      <View style={styles.axisCol}>
        <View
          style={[
            styles.axisLine,
            { backgroundColor: rowAxisColor },
            isFirst && !isLast && styles.axisLineHidden,
          ]}
        />
        <View
          style={[
            styles.axisEmojiDot,
            {
              backgroundColor: colors.bgElevated,
              borderColor: rowAxisColor,
            },
          ]}
        >
          <Text style={styles.axisEmoji}>{node.emoji}</Text>
        </View>
        <View
          style={[
            styles.axisLine,
            { backgroundColor: rowAxisColor },
            isLast && !isFirst && styles.axisLineHidden,
          ]}
        />
      </View>

      <SwipeDeleteTrack
        enabled={Boolean(swipePan)}
        swipeX={swipeX}
        panHandlers={swipePan?.panHandlers}
        armed={swipeArmed}
        onConfirmDelete={() => onSwipeDelete?.(node)}
      >
        <View style={cardShellStyle}>
          <Pressable
            onPress={
              editable
                ? () => {
                    onSelect?.(node);
                  }
                : undefined
            }
            accessibilityRole={editable ? 'button' : undefined}
            accessibilityHint={
              editable
                ? isChoice
                  ? 'Tippen wählt diesen Vorschlag'
                  : isOpenBand
                    ? 'Tippen plant diesen offenen Punkt'
                    : selected
                      ? 'Tippen klappt die Karte zu; Löschen-Button oder nach rechts wischen'
                      : 'Tippen klappt Zeiten und Navigation auf; nach rechts wischen zum Löschen'
                : undefined
            }
          >
            <Text style={styles.cardTitle} numberOfLines={2}>
              {titlePlain || node.title}
              {isOpenBand ? ' · offen' : ''}
            </Text>
            {selected && accordion && !isChoice
              ? stopAccordionFacts({
                  atMs: node.atMs,
                  endMs: node.endMs,
                  notes: node.subtitle,
                }).map((line, bi) => (
                  <Text
                    key={`ab_${bi}`}
                    style={styles.accordionBullet}
                    numberOfLines={2}
                  >
                    {`• ${line}`}
                  </Text>
                ))
              : node.subtitle
                ? isChoice
                  ? (
                      <View style={styles.choiceBullets}>
                        {node.subtitle
                          .split(/\n+/)
                          .map((line) => line.replace(/^[•\-\*]\s*/, '').trim())
                          .filter(Boolean)
                          .slice(0, 3)
                          .map((line, bi) => (
                            <Text
                              key={`b_${bi}`}
                              style={styles.choiceBulletLine}
                              numberOfLines={1}
                            >
                              {`• ${line}`}
                            </Text>
                          ))}
                      </View>
                    )
                  : (
                      <Text style={styles.cardSub} numberOfLines={2}>
                        {node.subtitle}
                      </Text>
                    )
                : null}
          </Pressable>
          {selected && accordion && !isChoice ? (
            <View style={styles.accordionBody}>
              {accordion.hardFixed ? (
                <Text style={styles.accordionLocked} numberOfLines={2}>
                  Fix-Termin — Zeit nur per Sprache ändern
                </Text>
              ) : null}
              <View style={styles.accordionRow}>
                {!accordion.hardFixed ? (
                  <>
                    <Pressable
                      style={styles.accordionTimeBtn}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        accordion.onMinus15();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="15 Minuten früher"
                    >
                      <Text style={styles.accordionBtnText}>−15 Min</Text>
                    </Pressable>
                    <Pressable
                      style={styles.accordionTimeBtn}
                      onPress={(e) => {
                        e?.stopPropagation?.();
                        accordion.onPlus15();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="15 Minuten später"
                    >
                      <Text style={styles.accordionBtnText}>+15 Min</Text>
                    </Pressable>
                  </>
                ) : null}
                {accordion.canNav ? (
                  <Pressable
                    style={styles.accordionNavBtn}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      accordion.onStartNav();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Navigation starten"
                  >
                    <Text style={styles.accordionNavText} numberOfLines={1}>
                      🧭 Navigation starten
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.accordionDeleteBtn}
                  onPressIn={(e) => {
                    e?.stopPropagation?.();
                    accordion.onDelete();
                  }}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Löschen"
                >
                  <Text style={styles.accordionDeleteText}>Löschen</Text>
                </Pressable>
              </View>
              <PlaceActionChips node={node} />
            </View>
          ) : null}
          {showPlaceActions && !(selected && accordion) ? (
            <PlaceActionChips node={node} />
          ) : null}
        </View>
      </SwipeDeleteTrack>
    </View>
  );
}

const TimelineRow = React.memo(TimelineRowInner);

export type PlanCalendarModalHandle = {
  handleHardwareBack: () => boolean;
};

function planCalendarPropsEqual(prev: Props, next: Props): boolean {
  if (!prev.visible && !next.visible) return true;
  return (
    prev.visible === next.visible &&
    prev.isListening === next.isListening &&
    prev.isMicLocked === next.isMicLocked &&
    prev.isFinalizing === next.isFinalizing &&
    prev.isGenerating === next.isGenerating &&
    prev.isAudiblySpeaking === next.isAudiblySpeaking &&
    prev.onClose === next.onClose &&
    prev.onPressIn === next.onPressIn &&
    prev.onPressOut === next.onPressOut &&
    prev.onSwipeLock === next.onSwipeLock &&
    prev.onSwipeLiveChat === next.onSwipeLiveChat &&
    prev.onShortAnswerPrompt === next.onShortAnswerPrompt
  );
}

export const PlanCalendarModal = React.memo(
  React.forwardRef<PlanCalendarModalHandle, Props>(
  function PlanCalendarModal(
    {
      visible,
      onClose,
      onPressIn,
      onPressOut,
      onSwipeLock,
      onSwipeLiveChat,
      isListening,
      isMicLocked = false,
      isFinalizing,
      isGenerating,
      isAudiblySpeaking = false,
      onShortAnswerPrompt,
    },
    ref,
  ) {
  const insets = useSafeAreaInsets();
  const [dateKey, setDateKey] = useState(todayDateKey);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const userToggledGroups = useRef<Record<string, boolean>>({});
  const [undoDelete, setUndoDelete] = useState<FuturePlanStop | null>(null);
  // Echte Systemuhr: Sync beim Öffnen, dann an volle Minuten gekoppelt (kein 5s-Poll)
  const wallClockMs = useWallClockMs(visible);

  const planUpdated = useFuturePlanStore((s) => s.plan.updatedAtMs);
  const planDayKey = useFuturePlanStore((s) => s.plan.dayKey);
  const planBase = useFuturePlanStore((s) => {
    if (s.plan.dayKey === dateKey) return s.plan.base;
    return s.plansByDay[dateKey]?.base ?? null;
  });
  const planOriginBase = useFuturePlanStore((s) => {
    if (s.plan.dayKey === dateKey) return s.plan.originBase;
    return s.plansByDay[dateKey]?.originBase ?? null;
  });
  const ensureDay = useFuturePlanStore((s) => s.ensureDay);
  const histEntries = useHistoricalTimelineStore((s) => s.entries);
  const histLen = histEntries.length;
  const shortAnswers = usePlanCalendarUiStore((s) => s.shortAnswers);
  const mirroredActions = usePlanCalendarUiStore((s) => s.mirroredActions);
  const pendingChoice = usePlanCalendarUiStore((s) => s.pendingChoice);
  const requestedDayKey = usePlanCalendarUiStore((s) => s.requestedDayKey);
  const requestedDayAtMs = usePlanCalendarUiStore((s) => s.requestedDayAtMs);
  const routeComputingIds = usePlanCalendarUiStore((s) => s.routeComputingIds);
  const navActive = useFinnusStore((s) => s.navActive);
  const navTargetName = useFinnusStore((s) => s.navTargetName);
  const liveRouteLabel = useFinnusStore((s) => {
    const titled = s.multiStopTour?.title?.trim();
    if (titled) return titled;
    const open = (s.multiStopTour?.stops ?? []).filter((x) => !x.done);
    const strip = (n: string) =>
      n
        .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/u, '')
        .replace(/^\S+\s+→\s+/, '')
        .trim();
    if (open.length > 1) {
      const dest = open.find((x) => x.role === 'dest') ?? open[open.length - 1];
      const start = open[0];
      const a = strip(start?.name ?? '');
      const b = strip(dest?.name ?? '');
      if (a && b && a.toLowerCase() !== b.toLowerCase()) return `${a} → ${b}`;
      if (b) return b;
    }
    return s.navTargetName?.trim() || 'Unterwegs';
  });
  const liveLeaveArrive = useFinnusStore((s) => {
    const meta = s.multiStopTour?.liveMeta;
    const leave = meta?.leaveByMs;
    const arrive = meta?.plannedArriveByMs ?? meta?.hardArriveByMs;
    if (leave == null || arrive == null || !Number.isFinite(leave) || !Number.isFinite(arrive)) {
      return '';
    }
    const fmt = (ms: number) => {
      const d = new Date(ms);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    return `${fmt(leave)}–${fmt(arrive)}`;
  });
  const navDistanceM = useFinnusStore((s) => s.navDistanceM);
  const navEtaMin = useFinnusStore((s) => s.navEtaMin);
  const multiStopCount = useFinnusStore(
    (s) => s.multiStopTour?.stops.length ?? 0,
  );
  const clearRequestedDayKey = usePlanCalendarUiStore(
    (s) => s.clearRequestedDayKey,
  );
  const monthScrollRef = useRef<ScrollView>(null);
  const dayScrollRef = useRef<ScrollView>(null);
  const nowYRef = useRef(0);
  const openPlansYRef = useRef(0);
  const nodeYRef = useRef<Record<string, number>>({});
  const monthBlockY = useRef<Record<string, number>>({});
  /** Beim Öffnen / Tagwechsel → Timeline auf „Jetzt“ landen. */
  const landOnNowRef = useRef(false);
  const scrollTarget = usePlanCalendarUiStore((s) => s.scrollTarget);
  const scrollTargetAtMs = usePlanCalendarUiStore((s) => s.scrollTargetAtMs);
  /** Monat: zuerst aktuell+nächster, 3s fixiert, dann Rest ohne Hin-und-Her. */
  const [monthRadiusBefore, setMonthRadiusBefore] = useState(0);
  const [monthRadiusAfter, setMonthRadiusAfter] = useState(1);
  const [monthScrollLocked, setMonthScrollLocked] = useState(false);
  const [openDragIndex, setOpenDragIndex] = useState<number | null>(null);
  const [openDragOverTrash, setOpenDragOverTrash] = useState(false);
  const [tlDragIndex, setTlDragIndex] = useState<number | null>(null);
  const openDragY = useRef(new Animated.Value(0)).current;
  const tlDragY = useRef(new Animated.Value(0)).current;
  const openDragFrom = useRef<number | null>(null);
  const tlDragFrom = useRef<number | null>(null);
  const tlHoverIdx = useRef<number | null>(null);
  const openHoverIdx = useRef<number | null>(null);
  const openTrashRef = useRef(false);
  const trashZoneY = useRef(0);

  /** Schlanke Revision — Zahl statt ganzes plansByDay-Objekt (weniger Re-Renders). */
  const plansRevision = useFuturePlanStore((s) => {
    let n = s.plan.updatedAtMs;
    for (const p of Object.values(s.plansByDay)) n += p?.updatedAtMs ?? 0;
    return n;
  });

  const textMul = useUiScaleStore((s) => s.textMul);
  const buttonMul = useUiScaleStore((s) => s.buttonMul);
  /** User hat ‹/› benutzt — nicht sofort wieder auf „heute“ zurücksetzen. */
  const userPickedDayRef = useRef(false);
  const [visitTick, setVisitTick] = useState(0);
  const timelineBodyReady = useDeferredReady(visible, {
    sticky: true,
    maxWaitMs: 48,
  });
  const timelineHydrateGen = useRef(0);
  const visitsHydratedRef = useRef(false);

  // Stempel → Visit-Log nachziehen (bleibt ~3 Jahre; Orte pro Tag navigierbar)
  useEffect(() => {
    if (!visible || !timelineBodyReady) return;
    if (visitsHydratedRef.current) return;
    visitsHydratedRef.current = true;
    const gen = ++timelineHydrateGen.current;
    void hydrateVisitLog().then(() => {
      if (gen !== timelineHydrateGen.current) return;
      const stamps = useFinnusStore.getState().visitedHistory;
      const pois = useFinnusStore.getState().pois;
      importStampsIntoVisitLog(stamps, (poiId) => {
        const p = pois.find((x) => x.id === poiId);
        return p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
          ? { lat: p.lat, lng: p.lng }
          : null;
      });
      setVisitTick((n) => n + 1);
    });
  }, [visible, timelineBodyReady]);

  // Duplikate (Visit/Hist/Plan) bei Öffnen und Tagwechsel
  useEffect(() => {
    if (!visible || !dateKey) return;
    try {
      cleanupTimelineDuplicates(dateKey);
      setVisitTick((n) => n + 1);
    } catch {
      /* soft */
    }
  }, [visible, dateKey]);

  useEffect(() => {
    if (!visible) {
      userPickedDayRef.current = false;
      return;
    }
    // Nach ‹/› nicht zurückspringen — sonst wirkt „Tag zurück“ kaputt
    if (userPickedDayRef.current) return;
    // Agent-/Plan-Tag hat Vorrang vor hartem „heute“ — sonst leere Timeline
    // während Stops schon auf Do/Fr/… liegen
    const prefer =
      usePlanCalendarUiStore.getState().requestedDayKey ||
      planDayKey ||
      todayDateKey();
    const dk =
      prefer && /^\d{4}-\d{2}-\d{2}$/.test(prefer) ? prefer : todayDateKey();
    setDateKey(dk);
    try {
      cleanupTimelineDuplicates(dk);
    } catch {
      /* soft */
    }
  }, [visible, planDayKey]);

  // Tages-Timeline und Plan-Store = derselbe Tag
  useEffect(() => {
    if (!visible) return;
    ensureDay(dateKey);
  }, [visible, dateKey, ensureDay]);

  // Store-Tag folgt Agent/Wecker → UI-Tag mitziehen (außer User hat ‹/› benutzt)
  // Agent-requestDayKey hat Vorrang — sonst überschreibt planDayKey „morgen“ wieder.
  useEffect(() => {
    if (!visible || userPickedDayRef.current) return;
    const pending = usePlanCalendarUiStore.getState().requestedDayKey;
    if (pending) return;
    if (planDayKey && planDayKey !== dateKey) setDateKey(planDayKey);
  }, [visible, planDayKey, dateKey]);

  // Agent: Tag wechseln (morgen / …) — User-Pick überschreiben
  useEffect(() => {
    if (!visible || !requestedDayKey) return;
    userPickedDayRef.current = false;
    setDateKey(requestedDayKey);
    ensureDay(requestedDayKey);
    clearRequestedDayKey();
  }, [visible, requestedDayKey, requestedDayAtMs, ensureDay, clearRequestedDayKey]);

  // UI-only: no proposal speech engine


  const { nodes, openPlans } = useMemo(
    () =>
      visible && timelineBodyReady
        ? buildDayTimeline(dateKey, Date.now())
        : { nodes: [] as TimelineNode[], openPlans: [] },
    [
      visible,
      timelineBodyReady,
      dateKey,
      wallClockMs,
      plansRevision,
      histLen,
      visitTick,
    ],
  );

  const groupHeads = useMemo(() => {
    const map: Record<
      string,
      {
        label: string;
        firstId: string;
        startMs: number | null;
        endMs: number | null;
        count: number;
      }
    > = {};
    for (const n of nodes) {
      if (!n.groupId) continue;
      const cur = map[n.groupId];
      if (!cur) {
        map[n.groupId] = {
          label: n.groupLabel || 'Abschnitt',
          firstId: n.id,
          startMs: n.atMs,
          endMs: n.endMs ?? n.atMs,
          count: 1,
        };
      } else {
        cur.count += 1;
        if (n.endMs != null) cur.endMs = n.endMs;
        else if (n.atMs != null) cur.endMs = n.atMs;
      }
    }
    return map;
  }, [nodes]);

  const hasLiveJourney = Boolean(groupHeads.live_journey);
  const endLiveJourney = useCallback(() => {
    void stopVoiceOnUserTap();
    try {
      const {
        isLiveChatActive,
        stopLiveChatSession,
      } = require('../services/handsFree/liveChatSession') as {
        isLiveChatActive: () => boolean;
        stopLiveChatSession: (r?: string) => Promise<void>;
      };
      if (isLiveChatActive()) void stopLiveChatSession('plan_end');
    } catch {
      /* soft */
    }
    clearLiveNavFromPlan({ abandon: true });
    void clearNavigationHard({ silent: true });
    enqueueSpeech({
      kind: 'main',
      text: 'Alles klar — ich bin wieder da, wenn du was brauchst.',
      turnId: `end_live_${Date.now()}`,
    });
  }, []);

  useEffect(() => {
    setCollapsedGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, g] of Object.entries(groupHeads)) {
        if (
          g.count >= 2 &&
          next[id] === undefined &&
          userToggledGroups.current[id] == null
        ) {
          // Geplante ÖPNV/Flug-Gruppen zu — Live-Fahrt bleibt offen.
          if (id !== 'live_journey') {
            next[id] = true;
            changed = true;
          } else if (
            g.endMs != null &&
            g.endMs < Date.now() - 5 * 60_000
          ) {
            next[id] = true;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [groupHeads]);

  // Öffnen / Tagwechsel: Fokus auf den blauen „Jetzt“-Balken
  useEffect(() => {
    if (!visible) {
      landOnNowRef.current = false;
      return;
    }
    if (viewMode === 'day') landOnNowRef.current = true;
  }, [visible, viewMode, dateKey]);

  useEffect(() => {
    if (!visible || viewMode !== 'day' || !landOnNowRef.current) return;
    if (scrollTarget) return;
    if (dateKey !== todayDateKey()) {
      landOnNowRef.current = false;
      return;
    }
    const futureFlight = nodes.some(
      (n) =>
        /:airport\b/.test(n.id) &&
        n.atMs != null &&
        n.atMs > Date.now() + 30_000,
    );
    if (futureFlight) {
      landOnNowRef.current = false;
      return;
    }
    const scrollToNow = () => {
      const sc = dayScrollRef.current;
      if (!sc) return;
      const hasNow = nodes.some((n) => n.lane === 'now');
      if (!hasNow) {
        landOnNowRef.current = false;
        return;
      }
      const y = nowYRef.current;
      // Layout noch nicht gemessen → einmaliger Retry
      if (y <= 0) return;
      sc.scrollTo({ y: Math.max(0, y - 20), animated: false });
      landOnNowRef.current = false;
    };
    const t1 = setTimeout(scrollToNow, 80);
    const t2 = setTimeout(scrollToNow, 200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible, viewMode, dateKey, nodes, scrollTarget]);

  // Live-Scroll: immer zu dem, was Yorro gerade ändert (max. 3 Retries)
  useEffect(() => {
    if (!visible || viewMode !== 'day' || !scrollTarget) return;
    landOnNowRef.current = false;
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const sc = dayScrollRef.current;
      if (!sc) {
        if (attempts++ < 3) setTimeout(tryScroll, 100);
        return;
      }
      let y: number | undefined;
      if (scrollTarget.kind === 'open_plans') {
        // Prefer konkreter pending/fresh Stop statt nur „offene Pläne“-Anker
        const pendingId = Object.keys(nodeYRef.current).find((k) =>
          k.startsWith('choice_'),
        );
        const wishId = Object.keys(nodeYRef.current).find((k) =>
          k.startsWith('wish_') || k.startsWith('fix_') || k.startsWith('stop_'),
        );
        y =
          (pendingId ? nodeYRef.current[pendingId] : undefined) ??
          (wishId ? nodeYRef.current[wishId] : undefined) ??
          openPlansYRef.current;
      } else if (scrollTarget.kind === 'stop') {
        y = nodeYRef.current[scrollTarget.stopId];
      } else if (scrollTarget.kind === 'choice') {
        const key = Object.keys(nodeYRef.current).find((k) =>
          k.includes(scrollTarget.stepKey),
        );
        y = key ? nodeYRef.current[key] : undefined;
      }
      if (y == null || !Number.isFinite(y)) {
        if (attempts++ < 3) {
          setTimeout(tryScroll, 120);
          return;
        }
        usePlanCalendarUiStore.getState().clearScrollTarget();
        return;
      }
      sc.scrollTo({ y: Math.max(0, y - 40), animated: true });
      usePlanCalendarUiStore.getState().clearScrollTarget();
    };
    const t = setTimeout(tryScroll, 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, viewMode, scrollTarget, scrollTargetAtMs, nodes, openPlans]);

  // Choice / Planung aktiv → ohne Tippen zum aktuellen Punkt
  useEffect(() => {
    if (!visible || viewMode !== 'day') return;
    if (scrollTarget) return;
    const pending = usePlanCalendarUiStore.getState().pendingChoice;
    if (pending?.stepKey) {
      requestPlanScroll({ kind: 'choice', stepKey: pending.stepKey });
    }
  }, [visible, viewMode, pendingChoice?.stepKey, pendingChoice?.anchorTimeMs]);
  /** Anker für Monatsstapel = aktueller Kalendermonat (heute). */
  const centerMonthKey = useMemo(
    () => monthKeyFromDateKey(todayDateKey()),
    [visible, viewMode],
  );

  const monthKeys = useMemo(() => {
    const out: string[] = [];
    for (let i = -monthRadiusBefore; i <= monthRadiusAfter; i++) {
      out.push(shiftMonthKey(centerMonthKey, i));
    }
    return out;
  }, [centerMonthKey, monthRadiusBefore, monthRadiusAfter]);

  // Monat öffnen: nur aktueller + nächster. Mehr nur beim Scrollen.
  useEffect(() => {
    if (!visible || viewMode !== 'month') {
      setMonthRadiusBefore(0);
      setMonthRadiusAfter(1);
      setMonthScrollLocked(false);
      return;
    }
    monthBlockY.current = {};
    setMonthRadiusBefore(0);
    setMonthRadiusAfter(1);
    setMonthScrollLocked(false);
    setDateKey(todayDateKey());

    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      const y = monthBlockY.current[centerMonthKey];
      if (y != null) {
        monthScrollRef.current?.scrollTo({
          y: Math.max(0, y - 8),
          animated: false,
        });
      }
    }, 40);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, viewMode, centerMonthKey]);

  const growMonthRange = useCallback((edge: 'before' | 'after') => {
    if (edge === 'before') {
      setMonthRadiusBefore((n) => Math.min(MONTHS_BEFORE, n + MONTH_CHUNK));
      return;
    }
    setMonthRadiusAfter((n) => Math.min(MONTHS_AFTER, n + MONTH_CHUNK));
  }, []);

  // Marks erst in Monatsansicht — Tag-Modus nicht ausbremsen
  const dayMarks = useMemo(() => {
    if (!visible || viewMode !== 'month') {
      return {
        today: todayDateKey(),
        pastContent: new Set<string>(),
        futureContent: new Set<string>(),
        conflictDays: new Set<string>(),
      };
    }
    return collectMonthDayMarks();
  }, [viewMode, visible, plansRevision, histLen, histEntries]);

  type MonthTone = 'empty' | 'today' | 'past' | 'future' | 'conflict';
  const monthToneFor = useCallback(
    (dk: string): MonthTone => {
      const { today, pastContent, futureContent, conflictDays } = dayMarks;
      // Rot vor Blau (nur heute/Zukunft)
      if (conflictDays.has(dk) && dk >= today) return 'conflict';
      if (dk === today) return 'today';
      if (dk < today && pastContent.has(dk)) return 'past';
      if (dk > today && futureContent.has(dk)) return 'future';
      return 'empty';
    },
    [dayMarks],
  );

  const monthToneStyle = (tone: MonthTone) => {
    switch (tone) {
      case 'today':
        return { bg: '#3D7CFF', fg: '#FFFFFF' }; // blau
      case 'past':
        return { bg: '#E6B422', fg: '#1A1A1A' }; // gelb
      case 'future':
        return { bg: '#2FBF71', fg: '#FFFFFF' }; // grün
      case 'conflict':
        return { bg: '#E24B4B', fg: '#FFFFFF' }; // rot
      default:
        return { bg: colors.surface, fg: colors.textMuted };
    }
  };

  const onPrev = useCallback(() => {
    void stopVoiceOnUserTap();
    userPickedDayRef.current = true;
    if (viewMode === 'month') {
      setDateKey((k) => `${shiftMonthKey(monthKeyFromDateKey(k), -1)}-01`);
      return;
    }
    setDateKey((k) => shiftDateKey(k, -1));
  }, [viewMode]);

  const onNext = useCallback(() => {
    void stopVoiceOnUserTap();
    userPickedDayRef.current = true;
    if (viewMode === 'month') {
      setDateKey((k) => `${shiftMonthKey(monthKeyFromDateKey(k), 1)}-01`);
      return;
    }
    setDateKey((k) => shiftDateKey(k, 1));
  }, [viewMode]);

  const goToday = useCallback(() => {
    void stopVoiceOnUserTap();
    userPickedDayRef.current = false;
    setDateKey(todayDateKey());
    setViewMode('day');
  }, []);

  const toggleMonthDay = useCallback(() => {
    void stopVoiceOnUserTap();
    setViewMode((m) => (m === 'day' ? 'month' : 'day'));
  }, []);

  const openDayFromMonth = useCallback((dk: string) => {
    void stopVoiceOnUserTap();
    setMonthRadiusBefore(0);
    setMonthRadiusAfter(1);
    setViewMode('day');
    setDateKey(dk);
    requestAnimationFrame(() => {
      try {
        ensureDay(dk);
      } catch {
        /* soft — Tag trotzdem anzeigen */
      }
    });
  }, [ensureDay]);

  /** System-Zurück: Akkordeon → Monat → Tag → schließen (eine Ebene). */
  const handleBack = useCallback(() => {
    void stopVoiceOnUserTap();
    if (selectedStopId) {
      setSelectedStopId(null);
      try {
        usePlanCalendarUiStore.getState().setFocusedStopId(null);
      } catch {
        /* soft */
      }
      return;
    }
    if (viewMode === 'month') {
      setViewMode('day');
      return;
    }
    onClose();
  }, [viewMode, onClose, selectedStopId]);

  React.useImperativeHandle(
    ref,
    () => ({
      handleHardwareBack: () => {
        if (!visible) return false;
        handleBack();
        return true;
      },
    }),
    [visible, handleBack],
  );

  const onShortAnswer = useCallback(
    (a: PlanShortAnswer) => {
      void stopVoiceOnUserTap();
      try {
        usePlanCalendarUiStore.getState().touchPlanInteraction();
      } catch {
        /* soft */
      }
      if (a.action === 'plan_location') {
        const pick =
          a.pick?.trim() ||
          a.label.replace(/^[🥇🥈📍✅👉❓]\s*/u, '').trim();
        void import('../module2/planning/runPlanningModule').then(({ resolvePlanLocationInput }) =>
          resolvePlanLocationInput(pick),
        );
        return;
      }
      if (
        a.action === 'plan_pick' ||
        a.action === 'plan_accept' ||
        a.action === 'plan_reject' ||
        a.action === 'plan_confirm'
      ) {
        const title =
          a.action === 'plan_pick'
            ? a.pick?.trim() ||
              a.prompt?.trim() ||
              (a.label ?? '')
                .replace(/^[🥇🥈📍✅👉❓]\s*/u, '')
                .replace(/^Option\s*[AB]\s*[·:–-]?\s*/i, '')
                .trim()
            : undefined;
        void import('../module2/planning/runPlanningModule').then(
          ({ handlePlanCalendarDirect }) =>
            handlePlanCalendarDirect({
              kind:
                a.action === 'plan_reject'
                  ? 'reject'
                  : a.action === 'plan_pick'
                    ? 'pick'
                    : a.action === 'plan_confirm'
                      ? 'confirm'
                      : 'accept',
              title,
            }).then((ok) => {
              if (!ok) {
                onShortAnswerPrompt?.(
                  a.action === 'plan_reject'
                    ? 'Beides nicht — hast du andere Vorschläge'
                    : title
                      ? `Ich wähle ${title}`
                      : 'Vorschlag bestätigen',
                );
              }
            }),
        );
        return;
      }
      if (a.action === 'prompt') {
        const prompt =
          a.prompt ??
          (a.id === 'book_tour'
            ? 'Zeig mir die Tour zum Buchen'
            : a.label);
        // Flug-Gepäck & Choice-Slots: Commitment sofort schließen (nicht Planning-Modul).
        void (async () => {
          try {
            const {
              resolveChoiceSlotFromPrompt,
              getLastParentTurnId,
            } = await import('../module2/router/choiceTurnContext');
            const resolved = resolveChoiceSlotFromPrompt(prompt, a.label);
            if (resolved) {
              try {
                usePlanCalendarUiStore.getState().clearShortAnswers();
                usePlanCalendarUiStore.getState().clearMirroredActions();
              } catch {
                /* soft */
              }
              const { continueTurnFromChoice } = await import(
                '../module2/router/continueTurnFromChoice'
              );
              await continueTurnFromChoice({
                parentTurnId: getLastParentTurnId() || `tap_${Date.now()}`,
                choiceId: resolved.choiceId,
                label: resolved.label,
                slotKey: resolved.slotKey,
                inventoryPatch: resolved.inventoryPatch,
              });
              return;
            }
          } catch {
            /* fall through */
          }
          try {
            usePlanCalendarUiStore.getState().clearShortAnswers();
          } catch {
            /* soft */
          }
          onShortAnswerPrompt?.(prompt);
        })();
      }
    },
    [onShortAnswerPrompt],
  );

  const onSelectNode = useCallback(
    (node: TimelineNode) => {
      const id = planStopIdFromTimelineNodeId(node.id);
      if (!id) return;

      // Während Yorro spricht: keine neuen Pitches — Zuklappen bleibt erlaubt
      if (isSpeechActive()) {
        setSelectedStopId((cur) => {
          if (cur !== id) return cur;
          try {
            usePlanCalendarUiStore.getState().setFocusedStopId(null);
          } catch {
            /* soft */
          }
          return null;
        });
        return;
      }

      if (id.startsWith('choice_')) {
        const clean = node.title
          .replace(/^[🥇🥈❓]\s*/u, '')
          .replace(/^👉\s*/u, '')
          .trim();
        void import('../module2/planning/runPlanningModule').then(
          ({ handlePlanCalendarDirect }) =>
            handlePlanCalendarDirect({
              kind: 'pick',
              title: clean,
              stopId: id,
            }),
        );
        return;
      }
      // Offenes Band / Wish: Recherche fortsetzen (nicht löschen)
      if (node.isOpenBand || node.kind === 'wish') {
        kickOpenPlanResearch(id);
        return;
      }
      setSelectedStopId((cur) => {
        const next = cur === id ? null : id;
        try {
          usePlanCalendarUiStore.getState().setFocusedStopId(next);
        } catch {
          /* soft */
        }
        return next;
      });
    },
    [],
  );

  const selectedStop = useMemo(() => {
    if (!selectedStopId) return null;
    return (
      useFuturePlanStore
        .getState()
        .plan.stops.find((s) => s.id === selectedStopId) ?? null
    );
  }, [selectedStopId, plansRevision]);

  const selectedIsHardFixed = useMemo(() => {
    if (!selectedStop) return false;
    try {
      const { isHardFixedStop } = require('../module2/planning/planHardLock') as {
        isHardFixedStop: (s: NonNullable<typeof selectedStop>) => boolean;
      };
      return isHardFixedStop(selectedStop);
    } catch {
      return false;
    }
  }, [selectedStop]);

  const editMinus15 = useCallback(() => {
    void stopVoiceOnUserTap();
    if (!selectedStopId || !selectedStop) return;
    try {
      const { isHardFixedStop } = require('../module2/planning/planHardLock') as {
        isHardFixedStop: (s: typeof selectedStop) => boolean;
      };
      if (isHardFixedStop(selectedStop)) return;
    } catch {
      /* soft */
    }
    reschedulePlanStop(selectedStopId, { deltaMin: -15 });
  }, [selectedStopId, selectedStop]);

  const editPlus15 = useCallback(() => {
    void stopVoiceOnUserTap();
    if (!selectedStopId || !selectedStop) return;
    try {
      const { isHardFixedStop } = require('../module2/planning/planHardLock') as {
        isHardFixedStop: (s: typeof selectedStop) => boolean;
      };
      if (isHardFixedStop(selectedStop)) return;
    } catch {
      /* soft */
    }
    reschedulePlanStop(selectedStopId, { deltaMin: 15 });
  }, [selectedStopId, selectedStop]);

  const setNavLegTransport = useCallback(
    (node: TimelineNode, mode: FuturePlanTransport) => {
      void stopVoiceOnUserTap();
      const id = planStopIdFromTimelineNodeId(node.id) ?? node.id;
      if (isLiveNavLegId(id)) {
        applyLiveNavTransport(mode);
        return;
      }
      if (id.startsWith('ft:') && /:(leave|leg\d+)$/i.test(id)) {
        const ident = id.split(':')[1] ?? '';
        setStopTransport(id, mode);
        usePlanCalendarUiStore.getState().markRouteComputing(id, true);
        void import('../services/flights/flightTimeline')
          .then((m) => m.retargetFlightAccess(id, mode))
          .finally(() => {
            const ui = usePlanCalendarUiStore.getState();
            ui.markRouteComputing(id, false);
            const keys = Object.keys(ui.routeComputingIds);
            for (const k of keys) {
              if (ident && k.startsWith(`ft:${ident}:`)) {
                usePlanCalendarUiStore.getState().markRouteComputing(k, false);
              }
            }
          });
        if (mode === 'taxi' || mode === 'car') {
          const stop = useFuturePlanStore
            .getState()
            .plan.stops.find((s) => s.id === id) ??
            useFuturePlanStore
              .getState()
              .plan.stops.find((s) => s.id.endsWith(':leave'));
          usePlanCalendarUiStore.getState().setMirroredActions([
            {
              type: 'BOOK_UBER',
              label: 'Uber vorbestellen',
              payload: {
                destName: stop?.title ?? 'Flughafen',
                destLat: stop?.lat,
                destLng: stop?.lng,
              },
            },
          ]);
        }
        return;
      }
      if (node.kind === 'nav_leg' || id.startsWith('nav_')) {
        setStopTransport(id, mode);
      }
    },
    [],
  );

  const startNavToSelected = useCallback(() => {
    void stopVoiceOnUserTap();
    if (!selectedStop) return;
    if (selectedStop.lat == null || selectedStop.lng == null) return;
    void handleQuickAction({
      type: 'START_NAVIGATION',
      label: `🧭 ${selectedStop.title}`.slice(0, 28),
      payload: {
        destName: selectedStop.title,
        destLat: selectedStop.lat,
        destLng: selectedStop.lng,
      },
    });
  }, [selectedStop]);

  /** Nav-Leg tippen: Zieltermin in der nächsten Stunde → Navigation starten */
  const tryStartNavFromLeg = useCallback((node: TimelineNode): boolean => {
    try {
      const legId = planStopIdFromTimelineNodeId(node.id) ?? node.id;
      if (!legId.startsWith('nav_')) return false;
      const stops = useFuturePlanStore.getState().plan.stops;
      let dest: (typeof stops)[number] | null = null;
      if (legId.startsWith('nav_here_')) {
        const toId = legId.slice('nav_here_'.length);
        dest = stops.find((s) => s.id === toId) ?? null;
      } else {
        const parts = legId.slice(4).split('_');
        for (let split = 1; split < parts.length; split++) {
          const toId = parts.slice(split).join('_');
          const b = stops.find((s) => s.id === toId);
          if (b?.lat != null && b.lng != null) {
            dest = b;
            break;
          }
        }
      }
      if (!dest || dest.lat == null || dest.lng == null) {
        // Fallback: Leg-eigene Koordinaten
        if (node.kind === 'nav_leg') {
          const leg = stops.find((s) => s.id === legId);
          if (leg?.lat == null || leg.lng == null) return false;
          const arrive = leg.plannedEndMs ?? node.endMs ?? null;
          if (arrive == null) return false;
          const delta = arrive - Date.now();
          if (delta > 60 * 60_000 || delta < -10 * 60_000) return false;
          void stopVoiceOnUserTap();
          void handleQuickAction({
            type: 'START_NAVIGATION',
            label: `🧭 ${leg.title}`.slice(0, 28),
            payload: {
              destName: leg.title,
              destLat: leg.lat,
              destLng: leg.lng,
            },
          });
          return true;
        }
        return false;
      }
      const arrive = dest.plannedStartMs ?? null;
      if (arrive == null) return false;
      const delta = arrive - Date.now();
      // Nur wenn Termin in der nächsten Stunde (oder gerade läuft)
      if (delta > 60 * 60_000 || delta < -10 * 60_000) return false;
      void stopVoiceOnUserTap();
      void handleQuickAction({
        type: 'START_NAVIGATION',
        label: `🧭 ${dest.title}`.slice(0, 28),
        payload: {
          destName: dest.title,
          destLat: dest.lat,
          destLng: dest.lng,
        },
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const onSwipeDeleteNode = useCallback((node: TimelineNode) => {
    void stopVoiceOnUserTap();
    const raw =
      planStopIdFromTimelineNodeId(node.id) ||
      (node.id.startsWith('plan_') ? node.id.slice('plan_'.length) : node.id);
    const id = raw && raw !== 'now' && node.kind !== 'reality' ? raw : null;
    if (!id) return;
    if (isLiveNavLegId(id) || node.groupId === 'live_journey') {
      setSelectedStopId((cur) => (cur === id ? null : cur));
      clearLiveNavFromPlan({ abandon: true });
      void clearNavigationHard({ silent: true });
      return;
    }
    const snap = useFuturePlanStore
      .getState()
      .plan.stops.find((s) => s.id === id);
    removePlanStop(id);
    setSelectedStopId((cur) => (cur === id ? null : cur));
    if (snap) {
      setUndoDelete(snap);
      setTimeout(() => {
        setUndoDelete((cur) => (cur?.id === id ? null : cur));
      }, 7000);
    }
    try {
      usePlanCalendarUiStore.getState().setFocusedStopId(null);
    } catch {
      /* soft */
    }
  }, []);

  // Open-Plan-Count vor Early-Return (Hooks dürfen nicht nach `if (!visible)` stehen)
  const openPlanDragCount = useMemo(() => {
    const todayKey = todayDateKey();
    if (dateKey < todayKey) return 0;
    return openPlans.length;
  }, [dateKey, openPlans.length]);

  const makeOpenPlanPan = useCallback(
    (index: number, planId: string) =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          openDragFrom.current === index &&
          (Math.abs(g.dy) > 4 || Math.abs(g.dx) > 4),
        onStartShouldSetPanResponder: () => openDragFrom.current === index,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          openDragFrom.current = index;
          openHoverIdx.current = index;
          openTrashRef.current = false;
          setOpenDragIndex(index);
          setOpenDragOverTrash(false);
          openDragY.setValue(0);
        },
        onPanResponderMove: (_e, g) => {
          openDragY.setValue(g.dy);
          const from = openDragFrom.current;
          if (from == null) return;
          const delta = Math.round(g.dy / OPEN_ROW_H);
          const next = Math.max(
            0,
            Math.min(openPlanDragCount - 1, from + delta),
          );
          openHoverIdx.current = next;
          const pastList =
            from * OPEN_ROW_H + g.dy > openPlanDragCount * OPEN_ROW_H + 24;
          const overTrash = pastList || g.dy > OPEN_ROW_H * 2.5;
          openTrashRef.current = overTrash;
          setOpenDragOverTrash(overTrash);
        },
        onPanResponderRelease: () => {
          const from = openDragFrom.current;
          const to = openHoverIdx.current;
          const trash = openTrashRef.current;
          openDragFrom.current = null;
          openHoverIdx.current = null;
          openTrashRef.current = false;
          setOpenDragIndex(null);
          setOpenDragOverTrash(false);
          openDragY.setValue(0);
          if (from == null) return;
          if (trash) {
            void stopVoiceOnUserTap();
            removeOpenPlan(planId);
            return;
          }
          if (to != null && from !== to) {
            void stopVoiceOnUserTap();
            reorderOpenPlan(planId, to);
          }
        },
        onPanResponderTerminate: () => {
          openDragFrom.current = null;
          openHoverIdx.current = null;
          openTrashRef.current = false;
          setOpenDragIndex(null);
          setOpenDragOverTrash(false);
          openDragY.setValue(0);
        },
      }),
    [openDragY, openPlanDragCount],
  );

  const timelineReorderable = useMemo(
    () =>
      nodes.filter(
        (n) =>
          n.lane === 'future' &&
          n.kind !== 'nav_leg' &&
          n.groupId !== 'live_journey' &&
          n.isProposal !== true,
      ),
    [nodes],
  );

  const applyTimelineReorder = useCallback(
    (from: number, to: number) => {
      const node = timelineReorderable[from];
      const dest = timelineReorderable[to];
      if (!node || !dest) return;
      const fromId = planStopIdFromTimelineNodeId(node.id) ?? node.id;
      const toId = planStopIdFromTimelineNodeId(dest.id) ?? dest.id;
      const fromLive = isLiveNavLegId(fromId) && fromId !== LIVE_NAV_LEG_ID;
      const toLive = isLiveNavLegId(toId) && toId !== LIVE_NAV_LEG_ID;
      if (fromLive && toLive) {
        const live = timelineReorderable.filter((n) => {
          const id = planStopIdFromTimelineNodeId(n.id) ?? n.id;
          return isLiveNavLegId(id) && id !== LIVE_NAV_LEG_ID;
        });
        const a = live.findIndex((n) => n.id === node.id);
        const b = live.findIndex((n) => n.id === dest.id);
        if (a >= 0 && b >= 0 && a !== b) {
          reorderUpcomingTourStops(a, b);
          upsertLiveNavFromStore({ force: true });
        }
        return;
      }
      if (!fromLive && !toLive) {
        const planish = timelineReorderable.filter((n) => {
          const id = planStopIdFromTimelineNodeId(n.id) ?? n.id;
          return !(isLiveNavLegId(id) && id !== LIVE_NAV_LEG_ID);
        });
        const b = planish.findIndex((n) => n.id === dest.id);
        if (b >= 0) reorderTimedPlanStops(fromId, b);
      }
    },
    [timelineReorderable],
  );

  const makeTlPan = useCallback(
    (index: number) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => tlDragFrom.current === index,
        onMoveShouldSetPanResponder: (_e, g) =>
          tlDragFrom.current === index && Math.abs(g.dy) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          tlHoverIdx.current = index;
          tlDragY.setValue(0);
        },
        onPanResponderMove: (_e, g) => {
          tlDragY.setValue(g.dy);
          const from = tlDragFrom.current;
          if (from == null) return;
          const delta = Math.round(g.dy / TL_ROW_H);
          tlHoverIdx.current = Math.max(
            0,
            Math.min(timelineReorderable.length - 1, from + delta),
          );
        },
        onPanResponderRelease: () => {
          const from = tlDragFrom.current;
          const to = tlHoverIdx.current;
          tlDragFrom.current = null;
          tlHoverIdx.current = null;
          setTlDragIndex(null);
          tlDragY.setValue(0);
          if (from == null || to == null || from === to) return;
          void stopVoiceOnUserTap();
          applyTimelineReorder(from, to);
        },
        onPanResponderTerminate: () => {
          tlDragFrom.current = null;
          tlHoverIdx.current = null;
          setTlDragIndex(null);
          tlDragY.setValue(0);
        },
      }),
    [applyTimelineReorder, tlDragY, timelineReorderable.length],
  );

  if (!visible) {
    /* keep mounted — Overlay unsichtbar, Dock sofort wieder da */
  }

  const todayKey = todayDateKey();
  const isPastDay = dateKey < todayKey;
  /** Vergangenheit = nur Zeitleiste; Planung/Offene Pläne nur heute + Zukunft. */
  const visibleOpenPlans = isPastDay ? [] : openPlans;
  const showPlanningChrome = !isPastDay;
  const leftAnswers = showPlanningChrome
    ? shortAnswers.slice(0, Math.ceil(shortAnswers.length / 2))
    : [];
  const rightAnswers = showPlanningChrome
    ? shortAnswers.slice(Math.ceil(shortAnswers.length / 2))
    : [];
  const conflictCount = nodes.filter((n) => n.tone === 'conflict').length;
  const openConflictCount = visibleOpenPlans.filter(
    (p) => p.status === 'conflict',
  ).length;
  const hasOverlapConflict =
    showPlanningChrome &&
    (conflictCount + openConflictCount > 0 || hasTimeOverlap());

  if (!visible) {
    return (
      <View
        style={[styles.overlay, styles.overlayHidden]}
        pointerEvents="none"
      />
    );
  }

  return (
    <View
      style={[styles.overlay, !visible && styles.overlayHidden]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <SwipeBackView
        enabled={visible}
        captureHardwareBack={false}
        onBack={handleBack}
        style={styles.sheet}
        edgeTopInset={56}
      >
        <View style={styles.topBar}>
          {/* ← Datum → …… Heute · Monat/Tag · ✕ */}
          <Pressable
            onPress={onPrev}
            hitSlop={16}
            style={[styles.navBtn, styles.navBtnPrev]}
            accessibilityRole="button"
            accessibilityLabel="Vorheriger Tag"
          >
            <Text style={styles.navBtnText}>‹</Text>
          </Pressable>
          <Text style={styles.dayTitle} numberOfLines={1}>
            {viewMode === 'month'
              ? formatMonthTitleDe(monthKeyFromDateKey(dateKey))
              : formatDayLabel(dateKey)}
          </Text>
          <Pressable onPress={onNext} hitSlop={12} style={styles.navBtn}>
            <Text style={styles.navBtnText}>›</Text>
          </Pressable>

          <View style={styles.topSpacer} />

          <Pressable
            onPress={goToday}
            hitSlop={8}
            style={styles.todayBtn}
            accessibilityRole="button"
            accessibilityLabel="Heute"
          >
            <Text style={styles.todayBtnText}>Heute</Text>
          </Pressable>
          {showPlanningChrome ? (
            <Pressable
              onPress={() => {
                // Clear zuerst — nicht hinter stopVoice warten (sonst tot bei JS-Last).
                const result = clearDayPlan(dateKey);
                void stopVoiceOnUserTap();
                if (result.speech) {
                  enqueueSpeech({
                    kind: 'main',
                    text: result.speech,
                    turnId: `m5_clear_${Date.now()}`,
                  });
                }
              }}
              hitSlop={8}
              style={styles.clearDayBtn}
              accessibilityRole="button"
              accessibilityLabel="Heutige Planung löschen"
            >
              <Text style={styles.clearDayBtnText}>Leeren</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={toggleMonthDay}
            hitSlop={8}
            style={styles.viewToggle}
            accessibilityRole="button"
            accessibilityLabel={
              viewMode === 'day' ? 'Monatsansicht öffnen' : 'Tagesansicht öffnen'
            }
          >
            <Text style={styles.viewToggleText}>
              {viewMode === 'day' ? 'Monat' : 'Tag'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onClose();
              void stopVoiceOnUserTap();
            }}
            hitSlop={20}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Timeline schließen"
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {(navActive || multiStopCount > 0) &&
        !hasLiveJourney &&
        (navTargetName?.trim() || multiStopCount > 0) ? (
          <View style={styles.routeStripWrap}>
            <View
              style={[
                styles.routeStrip,
                liveLeaveArrive ? styles.routeStripReminder : null,
              ]}
            >
              <Pressable
                style={styles.routeStripCopy}
                onPress={() => {
                  userToggledGroups.current.live_journey = true;
                  setCollapsedGroups((prev) => ({
                    ...prev,
                    live_journey: !prev.live_journey,
                  }));
                }}
                accessibilityRole="button"
                accessibilityLabel="Route auf- oder zuklappen"
              >
                <Text
                  style={[
                    styles.routeStripKicker,
                    liveLeaveArrive ? styles.routeStripKickerReminder : null,
                  ]}
                >
                  {collapsedGroups.live_journey ? '▸' : '▾'}{' '}
                  {liveLeaveArrive ? '⏰ Erinnerung · ÖPNV' : liveRouteLabel.startsWith('Fahrt') || liveRouteLabel.startsWith('Reise') ? 'Fahrt' : 'Aktive Route'}
                </Text>
                <Text style={styles.routeStripTitle} numberOfLines={2}>
                  {liveRouteLabel}
                  {liveLeaveArrive ? ` · ${liveLeaveArrive}` : ''}
                  {multiStopCount <= 1 &&
                  navDistanceM != null &&
                  Number.isFinite(navDistanceM)
                    ? ` · ${
                        navDistanceM < 1000
                          ? `${Math.max(0, Math.round(navDistanceM))} m`
                          : `${(navDistanceM / 1000).toFixed(1)} km`
                      }`
                    : ''}
                  {multiStopCount <= 1 &&
                  navEtaMin != null &&
                  Number.isFinite(navEtaMin) &&
                  navEtaMin > 0
                    ? ` · ${formatDurationMinutesDe(navEtaMin, 'short')}`
                    : ''}
                </Text>
              </Pressable>
              <Pressable
                onPress={endLiveJourney}
                style={styles.routeStripBtn}
                accessibilityRole="button"
                accessibilityLabel="Route beenden"
              >
                <Text style={styles.routeStripBtnText}>Beenden</Text>
              </Pressable>
            </View>
          </View>
        ) : viewMode === 'day' ? (
          <Text style={styles.routeHint} numberOfLines={2}>
            Route planen: sag Yorro wohin — sie erscheint in dieser Timeline,
            nicht extra auf dem Homescreen.
          </Text>
        ) : null}

        {hasOverlapConflict ? (
          <View style={styles.conflictBannerWrap}>
            <Text style={styles.conflictBanner} numberOfLines={2}>
              {conflictCount + openConflictCount > 0
                ? `${conflictCount + openConflictCount} Zeitkonflikt${
                    conflictCount + openConflictCount === 1 ? '' : 'e'
                  }`
                : 'Zeitkonflikt'}{' '}
              — nach Regeln lösen (6 frei, 5 fragen, 4 nur schieben, 3 fragen,
              1–2 heilig).
            </Text>
            <View style={styles.conflictBtnRow}>
              <Pressable
                style={styles.conflictBtn}
                onPress={() => {
                  void stopVoiceOnUserTap();
                  void import('../module2/planning/planConflictResolve').then(
                    (m) => m.resolveOverlapsInteractive(),
                  );
                }}
              >
                <Text style={styles.conflictBtnText}>Konflikt lösen</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {planOriginBase?.label ? (
          <View style={styles.baseBannerWrap}>
            <Text style={styles.baseBanner} numberOfLines={1}>
              📍 Basis jetzt: {planOriginBase.label}
            </Text>
          </View>
        ) : null}

        {planBase?.label ? (
          <View style={styles.baseBannerWrap}>
            <Text style={styles.baseBanner} numberOfLines={1}>
              {planBase.kind === 'hotel'
                ? '🏨'
                : planBase.kind === 'home'
                  ? '🏠'
                  : '📍'}{' '}
              Basis ab Plan-Tag: {planBase.label}
            </Text>
          </View>
        ) : null}

        {showPlanningChrome && mirroredActions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mirrorRow}
            style={styles.mirrorScroll}
          >
            {mirroredActions.slice(0, 6).map((a: QuickAction, i) => {
              const maps = isMapsQuickAction(a);
              const label = maps
                ? stripMapsActionPrefix(a.label)
                : a.label;
              return (
                <Pressable
                  key={`${a.type}_${a.label}_${i}`}
                  style={styles.mirrorBtn}
                  onPress={() => {
                    // Maps/Speisekarte: Speech nicht killen während Pitch
                    if (
                      a.type !== 'OPEN_URL' &&
                      a.type !== 'BOOK_STAY22' &&
                      a.type !== 'OPEN_GYG_WIDGET'
                    ) {
                      void stopVoiceOnUserTap();
                    }
                    if (a.type === 'START_NAVIGATION') {
                      onClose();
                    }
                    void handleQuickAction(a);
                  }}
                >
                  <View style={styles.mirrorBtnInner}>
                    {maps ? (
                      <Text style={styles.mapsEmoji} accessibilityLabel="Karte">
                        {MAPS_ACTION_EMOJI}
                      </Text>
                    ) : null}
                    <Text style={styles.mirrorBtnText} numberOfLines={1}>
                      {label}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {showPlanningChrome && pendingChoice ? (
          <Text style={styles.choiceHint} numberOfLines={2}>
            {pendingChoice.headline}
            {pendingChoice.anchorTimeLabel
              ? ` · ${pendingChoice.anchorTimeLabel}`
              : ''}
            {pendingChoice.selectedOptionId
              ? ' — Auswahl aktiv'
              : ' — tippe 🥇 oder 🥈 in der Timeline zum Übernehmen'}
          </Text>
        ) : null}

        {viewMode === 'month' ? (
          <ScrollView
            ref={monthScrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.monthStack}
            scrollEnabled={!monthScrollLocked}
            scrollEventThrottle={80}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } =
                e.nativeEvent;
              if (contentOffset.y < 96) growMonthRange('before');
              if (
                contentOffset.y + layoutMeasurement.height >
                contentSize.height - 96
              ) {
                growMonthRange('after');
              }
            }}
          >
            <View style={styles.monthLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#E6B422' }]} />
                <Text style={styles.legendText}>Vergangenheit (mit Inhalt)</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#3D7CFF' }]} />
                <Text style={styles.legendText}>Heute</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#2FBF71' }]} />
                <Text style={styles.legendText}>Zukunft</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#E24B4B' }]} />
                <Text style={styles.legendText}>Konflikt</Text>
              </View>
            </View>
            {monthKeys.map((mk) => {
              const days = daysInMonth(mk);
              const pad = mondayIndexForMonth(mk);
              return (
                <View
                  key={mk}
                  style={styles.monthBlock}
                  onLayout={(e) => {
                    monthBlockY.current[mk] = e.nativeEvent.layout.y;
                  }}
                >
                  <Text style={styles.monthBlockTitle}>
                    {formatMonthTitleDe(mk)}
                  </Text>
                  <View style={styles.weekdayRow}>
                    {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => (
                      <Text key={w} style={styles.weekdayLabel}>
                        {w}
                      </Text>
                    ))}
                  </View>
                  <View style={styles.monthGrid}>
                    {Array.from({ length: pad }).map((_, i) => (
                      <View key={`pad_${mk}_${i}`} style={styles.monthCellEmpty} />
                    ))}
                    {days.map((dk) => {
                      const tone = monthToneFor(dk);
                      const { bg, fg } = monthToneStyle(tone);
                      const selected = dk === dateKey;
                      const dayNum = Number(dk.slice(-2));
                      // Weiße Umrandung nur Auswahl, nicht zusätzlich auf „Heute“ (blau)
                      const showSelectRing = selected && tone !== 'today';
                      return (
                        <Pressable
                          key={dk}
                          onPress={() => openDayFromMonth(dk)}
                          style={[
                            styles.monthCell,
                            { backgroundColor: bg },
                            showSelectRing && styles.monthCellSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.monthCellText,
                              { color: fg },
                              selected && styles.monthCellTextOn,
                            ]}
                          >
                            {dayNum}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <ScrollView
            ref={dayScrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.timelinePad}
          >
            {visibleOpenPlans.length > 0 ? (
              <View
                style={styles.openSection}
                onLayout={(e) => {
                  openPlansYRef.current = e.nativeEvent.layout.y;
                }}
              >
                <View style={styles.openTitleRow}>
                  <Text style={styles.openTitle}>Offene Pläne</Text>
                </View>
                <Text style={styles.openHint}>
                  Lange drücken und schieben = Reihenfolge · nach rechts
                  wischen = löschen
                </Text>
                {visibleOpenPlans.map((p, idx) => {
                  const tone = toneStyles(
                    p.status === 'pending_change'
                      ? 'change'
                      : p.status === 'conflict'
                        ? 'conflict'
                        : 'default',
                  );
                  const selected = selectedStopId === p.id;
                  const dragging = openDragIndex === idx;
                  const pan = makeOpenPlanPan(idx, p.id);
                  return (
                    <Animated.View
                      key={p.id}
                      style={[
                        styles.openCard,
                        { borderColor: tone.border, backgroundColor: tone.bg },
                        selected && styles.cardSelected,
                        dragging && styles.openCardDragging,
                        dragging
                          ? {
                              transform: [
                                { translateY: openDragY },
                                { scale: 1.07 },
                              ],
                              zIndex: 20,
                              elevation: 20,
                            }
                          : null,
                      ]}
                      {...pan.panHandlers}
                    >
                      <View style={styles.openDragHandle}>
                        <Text style={styles.openDragHandleText}>≡</Text>
                      </View>
                      <Pressable
                        style={styles.openCardMain}
                        delayLongPress={380}
                        onLongPress={() => {
                          openDragFrom.current = idx;
                          openHoverIdx.current = idx;
                          setOpenDragIndex(idx);
                          openDragY.setValue(0);
                        }}
                        onPress={() => {
                          void stopVoiceOnUserTap();
                          focusOpenPlanNext(p.id);
                          kickOpenPlanResearch(p.id);
                        }}
                      >
                        <Text style={styles.openCardText}>
                          {p.emoji} {p.title}
                          {p.hardAnchor ||
                          (p.planPriority != null && p.planPriority <= 3)
                            ? ' · Fix'
                            : p.planPriority === 5
                              ? ' · Wichtig'
                              : ''}
                        </Text>
                        {p.status === 'pending_change' ? (
                          <Text style={styles.freshHint}>Frisch geändert</Text>
                        ) : null}
                      </Pressable>
                      <View style={styles.openCardActions}>
                        <Pressable
                          style={[
                            styles.openIconBtn,
                            idx === 0 && styles.openIconBtnDisabled,
                          ]}
                          disabled={idx === 0}
                          hitSlop={8}
                          accessibilityLabel="Nach oben"
                          onPress={() => {
                            void stopVoiceOnUserTap();
                            moveOpenPlan(p.id, 'up');
                          }}
                        >
                          <Text style={styles.openIconText}>↑</Text>
                        </Pressable>
                        <Pressable
                          style={[
                            styles.openIconBtn,
                            idx === visibleOpenPlans.length - 1 &&
                              styles.openIconBtnDisabled,
                          ]}
                          disabled={idx === visibleOpenPlans.length - 1}
                          hitSlop={8}
                          accessibilityLabel="Nach unten"
                          onPress={() => {
                            void stopVoiceOnUserTap();
                            moveOpenPlan(p.id, 'down');
                          }}
                        >
                          <Text style={styles.openIconText}>↓</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.openIconBtn, styles.openIconBtnDanger]}
                          hitSlop={8}
                          accessibilityLabel="Löschen"
                          onPress={() => {
                            void stopVoiceOnUserTap();
                            removeOpenPlan(p.id);
                          }}
                        >
                          <Text style={styles.openIconText}>🗑</Text>
                        </Pressable>
                      </View>
                    </Animated.View>
                  );
                })}
                <View
                  style={[
                    styles.openTrashZone,
                    openDragOverTrash && styles.openTrashZoneActive,
                  ]}
                  onLayout={(e) => {
                    trashZoneY.current = e.nativeEvent.layout.y;
                  }}
                >
                  <Text
                    style={[
                      styles.openTrashZoneText,
                      openDragOverTrash && styles.openTrashZoneTextActive,
                    ]}
                  >
                    {openDragOverTrash
                      ? '🗑 Loslassen = löschen + neu rechnen'
                      : '🗑 Hierher ziehen zum Löschen'}
                  </Text>
                </View>
              </View>
            ) : null}

            {!timelineBodyReady ? (
              <View style={{ paddingVertical: 28, alignItems: 'center' }}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : nodes.length === 0 ? (
              <Text style={styles.empty}>Noch nichts für diesen Tag.</Text>
            ) : (
              <>
              {timelineReorderable.length > 1 ? (
                <Text style={styles.openHint}>
                  Lange drücken und nach oben/unten schieben ändert die
                  Reihenfolge. Nach rechts wischen löscht.
                </Text>
              ) : null}
              {nodes.map((n, idx) => {
                const g = n.groupId ? groupHeads[n.groupId] : null;
                const isGroupFirst = Boolean(g && g.firstId === n.id);
                const collapsed = Boolean(
                  n.groupId && collapsedGroups[n.groupId],
                );
                if (collapsed && !isGroupFirst) return null;
                const reorderIdx = timelineReorderable.findIndex(
                  (r) => r.id === n.id,
                );
                const canDrag =
                  reorderIdx >= 0 && timelineReorderable.length > 1;
                const dragging = tlDragIndex === reorderIdx && canDrag;
                const pan = canDrag ? makeTlPan(reorderIdx) : null;
                return (
                  <View
                    key={n.id}
                    onLayout={(e) => {
                      const y = e.nativeEvent.layout.y;
                      const stopId = planStopIdFromTimelineNodeId(n.id) ?? n.id;
                      nodeYRef.current[stopId] = y;
                      nodeYRef.current[n.id] = y;
                      if (n.lane === 'now') {
                        nowYRef.current = y;
                        if (
                          landOnNowRef.current &&
                          !usePlanCalendarUiStore.getState().scrollTarget
                        ) {
                          dayScrollRef.current?.scrollTo({
                            y: Math.max(0, y - 20),
                            animated: false,
                          });
                          landOnNowRef.current = false;
                        }
                      }
                    }}
                  >
                    {isGroupFirst &&
                    g &&
                    n.groupId &&
                    (g.count >= 2 || n.groupId === 'live_journey') ? (
                      <View style={styles.row}>
                        <View style={styles.timeCol}>
                          <Text style={styles.timeText}>
                            {formatClock(g.startMs)}
                          </Text>
                          {g.endMs != null ? (
                            <Text style={styles.endTime}>
                              {formatClock(g.endMs)}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.axisCol}>
                          <View
                            style={[
                              styles.axisLine,
                              { backgroundColor: colors.thinking },
                            ]}
                          />
                          <View
                            style={[
                              styles.axisEmojiDot,
                              {
                                backgroundColor: colors.bgElevated,
                                borderColor:
                                  n.groupId === 'live_journey'
                                    ? colors.danger
                                    : colors.thinking,
                              },
                            ]}
                          >
                            <Text style={styles.axisEmoji}>
                              {n.groupId === 'live_journey'
                                ? '⏰'
                                : /flug/i.test(g.label)
                                  ? '✈️'
                                  : '🚌'}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.axisLine,
                              { backgroundColor: colors.thinking },
                              collapsed && styles.axisLineHidden,
                            ]}
                          />
                        </View>
                        {n.groupId === 'live_journey' ? (
                          <View
                            style={[
                              styles.card,
                              styles.routeStrip,
                              styles.routeStripReminder,
                              { marginHorizontal: 0, marginBottom: 0, flex: 1 },
                            ]}
                          >
                            <Pressable
                              style={styles.routeStripCopy}
                              hitSlop={12}
                              onPress={() => {
                                const id = n.groupId!;
                                userToggledGroups.current[id] = true;
                                setCollapsedGroups((prev) => ({
                                  ...prev,
                                  [id]: !prev[id],
                                }));
                              }}
                              accessibilityRole="button"
                              accessibilityLabel="Fahrt auf- oder zuklappen"
                            >
                              <Text
                                style={[
                                  styles.routeStripKicker,
                                  styles.routeStripKickerReminder,
                                ]}
                              >
                                {collapsed ? '▸' : '▾'} Erinnerung · ÖPNV
                              </Text>
                              <Text style={styles.routeStripTitle} numberOfLines={2}>
                                {liveRouteLabel}
                                {liveLeaveArrive ? ` · ${liveLeaveArrive}` : ''}
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={endLiveJourney}
                              style={styles.routeStripBtn}
                              accessibilityRole="button"
                              accessibilityLabel="Route beenden"
                            >
                              <Text style={styles.routeStripBtnText}>Beenden</Text>
                            </Pressable>
                          </View>
                        ) : (
                        <View
                          style={[
                            styles.card,
                            {
                              backgroundColor: colors.bgElevated,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Pressable
                            hitSlop={12}
                            onPress={() => {
                              const id = n.groupId!;
                              userToggledGroups.current[id] = true;
                              setCollapsedGroups((prev) => ({
                                ...prev,
                                [id]: !prev[id],
                              }));
                            }}
                          >
                            <Text style={styles.cardTitle} numberOfLines={2}>
                              {`${collapsed ? '▸' : '▾'} ${g.label.replace(/^Flug(?:\s+\S+)?\s+nach\s+(.+?)\s+\d{1,2}:\d{2}$/, 'Flug nach $1')}`}
                            </Text>
                            <Text style={styles.cardSub} numberOfLines={1}>
                              {collapsed
                                ? 'Tippen für die Schritte'
                                : 'Tippen zum Zuklappen'}
                            </Text>
                          </Pressable>
                          {n.groupId.includes('toAirport') ? (
                            <View style={[styles.navModeRow, { marginTop: 8 }]}>
                              {(
                                [
                                  ['walk', '🚶'],
                                  ['bike', '🚲'],
                                  ['transit', '🚌'],
                                  ['taxi', '🚕'],
                                ] as const
                              ).map(([mode, emoji]) => {
                                const active =
                                  n.transport === mode ||
                                  (mode === 'taxi' && n.transport === 'car');
                                return (
                                  <Pressable
                                    key={mode}
                                    hitSlop={6}
                                    style={[
                                      styles.navModeBtn,
                                      active && styles.navModeBtnActive,
                                    ]}
                                    onPress={() =>
                                      setNavLegTransport(n, mode)
                                    }
                                  >
                                    <Text style={styles.navModeBtnText}>
                                      {emoji}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          ) : null}
                        </View>
                        )}
                      </View>
                    ) : null}
                    {collapsed ? null : (
                    <Pressable
                      delayLongPress={380}
                      disabled={!canDrag}
                      onLongPress={
                        canDrag
                          ? () => {
                              tlDragFrom.current = reorderIdx;
                              tlHoverIdx.current = reorderIdx;
                              setTlDragIndex(reorderIdx);
                              tlDragY.setValue(0);
                            }
                          : undefined
                      }
                    >
                      <Animated.View
                        style={
                          dragging
                            ? {
                                transform: [
                                  { translateY: tlDragY },
                                  { scale: 1.06 },
                                ],
                                zIndex: 20,
                                elevation: 20,
                              }
                            : undefined
                        }
                        {...(pan ? pan.panHandlers : {})}
                      >
                    <TimelineRow
                      node={n}
                      isFirst={idx === 0}
                      isLast={idx === nodes.length - 1}
                      nextAtMs={(() => {
                        for (let j = idx + 1; j < nodes.length; j++) {
                          const m = nodes[j]!;
                          const mCollapsed = Boolean(
                            m.groupId && collapsedGroups[m.groupId],
                          );
                          const mg = m.groupId
                            ? groupHeads[m.groupId]
                            : null;
                          if (
                            mCollapsed &&
                            mg &&
                            mg.firstId !== m.id
                          ) {
                            continue;
                          }
                          return m.atMs;
                        }
                        return null;
                      })()}
                      selected={
                        selectedStopId != null &&
                        planStopIdFromTimelineNodeId(n.id) === selectedStopId
                      }
                      accordion={
                        selectedStopId != null &&
                        planStopIdFromTimelineNodeId(n.id) === selectedStopId &&
                        n.kind !== 'nav_leg'
                          ? {
                              hardFixed: selectedIsHardFixed,
                              canNav: Boolean(
                                selectedStop &&
                                  selectedStop.lat != null &&
                                  selectedStop.lng != null &&
                                  selectedStop.kind !== 'wish' &&
                                  !selectedStop.id.startsWith('choice_'),
                              ),
                              onMinus15: editMinus15,
                              onPlus15: editPlus15,
                              onStartNav: startNavToSelected,
                              onDelete: () => onSwipeDeleteNode(n),
                            }
                          : null
                      }
                      onSelect={onSelectNode}
                      onSwipeDelete={onSwipeDeleteNode}
                      onNavTransport={
                        n.kind === 'nav_leg' ? setNavLegTransport : undefined
                      }
                      onNavStart={
                        n.kind === 'nav_leg' ? tryStartNavFromLeg : undefined
                      }
                      routeComputing={(() => {
                        const nid =
                          planStopIdFromTimelineNodeId(n.id) ?? n.id;
                        if (routeComputingIds[nid]) return true;
                        const m = /^ft:([^:]+):/i.exec(nid);
                        if (!m) return false;
                        return Object.keys(routeComputingIds).some((k) =>
                          k.startsWith(`ft:${m[1]}:`),
                        );
                      })()}
                    />
                      </Animated.View>
                    </Pressable>
                    )}
                  </View>
                );
              })}
              </>
            )}
          </ScrollView>
        )}

        {undoDelete ? (
          <View style={styles.undoBar}>
            <Text style={styles.undoBarText} numberOfLines={1}>
              „{undoDelete.title}“ gelöscht
            </Text>
            <Pressable
              onPress={() => {
                const snap = undoDelete;
                setUndoDelete(null);
                addPlanStop({
                  id: snap.id,
                  title: snap.title,
                  lat: snap.lat,
                  lng: snap.lng,
                  plannedStartMs: snap.plannedStartMs,
                  plannedEndMs: snap.plannedEndMs,
                  transport: snap.transport,
                  kind: snap.kind,
                  hardAnchor: snap.hardAnchor,
                  notes: snap.notes,
                  bufferMin: snap.bufferMin,
                  emoji: snap.emoji,
                  journeyDetail: snap.journeyDetail,
                  userFixedTime: snap.userFixedTime,
                  planPriority: snap.planPriority,
                  groupId: snap.groupId,
                  groupLabel: snap.groupLabel,
                  mapsUrl: snap.mapsUrl,
                  openCalendar: false,
                });
              }}
              hitSlop={8}
            >
              <Text style={styles.undoBarAction}>Rückgängig</Text>
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.bottomBar,
            leftAnswers.length + rightAnswers.length === 0 &&
              styles.bottomBarCompact,
            {
              paddingBottom: Math.max(insets.bottom, 8) + 10,
            },
          ]}
        >
          {leftAnswers.length > 0 ? (
            <View style={styles.answerCol}>
              {leftAnswers.map((a) => (
                <Pressable
                  key={a.id}
                  style={[
                    styles.answerBtn,
                    {
                      paddingVertical: Math.round(12 * buttonMul),
                      paddingHorizontal: Math.round(10 * buttonMul),
                      minHeight: Math.round(44 * buttonMul),
                    },
                  ]}
                  onPress={() => onShortAnswer(a)}
                >
                  <Text
                    style={[
                      styles.answerText,
                      { fontSize: Math.round(15 * textMul) },
                    ]}
                    numberOfLines={2}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.answerCol} />
          )}
          <MicButton
            compact
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            onSwipeLock={onSwipeLock}
            onSwipeLiveChat={onSwipeLiveChat}
            isListening={isListening}
            isMicLocked={isMicLocked}
            isFinalizing={isFinalizing}
            isGenerating={isGenerating}
            isSpeaking={isAudiblySpeaking}
          />
          {rightAnswers.length > 0 ? (
            <View style={styles.answerCol}>
              {rightAnswers.map((a) => (
                <Pressable
                  key={a.id}
                  style={[
                    styles.answerBtn,
                    {
                      paddingVertical: Math.round(12 * buttonMul),
                      paddingHorizontal: Math.round(10 * buttonMul),
                      minHeight: Math.round(44 * buttonMul),
                    },
                  ]}
                  onPress={() => onShortAnswer(a)}
                >
                  <Text
                    style={[
                      styles.answerText,
                      { fontSize: Math.round(15 * textMul) },
                    ]}
                    numberOfLines={2}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.answerCol} />
          )}
        </View>
      </SwipeBackView>
    </View>
  );
  },
  ),
  planCalendarPropsEqual,
);

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay,
    elevation: UI_LAYER.overlay,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  overlayHidden: {
    opacity: 0,
    pointerEvents: 'none',
  },
  sheet: {
    flex: 1,
    marginTop: 48,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    zIndex: 80,
  },
  viewToggle: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  viewToggleText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    zIndex: 60,
    elevation: 60,
  },
  navBtnPrev: {
    // über SwipeBack-Edge liegen (Edge startet erst unter Top-Bar)
    marginLeft: 2,
  },
  navBtnText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '600',
    marginTop: -2,
  },
  dayTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
    maxWidth: 168,
  },
  topSpacer: {
    flex: 1,
    minWidth: 8,
  },
  todayBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.thinking,
  },
  todayBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  clearDayBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.danger,
    marginLeft: 6,
  },
  clearDayBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  phaseHint: {
    color: colors.thinking,
    fontSize: 11,
    paddingHorizontal: spacing.md,
    paddingBottom: 4,
  },
  conflictBanner: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  conflictBannerWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: 6,
  },
  baseBannerWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: 6,
  },
  baseBanner: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  routeStripWrap: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: 6,
  },
  routeStripModes: {
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 2,
  },
  routeStripModeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  routeStripModeText: {
    fontSize: 16,
  },
  routeStrip: {
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeStripCopy: {
    flex: 1,
    minWidth: 0,
  },
  routeStripKicker: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  routeStripTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  routeStripReminder: {
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: 'rgba(217, 107, 92, 0.16)',
  },
  routeStripKickerReminder: {
    color: colors.danger,
  },
  routeStripBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  routeStripBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  routeHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: spacing.md,
    paddingBottom: 8,
  },
  conflictBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  conflictBtn: {
    backgroundColor: 'rgba(217, 107, 92, 0.2)',
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '48%',
  },
  conflictBtnText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  choiceWrap: {
    marginHorizontal: spacing.sm,
    marginBottom: 8,
    padding: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(61,124,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(61,124,255,0.35)',
  },
  choiceHint: {
    color: colors.thinking,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingBottom: 8,
  },
  choiceHeadline: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 8,
  },
  choiceSplit: {
    flexDirection: 'row',
    gap: 8,
  },
  choiceCard: {
    flex: 1,
    backgroundColor: colors.surface ?? colors.bgElevated,
    borderRadius: 12,
    padding: 10,
    minHeight: 140,
    borderWidth: 1,
    borderColor: colors.border,
  },
  choiceMedal: {
    fontSize: 16,
    marginBottom: 4,
  },
  choiceTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  choiceSub: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    flexGrow: 1,
  },
  choiceWalk: {
    color: colors.thinking,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
  },
  choiceActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  choiceLink: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  choiceLinkText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  mirrorScroll: {
    maxHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mirrorRow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  mirrorBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: 220,
    minHeight: 36,
    justifyContent: 'center',
  },
  mirrorBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapsEmoji: {
    fontSize: 14,
    lineHeight: 18,
  },
  mirrorBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  timelineLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 80,
  },
  closeText: {
    color: colors.textMuted,
    fontSize: 18,
  },
  scroll: {
    flex: 1,
  },
  timelinePad: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: 8,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 24,
    lineHeight: 20,
    fontSize: 13,
  },
  emptySmall: {
    color: colors.textMuted,
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 64,
    marginVertical: 4,
  },
  timeCol: {
    width: 48,
    alignItems: 'flex-end',
    paddingRight: 6,
    justifyContent: 'center',
  },
  timeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  endTime: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  emojiOnly: {
    fontSize: 18,
  },
  axisCol: {
    width: 22,
    alignItems: 'center',
  },
  axisLine: {
    flex: 1,
    width: 2,
    opacity: 0.7,
    minHeight: 8,
  },
  axisLineDashed: {
    flex: 1,
    width: 0,
    minHeight: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: colors.thinking,
    opacity: 0.55,
  },
  axisLineHidden: {
    opacity: 0,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingVertical: 4,
  },
  navAxisTick: {
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: colors.thinking,
    opacity: 0.5,
    marginVertical: 2,
  },
  navTimeText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  navEndTime: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
    opacity: 0.8,
  },
  navCopy: {
    flex: 1,
    marginLeft: 8,
    minWidth: 0,
  },
  navTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  navModeBtn: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  navModeBtnActive: {
    borderColor: colors.thinking,
    backgroundColor: 'rgba(96,165,250,0.18)',
  },
  navModeBtnText: {
    fontSize: 13,
  },
  navLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.9,
  },
  navSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
    opacity: 0.75,
  },
  axisDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginVertical: 2,
  },
  axisEmojiDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  axisEmoji: {
    fontSize: 12,
  },
  nowAxisDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.thinking,
    marginVertical: 2,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  nowCard: {
    flex: 1,
    marginLeft: 8,
    marginVertical: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.thinking,
    justifyContent: 'center',
  },
  nowLineRow: {
    flex: 1,
    marginLeft: 8,
    marginVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nowLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.thinking,
    borderRadius: 1,
    opacity: 0.9,
  },
  nowLineLabel: {
    color: colors.thinking,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 0,
  },
  openBandCard: {
    backgroundColor: 'rgba(61,124,255,0.12)',
    borderColor: 'rgba(61,124,255,0.55)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  groupHead: {
    marginLeft: 56,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  groupHeadText: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  nowTimeText: {
    color: colors.thinking,
  },
  nowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  nowLabelInline: {
    color: colors.thinking,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  nowLabel: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  card: {
    flex: 1,
    marginLeft: 0,
    marginVertical: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: colors.thinking,
  },
  cardToneStrong: {
    borderWidth: 2,
  },
  proposalCard: {
    borderWidth: 2,
    borderColor: colors.thinking,
  },
  proposalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  proposalActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  proposalActionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  swipeDeleteAsk: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.danger ?? '#B91C1C',
  },
  swipeDeleteAskText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  swipeTrack: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 12,
    marginLeft: 8,
  },
  swipeReveal: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 88,
    backgroundColor: colors.danger,
    justifyContent: 'center',
    paddingLeft: 14,
  },
  swipeRevealText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  undoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  undoBarText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  undoBarAction: {
    color: colors.thinking,
    fontSize: 13,
    fontWeight: '800',
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  cardSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  choiceBullets: {
    marginTop: 4,
    gap: 2,
  },
  choiceBulletLine: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  freshHint: {
    color: colors.thinking,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  accordionBody: {
    marginTop: 6,
    gap: 2,
  },
  accordionBullet: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  accordionLocked: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  accordionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  accordionTimeBtn: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  accordionNavBtn: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 88,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    alignItems: 'center',
  },
  accordionDeleteBtn: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
  },
  accordionDeleteText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  accordionBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  accordionNavText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  addWishBtn: {
    marginTop: spacing.md,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  addWishText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  openSection: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 6,
  },
  openTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  openTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
  },
  openHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 2,
  },
  openCard: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  openCardDragging: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    opacity: 0.95,
  },
  openDragHandle: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  openDragHandleText: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: '700',
  },
  openTrashZone: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
  },
  openTrashZoneActive: {
    borderColor: colors.danger,
    backgroundColor: 'rgba(217, 107, 92, 0.15)',
  },
  openTrashZoneText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  openTrashZoneTextActive: {
    color: colors.danger,
  },
  openCardMain: {
    flex: 1,
    minWidth: 0,
  },
  openCardText: {
    color: colors.text,
    fontSize: 14,
  },
  openCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  openIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  openIconBtnDisabled: {
    opacity: 0.35,
  },
  openIconBtnDanger: {
    backgroundColor: 'rgba(226,75,75,0.12)',
  },
  openIconText: {
    fontSize: 14,
    color: colors.text,
  },
  monthStack: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 32,
    gap: spacing.lg,
  },
  monthBlock: {
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  monthBlockTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing.sm,
    textTransform: 'capitalize',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekdayLabel: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  monthLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthCellEmpty: {
    width: '14.28%',
    aspectRatio: 1,
  },
  monthCell: {
    width: '14.28%',
    aspectRatio: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    overflow: 'hidden',
  },
  monthCellSelected: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  monthCellText: {
    fontSize: 13,
    fontWeight: '700',
  },
  monthCellTextOn: {
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingBottom: 4,
    paddingTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 4,
  },
  bottomBarCompact: {
    paddingBottom: 2,
    paddingTop: 0,
  },
  answerCol: {
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    minHeight: 0,
  },
  answerBtn: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  answerText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});
