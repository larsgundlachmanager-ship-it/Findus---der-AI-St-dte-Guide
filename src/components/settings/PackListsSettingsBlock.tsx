/**
 * Gespeicherte Packlisten + Reisende — unter Einstellungen / Reisebüro.
 * Alter: genannt / optional Monat·Jahr — kein Geburtstags-Zwang.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePackListStore } from '../../store/usePackListStore';
import { formatTravelerAgeHint } from '../../module2/timeline/packListPersons';
import { colors, spacing } from '../../constants/theme';

export function PackListsSettingsBlock() {
  const lists = usePackListStore((s) => s.lists);
  const travelers = usePackListStore((s) => s.travelers);
  const hydrated = usePackListStore((s) => s.hydrated);
  const hydrate = usePackListStore((s) => s.hydrate);
  const openOverlay = usePackListStore((s) => s.openOverlay);
  const deleteList = usePackListStore((s) => s.deleteList);
  const removeTraveler = usePackListStore((s) => s.removeTraveler);
  const [open, setOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const newestFirst = [...lists].sort((a, b) => b.createdAtMs - a.createdAtMs);
  const people = [...travelers].sort((a, b) => b.updatedAtMs - a.updatedAtMs);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.title}>Packlisten</Text>
        <Text style={styles.chev}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {newestFirst.length === 0 ? (
            <Text style={styles.empty}>
              Noch keine gespeicherte Packliste. Sag Yorro einfach „Packliste“ —
              sie bleibt hier.
            </Text>
          ) : (
            newestFirst.map((list) => {
              const done = list.items.filter((i) => i.done).length;
              const who =
                list.persons && list.persons.length >= 2
                  ? ` · ${list.persons.map((p) => p.name).slice(0, 3).join(', ')}`
                  : '';
              return (
                <View key={list.id} style={styles.row}>
                  <Pressable
                    style={styles.rowMain}
                    onPress={() => openOverlay(list.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${list.title} öffnen`}
                  >
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {list.title}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {done}/{list.items.length} erledigt
                      {list.destHint ? ` · ${list.destHint}` : ''}
                      {who}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => deleteList(list.id)}
                    hitSlop={8}
                    accessibilityLabel="Packliste löschen"
                  >
                    <Text style={styles.del}>Löschen</Text>
                  </Pressable>
                </View>
              );
            })
          )}

          <Pressable
            onPress={() => setPeopleOpen((v) => !v)}
            style={styles.peopleHead}
            accessibilityRole="button"
          >
            <Text style={styles.peopleTitle}>
              Reisende ({people.length})
            </Text>
            <Text style={styles.chev}>{peopleOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {peopleOpen ? (
            <View style={styles.peopleBody}>
              {people.length === 0 ? (
                <Text style={styles.empty}>
                  Noch niemand gespeichert. Beispiel: „Packliste für Papa und
                  beide Kinder — Kind ist 11“ oder optional „geboren im März“.
                </Text>
              ) : (
                people.map((p) => (
                  <View key={p.id} style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle}>
                        {p.name}
                        <Text style={styles.role}>
                          {' '}
                          ·{' '}
                          {p.role === 'child'
                            ? 'Kind'
                            : p.role === 'partner'
                              ? 'Partner'
                              : p.role === 'self'
                                ? 'Ich'
                                : 'Person'}
                        </Text>
                      </Text>
                      <Text style={styles.rowMeta}>
                        {formatTravelerAgeHint(p)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => removeTraveler(p.id)}
                      hitSlop={8}
                      accessibilityLabel={`${p.name} entfernen`}
                    >
                      <Text style={styles.del}>Weg</Text>
                    </Pressable>
                  </View>
                ))
              )}
              <Text style={styles.ageNote}>
                Geburtstag ist freiwillig — „ist 11“ reicht, oder nur Monat /
                Jahrgang. Yorro rechnet zum Reisetermin hoch.
              </Text>
            </View>
          ) : null}

          <Text style={styles.hint}>
            Live: „Führ mich durch die Packliste.“ Dann „mach ich später“, „habe
            3, das langt“, „ist wichtig, erinner mich“ oder „was fehlt noch?“
          </Text>
        </View>
      ) : newestFirst.length > 0 || people.length > 0 ? (
        <Text style={styles.collapsed}>
          {newestFirst.length} Listen
          {people.length > 0 ? ` · ${people.length} Reisende` : ''}
          {newestFirst[0] ? ` · zuletzt ${newestFirst[0].title}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  chev: { color: colors.textMuted, fontSize: 16 },
  body: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
  empty: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  role: { color: colors.textMuted, fontWeight: '500', fontSize: 13 },
  del: { color: '#e07a6a', fontSize: 13 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  collapsed: {
    color: colors.textMuted,
    fontSize: 12,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  peopleHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  peopleTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  peopleBody: { gap: 4, marginTop: 4 },
  ageNote: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
});
