/**
 * Orte: Kategorie-Filter (Karte + Liste), Suche, Route.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { useDeferredReady } from '../hooks/useDeferredReady';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { countsAsMapVisitedGreen } from '../services/navigation/stampMapModul1';
import { useFinnusStore } from '../store/useFinnusStore';
import { getCachedUserProfile } from '../services/userProfileService';
import {
  collectOpenPlanStops,
  plannedPoiIdSet,
} from '../services/navigation/stampMapPlanMatch';
import { startNavigation, startNavigationToCoords } from '../services/navigation/navigationService';
import {
  colorForHomeMapPoi,
  isHomePresenceMapPoi,
} from '../services/homeMap/homeMapPlaceTone';
import {
  HOME_MAP_TYPE_FILTER_IDS,
  enabledHomeMapFilterSet,
  HOME_MAP_FILTER_CHIPS,
  isStandardHomeMapFilters,
  poiPassesHomeMapFilter,
} from '../services/homeMap/homeMapPlaceFilter';
import { homeMapTypeFilterId } from '../services/homeMap/homeMapPlaceType';
import { useHomeMapUiStore } from '../store/useHomeMapUiStore';
import { useGpsStore } from '../store/useGpsStore';
import {
  fetchPlaceSeekRemote,
  formatSeekDistanceM,
  poiMatchesSeekQuery,
  shouldFetchPlaceSeekRemote,
  type PlaceSeekRemoteHit,
} from '../services/homeMap/placeSeekSearch';
import { parseStreetHouseQuery } from '../services/navigation/streetAddressQuery';
import { searchCityIndex } from '../services/homeMap/searchCityIndex';
import {
  peekCityMapExtract,
  peekDisplayExtract,
} from '../services/homeMap/cityMapExtract';

/** IDs ≥ dieser Schwelle kommen nicht aus SQLite — Navi per Koordinaten. */
const PACK_MAP_POI_ID_MIN = 1_000_000_000;

type PlaceRow = {
  key: string;
  id: number;
  name: string;
  subtitle?: string;
  color: string;
  lat: number;
  lng: number;
  source: 'pack' | 'address' | 'web';
};

const EMPTY_ROWS: PlaceRow[] = [];
const ADDRESS_DOT = '#8A9AA0';
const WEB_DOT = '#C6B889';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export const PlaceSeekSheet = React.memo(function PlaceSeekSheet({
  visible,
  onClose,
}: Props) {
  const pois = useFinnusStore((s) => s.pois);
  const visitedHistory = useFinnusStore((s) => s.visitedHistory);
  const filters = useHomeMapUiStore((s) => s.filters);
  const toggleFilter = useHomeMapUiStore((s) => s.toggleFilter);
  const selectAllFilters = useHomeMapUiStore((s) => s.selectAllFilters);
  const selectNoFilters = useHomeMapUiStore((s) => s.selectNoFilters);
  const selectStandardFilters = useHomeMapUiStore((s) => s.selectStandardFilters);
  const [query, setQuery] = useState('');
  const kbInset = useKeyboardInset();
  const searchRef = useRef<TextInput>(null);
  const [remoteHits, setRemoteHits] = useState<PlaceSeekRemoteHit[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const listReady = useDeferredReady(visible);
  const gpsLat = useGpsStore((s) => s.lat);
  const gpsLng = useGpsStore((s) => s.lng);
  const enabled = useMemo(() => enabledHomeMapFilterSet(filters), [filters]);
  const anyOn = enabled.size > 0;
  const allOn = enabled.size >= HOME_MAP_FILTER_CHIPS.length;
  const standardOn = isStandardHomeMapFilters(filters);
  const seeking = query.trim().length >= 2;
  const cityId = (getCachedUserProfile()?.cityId ?? '').toLowerCase() || null;
  const localSeek = useMemo(() => {
    if (!seeking) return [];
    const origin =
      gpsLat != null &&
      gpsLng != null &&
      Number.isFinite(gpsLat) &&
      Number.isFinite(gpsLng)
        ? { lat: gpsLat, lng: gpsLng }
        : null;
    const extract =
      peekCityMapExtract(cityId)?.housenumbers ??
      peekDisplayExtract(cityId)?.extract?.housenumbers ??
      [];
    return searchCityIndex({
      query,
      pois,
      housenumbers: extract,
      origin,
      limit: 20,
    });
  }, [seeking, query, pois, cityId, gpsLat, gpsLng]);

  useEffect(() => {
    if (visible) return;
    Keyboard.dismiss();
    searchRef.current?.blur();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const q = query.trim();
    if (q.length < 3) {
      setRemoteHits([]);
      setRemoteLoading(false);
      return;
    }
    const hasAddressHit = localSeek.some((h) => h.kind === 'address');
    if (
      !shouldFetchPlaceSeekRemote({
        query: q,
        localHits: localSeek.length,
        hasAddressHit,
      })
    ) {
      setRemoteHits([]);
      setRemoteLoading(false);
      return;
    }
    let cancelled = false;
    setRemoteLoading(true);
    const t = setTimeout(() => {
      const cityHint = getCachedUserProfile()?.cityName ?? null;
      void fetchPlaceSeekRemote(q, {
        lat: gpsLat,
        lng: gpsLng,
        cityHint,
      }).then((hits) => {
        if (cancelled) return;
        setRemoteHits(hits);
        setRemoteLoading(false);
      });
    }, 380);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, visible, gpsLat, gpsLng, localSeek]);

  const placeRows = useMemo(() => {
    if (!visible || !listReady) return EMPTY_ROWS;
    const profile = getCachedUserProfile();
    const plannedIds = plannedPoiIdSet(pois, collectOpenPlanStops());
    const visitedById = new Map(visitedHistory.map((v) => [v.poiId, v]));
    const q = query.trim();
    const rows: PlaceRow[] = [];
    for (const p of pois) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      if (!isHomePresenceMapPoi(p, profile) && !plannedIds.has(p.id)) {
        continue;
      }
      const name = p.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
      if (q.length >= 2 && !poiMatchesSeekQuery(p, q)) continue;
      const visit = visitedById.get(p.id);
      const visited = visit
        ? countsAsMapVisitedGreen({
            keyFacts: visit.keyFacts,
            poi: p,
            profile,
          })
        : false;
      const planned = plannedIds.has(p.id);
      const typeOn = HOME_MAP_TYPE_FILTER_IDS.some((id) => enabled.has(id));
      if (seeking) {
        if (typeOn) {
          const typeId = homeMapTypeFilterId(p);
          if (!typeId || !enabled.has(typeId)) continue;
        }
      } else if (
        !poiPassesHomeMapFilter(p, {
          visited,
          planned,
          profile,
          enabled,
        })
      ) {
        continue;
      }
      rows.push({
        key: `pack-${p.id}`,
        id: p.id,
        name,
        color: colorForHomeMapPoi(p, profile, visited, {
          planned,
          typeFilters: enabled,
        }),
        lat: p.lat,
        lng: p.lng,
        source: 'pack',
      });
    }
    const origin =
      gpsLat != null &&
      gpsLng != null &&
      Number.isFinite(gpsLat) &&
      Number.isFinite(gpsLng)
        ? { lat: gpsLat, lng: gpsLng }
        : null;
    const distOf = (r: PlaceRow) =>
      origin
        ? Math.hypot(
            (r.lat - origin.lat) * 111320,
            (r.lng - origin.lng) * 111320 * Math.cos((r.lat * Math.PI) / 180),
          )
        : 0;
    if (seeking && origin) {
      rows.sort((a, b) => distOf(a) - distOf(b));
    } else {
      rows.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    }
    const slim = rows.slice(0, 80);
    if (seeking && origin) {
      for (const r of slim) {
        r.subtitle = formatSeekDistanceM(distOf(r));
      }
    }
    for (const hit of localSeek) {
      if (hit.kind !== 'address') continue;
      const dup = slim.some((r) => {
        const close =
          Math.hypot(
            (r.lat - hit.lat) * 111320,
            (r.lng - hit.lng) * 111320 * Math.cos((r.lat * Math.PI) / 180),
          ) < 45;
        return close;
      });
      if (dup) continue;
      slim.push({
        key: `addr-${hit.lat.toFixed(5)}-${hit.lng.toFixed(5)}`,
        id: PACK_MAP_POI_ID_MIN + slim.length,
        name: hit.name,
        subtitle: origin
          ? formatSeekDistanceM(
              Math.hypot(
                (hit.lat - origin.lat) * 111320,
                (hit.lng - origin.lng) *
                  111320 *
                  Math.cos((hit.lat * Math.PI) / 180),
              ),
            )
          : 'Adresse',
        color: ADDRESS_DOT,
        lat: hit.lat,
        lng: hit.lng,
        source: 'address',
      });
    }
    for (const hit of remoteHits) {
      const house = parseStreetHouseQuery(q);
      const dup = slim.some((r) => {
        const close =
          Math.hypot(
            (r.lat - hit.lat) * 111320,
            (r.lng - hit.lng) * 111320 * Math.cos((r.lat * Math.PI) / 180),
          ) < 45;
        if (!close) return false;
        if (house && r.source === 'pack' && !r.name.toLowerCase().includes(house.housenumber.toLowerCase())) {
          return false;
        }
        return true;
      });
      if (dup) continue;
      slim.push({
        key: `remote-${hit.source}-${hit.lat.toFixed(5)}-${hit.lng.toFixed(5)}`,
        id: PACK_MAP_POI_ID_MIN + slim.length,
        name: hit.name,
        subtitle: hit.subtitle,
        color: hit.source === 'address' ? ADDRESS_DOT : WEB_DOT,
        lat: hit.lat,
        lng: hit.lng,
        source: hit.source,
      });
    }
    if (seeking && origin) {
      slim.sort((a, b) => distOf(a) - distOf(b));
    }
    return slim;
  }, [
    visible,
    listReady,
    pois,
    visitedHistory,
    query,
    enabled,
    seeking,
    remoteHits,
    localSeek,
    gpsLat,
    gpsLng,
  ]);

  if (!visible) {
    /* keep mounted */
  }

  return (
    <View
      style={[styles.overlay, kbInset > 0 && { paddingBottom: kbInset }, !visible && styles.overlayHidden]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet} pointerEvents="auto" collapsable={false}>
        <View style={styles.head}>
          <Text style={styles.title}>Orte</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={styles.done}>Fertig</Text>
          </Pressable>
        </View>

        <TextInput
          ref={searchRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Adresse, Hotel, Lasertag…"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
        />

        <View style={styles.bulkRow}>
          <Pressable
            onPress={selectAllFilters}
            style={[styles.bulkBtn, allOn && styles.bulkBtnOn]}
            accessibilityRole="button"
            accessibilityLabel="Alle Kategorien auswählen"
          >
            <Text style={[styles.bulkTxt, allOn && styles.bulkTxtOn]}>Alles</Text>
          </Pressable>
          <Pressable
            onPress={selectNoFilters}
            style={[styles.bulkBtn, !anyOn && styles.bulkBtnOn]}
            accessibilityRole="button"
            accessibilityLabel="Keine Kategorie auswählen"
          >
            <Text style={[styles.bulkTxt, !anyOn && styles.bulkTxtOn]}>Nichts</Text>
          </Pressable>
          <Pressable
            onPress={selectStandardFilters}
            style={[styles.bulkBtn, standardOn && styles.bulkBtnOn]}
            accessibilityRole="button"
            accessibilityLabel="Standard: Besucht, Geplant, Auslösen, Story"
          >
            <Text style={[styles.bulkTxt, standardOn && styles.bulkTxtOn]}>Standard</Text>
          </Pressable>
        </View>

        {kbInset < 40 ? (
        <View style={styles.chipWrap}>
          {HOME_MAP_FILTER_CHIPS.map((chip) => {
            const on = !!filters[chip.id];
            return (
              <Pressable
                key={chip.id}
                onPress={() => toggleFilter(chip.id)}
                style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${chip.label}${on ? ', an' : ', aus'}`}
              >
                <View style={[styles.chipDot, { backgroundColor: chip.color }]} />
                <Text style={[styles.chipTxt, on ? styles.chipTxtOn : styles.chipTxtOff]}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        ) : null}

        <ScrollView
          style={[styles.list, kbInset > 80 && styles.listKb]}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {!listReady ? (
            <View style={styles.listLoading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <>
              {placeRows.map((row) => (
                <Pressable
                  key={row.key}
                  style={styles.row}
                    onPress={() => {
                    onClose();
                    void (async () => {
                      try {
                        if (row.source === 'pack' && row.id < PACK_MAP_POI_ID_MIN) {
                          await startNavigation(row.id);
                        } else {
                          await startNavigationToCoords({
                            name: row.name,
                            lat: row.lat,
                            lng: row.lng,
                            skipDestVerify: true,
                          });
                        }
                      } catch {
                        /* Nav darf die App nicht crashen */
                      }
                    })();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.name} — Route starten`}
                >
                  <View style={[styles.rowDot, { backgroundColor: row.color }]} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={2}>
                      {row.name}
                    </Text>
                    {row.subtitle ? (
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {row.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.rowGo}>Route</Text>
                </Pressable>
              ))}
              {remoteLoading ? (
                <View style={styles.listLoading}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : null}
              {placeRows.length === 0 && !remoteLoading ? (
                <Text style={styles.empty}>
                  {seeking
                    ? 'Keine Treffer — Adresse, Hotel oder Angebot tippen.'
                    : !anyOn
                      ? 'Keine Kategorie gewählt — Karte ohne Orte.'
                      : 'Keine Orte zu dieser Auswahl.'}
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.sheet,
    elevation: UI_LAYER.sheet,
    justifyContent: 'flex-end',
  },
  overlayHidden: {
    opacity: 0,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 20, 16, 0.45)',
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: '78%',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    zIndex: UI_LAYER.sheet + 1,
    elevation: UI_LAYER.sheet + 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  done: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  bulkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  bulkBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bulkBtnOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  bulkTxt: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  bulkTxtOn: {
    color: colors.text,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipOff: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
    opacity: 0.55,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipTxt: {
    fontSize: 12,
    fontWeight: '700',
  },
  chipTxtOn: {
    color: colors.text,
  },
  chipTxtOff: {
    color: colors.textMuted,
  },
  search: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  list: {
    maxHeight: 240,
  },
  listKb: {
    maxHeight: 200,
  },
  listLoading: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  rowSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  rowGo: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  empty: {
    color: colors.textMuted,
    fontSize: 13,
    paddingVertical: 12,
  },
});
