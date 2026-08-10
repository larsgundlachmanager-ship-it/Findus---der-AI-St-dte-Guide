import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import { AFFILIATE_DISCLOSURE_SHORT } from '../../constants/legal';
import {
  HELP_TOPIC_GROUPS,
  allHelpEntries,
  helpEntryBody,
  helpEntrySearchBlob,
  type HelpEntry,
  type HelpTopicGroup,
} from '../../constants/helpCatalog';
import { SwipeBackView } from '../SwipeBackView';
import {
  FEATURE_TIP_IDS,
  FEATURE_TIP_PROMPT,
  getCachedFeatureTipState,
  loadFeatureTipState,
} from '../../services/ai/featureTips';

type Props = {
  visible: boolean;
  onClose: () => void;
  embedded?: boolean;
  bare?: boolean;
  extraEntries?: HelpEntry[];
  extraGroups?: HelpTopicGroup[];
};

function normalizeSearch(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Legacy-Export für ältere Aufrufer. */
export const HELP_GUIDE_SECTIONS = allHelpEntries().map((e) => ({
  title: e.title,
  body: helpEntryBody(e),
  keywords: e.keywords,
}));

/**
 * Suchbarer Themen-Katalog (ohne Modal).
 */
export function HelpCatalogBrowser({
  extraEntries = [],
  extraGroups = [],
  showLead = true,
}: {
  extraEntries?: HelpEntry[];
  extraGroups?: HelpTopicGroup[];
  showLead?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [activeGroupId, setActiveGroupId] = useState<string | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [tipTick, setTipTick] = useState(0);

  useEffect(() => {
    void loadFeatureTipState().then(() => setTipTick((n) => n + 1));
  }, []);

  const checklist = useMemo(() => {
    void tipTick;
    const state = getCachedFeatureTipState();
    return FEATURE_TIP_IDS.map((id) => ({
      id,
      done: state.completed.includes(id),
      label: FEATURE_TIP_PROMPT[id].split(':')[0] ?? id,
    }));
  }, [tipTick]);

  const groups = useMemo(
    () => [...extraGroups, ...HELP_TOPIC_GROUPS],
    [extraGroups],
  );

  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    const pool =
      activeGroupId === 'all'
        ? [...extraEntries, ...allHelpEntries()]
        : [
            ...(extraGroups.find((g) => g.id === activeGroupId)?.entries ?? []),
            ...(HELP_TOPIC_GROUPS.find((g) => g.id === activeGroupId)?.entries ??
              []),
          ];

    if (!q) return pool;
    return pool.filter((e) =>
      normalizeSearch(helpEntrySearchBlob(e)).includes(q),
    );
  }, [query, activeGroupId, extraEntries, extraGroups]);

  return (
    <View style={styles.browser}>
      {showLead ? (
        <Text style={styles.lead}>
          Module & Gesten: Was · Wie · Optimal. Coach-Hinweise auf dem Homescreen
          verschwinden nach dem ersten erfolgreichen Test. Verbal: nach einem
          Vorschlag 3× Pause, beim 4. Mal wieder Erinnerung — bis du es einmal
          gemacht hast.
        </Text>
      ) : null}

      {showLead ? (
        <View style={styles.checkBox}>
          <Text style={styles.checkTitle}>Checkliste (abgehakt = nie wieder)</Text>
          {checklist.map((row) => (
            <Text key={row.id} style={styles.checkRow}>
              {row.done ? '✓' : '○'} {row.label}
            </Text>
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Schnell finden… z. B. Planung, Mikrofon, Leave-by"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <Pressable
          onPress={() => setActiveGroupId('all')}
          style={[
            styles.topicChip,
            activeGroupId === 'all' && styles.topicChipOn,
          ]}
        >
          <Text
            style={[
              styles.topicChipText,
              activeGroupId === 'all' && styles.topicChipTextOn,
            ]}
          >
            Alle
          </Text>
        </Pressable>
        {groups.map((g) => {
          const on = activeGroupId === g.id;
          return (
            <Pressable
              key={g.id}
              onPress={() => setActiveGroupId(g.id)}
              style={[styles.topicChip, on && styles.topicChipOn]}
            >
              <Text
                style={[styles.topicChipText, on && styles.topicChipTextOn]}
              >
                {g.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Text style={styles.count}>
        {filtered.length === 0
          ? 'Nichts gefunden'
          : `${filtered.length} ${filtered.length === 1 ? 'Eintrag' : 'Einträge'}`}
      </Text>

      {filtered.map((e) => {
        const open = openId === e.id;
        return (
          <Pressable
            key={e.id}
            onPress={() => setOpenId(open ? null : e.id)}
            style={[styles.card, open && styles.cardOpen]}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{e.title}</Text>
              <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
            </View>
            {!open ? (
              <Text style={styles.cardPreview} numberOfLines={2}>
                {e.what}
              </Text>
            ) : (
              <View style={styles.cardBody}>
                <Text style={styles.blockLabel}>Was</Text>
                <Text style={styles.blockText}>{e.what}</Text>
                <Text style={styles.blockLabel}>Wie</Text>
                <Text style={styles.blockText}>{e.how}</Text>
                <Text style={styles.blockLabel}>Optimal</Text>
                <Text style={styles.blockText}>{e.optimal}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function HelpGuideView({
  visible,
  onClose,
  embedded = false,
  bare = false,
  extraEntries = [],
  extraGroups = [],
}: Props) {
  if (!visible) return null;

  const browser = (
    <HelpCatalogBrowser
      extraEntries={extraEntries}
      extraGroups={extraGroups}
      showLead={!bare}
    />
  );

  const body = bare ? (
    browser
  ) : (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <SwipeBackView enabled={visible} onBack={onClose}>
        <View style={styles.header}>
          <Text style={styles.title}>Erklärungen & Tools</Text>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={styles.close}>Schließen</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {browser}
          <Text style={styles.affiliate}>{AFFILIATE_DISCLOSURE_SHORT}</Text>
        </ScrollView>
      </SwipeBackView>
    </SafeAreaView>
  );

  if (embedded || bare) {
    return <View style={styles.embedded}>{body}</View>;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      {body}
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  embedded: { flex: 1, backgroundColor: colors.bg },
  browser: { gap: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  close: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  lead: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  checkBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.sm,
    gap: 4,
    backgroundColor: colors.surface,
  },
  checkTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  checkRow: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    backgroundColor: colors.surface,
  },
  chipRow: { gap: 8, paddingVertical: 4 },
  topicChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  topicChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  topicChipText: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  topicChipTextOn: { color: colors.text },
  count: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardOpen: { borderColor: colors.accent },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    fontSize: 15,
  },
  chevron: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
  cardPreview: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  cardBody: { marginTop: 10, gap: 4 },
  blockLabel: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  blockText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  affiliate: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
});
