/**
 * Pitch-Auswahl UI:
 * Kurzer Titel → A|B-Wahl mit Stichpunkten → Action-Buttons pro Option.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import {
  useLivePitchStore,
  type LivePitchState,
} from '../module2/pitch/publishPitchUi';
import {
  alertActionError,
  handleQuickAction,
} from '../services/actionHandlerService';
import { pitchChoiceVisibleActions } from '../module2/pitch/pitchActions';
import {
  pitchNavIntentFromPayload,
  startPitchNavigation,
} from '../module2/pitch/pitchStartNav';
import { useFinnusStore } from '../store/useFinnusStore';
import type { QuickAction } from '../types/concierge';
import {
  BULLET_SURFACE_MAX_CHARS,
  MAX_VISUAL_BULLETS,
  rewriteBulletToFit,
} from '../services/concierge/visualBullets';
import {
  BULLETS_ENTERING,
  BULLETS_EXITING,
} from './liveStage/stageTransitions';

function navActionFromOption(option: {
  name: string;
  lat: number;
  lng: number;
  actions?: QuickAction[] | null;
}): { name: string; lat: number; lng: number; action?: QuickAction } {
  const act = (option.actions ?? []).find((a) => a.type === 'START_NAVIGATION');
  const payload = act?.payload;
  const lat =
    typeof payload?.destLat === 'number' ? payload.destLat : option.lat;
  const lng =
    typeof payload?.destLng === 'number' ? payload.destLng : option.lng;
  const name = String(payload?.destName || option.name || '').trim();
  return { name, lat, lng, action: act };
}

function medalFor(
  option: LivePitchState['options'][number],
  index: number,
): string {
  if (option.role === 'out_of_box') return '✨';
  if (option.role === 'favorite' || index === 0) return '🥇';
  return '🥈';
}

function ChoiceButton({
  option,
  index,
  selected,
  onSelect,
  compact,
  showChooseHint,
}: {
  option: LivePitchState['options'][number];
  index: number;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
  showChooseHint: boolean;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        styles.choiceBtn,
        compact && styles.choiceBtnCompact,
        selected && styles.choiceBtnSelected,
        pressed && styles.choiceBtnPressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Wähle ${option.name}`}
    >
      <Text style={styles.choiceMedal}>{medalFor(option, index)}</Text>
      <Text
        style={[styles.choiceName, selected && styles.choiceNameSelected]}
        numberOfLines={2}
      >
        {option.name}
      </Text>
      {(option.bullets ?? [])
        .slice(0, MAX_VISUAL_BULLETS)
        .map((b) => rewriteBulletToFit(b, BULLET_SURFACE_MAX_CHARS.pitch))
        .filter(Boolean)
        .map((b, i) => (
        <Text
          key={`${option.id}_b_${i}`}
          style={styles.choiceBullet}
          numberOfLines={2}
          ellipsizeMode="clip"
        >
          {b}
        </Text>
      ))}
      {selected || showChooseHint ? (
      <Text style={styles.choiceHint} numberOfLines={1}>
        {selected ? 'Gewählt' : 'Tippen zum Wählen'}
      </Text>
      ) : null}
    </Pressable>
  );
}

function ActionCluster({
  actions,
  align,
  navBusy,
  onNavBusy,
}: {
  actions: QuickAction[];
  align: 'left' | 'right';
  navBusy: boolean;
  onNavBusy: (v: boolean) => void;
}) {
  if (!actions.length) {
    return <View style={styles.actionCluster} />;
  }

  const runAction = (act: QuickAction) => {
    const isNav = act.type === 'START_NAVIGATION';
    if (isNav && navBusy) return;
    void (async () => {
      try {
        const {
          abortListenSessionForUiChoice,
        } = await import('../services/handsFree/scheduleMicAfterAsk');
        await abortListenSessionForUiChoice(`pitch_${act.type}`);
      } catch {
        /* soft */
      }
      if (isNav) {
        // Laden sofort — bevor awaits
        try {
          useFinnusStore.getState().setNavRouteLoading(true);
        } catch {
          /* soft */
        }
        onNavBusy(true);
      }
      try {
        if (act.type === 'START_NAVIGATION') {
          const payload = act.payload ?? {};
          const legs = payload.multiStop;
          if (Array.isArray(legs) && legs.length >= 2) {
            try {
              const { startMultiStopTour } = await import(
                '../services/navigation/multiStopTour'
              );
              const stops = legs.map((leg, i) => ({
                poiId: leg.poiId ?? -1 - i,
                name: leg.name,
                lat: leg.lat,
                lng: leg.lng,
                done: false as const,
              }));
              const result = await startMultiStopTour({
                kind: 'custom',
                title: `${stops[0]!.name} → ${stops[stops.length - 1]!.name}`,
                targetDistanceM: null,
                targetDurationMin: null,
                estimatedDistanceM: 0,
                stops,
                currentIndex: 0,
                liveMeta: {
                  requestId: `pitch_ms_${Date.now()}`,
                  hardArriveByMs: null,
                  softDurationMin: null,
                  bufferMin: 8,
                  plannedArriveByMs: Date.now() + stops.length * 15 * 60_000,
                  startedAtMs: Date.now(),
                  denserStops: false,
                  mobility: 'walk',
                },
              });
              if (!result.ok) {
                try {
                  useFinnusStore.getState().setNavRouteLoading(false);
                } catch {
                  /* soft */
                }
                alertActionError(result.reply || 'Route konnte nicht starten.');
              } else if (result.reply?.trim()) {
                try {
                  const { enqueueSpeech } = await import(
                    '../module2/speech/speechQueue'
                  );
                  enqueueSpeech({
                    kind: 'main',
                    text: result.reply.slice(0, 420),
                    turnId: `pitch_ms_${Date.now()}`,
                  });
                } catch {
                  /* soft */
                }
              }
            } catch (err) {
              try {
                useFinnusStore.getState().setNavRouteLoading(false);
              } catch {
                /* soft */
              }
              alertActionError(
                err instanceof Error ? err.message : 'Multi-Stop fehlgeschlagen.',
              );
            }
            return;
          }
          const lat = payload.destLat;
          const lng = payload.destLng;
          const name = (
            payload.destName ||
            String(act.label || '')
              .replace(/^📍\s*/u, '')
              .replace(/^Route\b/iu, '')
              .trim()
          ).trim();
          if (
            typeof lat === 'number' &&
            typeof lng === 'number' &&
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            !(lat === 0 && lng === 0) &&
            name
          ) {
            const result = await startPitchNavigation(
              { name, lat, lng },
              pitchNavIntentFromPayload(payload),
            );
            if (result.ok) {
              try {
                const { requestClosePlanCalendar } = require('../module2/timeline/planCalendarUiStore') as {
                  requestClosePlanCalendar: () => void;
                };
                requestClosePlanCalendar();
              } catch {
                /* soft */
              }
            }
            if (!result.ok) {
              try {
                useFinnusStore.getState().setNavRouteLoading(false);
              } catch {
                /* soft */
              }
              alertActionError(
                result.message ||
                  'Route konnte nicht starten — bitte nochmal tippen.',
              );
            } else if (result.message?.trim()) {
              try {
                const { enqueueSpeech } = await import(
                  '../module2/speech/speechQueue'
                );
                enqueueSpeech({
                  kind: 'main',
                  text: result.message.slice(0, 420),
                  turnId: `pitch_nav_${Date.now()}`,
                });
              } catch {
                /* soft */
              }
            }
            return;
          }
          try {
            useFinnusStore.getState().setNavRouteLoading(false);
          } catch {
            /* soft */
          }
          alertActionError('Für diesen Ort fehlen noch Koordinaten.');
          return;
        }
        const result = await handleQuickAction(act);
        if (result && result.ok === false && result.message) {
          alertActionError(result.message);
        }
      } catch (err) {
        if (isNav) {
          try {
            useFinnusStore.getState().setNavRouteLoading(false);
          } catch {
            /* soft */
          }
        }
        alertActionError(
          err instanceof Error ? err.message : 'Aktion fehlgeschlagen.',
        );
      } finally {
        if (isNav) onNavBusy(false);
      }
    })();
  };

  return (
    <View
      style={[
        styles.actionCluster,
        align === 'right' && styles.actionClusterRight,
      ]}
    >
      <View style={styles.actionClusterInner}>
        {actions.map((act, i) => {
          const isNav = act.type === 'START_NAVIGATION';
          const disabled = isNav && navBusy;
          return (
            <Pressable
              key={`${act.type}_${act.label}_${i}`}
              style={({ pressed }) => [
                styles.actionBtn,
                (pressed || disabled) && styles.actionBtnPressed,
              ]}
              onPress={() => runAction(act)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={act.label}
              accessibilityState={{ disabled }}
            >
              <Text style={styles.actionLabel} numberOfLines={1}>
                {act.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const PitchChoiceSlot = React.memo(function PitchChoiceSlot() {
  const requestId = useLivePitchStore((s) => s.requestId);
  const options = useLivePitchStore((s) => s.options);
  const selected = useLivePitchStore((s) => s.selectedOptionId);
  const softFail = useLivePitchStore((s) => s.softFail);
  const loading = useLivePitchStore((s) => s.loading);
  const headline = useLivePitchStore((s) => s.headline);
  const selectOption = useLivePitchStore((s) => s.selectOption);
  const clear = useLivePitchStore((s) => s.clear);
  const { width } = useWindowDimensions();
  const stackVertical = width < 360 || options.length > 2;
  const [navBusy, setNavBusy] = useState(false);
  const [showChooseHint, setShowChooseHint] = useState(true);
  const navStartedFor = useRef<string | null>(null);

  React.useEffect(() => {
    void import('../services/ui/hudHintPrefs').then((m) =>
      m.loadHudHintPrefs().then(() => {
        setShowChooseHint(m.shouldShowPitchChooseHint());
      }),
    );
  }, [requestId]);

  const onPick = useCallback(
    (id: string) => {
      void import('../services/ui/hudHintPrefs').then((m) =>
        m.markPitchChooseUsed().then(() => setShowChooseHint(false)),
      );
      void import('../services/handsFree/scheduleMicAfterAsk')
        .then((m) => m.abortListenSessionForUiChoice('pitch_choice'))
        .catch(() => undefined);
      // Vor Collapse die Option lesen (selectOption lässt nur noch die Wahl stehen).
      const storeBefore = useLivePitchStore.getState();
      const opt = storeBefore.options.find((o) => o.id === id);
      const pitchKind = storeBefore.pitchKind;
      const visitAtMs = storeBefore.visitAtMs;
      const visitFar =
        typeof visitAtMs === 'number' &&
        Number.isFinite(visitAtMs) &&
        visitAtMs > Date.now() + 30 * 60_000;
      const hasFollowOn =
        opt?.followOnStop &&
        Number.isFinite(opt.followOnStop.lat) &&
        Number.isFinite(opt.followOnStop.lng);
      // Gastro/Kino/Event später: Timing-Fork / Timeline — kein Auto-Nav.
      // Ausnahme Multi-Lane Fetch→Spot: sofort Tour starten.
      const deferAutoNav =
        !hasFollowOn &&
        (pitchKind === 'food' ||
          pitchKind === 'bar' ||
          pitchKind === 'cinema' ||
          pitchKind === 'event' ||
          visitFar);
      selectOption(id);
      if (!opt) return;

      // selectOption hat Speech + Fork-Buttons gesetzt — Slot darf nicht überschreiben.
      if (deferAutoNav) {
        setNavBusy(false);
        return;
      }

      const nav = navActionFromOption(opt);
      const canNav =
        Number.isFinite(nav.lat) &&
        Number.isFinite(nav.lng) &&
        !(nav.lat === 0 && nav.lng === 0) &&
        Boolean(nav.name);

      // Say–Do: Laden SOFORT (blauer Balken), bevor Speech/Imports — sonst „passiert nichts“
      if (canNav && navStartedFor.current !== id) {
        try {
          useFinnusStore.getState().setNavRouteLoading(true);
        } catch {
          /* soft */
        }
        setNavBusy(true);
      }

      // Kurzes Ack ohne UI-Meta („Infos bleiben unten“ / Programm-Regie).
      const followHint = hasFollowOn
        ? String(opt.followOnStop?.enjoyHint || opt.followOnStop?.name || '').trim()
        : '';
      const ackVariants = !canNav
        ? [
            `Super Wahl — ${opt.name}.`,
            `Gute Wahl: ${opt.name}.`,
          ]
        : hasFollowOn
          ? [
              `Super — dann holen wir bei ${opt.name} etwas und danach geht’s weiter${followHint ? ` zum ${followHint}` : ''}.`,
              `Gute Wahl: ${opt.name}. Route startet, der nächste Stopp ist schon eingeplant.`,
            ]
          : [
            `Super Wahl — ${opt.name}. Ich starte die Route.`,
            `Gute Wahl: ${opt.name}. Die Verbindung läuft an.`,
            `${opt.name} — starke Wahl. Route startet jetzt.`,
          ];
      const ack =
        ackVariants[
          Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) %
            ackVariants.length
        ]!;

      // Route ZUERST anstoßen (Say–Do), Speech parallel — nicht auf Speech warten
      const skipCannedAck = /^map_nav_/.test(id);
      if (canNav && navStartedFor.current !== id) {
        navStartedFor.current = id;
        void (async () => {
          try {
            let result: { ok: boolean; message?: string };
            if (hasFollowOn && opt.followOnStop) {
              const { startMultiStopTour } = await import(
                '../services/navigation/multiStopTour'
              );
              const stops = [
                {
                  poiId: -1,
                  name: opt.name,
                  lat: opt.lat,
                  lng: opt.lng,
                  done: false as const,
                },
                {
                  poiId: -2,
                  name: opt.followOnStop.name,
                  lat: opt.followOnStop.lat,
                  lng: opt.followOnStop.lng,
                  done: false as const,
                },
              ];
              const tour = await startMultiStopTour({
                kind: 'custom',
                title: `${stops[0]!.name} → ${stops[1]!.name}`,
                targetDistanceM: null,
                targetDurationMin: null,
                estimatedDistanceM: 0,
                stops,
                currentIndex: 0,
                liveMeta: {
                  requestId: `ml_follow_${Date.now()}`,
                  hardArriveByMs: null,
                  softDurationMin: null,
                  bufferMin: 8,
                  plannedArriveByMs: Date.now() + 40 * 60_000,
                  startedAtMs: Date.now(),
                  denserStops: false,
                  mobility: 'walk',
                },
              });
              result = {
                ok: tour.ok,
                message: tour.ok ? tour.reply : tour.reply,
              };
            } else {
              result = await startPitchNavigation(
                { name: nav.name, lat: nav.lat, lng: nav.lng },
                pitchNavIntentFromPayload(nav.action?.payload),
              );
            }
            if (!result.ok) {
              try {
                useFinnusStore.getState().setNavRouteLoading(false);
              } catch {
                /* soft */
              }
              if (result.message) alertActionError(result.message);
            } else {
              try {
                const { requestClosePlanCalendar } = require('../module2/timeline/planCalendarUiStore') as {
                  requestClosePlanCalendar: () => void;
                };
                if (skipCannedAck) requestClosePlanCalendar();
              } catch {
                /* soft */
              }
              setTimeout(() => {
                try {
                  useLivePitchStore.getState().clear(true);
                } catch {
                  /* soft */
                }
              }, 3000);
            }
          } catch {
            try {
              useFinnusStore.getState().setNavRouteLoading(false);
            } catch {
              /* soft */
            }
          } finally {
            setNavBusy(false);
          }
        })();
      }

      if (!skipCannedAck && ack.trim()) {
      void import('../module2/speech/speechQueue')
        .then(({ enqueueSpeech }) => {
          enqueueSpeech({
            kind: 'main',
            text: ack,
            turnId: `pitch_pick_${id}`,
          });
        })
        .catch(() => undefined);
      }

      if (!skipCannedAck && !hasFollowOn) {
        void import('../module2/router/compoundFollowUp')
          .then((m) =>
            m.continueTourFromPickedSpot({
              name: nav.name || opt.name,
              lat: nav.lat,
              lng: nav.lng,
            }),
          )
          .catch(() => undefined);
      }
    },
    [selectOption],
  );

  const a = options[0];
  const b = options[1];

  const actionsA = useMemo(
    () => (a ? pitchChoiceVisibleActions(a, selected === a.id) : []),
    [a, selected],
  );
  const actionsB = useMemo(
    () => (b ? pitchChoiceVisibleActions(b, selected === b.id) : []),
    [b, selected],
  );

  if (!requestId) return null;
  if (options.length < 1 && !loading && !softFail) return null;

  const title =
    loading && options.length < 1
      ? 'Suche Optionen…'
      : softFail
        ? headline || 'Alternativen'
        : headline || 'Zwei Optionen';

  return (
    <Animated.View
      entering={BULLETS_ENTERING}
      exiting={BULLETS_EXITING}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Pressable onPress={() => {
              clear();
              void import('../services/actionHandlerService')
                .then(({ dismissConciergeCard }) => dismissConciergeCard())
                .catch(() => undefined);
            }} hitSlop={10} accessibilityLabel="Schließen">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {loading && options.length < 1 ? (
          <Text style={styles.loadingHint}>
            Zwei passende Orte kommen gleich — Karten bleiben danach stehen.
          </Text>
        ) : softFail && options.length < 1 ? (
          <Text style={styles.loadingHint}>
            {headline && headline !== 'Alternativen'
              ? headline
              : 'Im engen Umkreis kein Hard-Match — sag Stadt oder Richtung, dann such ich weiter.'}
          </Text>
        ) : stackVertical ? (
          <ScrollView
            horizontal
            pagingEnabled={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sliderRow}
          >
            {options.map((o, idx) => (
              <View key={o.id} style={styles.sliderPage}>
                <ChoiceButton
                  option={o}
                  index={idx}
                  selected={selected === o.id}
                  onSelect={() => onPick(o.id)}
                  compact
                  showChooseHint={showChooseHint}
                />
                <ActionCluster
                  actions={pitchChoiceVisibleActions(o, selected === o.id)}
                  align={idx === 0 ? 'left' : 'right'}
                  navBusy={navBusy}
                  onNavBusy={setNavBusy}
                />
              </View>
            ))}
          </ScrollView>
        ) : (
          <>
            <View style={styles.choiceRow}>
              {a ? (
                <ChoiceButton
                  option={a}
                  index={0}
                  selected={selected === a.id}
                  onSelect={() => onPick(a.id)}
                  showChooseHint={showChooseHint}
                />
              ) : null}
              {b ? (
                <ChoiceButton
                  option={b}
                  index={1}
                  selected={selected === b.id}
                  onSelect={() => onPick(b.id)}
                  showChooseHint={showChooseHint}
                />
              ) : null}
            </View>
            <View style={styles.actionsRow}>
              {a ? (
                <ActionCluster
                  actions={actionsA}
                  align="left"
                  navBusy={navBusy}
                  onNavBusy={setNavBusy}
                />
              ) : null}
              {b ? (
                <ActionCluster
                  actions={actionsB}
                  align="right"
                  navBusy={navBusy}
                  onNavBusy={setNavBusy}
                />
              ) : null}
            </View>
          </>
        )}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    flexShrink: 1,
    zIndex: UI_LAYER.bullets,
    elevation: UI_LAYER.bullets,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: 'rgba(12, 28, 22, 0.94)',
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: 8,
  },
  title: {
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 17,
    flex: 1,
  },
  close: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 16,
    paddingLeft: 4,
    paddingTop: 2,
  },
  loadingHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    paddingVertical: spacing.sm,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  choiceBtn: {
    flex: 1,
    minWidth: 0,
    minHeight: 108,
    borderRadius: 14,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1.5,
    borderColor: 'rgba(196, 163, 90, 0.45)',
    backgroundColor: 'rgba(196, 163, 90, 0.14)',
    justifyContent: 'center',
  },
  choiceBtnCompact: {
    minHeight: 76,
    width: '100%',
  },
  choiceBtnSelected: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196, 163, 90, 0.32)',
  },
  choiceBtnPressed: {
    opacity: 0.88,
  },
  choiceMedal: { fontSize: 16, marginBottom: 4 },
  choiceName: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 15,
    lineHeight: 19,
  },
  choiceNameSelected: {
    color: '#F5E6C8',
  },
  choiceBullet: {
    marginTop: 4,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  choiceHint: {
    marginTop: 6,
    color: 'rgba(245, 230, 200, 0.75)',
    fontSize: 11,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    width: '100%',
  },
  actionCluster: {
    flex: 1,
    width: 0,
    minWidth: 0,
    overflow: 'hidden',
    alignItems: 'flex-start',
  },
  actionClusterRight: {
    alignItems: 'flex-end',
  },
  actionClusterInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    paddingVertical: 2,
    maxWidth: '100%',
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(196, 163, 90, 0.28)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 163, 90, 0.55)',
    maxWidth: '100%',
  },
  actionBtnPressed: {
    backgroundColor: 'rgba(196, 163, 90, 0.42)',
  },
  actionLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 140,
  },
  sliderRow: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  sliderPage: {
    width: 220,
    gap: spacing.xs,
  },
});
