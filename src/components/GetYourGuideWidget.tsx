import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import {
  buildGetYourGuideTourUrl,
  openGetYourGuideTour,
  type GygWidgetOptions,
} from '../services/affiliate/affiliateService';
import { confirmAffiliateRedirectIfNeeded } from '../services/affiliate/affiliateDisclosure';

export type GetYourGuideWidgetProps = {
  visible: boolean;
  onClose: () => void;
  options?: GygWidgetOptions;
  title?: string;
};

/**
 * GetYourGuide: öffnet Partner-Angebote im Browser.
 * Transparenz: Kennzeichnung „Anzeige“ + einmaliger Hinweis beim Öffnen.
 */
export function GetYourGuideWidget({
  visible,
  onClose,
  options,
  title = 'Tickets & Touren',
}: GetYourGuideWidgetProps) {
  const openBrowser = async () => {
    const proceed = await confirmAffiliateRedirectIfNeeded();
    if (!proceed) return;
    const slug = options?.tourUrlOrSlug;
    if (slug) {
      void openGetYourGuideTour(slug);
      return;
    }
    const loc = options?.locationId
      ? buildGetYourGuideTourUrl(`l${options.locationId}`)
      : buildGetYourGuideTourUrl('');
    void openGetYourGuideTour(loc.replace(/^https?:\/\/[^/]+\//i, ''));
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.anzeige}>Anzeige · GetYourGuide</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Schließen</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          <Text style={styles.lead}>
            Passende Touren und Tickets bei GetYourGuide — Preis für dich
            unverändert.
          </Text>
          <Pressable
            style={styles.browserBtn}
            onPress={() => void openBrowser()}
          >
            <Text style={styles.browserLabel}>Angebote öffnen</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  titleBlock: { flex: 1, marginRight: spacing.sm },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  anzeige: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  close: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  lead: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  browserBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  browserLabel: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 15,
  },
});
