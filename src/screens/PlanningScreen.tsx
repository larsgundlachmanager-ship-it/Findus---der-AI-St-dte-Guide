/**
 * Planungs-Spot — Timeline (Tag / Monat) + Sprachnachrichten-Planmodus.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import { SwipeBackView } from '../components/SwipeBackView';
import { useDayPlanStore } from '../store/useDayPlanStore';
import { todayDateKey } from '../types/dayPlan';
import {
  bootstrapModule5Today,
  speakPlanChangeExplanation,
  startVoicePlanDictation,
  stopVoicePlanDictation,
  processVoicePlanTranscript,
  commitVoicePlanDraft,
  buildOptimizePreview,
  acceptOptimizePreview,
  regenerateOptimizePreview,
  restoreOptimizeSnapshot,
  resetOptimizeFailCount,
} from '../services/module5';
import { PrimaryButton, SecondaryButton } from '../onboarding/OnboardingUI';
import { UnifiedDayAxisView } from '../components/UnifiedDayAxisView';

type Props = {
  visible: boolean;
  onClose: () => void;
};

type OptimizeUi =
  | 'idle'
  | 'preview'
  | 'retry'
  | 'city_reset';

const PROCESS_TIMEOUT_MS = 45_000;

function formatDateTitle(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const today = todayDateKey();
  const label = dt.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return dateKey === today ? `Heute · ${label}` : label;
}

function monthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function shiftMonthKey(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function MonthPanel({
  ym,
  selected,
  onSelect,
}: {
  ym: string;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y!, (m ?? 1) - 1, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y!, m ?? 1, 0).getDate();
  const cells: Array<string | null> = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    );
  }
  const today = todayDateKey();

  return (
    <View style={styles.monthWrap}>
      <Text style={styles.monthTitle}>
        {first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
      </Text>
      <Text style={styles.monthSwipeHint}>Hochwischen · anderer Monat</Text>
      <View style={styles.weekHead}>
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => (
          <Text key={w} style={styles.weekHeadCell}>
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {cells.map((key, i) =>
          key == null ? (
            <View key={`e-${ym}-${i}`} style={styles.dayCell} />
          ) : (
            <Pressable
              key={key}
              onPress={() => onSelect(key)}
              style={[
                styles.dayCell,
                key === selected && styles.daySelected,
                key === today && styles.dayToday,
              ]}
            >
              <Text
                style={[
                  styles.dayText,
                  key === selected && styles.dayTextSelected,
                ]}
              >
                {Number(key.slice(-2))}
              </Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

function MonthPager({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (key: string) => void;
}) {
  const [cursorYm, setCursorYm] = useState(() => monthKeyFromDateKey(selected));
  const scrollRef = useRef<ScrollView>(null);
  const pageH = useRef(360);
  const months = useMemo(
    () => [
      shiftMonthKey(cursorYm, -1),
      cursorYm,
      shiftMonthKey(cursorYm, 1),
    ],
    [cursorYm],
  );

  useEffect(() => {
    setCursorYm(monthKeyFromDateKey(selected));
  }, [selected]);

  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: pageH.current, animated: false });
    }, 40);
    return () => clearTimeout(t);
  }, [cursorYm]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const h = pageH.current || 1;
    const page = Math.round(y / h);
    if (page <= 0) {
      setCursorYm((c) => shiftMonthKey(c, -1));
    } else if (page >= 2) {
      setCursorYm((c) => shiftMonthKey(c, 1));
    } else {
      scrollRef.current?.scrollTo({ y: h, animated: true });
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      onMomentumScrollEnd={onMomentumEnd}
      style={styles.monthPager}
      onLayout={(ev) => {
        pageH.current = Math.max(320, ev.nativeEvent.layout.height);
      }}
    >
      {months.map((ym) => (
        <View
          key={ym}
          style={{ minHeight: pageH.current }}
          onLayout={(ev) => {
            if (ym === cursorYm) {
              pageH.current = Math.max(320, ev.nativeEvent.layout.height);
            }
          }}
        >
          <MonthPanel ym={ym} selected={selected} onSelect={onSelect} />
        </View>
      ))}
    </ScrollView>
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function PlanningScreen({ visible, onClose }: Props) {
  const selectedDateKey = useDayPlanStore((s) => s.selectedDateKey);
  const plansByDate = useDayPlanStore((s) => s.plansByDate);
  const shiftDay = useDayPlanStore((s) => s.shiftDay);
  const setSelectedDate = useDayPlanStore((s) => s.setSelectedDate);
  const ensureDay = useDayPlanStore((s) => s.ensureDay);
  const clearUnread = useDayPlanStore((s) => s.clearUnreadChanges);
  const [showMonth, setShowMonth] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [partial, setPartial] = useState('');
  const [showChangesBtn, setShowChangesBtn] = useState(false);
  const [optimizeUi, setOptimizeUi] = useState<OptimizeUi>('idle');
  const [optimizeCount, setOptimizeCount] = useState(0);
  const [errorLine, setErrorLine] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    bootstrapModule5Today();
    ensureDay(todayDateKey());
    setSelectedDate(todayDateKey());
  }, [visible, ensureDay, setSelectedDate]);

  useEffect(() => {
    if (visible) return;
    setDictating(false);
    setProcessing(false);
    setPartial('');
    setShowChangesBtn(false);
    setOptimizeUi('idle');
    setErrorLine(null);
  }, [visible]);

  const day = plansByDate[selectedDateKey] ?? ensureDay(selectedDateKey);
  const unread = day.unreadSignificantChangeIds?.length ?? 0;
  const axisRefreshKey = `${day.updatedAtMs}-${day.items.length}-${optimizeUi}-${optimizeCount}`;

  const onToggleDictate = async () => {
    setErrorLine(null);
    if (processing) return;
    if (!dictating) {
      setPartial('');
      const r = await startVoicePlanDictation((t) => setPartial(t));
      if (!r.ok) {
        setErrorLine(
          r.reason === 'permission'
            ? 'Mikrofon-Erlaubnis fehlt.'
            : 'Spracherkennung nicht verfügbar.',
        );
        return;
      }
      setDictating(true);
      return;
    }

    setDictating(false);
    setProcessing(true);
    setPartial('');
    try {
      const transcript = await withTimeout(
        stopVoicePlanDictation(),
        12_000,
      ).catch(() => '');
      const text = (transcript || '').trim();
      if (text.length < 8) {
        setErrorLine('Zu kurz — bitte länger diktieren.');
        return;
      }
      const next = await withTimeout(
        processVoicePlanTranscript(text, { dateKey: selectedDateKey }),
        PROCESS_TIMEOUT_MS,
      );
      if (!next) {
        setErrorLine('Konnte nichts Strukturiertes erkennen.');
        return;
      }
      // Direkt in die Zeitachse — kein Extra-Fenster, kein Transkript-Text
      await withTimeout(commitVoicePlanDraft(next), PROCESS_TIMEOUT_MS);
      setShowChangesBtn(true);
    } catch {
      setErrorLine('Auswertung fehlgeschlagen — bitte nochmal versuchen.');
    } finally {
      setProcessing(false);
      setPartial('');
    }
  };

  const onOptimize = () => {
    setErrorLine(null);
    const r = buildOptimizePreview(selectedDateKey);
    setOptimizeCount(r.count);
    setOptimizeUi(r.count > 0 ? 'preview' : 'idle');
    if (r.count === 0) {
      setErrorLine('Nichts zu optimieren — Plan sieht schon rund aus.');
    }
  };

  const onOptimizeYes = () => {
    acceptOptimizePreview(selectedDateKey);
    setOptimizeUi('idle');
    setOptimizeCount(0);
  };

  const onOptimizeNeu = () => {
    const r = regenerateOptimizePreview(selectedDateKey);
    setOptimizeCount(r.count);
    if (r.failCount >= 2) {
      setOptimizeUi('city_reset');
      return;
    }
    setOptimizeUi(r.count > 0 ? 'preview' : 'retry');
  };

  const onOptimizeMic = async () => {
    setOptimizeUi('idle');
    if (!dictating) {
      await onToggleDictate();
    }
  };

  const onCityResetNein = () => {
    restoreOptimizeSnapshot(selectedDateKey);
    resetOptimizeFailCount();
    setOptimizeUi('idle');
    setOptimizeCount(0);
  };

  const onCityResetJa = () => {
    // Stadt neu: Snapshot weg, Preview verwerfen, leere Soft-Hinweis
    restoreOptimizeSnapshot(selectedDateKey);
    resetOptimizeFailCount();
    setOptimizeUi('idle');
    setOptimizeCount(0);
    setErrorLine('Okay — sag per Mic, welche Stadt / welchen Tag wir neu planen.');
  };

  if (!visible) return null;

  return (
    <View style={styles.overlayRoot} accessibilityViewIsModal>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <SwipeBackView enabled={visible} onBack={onClose}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.back}>← Zurück</Text>
            </Pressable>
            <Text style={styles.headerTitle}>Planung</Text>
            <Pressable onPress={() => setShowMonth((v) => !v)} hitSlop={12}>
              <Text style={styles.monthBtn}>
                {showMonth ? 'Timeline' : 'Monat'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.dayNav}>
            <Pressable onPress={() => shiftDay(-1)} style={styles.navBtn}>
              <Text style={styles.navBtnText}>‹</Text>
            </Pressable>
            <Text style={styles.dayTitle}>
              {formatDateTitle(selectedDateKey)}
            </Text>
            <Pressable onPress={() => shiftDay(1)} style={styles.navBtn}>
              <Text style={styles.navBtnText}>›</Text>
            </Pressable>
          </View>

          <Pressable
            style={[
              styles.dictateBtn,
              dictating && styles.dictateBtnLive,
              processing && styles.dictateBtnBusy,
            ]}
            onPress={() => {
              void onToggleDictate();
            }}
            disabled={processing}
            accessibilityRole="button"
            accessibilityLabel="Plan diktieren"
          >
            {processing ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.dictateEmoji}>{dictating ? '⏹' : '🎙'}</Text>
            )}
            <View style={styles.dictateCopy}>
              <Text style={styles.dictateTitle}>
                {processing
                  ? 'Wertet Sprachnachricht aus…'
                  : dictating
                    ? 'Aufnahme läuft — tippen zum Stoppen'
                    : 'Plan diktieren'}
              </Text>
              <Text style={styles.dictateSub} numberOfLines={2}>
                {dictating
                  ? 'Ich höre zu…'
                  : processing
                    ? 'Einen Moment — landet direkt in der Zeitachse'
                    : 'Hotel, Zug, Stopps — landet direkt in der Zeitachse'}
              </Text>
            </View>
          </Pressable>

          {errorLine ? (
            <Text style={styles.errorLine}>{errorLine}</Text>
          ) : null}

          {showChangesBtn || unread > 0 ? (
            <Pressable
              style={styles.changeBanner}
              onPress={() => {
                void speakPlanChangeExplanation(selectedDateKey);
                clearUnread(selectedDateKey);
                setShowChangesBtn(false);
              }}
            >
              <View style={styles.changeDot} />
              <Text style={styles.changeText}>Änderungen</Text>
            </Pressable>
          ) : null}

          {optimizeUi === 'preview' || optimizeUi === 'retry' ? (
            <Text style={styles.optimizeHint}>
              Gelb = Vorschlag ({optimizeCount}). Ja übernehmen · Mic
              nachbessern · Neu nochmal rechnen.
            </Text>
          ) : null}

          {optimizeUi === 'city_reset' ? (
            <View style={styles.cityResetBox}>
              <Text style={styles.cityResetText}>
                Zweimal nicht gepasst — Stadt neu? Oder Nein = Plan zurück.
              </Text>
              <View style={styles.cityResetRow}>
                <View style={styles.footerBtn}>
                  <PrimaryButton label="Stadt neu" onPress={onCityResetJa} />
                </View>
                <View style={styles.footerBtn}>
                  <SecondaryButton label="Nein" onPress={onCityResetNein} />
                </View>
              </View>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {showMonth ? (
              <MonthPager
                selected={selectedDateKey}
                onSelect={(key) => {
                  ensureDay(key);
                  setSelectedDate(key);
                  setShowMonth(false);
                }}
              />
            ) : (
              <UnifiedDayAxisView
                dateKey={selectedDateKey}
                refreshKey={axisRefreshKey}
                emptyHint="Noch leer. Besuchte Orte erscheinen oben; Planung für später darunter — getrennt durch „Jetzt“."
              />
            )}
          </ScrollView>

          {optimizeUi === 'preview' || optimizeUi === 'retry' ? (
            <View style={styles.footerStack}>
              <View style={styles.footerPrimary}>
                <PrimaryButton label="Ja" onPress={onOptimizeYes} />
              </View>
              <View style={styles.footerSecondaryRow}>
                <View style={styles.footerBtnSm}>
                  <SecondaryButton
                    label="🎙 Mic"
                    onPress={() => {
                      void onOptimizeMic();
                    }}
                  />
                </View>
                <View style={styles.footerBtnSm}>
                  <SecondaryButton label="Neu" onPress={onOptimizeNeu} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.footerStack}>
              <View style={styles.footerPrimary}>
                <SecondaryButton label="Optimieren" onPress={onOptimize} />
              </View>
              <View style={styles.footerSecondaryRow}>
                <View style={styles.footerBtnWide}>
                  <PrimaryButton
                    label="Vorschläge?"
                    onPress={() => {
                      useDayPlanStore.getState().addChange(selectedDateKey, {
                        summary:
                          'Vorschläge angefragt — per Mic „Was können wir heute machen?“',
                        reason: 'ui_suggestions',
                        significant: false,
                      });
                      setShowChangesBtn(true);
                    }}
                  />
                </View>
              </View>
            </View>
          )}
        </SwipeBackView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 1000,
    elevation: 1000,
  },
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  back: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  headerTitle: { color: colors.text, fontWeight: '800', fontSize: 17 },
  monthBtn: { color: colors.wave, fontWeight: '700', fontSize: 14 },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  dayTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  changeBanner: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: 'rgba(61,124,255,0.18)',
    borderWidth: 1,
    borderColor: colors.thinking,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  changeDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.thinking,
  },
  changeText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  optimizeHint: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    color: colors.offline,
    fontSize: 12,
    fontWeight: '600',
  },
  cityResetBox: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cityResetText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  cityResetRow: { flexDirection: 'row', gap: spacing.sm },
  dictateBtn: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    borderWidth: 1.5,
    borderColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dictateBtnLive: {
    backgroundColor: 'rgba(217,107,92,0.22)',
    borderColor: colors.danger,
  },
  dictateBtnBusy: {
    opacity: 0.85,
  },
  dictateEmoji: { fontSize: 26 },
  dictateCopy: { flex: 1 },
  dictateTitle: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 16,
  },
  dictateSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  errorLine: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  body: { padding: spacing.md, paddingBottom: 160 },
  footerStack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerPrimary: { width: '100%' },
  footerSecondaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  footerBtn: { flex: 1 },
  footerBtnSm: { flex: 1 },
  footerBtnWide: { flex: 1 },
  monthPager: { maxHeight: 420 },
  monthWrap: { marginBottom: spacing.lg, paddingBottom: spacing.md },
  monthTitle: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 16,
    marginBottom: 4,
  },
  monthSwipeHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: spacing.sm,
  },
  weekHead: { flexDirection: 'row', marginBottom: 4 },
  weekHeadCell: {
    width: `${100 / 7}%` as unknown as number,
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100 / 7}%` as unknown as number,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: {
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
  },
  dayToday: {
    borderWidth: 1,
    borderColor: colors.wave,
    borderRadius: 10,
  },
  dayText: { color: colors.text, fontWeight: '600' },
  dayTextSelected: { color: colors.accent, fontWeight: '800' },
});
