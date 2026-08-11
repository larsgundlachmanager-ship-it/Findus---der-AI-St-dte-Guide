/**
 * Pitch-only UI: Live = A|B nebeneinander; Name-Button + Stichpunkte darunter.
 */

import React, { useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import {
  useLivePitchStore,
  type LivePitchState,
} from '../module2/pitch/publishPitchUi';
import { handleQuickAction } from '../services/actionHandlerService';
import {
  BULLETS_ENTERING,
  BULLETS_EXITING,
} from './liveStage/stageTransitions';

function OptionColumn({
  option,
  selected,
  onSelect,
}: {
  option: LivePitchState['options'][number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <View style={[styles.col, selected && styles.colSelected]}>
      <Pressable
        onPress={onSelect}
        style={styles.nameBtn}
        accessibilityRole="button"
        accessibilityLabel={`Wähle ${option.name}`}
      >
        <Text style={styles.medal} numberOfLines={1}>
          {option.role === 'favorite'
            ? '🥇'
            : option.role === 'out_of_box'
              ? '✨'
              : '🥈'}
        </Text>
        <Text style={styles.name} numberOfLines={2}>
          {option.name}
        </Text>
      </Pressable>
      <View style={styles.bullets}>
        {(option.bullets?.length
          ? option.bullets
          : [
              option.rating != null
                ? `${option.rating.toFixed(1).replace('.', ',')}★`
                : null,
              'Tippe → Route oder Buchen',
            ].filter(Boolean) as string[]
        )
          .slice(0, 3)
          .map((b, i) => (
          <Text
            key={`${option.id}_b_${i}`}
            style={styles.bullet}
            numberOfLines={2}
          >
            • {b}
          </Text>
        ))}
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

  const onPick = useCallback(
    (id: string) => {
      selectOption(id);
      const opt = useLivePitchStore.getState().options.find((o) => o.id === id);
      if (!opt) return;

      // Hotel: Buchungs-Link zuerst (nicht stillschweigend nur Nav)
      const book =
        opt.actions.find(
          (a) =>
            a.type === 'OPEN_URL' &&
            typeof a.payload?.url === 'string' &&
            /expedia|stay22|booking\.com|hotels\.com|vrbo|affiliate|camref|zimmer\s*buch/i.test(
              `${a.payload.url} ${a.label}`,
            ),
        ) ||
        (opt.bookingUrl
          ? {
              type: 'OPEN_URL' as const,
              label: '🏨 Zimmer buchen',
              payload: { url: opt.bookingUrl, destName: opt.name },
            }
          : null);
      if (book) {
        void handleQuickAction(book).finally(() => {
          setTimeout(() => {
            try {
              useLivePitchStore.getState().clear();
            } catch {
              /* soft */
            }
          }, 800);
        });
        return;
      }

      const nav =
        opt.actions.find((a) => a.type === 'START_NAVIGATION') ||
        (Number.isFinite(opt.lat) && Number.isFinite(opt.lng)
          ? {
              type: 'START_NAVIGATION' as const,
              label: `📍 ${opt.name}`,
              payload: {
                destName: opt.name,
                destLat: opt.lat,
                destLng: opt.lng,
              },
            }
          : null);
      if (nav) {
        void handleQuickAction(nav).finally(() => {
          // Karte kurz stehen lassen, dann schließen — Say–Do
          setTimeout(() => {
            try {
              useLivePitchStore.getState().clear();
            } catch {
              /* soft */
            }
          }, 800);
        });
      }
    },
    [selectOption],
  );

  if (!requestId) return null;
  if (options.length < 1 && !loading) return null;
  const a = options[0];
  const b = options[1];

  return (
    <Animated.View
      entering={BULLETS_ENTERING}
      exiting={BULLETS_EXITING}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={1}>
            {loading && options.length < 1
              ? 'Suche Optionen…'
              : softFail
                ? 'Alternativen'
                : headline || 'Zwei Optionen'}
          </Text>
          <Pressable onPress={clear} hitSlop={10} accessibilityLabel="Schließen">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        {loading && options.length < 1 ? (
          <Text style={styles.loadingHint}>
            Zwei passende Orte kommen gleich — Karten bleiben danach stehen.
          </Text>
        ) : (
          <>
            <View style={styles.row}>
              {a ? (
                <OptionColumn
                  option={a}
                  selected={selected === a.id}
                  onSelect={() => onPick(a.id)}
                />
              ) : null}
              {b ? (
                <OptionColumn
                  option={b}
                  selected={selected === b.id}
                  onSelect={() => onPick(b.id)}
                />
              ) : null}
            </View>
            <View style={styles.actions}>
              {options.flatMap((o) => {
                const raw = o.actions?.length
                  ? [...o.actions]
                  : [
                      {
                        type: 'START_NAVIGATION' as const,
                        label: `📍 ${o.name}`,
                        payload: {
                          destName: o.name,
                          destLat: o.lat,
                          destLng: o.lng,
                        },
                      },
                    ];
                // Buchen / Speisekarte sichtbar halten (nicht hinter Maps verstecken)
                raw.sort((a, b) => {
                  const rank = (x: (typeof raw)[number]) => {
                    const lab = `${x.label} ${x.type === 'OPEN_URL' ? x.payload?.url ?? '' : ''}`;
                    if (
                      /zimmer\s*buch|speisekarte|getränkekarte|🍹|🍽|🏨/i.test(
                        lab,
                      ) ||
                      /expedia|stay22|booking\.com/i.test(lab)
                    ) {
                      return 0;
                    }
                    if (x.type === 'START_NAVIGATION') return 1;
                    return 2;
                  };
                  return rank(a) - rank(b);
                });
                return raw.slice(0, 2).map((act, i) => (
                  <Pressable
                    key={`${o.id}_act_${i}`}
                    style={styles.actionBtn}
                    onPress={() => void handleQuickAction(act)}
                  >
                    <Text style={styles.actionLabel} numberOfLines={1}>
                      {act.label}
                    </Text>
                  </Pressable>
                ));
              })}
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
    paddingBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
    flex: 1,
  },
  close: { color: 'rgba(255,255,255,0.55)', fontSize: 16, paddingLeft: 8 },
  loadingHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    paddingVertical: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  col: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    padding: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  colSelected: {
    borderColor: 'rgba(120, 200, 160, 0.7)',
    backgroundColor: 'rgba(40, 80, 60, 0.35)',
  },
  nameBtn: { marginBottom: 4 },
  medal: { fontSize: 14, marginBottom: 2 },
  name: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  bullets: { gap: 2 },
  bullet: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  actionLabel: { color: colors.text, fontSize: 11, maxWidth: 140 },
});
