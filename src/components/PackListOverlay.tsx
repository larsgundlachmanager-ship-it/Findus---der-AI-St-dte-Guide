/**
 * Packlisten-Overlay — abhakbare Punkte (Chrome-Lane).
 * Sort: Prio (rot) → offen (blau) → erledigt (grün).
 * Optional: Reiter pro Person + Gemeinsam.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePackListStore, type PackListItem } from '../store/usePackListStore';

const C = {
  prio: '#e86a5c',
  open: '#5aa8ff',
  done: '#6fbf6a',
};

function sortPackItems(items: PackListItem[]): PackListItem[] {
  return [...items].sort((a, b) => {
    const rank = (it: PackListItem) => {
      if (!it.done && it.priority === 'high') return 0;
      if (!it.done) return 1;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) {
      const la = a.later ? 1 : 0;
      const lb = b.later ? 1 : 0;
      if (la !== lb) return la - lb;
    }
    return 0;
  });
}

function toneFor(it: PackListItem): 'prio' | 'open' | 'done' {
  if (it.done) return 'done';
  if (it.priority === 'high') return 'prio';
  return 'open';
}

type PersonTab = 'all' | 'shared' | string;

export function PackListOverlay() {
  const visible = usePackListStore((s) => s.overlayVisible);
  const list = usePackListStore((s) => s.getActiveList());
  const close = usePackListStore((s) => s.closeOverlay);
  const toggle = usePackListStore((s) => s.toggleItem);
  const setLaundryAccess = usePackListStore((s) => s.setLaundryAccess);
  const insets = useSafeAreaInsets();
  const [personTab, setPersonTab] = useState<PersonTab>('all');

  const persons = list?.persons || [];
  const showPersonTabs = persons.length >= 2;

  useEffect(() => {
    setPersonTab('all');
  }, [list?.id]);

  const onToggle = useCallback(
    (itemId: string) => {
      if (!list) return;
      toggle(list.id, itemId);
    },
    [list, toggle],
  );

  const onLaundry = useCallback(
    (v: 'yes' | 'no') => {
      if (!list) return;
      setLaundryAccess(list.id, v);
    },
    [list, setLaundryAccess],
  );

  const filtered = useMemo(() => {
    if (!list) return [];
    if (!showPersonTabs || personTab === 'all') return list.items;
    if (personTab === 'shared') {
      return list.items.filter((it) => !it.personId);
    }
    return list.items.filter(
      (it) => !it.personId || it.personId === personTab,
    );
  }, [list, personTab, showPersonTabs]);

  const sorted = useMemo(() => sortPackItems(filtered), [filtered]);

  if (!visible || !list) return null;

  const doneN = filtered.filter((i) => i.done).length;
  const total = filtered.length;
  const openN = total - doneN;
  const laundry = list.laundryAccess || 'unknown';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(16, insets.bottom + 8) },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{list.title}</Text>
              <Text style={styles.sub}>
                {openN} offen · {doneN}/{total} erledigt
                {list.weatherNote ? ` · ${list.weatherNote}` : ''}
              </Text>
            </View>
            <Pressable onPress={close} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeTxt}>Schließen</Text>
            </Pressable>
          </View>

          {showPersonTabs ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.personScroll}
              contentContainerStyle={styles.personTabs}
            >
              <Pressable
                onPress={() => setPersonTab('all')}
                style={[
                  styles.personTab,
                  personTab === 'all' && styles.personTabOn,
                ]}
              >
                <Text
                  style={[
                    styles.personTabTxt,
                    personTab === 'all' && styles.personTabTxtOn,
                  ]}
                >
                  Alle
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setPersonTab('shared')}
                style={[
                  styles.personTab,
                  personTab === 'shared' && styles.personTabOn,
                ]}
              >
                <Text
                  style={[
                    styles.personTabTxt,
                    personTab === 'shared' && styles.personTabTxtOn,
                  ]}
                >
                  Gemeinsam
                </Text>
              </Pressable>
              {persons.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setPersonTab(p.id)}
                  style={[
                    styles.personTab,
                    personTab === p.id && styles.personTabOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.personTabTxt,
                      personTab === p.id && styles.personTabTxtOn,
                    ]}
                  >
                    {p.name}
                    {p.ageAtTrip != null ? ` · ${p.ageAtTrip} J.` : ''}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.laundryBar}>
            <Text style={styles.laundryLabel}>Waschmaschine</Text>
            <View style={styles.laundryTabs}>
              <Pressable
                onPress={() => onLaundry('yes')}
                style={[
                  styles.laundryTab,
                  laundry === 'yes' && styles.laundryTabOn,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: laundry === 'yes' }}
              >
                <Text
                  style={[
                    styles.laundryTabTxt,
                    laundry === 'yes' && styles.laundryTabTxtOn,
                  ]}
                >
                  Ja
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onLaundry('no')}
                style={[
                  styles.laundryTab,
                  laundry === 'no' && styles.laundryTabOnNo,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: laundry === 'no' }}
              >
                <Text
                  style={[
                    styles.laundryTabTxt,
                    laundry === 'no' && styles.laundryTabTxtOn,
                  ]}
                >
                  Nein
                </Text>
              </Pressable>
            </View>
            <Text style={styles.laundryHint}>
              {laundry === 'yes'
                ? 'Weniger Wechselwäsche'
                : laundry === 'no'
                  ? 'Volle Wechselwäsche'
                  : 'Tippen setzt Mengen neu'}
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            {sorted.map((it) => {
              const tone = toneFor(it);
              const color =
                tone === 'prio' ? C.prio : tone === 'done' ? C.done : C.open;
              const personName =
                it.personId && showPersonTabs && personTab === 'all'
                  ? persons.find((p) => p.id === it.personId)?.name
                  : null;
              return (
                <Pressable
                  key={it.id}
                  onPress={() => onToggle(it.id)}
                  style={styles.row}
                >
                  <Text style={[styles.check, { color }]}>
                    {it.done ? '☑' : '☐'}
                  </Text>
                  <View style={styles.rowBody}>
                    <Text
                      style={[
                        styles.itemLabel,
                        { color },
                        it.done && styles.itemDone,
                      ]}
                    >
                      {personName ? `${personName}: ` : ''}
                      {it.label}
                      {it.priority === 'high' && !it.done ? ' · wichtig' : ''}
                      {it.later && !it.done ? ' · später' : ''}
                    </Text>
                    {!!it.reason && !it.done ? (
                      <Text style={styles.reason}>{it.reason}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1a1f1c',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '78%',
    paddingHorizontal: 14,
    paddingTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 12,
      },
      android: { elevation: 12 },
    }),
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
    gap: 8,
  },
  title: {
    color: '#f2f5f0',
    fontSize: 18,
    fontWeight: '700',
  },
  sub: {
    color: 'rgba(242,245,240,0.65)',
    fontSize: 13,
    marginTop: 2,
  },
  closeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  closeTxt: {
    color: '#b8d4a8',
    fontSize: 14,
    fontWeight: '600',
  },
  personScroll: { flexGrow: 0, marginBottom: 6 },
  personTabs: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  personTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  personTabOn: { backgroundColor: 'rgba(90,168,255,0.35)' },
  personTabTxt: {
    color: 'rgba(242,245,240,0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  personTabTxtOn: { color: '#f2f5f0' },
  laundryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  laundryLabel: {
    color: 'rgba(242,245,240,0.85)',
    fontSize: 13,
    fontWeight: '700',
  },
  laundryTabs: { flexDirection: 'row', gap: 6 },
  laundryTab: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  laundryTabOn: { backgroundColor: 'rgba(111,191,106,0.35)' },
  laundryTabOnNo: { backgroundColor: 'rgba(232,106,92,0.3)' },
  laundryTabTxt: {
    color: 'rgba(242,245,240,0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
  laundryTabTxtOn: { color: '#f2f5f0' },
  laundryHint: {
    color: 'rgba(242,245,240,0.45)',
    fontSize: 11,
    flexGrow: 1,
  },
  scroll: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  rowBody: { flex: 1, minWidth: 0 },
  check: {
    fontSize: 17,
    lineHeight: 20,
    width: 20,
    textAlign: 'center',
  },
  itemLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  itemDone: {
    textDecorationLine: 'line-through',
    fontWeight: '500',
    opacity: 0.9,
  },
  reason: {
    color: 'rgba(242,245,240,0.45)',
    fontSize: 11,
    marginTop: 1,
  },
});
