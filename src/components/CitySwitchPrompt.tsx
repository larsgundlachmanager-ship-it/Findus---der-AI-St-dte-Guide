/**
 * Stadtwechsel-Prompt — Cover + Fakten wie Stadt-Katalog, Findus-Design.
 * Overlay statt RN-Modal (Android: Modal oft nur Fragmente / kein Inhalt).
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import {
  cityCoverFocus,
  citySearchMeta,
  prefetchCityCover,
  resolveCityCoverSource,
} from '../constants/cityCovers';
import { CITY_CARD_HERO } from '../constants/personaPortraits';
import {
  registerCitySwitchPresenter,
  registerCitySwitchSettledListener,
  type CitySwitchPromptPayload,
  type CitySwitchDecision,
} from '../services/cityProximityService';
import type { CityCatalogItem } from '../services/cityCatalogService';

type Pending = {
  payload: CitySwitchPromptPayload;
  resolve: (decision: CitySwitchDecision) => void;
};

function formatKm(km: number): string {
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function CityHero({ city }: { city: CityCatalogItem }) {
  const focus = cityCoverFocus(city.id);
  const [coverPhase, setCoverPhase] = useState<'primary' | 'hero'>('primary');

  useEffect(() => {
    setCoverPhase('primary');
    prefetchCityCover(city.coverUrl);
  }, [city.id, city.coverUrl]);

  const coverSource =
    coverPhase === 'hero'
      ? CITY_CARD_HERO
      : resolveCityCoverSource(city.id, city.coverUrl);

  return (
    <View style={styles.heroClip}>
      <Image
        key={`${city.id}:${coverPhase}:${city.coverUrl || ''}`}
        source={coverSource}
        style={[
          styles.heroImg,
          {
            transform: [
              { scale: focus.scale },
              { translateY: focus.translateY },
              { translateX: focus.translateX },
            ],
          },
        ]}
        resizeMode="cover"
        onError={() => {
          setCoverPhase('hero');
        }}
      />
      <View style={styles.heroShadeTop} pointerEvents="none" />
      <View style={styles.heroShadeBottom} pointerEvents="none" />
      <View style={styles.heroBadge}>
        <Text style={styles.heroBadgeText}>Näher bei dir</Text>
      </View>
    </View>
  );
}

function StatPill({ num, label }: { num: number; label: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statNum}>{num}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Einmal in App mounten — Presenter für cityProximityService.
 * Absolutes Overlay (kein RN-Modal) → Android zeigt die Karte zuverlässig.
 */
export function CitySwitchPromptHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    registerCitySwitchPresenter((payload) => {
      return new Promise<CitySwitchDecision>((resolve) => {
        setBusy(false);
        setPending({ payload, resolve });
      });
    });
    registerCitySwitchSettledListener(() => {
      setPending(null);
      setBusy(false);
    });
    return () => {
      registerCitySwitchPresenter(null);
      registerCitySwitchSettledListener(null);
    };
  }, []);

  const finish = (decision: CitySwitchDecision) => {
    if (!pending || busy) return;
    if (decision === 'accept') {
      setBusy(true);
      pending.resolve('accept');
      return;
    }
    pending.resolve('dismiss');
    setPending(null);
    setBusy(false);
  };

  if (!pending) return null;

  const { nearest, selected, nearestKm, selectedKm } = pending.payload;
  const meta = citySearchMeta(nearest.id);
  const regionLine = [meta.region, meta.country].filter(Boolean).join(' · ');
  const triggers = nearest.triggerCount ?? nearest.placeCount ?? 0;
  const zones = nearest.zoneCount ?? nearest.directoryCount ?? 0;
  const stories = nearest.storyCount ?? 0;
  const facts = nearest.factCount ?? 0;
  const selectedName = selected.name?.trim() || 'deiner Stadt';

  return (
    <View
      style={styles.overlay}
      pointerEvents="auto"
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdropHit}
        onPress={() => finish('dismiss')}
        disabled={busy}
        accessibilityLabel="Schließen"
      />
      <View style={styles.centerWrap} pointerEvents="box-none">
        <View
          style={styles.card}
          accessibilityRole="summary"
          accessibilityLabel={`${nearest.name} — näher als ${selectedName}`}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <CityHero city={nearest} />

            <View style={styles.body}>
              <Text style={styles.eyebrow}>Stadt in der Nähe</Text>
              <Text style={styles.title}>{nearest.name}</Text>
              {regionLine ? (
                <Text style={styles.region} numberOfLines={1}>
                  {regionLine}
                </Text>
              ) : null}

              <View style={styles.compareRow}>
                <View style={styles.compareCol}>
                  <Text style={styles.compareLabel} numberOfLines={1}>
                    {selectedName}
                  </Text>
                  <Text style={styles.compareKmMuted}>
                    {formatKm(selectedKm)}
                  </Text>
                </View>
                <Text style={styles.compareArrow}>→</Text>
                <View style={[styles.compareCol, styles.compareColFocus]}>
                  <Text style={styles.compareLabelFocus} numberOfLines={1}>
                    {nearest.name}
                  </Text>
                  <Text style={styles.compareKm}>{formatKm(nearestKm)}</Text>
                </View>
              </View>

              <View style={styles.statRow}>
                <StatPill num={triggers} label="Trigger" />
                <StatPill num={zones} label="Orte" />
                <StatPill num={stories} label="Stories" />
                <StatPill num={facts} label="Fakten" />
              </View>

              <Text style={styles.prompt}>
                Du bist näher an {nearest.name} als an {selectedName}. Pack
                wechseln und hier weiter entdecken?
              </Text>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => finish('dismiss')}
                  disabled={busy}
                  style={styles.secondary}
                  accessibilityRole="button"
                  accessibilityLabel={`Bei ${selectedName} bleiben`}
                >
                  <Text style={styles.secondaryText}>Bleiben</Text>
                </Pressable>
                <Pressable
                  onPress={() => finish('accept')}
                  disabled={busy}
                  style={styles.primary}
                  accessibilityRole="button"
                  accessibilityLabel={`Auf ${nearest.name} wechseln`}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.bg} />
                  ) : (
                    <Text style={styles.primaryText}>Wechseln</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay + 20,
    elevation: UI_LAYER.overlay + 20,
  },
  backdropHit: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 18, 14, 0.78)',
  },
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    maxHeight: '88%',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  scrollContent: {
    flexGrow: 0,
  },
  heroClip: {
    width: '100%',
    height: 188,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  heroImg: {
    width: '100%',
    height: '100%',
  },
  heroShadeTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 48,
    backgroundColor: 'rgba(15, 44, 36, 0.25)',
  },
  heroShadeBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 88,
    backgroundColor: 'rgba(15, 44, 36, 0.55)',
  },
  heroBadge: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 44, 36, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(196, 163, 90, 0.45)',
  },
  heroBadgeText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: 8,
  },
  eyebrow: {
    color: colors.wave,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 0.2,
    lineHeight: 30,
  },
  region: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: -2,
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    gap: 8,
  },
  compareCol: {
    flex: 1,
    minWidth: 0,
  },
  compareColFocus: {
    alignItems: 'flex-end',
  },
  compareLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  compareLabelFocus: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  compareKmMuted: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
  },
  compareKm: {
    color: colors.wave,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  compareArrow: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  statRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  statPill: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  statNum: {
    color: colors.wave,
    fontSize: 16,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
    textAlign: 'center',
  },
  prompt: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  secondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  primary: {
    flex: 1.15,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  primaryText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '800',
  },
});
