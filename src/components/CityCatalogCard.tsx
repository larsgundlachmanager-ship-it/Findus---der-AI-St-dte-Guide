/**
 * Stadt-Karte mit Cover — SSOT für Einrichtung und Einstellungen.
 */

import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import {
  citySearchMeta,
  resolveCityCoverSource,
} from '../constants/cityCovers';
import {
  ensureCityCoverCached,
  peekCachedCoverFile,
} from '../services/cityCoverCache';
import { CITY_CARD_HERO } from '../constants/personaPortraits';
import { t, type AppLanguage } from '../i18n';
import type { CityCatalogItem } from '../services/cityCatalogService';

export type CityCatalogCardVariant = 'hero' | 'grid';

export function CityCatalogCard({
  city,
  lang,
  selected,
  variant,
  onPress,
  disabled,
  busy,
}: {
  city: CityCatalogItem;
  lang: AppLanguage;
  selected: boolean;
  variant: CityCatalogCardVariant;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const meta = citySearchMeta(city.id);
  const regionLine = [meta.region, meta.country].filter(Boolean).join(' · ');
  const compact = variant === 'grid';
  const triggers = city.triggerCount ?? city.placeCount ?? 0;
  const zones = city.zoneCount ?? city.directoryCount ?? 0;
  const facts = city.factCount ?? 0;
  const stories = city.storyCount ?? 0;
  const hasStats = triggers > 0 || zones > 0 || facts > 0 || stories > 0;
  const [coverPhase, setCoverPhase] = useState<'primary' | 'hero'>('primary');
  const [localCover, setLocalCover] = useState<string | null>(() =>
    peekCachedCoverFile(city.id, city.coverUrl),
  );

  useEffect(() => {
    setCoverPhase('primary');
    const peek = peekCachedCoverFile(city.id, city.coverUrl);
    setLocalCover(peek);
    if (peek) return;
    let cancelled = false;
    void ensureCityCoverCached(city.id, city.coverUrl).then((uri) => {
      if (!cancelled && uri) setLocalCover(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [city.id, city.coverUrl]);

  const coverSource =
    coverPhase === 'hero'
      ? CITY_CARD_HERO
      : localCover
        ? { uri: localCover.startsWith('file:') ? localCover : `file://${localCover}` }
        : resolveCityCoverSource(city.id, city.coverUrl);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[
        styles.card,
        compact && styles.cardGrid,
        selected && styles.cardSelected,
        (disabled || busy) && styles.cardBusy,
      ]}
    >
      <View
        style={[styles.heroClip, compact ? styles.heroGrid : styles.heroFull]}
      >
        <Image
          key={`${city.id}:${coverPhase}:${city.coverUrl || ''}`}
          source={coverSource}
          style={styles.heroImg}
          resizeMode="cover"
          onError={() => {
            setCoverPhase('hero');
          }}
        />
      </View>
      <View style={[styles.body, compact && styles.bodyGrid]}>
        <Text style={[styles.titleLine, compact && styles.titleLineGrid]}>
          <Text style={[styles.name, compact && styles.nameGrid]}>
            {city.name}
          </Text>
          {city.distanceKm != null ? (
            <Text
              style={[
                styles.distanceInline,
                compact && styles.distanceInlineGrid,
              ]}
            >
              {'  '}
              {city.distanceKm < 10
                ? city.distanceKm.toFixed(1)
                : Math.round(city.distanceKm)}{' '}
              {t(lang, 'kmAway')}
            </Text>
          ) : regionLine && !compact ? (
            <Text style={styles.distanceInline}>
              {'  '}
              {regionLine}
            </Text>
          ) : null}
          {selected && !busy ? (
            <Text style={styles.selectedMark}>{'  '}✓</Text>
          ) : null}
        </Text>
        {regionLine && compact && city.distanceKm == null ? (
          <Text style={styles.meta} numberOfLines={1}>
            {regionLine}
          </Text>
        ) : null}
        {hasStats && !compact ? (
          <View style={styles.statRow}>
            <StatPill num={triggers} label="Trigger" />
            <StatPill num={zones} label="Orte" />
            <StatPill num={stories} label="Stories" />
            <StatPill num={facts} label="Fakten" />
          </View>
        ) : null}
        {hasStats && compact ? (
          <View style={styles.gridStatsBlock}>
            <Text style={styles.gridStats} numberOfLines={1}>
              <Text style={styles.gridStatNum}>{triggers}</Text>
              <Text style={styles.gridStatLabel}> Trigger · </Text>
              <Text style={styles.gridStatNum}>{zones}</Text>
              <Text style={styles.gridStatLabel}> Orte</Text>
            </Text>
            <Text style={styles.gridStats} numberOfLines={1}>
              <Text style={styles.gridStatNum}>{stories}</Text>
              <Text style={styles.gridStatLabel}> Stories · </Text>
              <Text style={styles.gridStatNum}>{facts}</Text>
              <Text style={styles.gridStatLabel}> Fakten</Text>
            </Text>
          </View>
        ) : null}
        {busy ? (
          <Text style={styles.busyHint}>{t(lang, 'downloadingCity')}</Text>
        ) : null}
      </View>
    </Pressable>
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardGrid: {
    minHeight: 0,
    borderRadius: 14,
  },
  cardSelected: {
    borderColor: colors.accent,
  },
  cardBusy: {
    opacity: 0.7,
  },
  heroClip: {
    width: '100%',
    backgroundColor: colors.surface,
    // Covers sind 3:2 — Rahmen muss matchen, sonst fehlt unten Bildinhalt
    overflow: 'hidden',
    aspectRatio: 3 / 2,
  },
  heroFull: {},
  heroGrid: {},
  heroImg: {
    width: '100%',
    height: '100%',
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 6,
  },
  bodyGrid: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    gap: 2,
  },
  titleLine: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
    lineHeight: 28,
  },
  titleLineGrid: {
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0,
  },
  name: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  nameGrid: {
    fontSize: 14,
    letterSpacing: 0,
  },
  distanceInline: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  distanceInlineGrid: {
    fontSize: 11,
    fontWeight: '500',
  },
  selectedMark: {
    color: colors.accent,
    fontWeight: '800',
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  busyHint: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    marginTop: 4,
    gap: 6,
  },
  statPill: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  statNum: {
    color: colors.wave,
    fontSize: 17,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
    textAlign: 'center',
  },
  gridStats: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
    lineHeight: 15,
  },
  gridStatsBlock: {
    marginTop: 2,
    gap: 2,
  },
  gridStatNum: {
    color: colors.wave,
    fontWeight: '800',
  },
  gridStatLabel: {
    color: colors.textMuted,
    fontWeight: '600',
  },
});
