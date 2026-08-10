/**
 * VoiceSelectorList — Offline-Hörproben + Stimmenwahl.
 * Reihenfolge: Community-Häufigkeit (häufigste oben).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import { Asset } from 'expo-asset';
import { colors, spacing } from '../constants/theme';
import { voicesForLanguage, type VoiceDefinition } from '../constants/voices';
import { VOICE_PREVIEW_MODULES } from '../constants/voicePreviewAssets';
import type { VoiceId } from '../types/userProfile';
import { PlayPauseIcon } from './PlayPauseIcon';
import {
  recordVoiceSelection,
  sortVoiceIdsByPopularity,
} from '../services/voice/voicePopularityService';

type Props = {
  selectedVoiceId: VoiceId;
  onSelectVoice: (id: VoiceId) => void;
  onAfterSelect?: (id: VoiceId) => void;
  /** Wenn gesetzt: nur diese Stimmen anzeigen (Express / Combo-Match). */
  allowedVoiceIds?: readonly VoiceId[];
  /** Empfehlung hervorheben */
  recommendedVoiceId?: VoiceId | null;
};

export function VoiceSelectorList({
  selectedVoiceId,
  onSelectVoice,
  onAfterSelect,
  allowedVoiceIds,
  recommendedVoiceId,
}: Props) {
  const baseVoices = voicesForLanguage('de').filter(
    (v) => !allowedVoiceIds || allowedVoiceIds.includes(v.id),
  );
  const [voices, setVoices] = useState<VoiceDefinition[]>(baseVoices);
  const [previewing, setPreviewing] = useState<VoiceId | null>(null);
  const [loadingId, setLoadingId] = useState<VoiceId | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const orderedIds = await sortVoiceIdsByPopularity(
        baseVoices.map((v) => v.id),
      );
      if (cancelled) return;
      const byId = new Map(baseVoices.map((v) => [v.id, v]));
      let ordered = orderedIds
        .map((id) => byId.get(id))
        .filter((v): v is VoiceDefinition => !!v);
      // Empfohlene / vorausgewählte Stimme ganz nach oben
      const pinId = recommendedVoiceId ?? selectedVoiceId;
      if (pinId) {
        const pinned = ordered.find((v) => v.id === pinId);
        if (pinned) {
          ordered = [pinned, ...ordered.filter((v) => v.id !== pinId)];
        }
      }
      setVoices(ordered);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedVoiceIds?.join(','), recommendedVoiceId, selectedVoiceId]);

  useEffect(() => {
    return () => {
      void stopPreview();
    };
  }, []);

  async function stopPreview(): Promise<void> {
    const s = soundRef.current;
    soundRef.current = null;
    setPreviewing(null);
    setLoadingId(null);
    if (!s) return;
    try {
      await s.stopAsync();
    } catch {
      /* ignore */
    }
    try {
      await s.unloadAsync();
    } catch {
      /* ignore */
    }
  }

  async function playOfflinePreview(voice: VoiceDefinition): Promise<void> {
    if (previewing === voice.id) {
      await stopPreview();
      return;
    }

    await stopPreview();
    setLoadingId(voice.id);

    try {
      const moduleId = VOICE_PREVIEW_MODULES[voice.id];
      if (moduleId == null) {
        throw new Error(`Keine Offline-Hörprobe für ${voice.id}`);
      }

      const asset = Asset.fromModule(moduleId);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri) throw new Error('Preview-Asset ohne URI');

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
      );
      soundRef.current = sound;
      setPreviewing(voice.id);
      setLoadingId(null);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          void stopPreview();
        }
      });
    } catch (err) {
      console.warn('[VoiceSelectorList] offline preview failed:', err);
      setLoadingId(null);
      setPreviewing(null);
    }
  }

  function selectVoice(id: VoiceId): void {
    onSelectVoice(id);
    void recordVoiceSelection(id);
    onAfterSelect?.(id);
  }

  return (
    <View style={styles.list}>
      {voices.map((v) => {
        const selected = selectedVoiceId === v.id;
        const isLoading = loadingId === v.id;
        const isPlaying = previewing === v.id;

        return (
          <Pressable
            key={v.id}
            onPress={() => selectVoice(v.id)}
            style={[styles.row, selected && styles.rowOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${v.name}, ${v.subtitle}`}
          >
            <View style={[styles.radio, selected && styles.radioOn]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>

            <View style={styles.copy}>
              <Text style={[styles.name, selected && styles.nameOn]}>
                {v.emoji} {v.name}
                {recommendedVoiceId === v.id ? ' · passt' : ''}
              </Text>
              <Text style={styles.subtitle}>{v.subtitle}</Text>
            </View>

            <Pressable
              onPress={() => {
                void playOfflinePreview(v);
              }}
              style={[styles.playBtn, isPlaying && styles.playBtnActive]}
              accessibilityRole="button"
              accessibilityLabel={
                isPlaying
                  ? `${v.name} Hörprobe pausieren`
                  : `${v.name} Hörprobe abspielen`
              }
              hitSlop={8}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <PlayPauseIcon paused={isPlaying} size={14} />
              )}
            </Pressable>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  rowOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(46, 204, 138, 0.12)',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  nameOn: {
    color: colors.accent,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  playBtnActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(46, 204, 138, 0.18)',
  },
});
