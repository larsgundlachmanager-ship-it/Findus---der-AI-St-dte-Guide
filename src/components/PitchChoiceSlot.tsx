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

function medalFor(option: LivePitchState['options'][number]): string {
  if (option.role === 'favorite') return '🥇';
  if (option.role === 'out_of_box') return '✨';
  return '🥈';
}

function ChoiceButton({
  option,
  selected,
  onSelect,
  compact,
}: {
  option: LivePitchState['options'][number];
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
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
      <Text style={styles.choiceMedal}>{medalFor(option)}</Text>
      <Text
        style={[styles.choiceName, selected && styles.choiceNameSelected]}
        numberOfLines={2}
      >
        {option.name}
      </Text>
      {(option.bullets ?? []).slice(0, 3).map((b, i) => (
        <Text
          key={`${option.id}_b_${i}`}
          style={styles.choiceBullet}
          numberOfLines={2}
        >
          {b}
        </Text>
      ))}
      <Text style={styles.choiceHint} numberOfLines={1}>
        {selected ? 'Gewählt · Route startet' : 'Tippen zum Wählen'}
      </Text>
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.actionClusterInner}
      >
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
      </ScrollView>
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
  const navStartedFor = useRef<string | null>(null);

  const onPick = useCallback(
    (id: string) => {
      void import('../services/handsFree/scheduleMicAfterAsk')
        .then((m) => m.abortListenSessionForUiChoice('pitch_choice'))
        .catch(() => undefined);
      // Vor Collapse die Option lesen (selectOption lässt nur noch die Wahl stehen).
      const opt = useLivePitchStore.getState().options.find((o) => o.id === id);
      const pitchRequestId = useLivePitchStore.getState().requestId;
      selectOption(id);
      if (!opt) return;

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

      const hasProgram = (opt.actions ?? []).some(
        (a) =>
          a.type === 'OPEN_URL' &&
          /programm|website|pdf|ticket|probe|infos/i.test(a.label),
      );

      // Nur sagen „starte Route“, wenn wir sie wirklich starten
      const ackVariants = !canNav
        ? [
            `Super Wahl — ${opt.name}. Programm und Infos hast du unten.`,
            `Gute Wahl: ${opt.name}. Die Infos liegen bereit.`,
          ]
        : hasProgram
          ? [
              `Super Wahl — ${opt.name}. Ich starte die Route; Programm und Infos bleiben unten.`,
              `Gute Wahl: ${opt.name}. Route läuft an — und unten findest du das Programm.`,
              `${opt.name} — starke Wahl. Ich leg die Verbindung los; Programm ist verlinkt.`,
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
            const result = await startPitchNavigation(
              { name: nav.name, lat: nav.lat, lng: nav.lng },
              pitchNavIntentFromPayload(nav.action?.payload),
            );
            if (!result.ok) {
              try {
                useFinnusStore.getState().setNavRouteLoading(false);
              } catch {
                /* soft */
              }
              if (result.message) alertActionError(result.message);
            } else {
              setTimeout(() => {
                try {
                  useLivePitchStore.getState().clear(true);
                } catch {
                  /* soft */
                }
              }, 3000);
              setTimeout(() => {
                void import('../module2/pitch/pitchDeepAppend')
                  .then(({ getPitchSession }) => {
                    const session = getPitchSession(pitchRequestId || '');
                    if (
                      session?.kind !== 'food' &&
                      session?.kind !== 'bar'
                    ) {
                      return;
                    }
                    return import('../services/concierge/autoReservationFollowUp').then(
                      (m) =>
                        m.presentPlaceReservationAsk({
                          name: opt.name,
                          lat: nav.lat,
                          lng: nav.lng,
                        }),
                    );
                  })
                  .catch(() => undefined);
              }, 4500);
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

      if (!skipCannedAck) {
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
          <Pressable onPress={clear} hitSlop={10} accessibilityLabel="Schließen">
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
                  selected={selected === o.id}
                  onSelect={() => onPick(o.id)}
                  compact
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
                  selected={selected === a.id}
                  onSelect={() => onPick(a.id)}
                />
              ) : null}
              {b ? (
                <ChoiceButton
                  option={b}
                  selected={selected === b.id}
                  onSelect={() => onPick(b.id)}
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
  },
  actionCluster: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  actionClusterRight: {
    alignItems: 'flex-end',
  },
  actionClusterInner: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 6,
    alignItems: 'center',
    paddingVertical: 2,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(196, 163, 90, 0.28)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 163, 90, 0.55)',
  },
  actionBtnPressed: {
    backgroundColor: 'rgba(196, 163, 90, 0.42)',
  },
  actionLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 130,
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
