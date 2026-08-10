/**
 * Drag-and-drop Stop-Liste für Multi-Stop-Navigation im Overlay.
 * Halten am ≡-Griff → verschieben; 🗑 löscht.
 * Zeile: → km · Dauer, darunter Ortsname.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../constants/theme';
import type { TourStop } from '../services/navigation/multiStopTour';
import {
  activateMultiStopAt,
  removeMultiStopAt,
  reorderMultiStop,
} from '../runtime/navigationModule';
import { haversineMeters } from '../db/database';
import {
  getPlanBikeMPerMin,
  getPlanWalkMPerMin,
} from '../services/mobility/paceProfile';
import { useFinnusStore } from '../store/useFinnusStore';
import { useGpsStore } from '../store/useGpsStore';

const ROW_H = 68;

type Props = {
  stops: TourStop[];
  currentIndex: number;
  onDraggingChange?: (dragging: boolean) => void;
};

function formatKm(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function formatEta(distanceM: number, bike: boolean): string {
  const mpm = bike ? getPlanBikeMPerMin() : getPlanWalkMPerMin();
  const mins = Math.max(1, Math.round(distanceM / Math.max(1, mpm)));
  return bike ? `~${mins} Min Rad` : `~${mins} Min Fuß`;
}

export function DraggableStopList({
  stops,
  currentIndex,
  onDraggingChange,
}: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragFrom = useRef<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const onDraggingChangeRef = useRef(onDraggingChange);
  onDraggingChangeRef.current = onDraggingChange;

  const userLat = useGpsStore((s) => s.lat);
  const userLng = useGpsStore((s) => s.lng);
  const transportMode = useFinnusStore((s) => s.transportMode);
  const bike = transportMode === 'bicycle';

  const legMeta = useMemo(() => {
    return stops.map((stop, i) => {
      const prev =
        i === 0
          ? userLat != null && userLng != null
            ? { lat: userLat, lng: userLng }
            : null
          : stops[i - 1]!;
      if (!prev) {
        return { distM: null as number | null, line: '—' };
      }
      const distM = haversineMeters(prev.lat, prev.lng, stop.lat, stop.lng);
      return {
        distM,
        line: `${formatKm(distM)} · ${formatEta(distM, bike)}`,
      };
    });
  }, [stops, userLat, userLng, bike]);

  const commitReorder = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    void reorderMultiStop(from, to);
  }, []);

  const makePan = useCallback(
    (index: number) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dy) > 4 || Math.abs(g.dx) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragFrom.current = index;
          hoverRef.current = index;
          setDragIndex(index);
          setHoverIndex(index);
          dragY.setValue(0);
          onDraggingChangeRef.current?.(true);
        },
        onPanResponderMove: (_e, g) => {
          dragY.setValue(g.dy);
          const from = dragFrom.current;
          if (from == null) return;
          const delta = Math.round(g.dy / ROW_H);
          const next = Math.max(0, Math.min(stops.length - 1, from + delta));
          if (hoverRef.current !== next) {
            hoverRef.current = next;
            setHoverIndex(next);
          }
        },
        onPanResponderRelease: () => {
          const from = dragFrom.current;
          const to = hoverRef.current;
          dragFrom.current = null;
          hoverRef.current = null;
          setDragIndex(null);
          setHoverIndex(null);
          dragY.setValue(0);
          onDraggingChangeRef.current?.(false);
          if (from != null && to != null && from !== to) {
            commitReorder(from, to);
          }
        },
        onPanResponderTerminate: () => {
          dragFrom.current = null;
          hoverRef.current = null;
          setDragIndex(null);
          setHoverIndex(null);
          dragY.setValue(0);
          onDraggingChangeRef.current?.(false);
        },
      }),
    [commitReorder, dragY, stops.length],
  );

  const pans = useMemo(
    () => stops.map((_, i) => makePan(i)),
    [makePan, stops],
  );

  return (
    <View style={styles.list}>
      <Text style={styles.hint}>Ziehen am ≡ zum Sortieren · 🗑 zum Löschen</Text>
      {stops.map((stop, i) => {
        const active = i === currentIndex && !stop.done;
        const done = stop.done || i < currentIndex;
        const isLast = i === stops.length - 1;
        const dragging = dragIndex === i;
        const isHoverTarget =
          hoverIndex === i && dragIndex != null && dragIndex !== i;
        const meta = legMeta[i];

        return (
          <Animated.View
            key={`${stop.name}-${i}-${stop.lat}`}
            style={[
              styles.row,
              active && styles.rowActive,
              done && styles.rowDone,
              dragging && styles.rowDragging,
              isHoverTarget && styles.rowHover,
              dragging
                ? {
                    transform: [{ translateY: dragY }],
                    zIndex: 20,
                    elevation: 20,
                  }
                : null,
            ]}
          >
            {!done ? (
              <View
                style={styles.handle}
                {...pans[i].panHandlers}
                accessibilityLabel="Stopp verschieben"
              >
                <Text style={styles.handleTxt}>≡</Text>
              </View>
            ) : (
              <View style={styles.handlePlaceholder} />
            )}

            <Pressable
              style={styles.main}
              onPress={() => {
                if (!done) void activateMultiStopAt(i);
              }}
            >
              <Text style={styles.idx}>
                {done ? '✓' : active ? '→' : isLast ? '★' : String(i + 1)}
              </Text>
              <View style={styles.copy}>
                <Text
                  style={[styles.metaLine, active && styles.metaActive]}
                  numberOfLines={1}
                >
                  {done ? 'Erledigt' : meta?.line ?? '—'}
                </Text>
                <Text
                  style={[
                    styles.name,
                    done && styles.nameDone,
                    active && styles.nameActive,
                  ]}
                  numberOfLines={2}
                >
                  {stop.name}
                  {isLast && !done ? ' (Ziel)' : ''}
                </Text>
              </View>
            </Pressable>

            {!done ? (
              <Pressable
                onPress={() => void removeMultiStopAt(i)}
                hitSlop={10}
                style={styles.trash}
                accessibilityLabel="Stopp löschen"
              >
                <Text style={styles.trashTxt}>🗑</Text>
              </Pressable>
            ) : (
              <View style={styles.trashPlaceholder} />
            )}
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 4,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ROW_H,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
  },
  rowActive: {
    backgroundColor: colors.accentSoft,
  },
  rowDone: {
    opacity: 0.55,
  },
  rowDragging: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: 1,
    borderColor: colors.accent,
  },
  rowHover: {
    borderTopWidth: 2,
    borderTopColor: colors.accent,
  },
  handle: {
    width: 36,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handlePlaceholder: {
    width: 36,
  },
  handleTxt: {
    color: colors.textMuted,
    fontSize: 20,
    fontWeight: '700',
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minWidth: 0,
    paddingVertical: 2,
  },
  idx: {
    width: 22,
    color: colors.accent,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  metaLine: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  metaActive: {
    color: colors.accent,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  nameDone: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
  },
  nameActive: {
    fontWeight: '800',
  },
  trash: {
    width: 40,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashPlaceholder: {
    width: 40,
  },
  trashTxt: {
    fontSize: 16,
  },
});
