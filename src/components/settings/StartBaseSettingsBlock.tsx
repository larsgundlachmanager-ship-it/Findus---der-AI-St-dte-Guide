/**
 * Startpunkt / Unterkunft für den Tagesplan (stadt-getrennt).
 * Auswahl: Zuhause hier (GPS) oder Hotel/Adresse per Suche eingeben.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing } from '../../constants/theme';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { getCachedUserProfile } from '../../services/userProfileService';
import { applyConfirmedHotelAsDayBase } from '../../services/memory/hotelBasePresence';

type Props = {
  /** Kompakter Hinweis für Auto-Popup */
  compact?: boolean;
};

type SearchHit = {
  name: string;
  lat: number;
  lng: number;
  kind: 'zuhause' | 'hotel' | 'ferienwohnung';
  detail?: string;
};

function currentGps(): { lat: number; lng: number } | null {
  const gps = useFinnusStore.getState();
  const lat = gps.lastGpsLat;
  const lng = gps.lastGpsLng;
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  return { lat, lng };
}

function labelForKind(kind: SearchHit['kind']): string {
  if (kind === 'zuhause') return 'Zuhause';
  if (kind === 'ferienwohnung') return 'Ferienwohnung';
  return 'Hotel';
}

export function StartBaseSettingsBlock({ compact = false }: Props) {
  const entities = useUserMemoryStore((s) => s.entities);

  const base = useMemo(() => {
    const hotel = useUserMemoryStore.getState().getConfirmedHotel();
    if (
      hotel &&
      typeof hotel.lat === 'number' &&
      typeof hotel.lng === 'number' &&
      Number.isFinite(hotel.lat) &&
      Number.isFinite(hotel.lng)
    ) {
      return {
        name: hotel.name,
        kind: 'unterkunft',
        lat: hotel.lat,
        lng: hotel.lng,
      };
    }
    return null;
  }, [entities]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [mode, setMode] = useState<'home' | 'search' | null>(null);
  const [query, setQuery] = useState('');
  const [saveKind, setSaveKind] = useState<'hotel' | 'zuhause' | 'ferienwohnung'>(
    'hotel',
  );
  const [hits, setHits] = useState<SearchHit[]>([]);

  const persistBase = async (opts: {
    name: string;
    kind: SearchHit['kind'];
    lat: number;
    lng: number;
    notes: string;
  }) => {
    const name = opts.name.trim().slice(0, 64) || labelForKind(opts.kind);
    useUserMemoryStore.getState().addOrUpdateEntity({
      type: 'hotel',
      name,
      isConfirmed: true,
      lat: opts.lat,
      lng: opts.lng,
      notes: opts.notes,
      visitedAt: new Date().toISOString(),
    });
    applyConfirmedHotelAsDayBase({
      name,
      lat: opts.lat,
      lng: opts.lng,
    });
    setStatus(`${name} als Startpunkt gespeichert.`);
    setHits([]);
    setMode(null);
  };

  const onHereHome = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const gps = currentGps();
      if (!gps) {
        setStatus('Kein GPS — kurz ins Freie und erneut tippen.');
        return;
      }
      await persistBase({
        name: 'Zuhause',
        kind: 'zuhause',
        lat: gps.lat,
        lng: gps.lng,
        notes: 'Settings: hier = Zuhause',
      });
      setMode('home');
    } catch {
      setStatus('Konnte Startpunkt nicht speichern.');
    } finally {
      setBusy(false);
    }
  };

  const onSearch = async () => {
    const q = query.replace(/\s+/g, ' ').trim();
    if (q.length < 2) {
      setStatus('Bitte Hotelname oder Adresse eingeben.');
      return;
    }
    setBusy(true);
    setStatus(null);
    setHits([]);
    try {
      const profile = getCachedUserProfile();
      const cityHint = profile?.cityName?.trim() || null;
      const gps = currentGps();
      const next: SearchHit[] = [];
      const seen = new Set<string>();

      const push = (hit: SearchHit) => {
        const key = `${hit.name.toLowerCase()}|${hit.lat.toFixed(4)}|${hit.lng.toFixed(4)}`;
        if (seen.has(key)) return;
        seen.add(key);
        next.push(hit);
      };

      // 1) Stadt-Pack: Unterkünfte / passende Namen
      try {
        const { getAllPois } = await import('../../db/database');
        const { parseTagsJson } = await import('../../services/geo/triggerPolicy');
        const pois = await getAllPois();
        const needle = q.toLowerCase().replace(/^hotel\s+/i, '');
        for (const poi of pois) {
          const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
          const blob = `${poi.name} ${poi.category ?? ''} ${tags}`.toLowerCase();
          const lodging = /(hotel|pension|hostel|unterkunft|apartment|ferien)/i.test(
            blob,
          );
          const nameHit =
            poi.name.toLowerCase().includes(needle) ||
            needle.includes(poi.name.toLowerCase().replace(/^hotel\s+/i, ''));
          if (!nameHit && !(lodging && blob.includes(needle))) continue;
          push({
            name: poi.name,
            lat: poi.lat,
            lng: poi.lng,
            kind: saveKind,
            detail: lodging ? 'Im Stadt-Pack' : 'Ort im Pack',
          });
          if (next.length >= 5) break;
        }
      } catch {
        /* soft */
      }

      // 2) Geocode (Adresse / Hotelname + Stadt)
      try {
        const { geocodePlaceNameOsmFirst } = await import(
          '../../services/navigation/googleMapsNav'
        );
        const geo = await geocodePlaceNameOsmFirst(q, {
          biasLat: gps?.lat,
          biasLng: gps?.lng,
          cityHint,
          preferStreetAddress: /\d/.test(q) || /\b(str|straße|strasse|weg|platz)\b/i.test(q),
        });
        if (geo) {
          push({
            name: geo.label || q,
            lat: geo.lat,
            lng: geo.lng,
            kind: saveKind,
            detail: 'Adresse / Geocode',
          });
        }
      } catch {
        /* soft */
      }

      // 3) Places-Textsuche (wenn Key da)
      if (gps) {
        try {
          const { searchPlacesByText } = await import(
            '../../services/navigation/googleMapsNav'
          );
          const places = await searchPlacesByText({
            query: cityHint ? `${q} ${cityHint}` : q,
            lat: gps.lat,
            lng: gps.lng,
            radiusM: 20_000,
            includedType: saveKind === 'hotel' ? 'lodging' : null,
          });
          for (const p of places.slice(0, 5)) {
            push({
              name: p.name,
              lat: p.lat,
              lng: p.lng,
              kind: saveKind,
              detail: 'Suche',
            });
          }
        } catch {
          /* soft */
        }
      }

      if (!next.length) {
        setStatus(
          'Nichts gefunden — genauerer Hotelname oder Straße + Hausnummer versuchen.',
        );
        return;
      }
      setHits(next.slice(0, 6));
      setStatus(`${next.length} Treffer — tippe zum Übernehmen.`);
    } catch {
      setStatus('Suche fehlgeschlagen — später erneut versuchen.');
    } finally {
      setBusy(false);
    }
  };

  const onPickHit = async (hit: SearchHit) => {
    setBusy(true);
    try {
      await persistBase({
        name: hit.name,
        kind: hit.kind,
        lat: hit.lat,
        lng: hit.lng,
        notes: `Settings: ${hit.kind} per Suche/Adresse`,
      });
      setQuery('');
    } catch {
      setStatus('Konnte Startpunkt nicht speichern.');
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      const hotel = useUserMemoryStore.getState().getConfirmedHotel();
      if (hotel?.id) {
        useUserMemoryStore.getState().removeEntity(hotel.id);
      }
      setStatus('Startpunkt gelöscht.');
      setHits([]);
    } catch {
      setStatus('Löschen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      {!compact ? (
        <Text style={styles.hint}>
          Von hier starten die Wege im Tagesplan („Los zu …“), solange kein
          anderer Stop davor liegt. Stadt-getrennt — wechselt du die Stadt,
          gilt der alte Startpunkt nicht mit.
        </Text>
      ) : (
        <Text style={styles.hint}>
          Startpunkt für diese Stadt: Zuhause hier setzen oder Hotel / Adresse
          suchen.
        </Text>
      )}
      {base ? (
        <Text style={[styles.hint, { marginTop: 8 }]}>
          Aktuell: {base.name} · {base.lat.toFixed(4)}, {base.lng.toFixed(4)}
        </Text>
      ) : (
        <Text style={[styles.hint, { marginTop: 8 }]}>
          Noch kein Startpunkt mit Position gesetzt.
        </Text>
      )}

      <View style={styles.choiceRow}>
        <Pressable
          style={[
            styles.choiceChip,
            mode === 'home' && styles.choiceChipOn,
            busy && styles.dim,
          ]}
          disabled={busy}
          onPress={() => {
            setMode('home');
            setHits([]);
            void onHereHome();
          }}
          accessibilityRole="button"
          accessibilityLabel="Hier als Zuhause setzen"
        >
          <Text
            style={[
              styles.choiceChipText,
              mode === 'home' && styles.choiceChipTextOn,
            ]}
          >
            Zuhause hier
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.choiceChip,
            mode === 'search' && styles.choiceChipOn,
            busy && styles.dim,
          ]}
          disabled={busy}
          onPress={() => {
            setMode('search');
            setStatus(null);
          }}
          accessibilityRole="button"
          accessibilityLabel="Hotel oder Adresse eingeben"
        >
          <Text
            style={[
              styles.choiceChipText,
              mode === 'search' && styles.choiceChipTextOn,
            ]}
          >
            Hotel / Adresse
          </Text>
        </Pressable>
      </View>

      {mode === 'search' ? (
        <View style={styles.searchBlock}>
          <View style={styles.kindRow}>
            {(
              [
                { id: 'hotel' as const, label: 'Hotel' },
                { id: 'zuhause' as const, label: 'Zuhause' },
                { id: 'ferienwohnung' as const, label: 'Ferienwohnung' },
              ] as const
            ).map((k) => (
              <Pressable
                key={k.id}
                style={[
                  styles.kindChip,
                  saveKind === k.id && styles.kindChipOn,
                ]}
                onPress={() => setSaveKind(k.id)}
              >
                <Text
                  style={[
                    styles.kindChipText,
                    saveKind === k.id && styles.kindChipTextOn,
                  ]}
                >
                  {k.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Hotelname oder Straße + Nr."
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void onSearch()}
            editable={!busy}
          />
          <Pressable
            style={[styles.searchBtn, busy && styles.dim]}
            disabled={busy}
            onPress={() => void onSearch()}
          >
            {busy ? (
              <ActivityIndicator color="#1A1408" />
            ) : (
              <Text style={styles.searchBtnText}>Suchen</Text>
            )}
          </Pressable>
          {hits.map((hit) => (
            <Pressable
              key={`${hit.name}-${hit.lat}-${hit.lng}`}
              style={[styles.hitRow, busy && styles.dim]}
              disabled={busy}
              onPress={() => void onPickHit({ ...hit, kind: saveKind })}
            >
              <Text style={styles.hitTitle} numberOfLines={2}>
                {hit.name}
              </Text>
              <Text style={styles.hitMeta}>
                {labelForKind(saveKind)}
                {hit.detail ? ` · ${hit.detail}` : ''} · {hit.lat.toFixed(4)},{' '}
                {hit.lng.toFixed(4)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!compact && mode !== 'search' ? (
        <Pressable
          style={[styles.row, { marginTop: 8, opacity: busy ? 0.5 : 1 }]}
          disabled={busy}
          onPress={() => {
            setMode('search');
            setSaveKind('ferienwohnung');
          }}
        >
          <Text style={styles.rowTitle}>Ferienwohnung / Adresse suchen…</Text>
        </Pressable>
      ) : null}

      {base ? (
        <Pressable
          style={[styles.row, { marginTop: 8, opacity: busy ? 0.5 : 1 }]}
          disabled={busy}
          onPress={() => void onClear()}
        >
          <Text style={styles.rowTitle}>Startpunkt löschen</Text>
        </Pressable>
      ) : null}
      {status ? (
        <Text style={[styles.hint, { marginTop: 8 }]}>{status}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  choiceChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  choiceChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft ?? 'rgba(196, 163, 90, 0.18)',
  },
  choiceChipText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  choiceChipTextOn: {
    color: colors.accent,
  },
  searchBlock: {
    marginTop: 10,
    gap: 8,
  },
  kindRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  kindChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  kindChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft ?? 'rgba(196, 163, 90, 0.15)',
  },
  kindChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  kindChipTextOn: {
    color: colors.accent,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.bg ?? colors.surface,
    fontSize: 15,
  },
  searchBtn: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  searchBtnText: {
    color: '#1A1408',
    fontWeight: '800',
    fontSize: 14,
  },
  hitRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  hitTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  hitMeta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  dim: { opacity: 0.55 },
});
