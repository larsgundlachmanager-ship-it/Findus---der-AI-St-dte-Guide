import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';

export type InAppBrowserSheetProps = {
  visible: boolean;
  url: string;
  title?: string;
  onClose: () => void;
};

/**
 * Speisekarte / Menu in-app: Overlay-View + WebView (kein RN-Modal —
 * Android + Karte macht aus Modal oft ein kaputtes Fenster).
 */
export function InAppBrowserSheet({
  visible,
  url,
  title = 'Speisekarte',
  onClose,
}: InAppBrowserSheetProps) {
  const openExternal = useCallback(() => {
    const u = url.trim();
    if (!u) return;
    void Linking.openURL(u);
  }, [url]);

  if (!visible || !url.trim()) return null;

  return (
    <View
      style={styles.root}
      pointerEvents="auto"
      accessibilityViewIsModal
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Schließen">
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
            </View>
          )}
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
        />

        <View style={styles.footer}>
          <Pressable
            style={styles.browserBtn}
            onPress={openExternal}
            accessibilityLabel="Im Browser öffnen"
          >
            <Text style={styles.browserLabel}>Im Browser öffnen</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.sheet,
    elevation: UI_LAYER.sheet,
    backgroundColor: colors.bg,
  },
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
  title: {
    flex: 1,
    marginRight: spacing.sm,
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  close: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  web: { flex: 1, backgroundColor: colors.bg },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  footer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  browserBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  browserLabel: {
    color: colors.textMuted,
    fontWeight: '700',
    fontSize: 14,
  },
});
