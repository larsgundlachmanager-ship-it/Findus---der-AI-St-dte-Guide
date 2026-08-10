/**
 * Runtime Dev-Board (Phase 8) — __DEV__ only.
 * Orchestrator module, GPS profile, queue, presence + Cartesia cost.
 */

import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { getHudRuntimeSnapshot } from '../runtime/uiModule';
import {
  getCartesiaCostSnapshot,
  getCartesiaCostSnapshotAsync,
} from '../services/cartesiaCostTracker';
import { getSpeechJobQueueSize } from '../services/ai/speechJobQueue';
import { getStreamingPrefetchDepth } from '../services/audio/streamingAudioQueueService';

const REFRESH_MS = 900;

export function RuntimeDevBoard() {
  const [expanded, setExpanded] = useState(false);
  const [snap, setSnap] = useState(getHudRuntimeSnapshot);
  const [cartesia, setCartesia] = useState(getCartesiaCostSnapshot);
  const [queueDepth, setQueueDepth] = useState(0);
  const [prefetch, setPrefetch] = useState(0);

  useEffect(() => {
    if (!__DEV__) return;
    const id = setInterval(() => {
      setSnap(getHudRuntimeSnapshot());
      setQueueDepth(getSpeechJobQueueSize());
      setPrefetch(getStreamingPrefetchDepth());
      void getCartesiaCostSnapshotAsync().then(setCartesia);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  if (!__DEV__) return null;

  const costLabel =
    cartesia.costEurToday < 0.01
      ? '<0,01€'
      : `${cartesia.costEurToday.toFixed(2).replace('.', ',')}€`;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={styles.chip}
        accessibilityRole="button"
        accessibilityLabel="Runtime Dev-Board"
      >
        <Text style={styles.chipText}>
          {snap.runtimeModuleLabel}
          {snap.queuedGpsPoiId != null ? ` · Q#${snap.queuedGpsPoiId}` : ''}
          {` · C ${cartesia.charsToday}|${costLabel}`}
        </Text>
      </Pressable>

      {expanded ? (
        <View style={styles.panel}>
          <Text style={styles.title}>Runtime Dev-Board</Text>
          <Text style={styles.help}>
            Nur in Dev-Builds: Live-Status (Modul, GPS, Mic/TTS) + Cartesia-Kosten
            heute. Tippen zum Auf-/Zuklappen. API-Gesamtkosten: Settings →
            Entwickler → Kosten-Übersicht.
          </Text>
          <DevRow label="Modul" value={snap.runtimeModuleLabel} />
          <DevRow label="Presence" value={snap.presence} />
          <DevRow label="GPS" value={snap.gpsProfile} />
          <DevRow label="Transport" value={snap.transportMode} />
          <DevRow
            label="Flags"
            value={[
              snap.isSpeaking ? 'TTS' : null,
              snap.isListening ? 'Mic' : null,
              snap.isGenerating ? 'Gen' : null,
              snap.navActive ? 'Nav' : null,
              snap.online ? 'Online' : 'Offline',
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          />
          <DevRow
            label="Cartesia"
            value={`Zeichen heute: ${cartesia.charsToday.toLocaleString('de-DE')} | Kosten heute: ${costLabel}`}
          />
          <DevRow
            label="Audio-Q"
            value={
              queueDepth > 0 || prefetch > 0
                ? `${queueDepth} Jobs · Prefetch ${prefetch}`
                : 'leer'
            }
          />
          <DevRow
            label="Growth"
            value={`Pull +${snap.growthPullImported} · Sync ${String(snap.growthSyncHour).padStart(2, '0')}:00`}
          />
          <DevRow
            label="GPS-Queue"
            value={
              snap.queuedGpsPoiId != null
                ? `POI #${snap.queuedGpsPoiId}`
                : '—'
            }
          />
        </View>
      ) : null}
    </View>
  );
}

function DevRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: spacing.md + 4,
    right: spacing.md + 52,
    zIndex: UI_LAYER.hud + 1,
    elevation: UI_LAYER.hud + 1,
    alignItems: 'flex-end',
    gap: 6,
    maxWidth: '48%',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  panel: {
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: 'rgba(8, 18, 14, 0.92)',
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
    minWidth: 180,
  },
  title: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  help: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 12,
    marginBottom: 4,
    opacity: 0.9,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  rowLabel: {
    width: 62,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  rowValue: {
    flex: 1,
    color: colors.text,
    fontSize: 10,
    lineHeight: 14,
  },
});
