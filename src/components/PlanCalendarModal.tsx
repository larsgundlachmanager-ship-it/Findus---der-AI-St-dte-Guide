/**
 * Planungsmodul-UI — Ist-Zeitachse + Zukunftsplan + offene Pläne + Mic.
 * Overlay (kein RN-Modal), analog VisitPassportModal.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { todayDateKey } from '../utils/dateKeys';
// session.dayKey steuert „Plan für morgen“ etc.
import { useWallClockMs } from '../hooks/useWallClockMs';
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
import { useFuturePlanStore } from '../module2/timeline/futurePlanState';
import { useHistoricalTimelineStore } from '../module2/timeline/historicalTimelineState';
import { useUiScaleStore } from '../services/ui/uiScale';
import {
  cycleStopTransport,
  planStopIdFromTimelineNodeId,
  removePlanStop,
  reschedulePlanStop,
} from '../module2/timeline/planLiveEdits';
import {
  focusOpenPlanNext,
  moveOpenPlan,
  removeOpenPlan,
  reorderOpenPlan,
} from '../module2/timeline/openPlanEdits';
import { MicButton } from './MicButton';
import { SwipeBackView } from './SwipeBackView';
import { handleQuickAction } from '../services/actionHandlerService';
import type { QuickAction } from '../types/concierge';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  hydrateVisitLog,
  importStampsIntoVisitLog,
} from '../services/timeline/visitLog';
import { enqueueSpeech, stopVoiceOnUserTap, isSpeechActive } from '../module2/speech/speechQueue';
import {
  detectOfferKind,
  isSafeOfferUrl,
  offerLabel,
} from '../module2/planning/offerActionUtils';
import { shortenActionLabel, stripMapsActionPrefix, MAPS_ACTION_EMOJI } from '../services/concierge/actionLabelShorten';
import { hasTimeOverlap } from '../module2/planning/planConflictResolve';

const OPEN_ROW_H = 56;

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

const MONTHS_BEFORE = 26;
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
      return { border: colors.online, dot: colors.online, bg: colors.surface };
    case 'reality':
      return { border: colors.wave, dot: colors.wave, bg: colors.surface };
    default:
      return { border: colors.border, dot: colors.textMuted, bg: colors.surface };
  }
}

function TimelineRow({
  node,
  selected,
  onSelect,
  isFirst,
  isLast,
}: {
  node: TimelineNode;
  selected?: boolean;
  onSelect?: (node: TimelineNode) => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const tone = toneStyles(node.tone);
  const axisColor =
    node.lane === 'now' ? colors.thinking : tone.dot;

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

  const hasTime = node.atMs != null;
  const isNav = node.kind === 'nav_leg';
  const isOpenBand = node.isOpenBand === true || node.kind === 'wish';
  const isChoice =
    node.isProposal === true ||
    node.id.includes('choice_') ||
    /^[🥇🥈❓]/.test(node.title);
  const editable =
    node.lane === 'future' && !isNav && !node.realityLocked;
  const Card = editable ? Pressable : View;
  // Achsen-Emoji separat; Medaillen/❓ bei Auswahl-Vorschlägen behalten
  const titlePlain = isChoice
    ? node.title.replace(/^👉\s*/u, '').trim()
    : node.title
        .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}❓👉]\s*/u, '')
        .trim();

  // Proposals: Maps/Speisekarte am Top-Board (mirroredActions), nicht unter der Karte
  const showPlaceActions =
    Boolean(node.mapsUrl || node.menuUrl || node.reserveUrl) &&
    !isChoice &&
    !isOpenBand &&
    node.lane === 'future' &&
    !isNav;

  const rowAxisColor = isOpenBand ? colors.thinking : axisColor;

  // Navigation: Trigger/Erinnerung = grün; Wege geroutet = blau; Schätzung = neutrales ?
  if (isNav) {
    const role = node.navRole;
    const isGreenNav = role === 'reminder' || role === 'trigger';
    const isFallback = node.routeEstimate === 'fallback';
    const navColor = isGreenNav
      ? colors.online
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
          {node.endMs != null && !isFallback ? (
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
        <View style={styles.navCopy}>
          <Text style={[styles.navLabel, { color: navColor }]} numberOfLines={1}>
            {isFallback ? '❔ ' : node.emoji ? `${node.emoji} ` : ''}
            {titlePlain || node.title}
          </Text>
          {node.subtitle ? (
            <Text style={styles.navSub} numberOfLines={2}>
              {isFallback
                ? 'Route wird noch berechnet…'
                : node.subtitle}
            </Text>
          ) : isFallback ? (
            <Text style={styles.navSub} numberOfLines={1}>
              Route wird noch berechnet…
            </Text>
          ) : null}
        </View>
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
        {node.endMs != null ? (
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

      <Card
        style={[
          styles.card,
          { borderColor: tone.border, backgroundColor: tone.bg },
          selected && styles.cardSelected,
          isChoice && styles.proposalCard,
          isOpenBand && styles.openBandCard,
        ]}
        onPress={editable ? () => onSelect?.(node) : undefined}
        accessibilityRole={editable ? 'button' : undefined}
        accessibilityHint={
          editable
            ? isChoice
              ? 'Tippen wählt diesen Vorschlag'
              : isOpenBand
                ? 'Tippen plant diesen offenen Punkt'
                : 'Tippen zum Bearbeiten: Zeit, Transport, Löschen'
            : undefined
        }
      >
        <Text style={styles.cardTitle} numberOfLines={2}>
          {titlePlain || node.title}
          {isOpenBand ? ' · offen' : ''}
        </Text>
        {node.subtitle ? (
          isChoice ? (
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
          ) : (
            <Text style={styles.cardSub} numberOfLines={1}>
              {node.subtitle}
            </Text>
          )
        ) : null}
        {showPlaceActions ? (
          <View style={styles.proposalActions}>
            {node.mapsUrl ? (
              <Pressable
                style={styles.proposalActionBtn}
                hitSlop={6}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  void Linking.openURL(node.mapsUrl!);
                }}
              >
                <Text style={styles.proposalActionText}>
                  {MAPS_ACTION_EMOJI} Maps
                </Text>
              </Pressable>
            ) : null}
            {node.menuUrl && isSafeOfferUrl(node.menuUrl) ? (
              <Pressable
                style={styles.proposalActionBtn}
                hitSlop={6}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  void Linking.openURL(node.menuUrl!);
                }}
              >
                <Text style={styles.proposalActionText}>
                  {
                    offerLabel(
                      detectOfferKind(node.title),
                    ).label
                  }
                </Text>
              </Pressable>
            ) : null}
            {node.reserveUrl ? (
              <Pressable
                style={styles.proposalActionBtn}
                hitSlop={6}
                onPress={(e) => {
                  e?.stopPropagation?.();
                  void Linking.openURL(node.reserveUrl!);
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
        ) : null}
      </Card>
    </View>
  );
}

export function PlanCalendarModal({
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
}: Props) {
  const [dateKey, setDateKey] = useState(todayDateKey);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  // Echte Systemuhr: Sync beim Öffnen, dann an volle Minuten gekoppelt (kein 5s-Poll)
  const wallClockMs = useWallClockMs(visible);

  const planUpdated = useFuturePlanStore((s) => s.plan.updatedAtMs);
  const planDayKey = useFuturePlanStore((s) => s.plan.dayKey);
  const planBase = useFuturePlanStore((s) => {
    if (s.plan.dayKey === dateKey) return s.plan.base;
    return s.plansByDay[dateKey]?.base ?? null;
  });
  const plansByDay = useFuturePlanStore((s) => s.plansByDay);
  const ensureDay = useFuturePlanStore((s) => s.ensureDay);
  const histEntries = useHistoricalTimelineStore((s) => s.entries);
  const histLen = histEntries.length;
  const shortAnswers = usePlanCalendarUiStore((s) => s.shortAnswers);
  const mirroredActions = usePlanCalendarUiStore((s) => s.mirroredActions);
  const pendingChoice = usePlanCalendarUiStore((s) => s.pendingChoice);
  const requestedDayKey = usePlanCalendarUiStore((s) => s.requestedDayKey);
  const requestedDayAtMs = usePlanCalendarUiStore((s) => s.requestedDayAtMs);
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
  const [monthScrollLocked, setMonthScrollLocked] = useState(true);
  const [openDragIndex, setOpenDragIndex] = useState<number | null>(null);
  const [openDragOverTrash, setOpenDragOverTrash] = useState(false);
  const openDragY = useRef(new Animated.Value(0)).current;
  const openDragFrom = useRef<number | null>(null);
  const openHoverIdx = useRef<number | null>(null);
  const openTrashRef = useRef(false);
  const trashZoneY = useRef(0);

  /** Alle Plan-Tage — damit Monat reagiert, auch wenn aktiver Tag ≠ bearbeiteter Tag */
  const plansRevision = useMemo(() => {
    let n = planUpdated;
    for (const p of Object.values(plansByDay)) {
      n += p?.updatedAtMs ?? 0;
      n += (p?.stops?.length ?? 0) * 17;
    }
    return n;
  }, [planUpdated, plansByDay]);

  const textMul = useUiScaleStore((s) => s.textMul);
  const buttonMul = useUiScaleStore((s) => s.buttonMul);
  /** User hat ‹/› benutzt — nicht sofort wieder auf „heute“ zurücksetzen. */
  const userPickedDayRef = useRef(false);
  const [visitTick, setVisitTick] = useState(0);

  // Stempel → Visit-Log nachziehen (bleibt ~3 Jahre; Orte pro Tag navigierbar)
  useEffect(() => {
    if (!visible) return;
    void hydrateVisitLog().then(() => {
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
  }, [visible]);

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
    const dk = todayDateKey();
    setDateKey(dk);
    try {
      cleanupTimelineDuplicates(dk);
    } catch {
      /* soft */
    }
  }, [visible]);

  // Tages-Timeline und Plan-Store = derselbe Tag
  useEffect(() => {
    if (!visible) return;
    ensureDay(dateKey);
  }, [visible, dateKey, ensureDay]);

  // Store-Tag folgt Agent/Wecker → UI-Tag mitziehen (außer User hat ‹/› benutzt)
  useEffect(() => {
    if (!visible || userPickedDayRef.current) return;
    if (planDayKey && planDayKey !== dateKey) setDateKey(planDayKey);
  }, [visible, planDayKey]);

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
    () => buildDayTimeline(dateKey, Date.now()),
    [dateKey, wallClockMs, plansRevision, histLen, visitTick],
  );

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

  // Live-Scroll: immer zu dem, was Findus gerade ändert (max. 3 Retries)
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

  // Monat öffnen: aktuell + nächster sofort → 3s fixiert → Rest laden → einmal positionieren → scrollen
  useEffect(() => {
    if (!visible || viewMode !== 'month') {
      setMonthRadiusBefore(0);
      setMonthRadiusAfter(1);
      setMonthScrollLocked(true);
      return;
    }
    monthBlockY.current = {};
    setMonthRadiusBefore(0);
    setMonthRadiusAfter(1);
    setMonthScrollLocked(true);

    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    // Während der Fixierung im Hintergrund vorbereiten (kein UI-Wachstum → kein Springen)
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        // Einmalig alle Monate einsetzen
        setMonthRadiusBefore(MONTHS_BEFORE);
        setMonthRadiusAfter(MONTHS_AFTER);
        // Layout abwarten, einmal zum aktuellen Monat, dann Scroll freigeben
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            const y = monthBlockY.current[centerMonthKey];
            if (y != null) {
              monthScrollRef.current?.scrollTo({
                y: Math.max(0, y - 8),
                animated: false,
              });
            }
            // Zweites Frame: Layout der neuen Blöcke kann Y noch verschieben
            timers.push(
              setTimeout(() => {
                if (cancelled) return;
                const y2 = monthBlockY.current[centerMonthKey];
                if (y2 != null) {
                  monthScrollRef.current?.scrollTo({
                    y: Math.max(0, y2 - 8),
                    animated: false,
                  });
                }
                setMonthScrollLocked(false);
              }, 80),
            );
          }, 48),
        );
      }, 3000),
    );

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [visible, viewMode, centerMonthKey]);

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
    setDateKey(dk);
    ensureDay(dk);
    setViewMode('day');
  }, [ensureDay]);

  /** System-Zurück: Monat → Tag → schließen (eine Ebene). */
  const handleBack = useCallback(() => {
    void stopVoiceOnUserTap();
    if (viewMode === 'month') {
      setViewMode('day');
      return;
    }
    onClose();
  }, [viewMode, onClose]);

  const onShortAnswer = useCallback(
    (a: PlanShortAnswer) => {
      void stopVoiceOnUserTap();
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
        onShortAnswerPrompt?.(
          a.prompt ??
            (a.id === 'book_tour'
              ? 'Zeig mir die Tour zum Buchen'
              : a.label),
        );
      }
    },
    [onShortAnswerPrompt],
  );

  const onSelectNode = useCallback(
    (node: TimelineNode) => {
      const id = planStopIdFromTimelineNodeId(node.id);
      if (!id) return;

      // Während Findus spricht: Tipps nicht neu starten (kein Dauerschleifen-Pitch)
      if (isSpeechActive()) {
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
        void import('../module2/planning/runPlanningModule').then((m) => {
          m.overrideOpenWishFromStop(id);
          return m.resumeOpenWishResearch(id);
        });
        return;
      }
      setSelectedStopId((cur) => (cur === id ? null : id));
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

  const editMinus15 = useCallback(() => {
    void stopVoiceOnUserTap();
    if (!selectedStopId) return;
    reschedulePlanStop(selectedStopId, { deltaMin: -15 });
  }, [selectedStopId]);

  const editPlus15 = useCallback(() => {
    void stopVoiceOnUserTap();
    if (!selectedStopId) return;
    reschedulePlanStop(selectedStopId, { deltaMin: 15 });
  }, [selectedStopId]);

  const editTransport = useCallback(() => {
    void stopVoiceOnUserTap();
    if (!selectedStopId) return;
    cycleStopTransport(selectedStopId);
  }, [selectedStopId]);

  const editDelete = useCallback(() => {
    void stopVoiceOnUserTap();
    if (!selectedStopId) return;
    removePlanStop(selectedStopId);
    setSelectedStopId(null);
  }, [selectedStopId]);

  // Open-Plan-Count vor Early-Return (Hooks dürfen nicht nach `if (!visible)` stehen)
  const openPlanDragCount = useMemo(() => {
    const todayKey = todayDateKey();
    if (dateKey < todayKey) return 0;
    return openPlans.length;
  }, [dateKey, openPlans.length]);

  const makeOpenPlanPan = useCallback(
    (index: number, planId: string) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dy) > 6 || Math.abs(g.dx) > 6,
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

  if (!visible) return null;

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

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <SwipeBackView
        enabled={visible}
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
              void stopVoiceOnUserTap();
              onClose();
            }}
            hitSlop={12}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

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

        {planBase?.label ? (
          <View style={styles.baseBannerWrap}>
            <Text style={styles.baseBanner} numberOfLines={1}>
              {planBase.kind === 'hotel'
                ? '🏨'
                : planBase.kind === 'home'
                  ? '🏠'
                  : '📍'}{' '}
              Basis: {planBase.label}
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
                    if (a.type !== 'OPEN_URL') {
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
          >
            <View style={styles.monthLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#E6B422' }]} />
                <Text style={styles.legendText}>Vergangenheit</Text>
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
                      return (
                        <Pressable
                          key={dk}
                          onPress={() => openDayFromMonth(dk)}
                          style={[
                            styles.monthCell,
                            { backgroundColor: bg },
                            selected && styles.monthCellSelected,
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
            {nodes.length === 0 ? (
              <Text style={styles.empty}>Noch nichts für diesen Tag.</Text>
            ) : (
              nodes.map((n, idx) => (
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
                    <TimelineRow
                      node={n}
                      isFirst={idx === 0}
                      isLast={idx === nodes.length - 1}
                      selected={
                        selectedStopId != null &&
                        planStopIdFromTimelineNodeId(n.id) === selectedStopId
                      }
                      onSelect={onSelectNode}
                    />
                  </View>
                ))
            )}

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
                  Tippen = Fokus · Ziehen = sortieren · in 🗑 = löschen + neu rechnen
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
                              transform: [{ translateY: openDragY }],
                              zIndex: 20,
                              elevation: 20,
                            }
                          : null,
                      ]}
                    >
                      <View style={styles.openDragHandle} {...pan.panHandlers}>
                        <Text style={styles.openDragHandleText}>≡</Text>
                      </View>
                      <Pressable
                        style={styles.openCardMain}
                        onPress={() => {
                          void stopVoiceOnUserTap();
                          focusOpenPlanNext(p.id);
                          void import('../module2/planning/runPlanningModule').then(
                            (m) => {
                              m.overrideOpenWishFromStop(p.id);
                              return m.resumeOpenWishResearch(p.id);
                            },
                          );
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
                            if (isSpeechActive()) return;
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
          </ScrollView>
        )}

        {showPlanningChrome && selectedStop ? (
          <View style={styles.editPopup} pointerEvents="box-none">
            <View style={styles.editBar}>
              <Text style={styles.editTitle} numberOfLines={1}>
                {selectedStop.title}
              </Text>
              <View style={styles.editRow}>
                <Pressable style={styles.editBtn} onPress={editMinus15}>
                  <Text style={styles.editBtnText}>−15 Min</Text>
                </Pressable>
                <Pressable style={styles.editBtn} onPress={editPlus15}>
                  <Text style={styles.editBtnText}>+15 Min</Text>
                </Pressable>
                <Pressable style={styles.editBtn} onPress={editTransport}>
                  <Text style={styles.editBtnText}>
                    {selectedStop.transport === 'walk'
                      ? '🚶 Fuß'
                      : selectedStop.transport === 'bike'
                        ? '🚲 Rad'
                        : selectedStop.transport === 'transit'
                          ? '🚌 ÖPNV'
                          : selectedStop.transport === 'taxi'
                            ? '🚕 Taxi'
                            : selectedStop.transport === 'car'
                              ? '🚗 Auto'
                              : 'Transport'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.editBtn, styles.editBtnDanger]}
                  onPress={editDelete}
                >
                  <Text style={styles.editBtnTextDanger}>Löschen</Text>
                </Pressable>
              </View>
              <Pressable
                style={styles.editDismiss}
                onPress={() => {
                  void stopVoiceOnUserTap();
                  setSelectedStopId(null);
                }}
              >
                <Text style={styles.editDismissText}>Fertig</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View
          style={[
            styles.bottomBar,
            leftAnswers.length + rightAnswers.length === 0 &&
              styles.bottomBarCompact,
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
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay,
    elevation: UI_LAYER.overlay,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
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
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginLeft: 8,
    marginVertical: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: colors.thinking,
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
  editPopup: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    top: 72,
    zIndex: 20,
  },
  editBar: {
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.bgElevated ?? colors.surface,
    borderWidth: 1,
    borderColor: colors.thinking,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    gap: 8,
  },
  editTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  editRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  editBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  editBtnDanger: {
    borderColor: colors.danger,
  },
  editBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  editBtnTextDanger: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  editDismiss: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  editDismissText: {
    color: colors.thinking,
    fontSize: 13,
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
