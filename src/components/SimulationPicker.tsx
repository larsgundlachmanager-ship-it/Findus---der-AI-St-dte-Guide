import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import type { Poi } from '../db/types';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { noteUserPosition } from '../runtime/triggerEngine';
import { triggerPoiArrival } from '../runtime/exploreModule';
import { setSimulatedNavCoords, startNavigation } from '../services/navigation';
import { useFinnusStore } from '../store/useFinnusStore';
import { stopSpeaking } from '../services/ttsService';

interface Props {
  pois: Poi[];
  visible: boolean;
  disabled?: boolean;
  /**
   * `micFab` — kleiner Button links neben dem Mikrofon.
   * `stack` — klassische Vollbreite-Buttons (Debug).
   */
  layout?: 'micFab' | 'stack';
}

type PickMode = 'arrive' | 'navigate';

function kindLabel(poi: Poi): string {
  const k = poi.kind ?? 'legacy';
  if (k === 'area') return 'Hauptort';
  if (k === 'approach') return 'Annäherung';
  if (k === 'sub') return 'Nebenort';
  return 'Ort';
}

function displayName(poi: Poi): string {
  return poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
}

/** Teleport: App glaubt, User steht am POI (Modul-1-Test ohne echtes GPS). */
function injectSimulatedPresence(poi: Poi): void {
  noteUserPosition(poi.lat, poi.lng);
  useFinnusStore.getState().reportGpsFix({
    lat: poi.lat,
    lng: poi.lng,
    accuracy: 5,
  });
  setSimulatedNavCoords({ lat: poi.lat, lng: poi.lng });
  useFinnusStore.getState().setCurrentLocationName(displayName(poi));
  useFinnusStore.getState().setCurrentPoiId(poi.id);
}

export function SimulationPicker({
  pois,
  visible,
  disabled,
  layout = 'micFab',
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<PickMode>('arrive');

  const sortedPois = useMemo(() => {
    const rank = (p: Poi) => {
      const k = p.kind ?? 'legacy';
      if (k === 'area' || k === 'legacy') return 0;
      if (k === 'sub') return 1;
      return 2;
    };
    return [...pois].sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name, 'de');
    });
  }, [pois]);

  const openPicker = useCallback((next: PickMode) => {
    setMode(next);
    setOpen(true);
  }, []);

  const selectPoi = useCallback(
    (poi: Poi) => {
      setOpen(false);
      setBusy(true);
      const runId = poi.id;
      const pickMode = mode;
      void (async () => {
        try {
          await stopSpeaking();
          useFinnusStore.getState().setLastVisitedPoiId(null);
          useFinnusStore.getState().setIsGenerating(false);
          injectSimulatedPresence(poi);
          if (pickMode === 'navigate') {
            await startNavigation(runId);
            return;
          }
          await triggerPoiArrival(runId, { force: true });
        } catch (err) {
          console.warn('[sim] POI-Auswahl fehlgeschlagen:', err);
          useFinnusStore.getState().setIsGenerating(false);
          useFinnusStore.getState().setIsPlayingAudio(false);
          useFinnusStore.getState().setIsAudiblySpeaking(false);
        } finally {
          setBusy(false);
        }
      })();
    },
    [mode],
  );

  const renderItem = useCallback<ListRenderItem<Poi>>(
    ({ item: poi }) => (
      <Pressable
        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
        onPress={() => selectPoi(poi)}
      >
        <View style={styles.itemRow}>
          <Text style={styles.itemKind}>{kindLabel(poi)}</Text>
          <Text style={styles.itemName} numberOfLines={2}>
            {displayName(poi)}
          </Text>
        </View>
        <Text style={styles.itemMeta}>
          {poi.lat.toFixed(5)}, {poi.lng.toFixed(5)} · {poi.radius_meters} m
        </Text>
      </Pressable>
    ),
    [selectPoi],
  );

  const sheet = (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={() => setOpen(false)}
    >
      <View style={styles.modalRoot}>
        <Pressable
          style={styles.backdropHit}
          onPress={() => setOpen(false)}
          accessibilityLabel="Schließen"
        />
        <View style={styles.sheet} pointerEvents="box-none">
          <View style={styles.sheetInner}>
            <Text style={styles.sheetTitle}>
              {mode === 'navigate' ? 'Navigiere zu' : 'Modul 1 auslösen'}
            </Text>
            <Text style={styles.sheetHint}>
              {mode === 'navigate'
                ? 'Live-Kompass ohne Story — Position wird an den Ort gesetzt.'
                : 'Tipp = du stehst virtuell dort → Yorro erzählt Modul 1.'}
            </Text>
            {sortedPois.length === 0 ? (
              <Text style={styles.emptyHint}>
                Keine POIs geladen. Stadt-Pack zuerst laden, dann erneut öffnen.
              </Text>
            ) : (
              <FlatList
                data={sortedPois}
                keyExtractor={(p) => String(p.id)}
                renderItem={renderItem}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={12}
                maxToRenderPerBatch={16}
                windowSize={7}
                removeClippedSubviews={Platform.OS === 'android'}
                style={styles.list}
              />
            )}
            <Pressable
              style={styles.closeBtn}
              onPress={() => setOpen(false)}
            >
              <Text style={styles.closeBtnText}>Schließen</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (!visible) return null;

  if (layout === 'micFab') {
    return (
      <View style={styles.fabSlot}>
        <Pressable
          style={[styles.fab, disabled && styles.triggerDisabled]}
          onPress={() => openPicker('arrive')}
          onLongPress={() => openPicker('navigate')}
          delayLongPress={420}
          disabled={disabled}
          accessibilityLabel="GPS-Simulation: Ort für Modul 1 wählen"
          accessibilityHint="Kurz tippen: Modul 1 am Ort. Lange halten: nur Navigation."
        >
          <Text style={styles.fabGlyph}>⊕</Text>
          <Text style={styles.fabLabel} numberOfLines={1}>
            {busy ? '…' : 'Ort'}
          </Text>
        </Pressable>
        {sheet}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        style={[styles.trigger, disabled && styles.triggerDisabled]}
        onPress={() => openPicker('arrive')}
        disabled={disabled}
      >
        <Text style={styles.triggerLabel}>Ort wechseln (GPS-Simulation)</Text>
        <Text style={styles.triggerHint}>
          {busy
            ? 'Yorro erzählt… (Liste trotzdem öffnen)'
            : `${pois.length} POIs · Modul 1 manuell`}
        </Text>
      </Pressable>

      <Pressable
        style={[
          styles.trigger,
          styles.triggerNav,
          disabled && styles.triggerDisabled,
        ]}
        onPress={() => openPicker('navigate')}
        disabled={disabled}
      >
        <Text style={styles.triggerLabel}>Navigiere zu…</Text>
        <Text style={styles.triggerHint}>Live-Kompass (ohne Story-Start)</Text>
      </Pressable>

      {sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  fabSlot: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'flex-start',
    // Vertikal an Mic-Kreis (84) ausrichten: sm + (84-56)/2
    paddingTop: spacing.sm + 14,
    zIndex: UI_LAYER.mic,
    elevation: UI_LAYER.mic,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  fabGlyph: {
    fontSize: 18,
    lineHeight: 20,
  },
  fabLabel: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  trigger: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  triggerNav: {
    borderColor: colors.accent,
  },
  triggerDisabled: {
    opacity: 0.6,
  },
  triggerLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  triggerHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  modalRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  backdropHit: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    maxHeight: '70%',
  },
  sheetInner: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    maxHeight: '100%',
  },
  list: {
    flexGrow: 0,
    maxHeight: 420,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  sheetHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: 14,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  item: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemPressed: {
    backgroundColor: colors.accentSoft,
  },
  itemRow: {
    gap: 4,
  },
  itemKind: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  itemName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  itemMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    marginTop: spacing.sm,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  closeBtnText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
});
