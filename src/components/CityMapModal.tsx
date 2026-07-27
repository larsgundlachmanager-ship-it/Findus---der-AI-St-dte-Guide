import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { colors, spacing } from '../constants/theme';

export type CityMapModalProps = {
  visible: boolean;
  onClose: () => void;
  url?: string;
  title?: string;
};

/**
 * Interaktive Stadt-/Inselkarte im Vollbild (WebView).
 */
export function CityMapModal({
  visible,
  onClose,
  url,
  title = 'Inselkarte',
}: CityMapModalProps) {
  if (!url) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.sub}>Offizielle Karte · Pinch zum Zoomen</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Karte schließen">
            <Text style={styles.close}>Schließen</Text>
          </Pressable>
        </View>

        <WebView
          source={{ uri: url }}
          style={styles.web}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.loadingText}>Karte wird geladen…</Text>
            </View>
          )}
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
        />
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
  sub: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 11,
  },
  close: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  web: { flex: 1, backgroundColor: colors.bg },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    gap: spacing.sm,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
