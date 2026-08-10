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
        {(option.bullets ?? []).slice(0, 3).map((b, i) => (
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
  const headline = useLivePitchStore((s) => s.headline);
  const selectOption = useLivePitchStore((s) => s.selectOption);
  const clear = useLivePitchStore((s) => s.clear);

  const onPick = useCallback(
    (id: string) => {
      selectOption(id);
    },
    [selectOption],
  );

  if (!requestId || options.length < 1) return null;
  const a = options[0]!;
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
            {softFail ? 'Alternativen' : headline || 'Zwei Optionen'}
          </Text>
          <Pressable onPress={clear} hitSlop={10} accessibilityLabel="Schließen">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          <OptionColumn
            option={a}
            selected={selected === a.id}
            onSelect={() => onPick(a.id)}
          />
          {b ? (
            <OptionColumn
              option={b}
              selected={selected === b.id}
              onSelect={() => onPick(b.id)}
            />
          ) : null}
        </View>
        <View style={styles.actions}>
          {options.flatMap((o) =>
            o.actions.slice(0, 2).map((act, i) => (
              <Pressable
                key={`${o.id}_act_${i}`}
                style={styles.actionBtn}
                onPress={() => void handleQuickAction(act)}
              >
                <Text style={styles.actionLabel} numberOfLines={1}>
                  {act.label}
                </Text>
              </Pressable>
            )),
          )}
        </View>
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
