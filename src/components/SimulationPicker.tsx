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
import { triggerPoiArrival } from '../services/poiTriggerService';
import { startNavigation } from '../services/navigation';
import { useFinnusStore } from '../store/useFinnusStore';
import { stopSpeaking } from '../services/ttsService';

interface Props {
  pois: Poi[];
  visible: boolean;
  disabled?: boolean;
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

export function SimulationPicker({ pois, visible, disabled }: Props) {
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
    // Modal sofort öffnen — nicht hinter Story/TTS warten
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
          // Sofort stoppen — sonst hängt die alte Story und blockiert die nächste Simulation
          await stopSpeaking();
          useFinnusStore.getState().setLastVisitedPoiId(null);
          useFinnusStore.getState().setIsGenerating(false);
          if (pickMode === 'navigate') {
            await startNavigation(runId);
            return;
          }
          await triggerPoiArrival(runId, { force: true });
        } catch (err) {
          console.warn('[sim] POI-Auswahl fehlgeschlagen:', err);
          useFinnusStore.getState().setIsGenerating(false);
          useFinnusStore.getState().setIsPlayingAudio(false);
          useFinnusStore.getState().setSubtitleText(null);
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

  if (!visible) return null;

  return (
    <View style={styles.wrap}>
      <Pressable
        style={[styles.trigger, disabled && styles.triggerDisabled]}
        onPress={() => openPicker('arrive')}
        disabled={disabled}
      >
        <Text style={styles.triggerLabel}>Ort wechseln (GPS-Simulation)</Text>
        <Text style={styles.triggerHint}>
          {busy ? 'Findus erzählt… (Liste trotzdem öffnen)' : `${pois.length} POIs`}
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

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent={Platform.OS === 'android'}
        onRequestClose={() => setOpen(false)}
      >
        {/*
          Wichtig: dunkler Root-View (nicht Pressable als Wrapper).
          Sonst blitzt Android beim Öffnen/Schließen hellweiß.
        */}
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.backdropHit}
            onPress={() => setOpen(false)}
            accessibilityLabel="Schließen"
          />
          <View style={styles.sheet} pointerEvents="box-none">
            <View style={styles.sheetInner}>
              <Text style={styles.sheetTitle}>
                {mode === 'navigate' ? 'Navigiere zu' : 'Ort wählen'}
              </Text>
              <Text style={styles.sheetHint}>
                Hauptorte zuerst — tippe einen Eintrag, Findus startet dort.
              </Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
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
  /** Undurchsichtiger Dunkelton — deckt Android-Modal-Weiß komplett ab */
  modalRoot: {
    flex: 1,
    backgroundColor: '#0A1A15',
    justifyContent: 'flex-end',
  },
  backdropHit: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
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
