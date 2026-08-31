/**
 * Stadtwechsel-Prompt — Cover + Fakten wie Stadt-Katalog, Yorro-Design.
 * Overlay statt RN-Modal (Android: Modal oft nur Fragmente / kein Inhalt).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { triggerHapticPulse } from '../services/navigation/haptics';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import {
  citySearchMeta,
  resolveCityCoverSource,
} from '../constants/cityCovers';
import {
  ensureCityCoverCached,
  peekCachedCoverFile,
} from '../services/cityCoverCache';
import { CITY_CARD_HERO } from '../constants/personaPortraits';
import {
  registerCitySwitchPresenter,
  registerCitySwitchSettledListener,
  registerCitySwitchAbort,
  type CitySwitchPromptPayload,
  type CitySwitchDecision,
} from '../services/cityProximityService';
import type { CityCatalogItem } from '../services/cityCatalogService';

type Pending = {
  payload: CitySwitchPromptPayload;
  resolve: (decision: CitySwitchDecision) => void;
};

function formatKm(km: number): string {
  if (!(km >= 0) || !Number.isFinite(km)) return '—';
  if (km < 10) return `${km.toFixed(1)} km`;
  if (km < 100) return `${Math.round(km)} km`;
  return `${Math.round(km / 10) * 10} km`;
}

function CityHero({
  city,
  soft,
  badge,
}: {
  city: CityCatalogItem;
  soft?: boolean;
  badge?: string;
}) {
  const [coverPhase, setCoverPhase] = useState<'primary' | 'hero'>('primary');
  const [localCover, setLocalCover] = useState<string | null>(() =>
    peekCachedCoverFile(city.id, city.coverUrl),
  );

  useEffect(() => {
    setCoverPhase('primary');
    const peek = peekCachedCoverFile(city.id, city.coverUrl);
    setLocalCover(peek);
    if (peek || soft) return;
    let cancelled = false;
    void ensureCityCoverCached(city.id, city.coverUrl).then((uri) => {
      if (!cancelled && uri) setLocalCover(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [city.id, city.coverUrl, soft]);

  const coverSource =
    coverPhase === 'hero' || soft
      ? CITY_CARD_HERO
      : localCover
        ? { uri: localCover.startsWith('file:') ? localCover : `file://${localCover}` }
        : resolveCityCoverSource(city.id, city.coverUrl);

  return (
    <View style={styles.heroClip}>
      <Image
        key={`${city.id}:${coverPhase}:${city.coverUrl || ''}:${soft ? 's' : 'p'}`}
        source={coverSource}
        style={styles.heroImg}
        resizeMode="cover"
        onError={() => {
          setCoverPhase('hero');
        }}
      />
      <View style={styles.heroBadge}>
        <Text style={styles.heroBadgeText}>
          {badge || (soft ? 'Neu erkannt' : 'Näher bei dir')}
        </Text>
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
  const [acceptedFlash, setAcceptedFlash] = useState(false);
  const acceptedRef = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  pendingRef.current = pending;

  const clearDismissTimer = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  const finish = (decision: CitySwitchDecision) => {
    const cur = pendingRef.current;
    if (!cur) return;
    triggerHapticPulse(decision === 'accept' ? 'heavy' : 'single');
    if (decision === 'accept') {
      if (acceptedRef.current) return;
      acceptedRef.current = true;
      setAcceptedFlash(true);
      // Sofort freigeben → Download/Pack im Hintergrund; Karte nur kurz mit Haken.
      cur.resolve('accept');
      clearDismissTimer();
      dismissTimerRef.current = setTimeout(() => {
        acceptedRef.current = false;
        pendingRef.current = null;
        setPending(null);
        setAcceptedFlash(false);
        dismissTimerRef.current = null;
      }, 180);
      return;
    }
    clearDismissTimer();
    try {
      cur.resolve('dismiss');
    } catch {
      /* soft */
    }
    acceptedRef.current = false;
    pendingRef.current = null;
    setPending(null);
    setAcceptedFlash(false);
  };

  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    registerCitySwitchPresenter((payload) => {
      return new Promise<CitySwitchDecision>((resolve) => {
        clearDismissTimer();
        acceptedRef.current = false;
        setAcceptedFlash(false);
        const next = { payload, resolve };
        pendingRef.current = next;
        setPending(next);
      });
    });
    registerCitySwitchSettledListener(() => {
      if (acceptedRef.current) return;
      clearDismissTimer();
      pendingRef.current = null;
      setPending(null);
      setAcceptedFlash(false);
    });
    registerCitySwitchAbort((d) => finishRef.current(d));
    return () => {
      clearDismissTimer();
      registerCitySwitchPresenter(null);
      registerCitySwitchSettledListener(null);
      registerCitySwitchAbort(null);
    };
  }, []);

  if (!pending) return null;

  const { nearest, selected, nearestKm, selectedKm, softTarget, reason } =
    pending.payload;
  const research = reason === 'research';
  const meta = citySearchMeta(nearest.id);
  const regionLine = [meta.region, meta.country].filter(Boolean).join(' · ');
  const triggers = nearest.triggerCount ?? nearest.placeCount ?? 0;
  const zones = nearest.zoneCount ?? nearest.directoryCount ?? 0;
  const stories = nearest.storyCount ?? 0;
  const facts = nearest.factCount ?? 0;
  const selectedName = selected.name?.trim() || 'deiner Stadt';
  const soft = Boolean(softTarget);
  const gapKm = Math.max(0, selectedKm - nearestKm);
  const clearlyCloser = gapKm >= 3;

  return (
    <View
      style={styles.overlay}
      pointerEvents="auto"
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdropHit}
        onPress={() => finish('dismiss')}
        accessibilityLabel="Schließen"
      />
      <View style={styles.centerWrap} pointerEvents="box-none">
        <View
          style={styles.card}
          accessibilityRole="summary"
          accessibilityLabel={`${nearest.name} — ${soft ? 'neu erkannt' : `näher als ${selectedName}`}`}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <CityHero
              city={nearest}
              soft={soft}
              badge={research ? 'Datensatz' : undefined}
            />

            <View style={styles.body}>
              <Text style={styles.eyebrow}>
                {research
                  ? 'Für die Recherche'
                  : soft
                    ? 'Stadt erkannt'
                    : 'Stadt in der Nähe'}
              </Text>
              <Text style={styles.title}>{nearest.name}</Text>
              {regionLine && !soft ? (
                <Text style={styles.region} numberOfLines={1}>
                  {regionLine}
                </Text>
              ) : soft ? (
                <Text style={styles.region} numberOfLines={2}>
                  Ohne Datensatz — Restaurants, Hotels & Orte live vor Ort
                </Text>
              ) : null}

              <View style={styles.compareRow}>
                <View style={styles.compareCol}>
                  <Text style={styles.compareLabel} numberOfLines={1}>
                    {selectedName}
                  </Text>
                  <Text style={styles.compareKmMuted}>
                    {research ? 'jetzt' : formatKm(selectedKm)}
                  </Text>
                </View>
                <Feather
                  name="arrow-right"
                  size={18}
                  color={colors.accent}
                  style={styles.compareArrowIcon}
                />
                <View style={[styles.compareCol, styles.compareColFocus]}>
                  <Text style={styles.compareLabelFocus} numberOfLines={1}>
                    {nearest.name}
                  </Text>
                  <Text style={styles.compareKm}>
                    {research ? 'laden' : formatKm(nearestKm)}
                  </Text>
                </View>
              </View>

              {!soft && !research ? (
                <View style={styles.statRow}>
                  <StatPill num={triggers} label="Trigger" />
                  <StatPill num={zones} label="Orte" />
                  <StatPill num={stories} label="Stories" />
                  <StatPill num={facts} label="Fakten" />
                </View>
              ) : null}

              <Text style={styles.prompt}>
                {research
                  ? `Für ${nearest.name} recherchiere ich besser, wenn wir wechseln. Wollen wir das?`
                  : soft
                    ? `Du bist in ${nearest.name}. Hier weiter entdecken — Suche & Tipps laufen auf ${nearest.name}, auch ohne fertigen Datensatz.`
                    : clearlyCloser
                      ? `Du bist näher an ${nearest.name} als an ${selectedName}. Pack wechseln und hier weiter entdecken?`
                      : `Hier ist ${nearest.name}. Pack wechseln und hier weiter entdecken?`}
              </Text>
            </View>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              onPress={() => finish('dismiss')}
              style={styles.secondary}
              hitSlop={16}
              accessibilityRole="button"
              accessibilityLabel={`Bei ${selectedName} bleiben`}
            >
              <Text style={styles.secondaryText}>Bleiben</Text>
            </Pressable>
            <Pressable
              onPress={() => finish('accept')}
              disabled={acceptedFlash}
              style={styles.primary}
              hitSlop={16}
              accessibilityRole="button"
              accessibilityLabel={
                soft
                  ? `${nearest.name} als Stadt wählen`
                  : `Auf ${nearest.name} wechseln`
              }
            >
              {acceptedFlash ? (
                <View style={styles.acceptedRow}>
                  <Feather name="check" size={20} color={colors.bg} />
                  <Text style={styles.primaryText} numberOfLines={1}>
                    OK
                  </Text>
                </View>
              ) : (
                <Text style={styles.primaryText}>
                  {research ? 'Wechseln' : soft ? 'Hier nutzen' : 'Wechseln'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.askSheet,
    elevation: UI_LAYER.askSheet,
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
    // Covers sind 3:2 — Rahmen muss matchen, sonst fehlt unten Bildinhalt
    aspectRatio: 3 / 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  heroImg: {
    width: '100%',
    height: '100%',
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
  compareArrowIcon: {
    marginHorizontal: 2,
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
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    paddingTop: 8,
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
  acceptedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
});
