import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../constants/theme';
import {
  AFFILIATE_DISCLOSURE_SHORT,
  LEGAL_CHAPTERS,
  type LegalChapterId,
} from '../../constants/legal';
import { SwipeBackView } from '../SwipeBackView';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Optional: Fokus auf ein Kapitel */
  initialChapterId?: LegalChapterId;
  /**
   * true = kein eigener Modal (z. B. innerhalb Einstellungen).
   * Vermeidet Android-Bug: Nested Modals → nur Abdunkelung, kein Inhalt.
   */
  embedded?: boolean;
};

/**
 * Modularer Recht-Screen: Impressum, Datenschutz, KI-Transparenz, Affiliate.
 * Kapitel starten zugeklappt — nichts vorauswählen.
 */
export function LegalView({
  visible,
  onClose,
  initialChapterId,
  embedded = false,
}: Props) {
  const [openId, setOpenId] = useState<LegalChapterId | null>(null);

  useEffect(() => {
    if (visible) {
      setOpenId(initialChapterId ?? null);
    }
  }, [visible, initialChapterId]);

  if (!visible) return null;

  const body = (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <SwipeBackView enabled={visible} onBack={onClose}>
        <View style={styles.header}>
          <Text style={styles.title}>Datenschutz & Impressum</Text>
          <Pressable onPress={onClose} accessibilityRole="button">
            <Text style={styles.close}>Schließen</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.intro}>
            Hier findest du alle Pflichtangaben zu Verantwortlichem,
            Datenverarbeitung, KI-Einsatz und Partner-Links.
          </Text>

          {LEGAL_CHAPTERS.map((ch) => {
            const open = openId === ch.id;
            return (
              <View key={ch.id} style={styles.chapter}>
                <Pressable
                  onPress={() => setOpenId(open ? null : ch.id)}
                  style={styles.chapterHeader}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                >
                  <Text style={styles.chapterTitle}>{ch.title}</Text>
                  <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
                </Pressable>
                {open ? (
                  <Text style={styles.chapterBody}>{ch.body}</Text>
                ) : null}
              </View>
            );
          })}

          <Text style={styles.footerNote}>{AFFILIATE_DISCLOSURE_SHORT}</Text>
        </ScrollView>
      </SwipeBackView>
    </SafeAreaView>
  );

  if (embedded) {
    return <View style={styles.embeddedRoot}>{body}</View>;
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent={Platform.OS === 'android'}
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>{body}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  embeddedRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    zIndex: 40,
    elevation: 40,
  },
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  close: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  body: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.sm,
  },
  intro: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.md,
  },
  chapter: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  chapterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  chapterTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginRight: spacing.sm,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 16,
  },
  chapterBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  footerNote: {
    marginTop: spacing.lg,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },
});
