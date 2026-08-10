/**
 * Multi-stop queue drawer: reorder / delete stops, next-stop distance.
 */

import React, { useCallback } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  activateMultiStopAt,
  removeMultiStopAt,
  reorderMultiStop,
} from '../runtime/navigationModule';
import { clearNavigationHard } from '../services/navigation/hardNavOverride';
import { getActiveNavDestination } from '../services/navigation/navigationService';

function formatKm(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export const StopQueueSheet = React.memo(function StopQueueSheet() {
  const visible = useFinnusStore((s) => s.stopQueueVisible);
  const tour = useFinnusStore((s) => s.multiStopTour);
  const navActive = useFinnusStore((s) => s.navActive);
  const navTargetName = useFinnusStore((s) => s.navTargetName);
  // Prefer store leg distance — do NOT subscribe to raw GPS coords here.
  const nextDistM = useFinnusStore((s) => {
    if (s.navLegDistanceM != null && s.navLegDistanceM > 0) {
      return Math.round(s.navLegDistanceM);
    }
    return null;
  });

  const close = useCallback(() => {
    useFinnusStore.getState().setStopQueueVisible(false);
  }, []);

  const onClearRoute = useCallback(() => {
    void (async () => {
      await clearNavigationHard({ silent: true });
      close();
    })();
  }, [close]);

  const nextStop = tour?.stops[tour.currentIndex] ?? null;
  const singleDest = !tour ? getActiveNavDestination() : null;

  const onRemove = useCallback(
    (index: number) => {
      void removeMultiStopAt(index);
    },
    [],
  );

  const onMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    void reorderMultiStop(index, index - 1);
  }, []);

  const onMoveDown = useCallback((index: number) => {
    const tourNow = useFinnusStore.getState().multiStopTour;
    if (!tourNow || index >= tourNow.stops.length - 1) return;
    void reorderMultiStop(index, index + 1);
  }, []);

  const onActivate = useCallback((index: number) => {
    void activateMultiStopAt(index);
  }, []);

  const title = tour?.title ?? navTargetName ?? 'Route';
  const displayName =
    navTargetName ?? nextStop?.name ?? singleDest?.name ?? '—';

  if (!visible || (!tour?.stops?.length && !navActive)) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>

        <View style={styles.nextBlock}>
          <Text style={styles.nextLabel}>Nächster Stop</Text>
          <Text style={styles.nextName} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.nextDist}>
            {nextDistM != null ? formatKm(nextDistM) : '—'}
            {tour && tour.estimatedDistanceM > 0
              ? ` · Gesamt ~${formatKm(tour.estimatedDistanceM)}`
              : ''}
          </Text>
        </View>

        <ScrollView
          style={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {tour?.stops?.length
            ? tour.stops.map((stop, i) => {
                const active = i === tour.currentIndex && !stop.done;
                const done = stop.done || i < tour.currentIndex;
                return (
                  <View
                    key={`${stop.name}-${i}-${stop.lat}`}
                    style={[
                      styles.row,
                      active && styles.rowActive,
                      done && styles.rowDone,
                    ]}
                  >
                    <Pressable
                      style={styles.rowMain}
                      onPress={() => {
                        if (!done) onActivate(i);
                      }}
                    >
                      <Text style={styles.idx}>
                        {done ? '✓' : active ? '→' : String(i + 1)}
                      </Text>
                      <Text
                        style={[styles.stopName, done && styles.stopNameDone]}
                        numberOfLines={1}
                      >
                        {stop.name}
                        {active ? ' (aktiv)' : ''}
                      </Text>
                    </Pressable>
                    {!done ? (
                      <View style={styles.ops}>
                        <Pressable
                          onPress={() => onMoveUp(i)}
                          hitSlop={8}
                          style={styles.opBtn}
                        >
                          <Text style={styles.opTxt}>↑</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onMoveDown(i)}
                          hitSlop={8}
                          style={styles.opBtn}
                        >
                          <Text style={styles.opTxt}>↓</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onRemove(i)}
                          hitSlop={8}
                          style={styles.opBtn}
                        >
                          <Text style={[styles.opTxt, styles.opDanger]}>✕</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })
            : (
              <View style={[styles.row, styles.rowActive]}>
                <Text style={styles.idx}>→</Text>
                <Text style={styles.stopName} numberOfLines={1}>
                  {displayName} (aktiv)
                </Text>
              </View>
            )}
        </ScrollView>

        <Pressable style={styles.clearRouteBtn} onPress={onClearRoute}>
          <Text style={styles.clearRouteTxt}>Route löschen</Text>
        </Pressable>

        <Pressable style={styles.closeBtn} onPress={close}>
          <Text style={styles.closeTxt}>Schließen</Text>
        </Pressable>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: '72%',
    marginTop: 'auto',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  nextBlock: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  nextLabel: {
    color: colors.textMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  nextName: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
  },
  nextDist: {
    color: colors.text,
    fontSize: 14,
    marginTop: 4,
  },
  list: {
    maxHeight: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowActive: {
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 6,
  },
  rowDone: {
    opacity: 0.55,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  idx: {
    color: colors.accent,
    width: 22,
    fontWeight: '700',
  },
  stopName: {
    color: colors.text,
    fontSize: 15,
    flex: 1,
  },
  stopNameDone: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
  },
  ops: {
    flexDirection: 'row',
    gap: 4,
  },
  opBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  opTxt: {
    color: colors.text,
    fontSize: 16,
  },
  opDanger: {
    color: colors.danger,
  },
  closeBtn: {
    marginTop: spacing.sm,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  closeTxt: {
    color: colors.text,
    fontWeight: '600',
  },
  clearRouteBtn: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(217, 107, 92, 0.22)',
  },
  clearRouteTxt: {
    color: colors.danger,
    fontWeight: '700',
  },
});
