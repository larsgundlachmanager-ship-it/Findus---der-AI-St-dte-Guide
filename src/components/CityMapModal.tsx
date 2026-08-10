import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
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

function isInlineImage(url: string): boolean {
  return /^data:image\//i.test(url) || /\.(jpe?g|png|webp)(\?|$)/i.test(url);
}

/**
 * Interaktive Stadt-/Inselkarte (WebView) oder Street-View-Bild (Image).
 */
export const CityMapModal = React.memo(function CityMapModal({
  visible,
  onClose,
  url,
  title = 'Inselkarte',
}: CityMapModalProps) {
  if (!url) return null;

  const imageMode = isInlineImage(url);
  const isStreetView = imageMode || /street.?view/i.test(title);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.sub}>
              {isStreetView
                ? 'Street View · Zur Orientierung'
                : 'Offizielle Karte · Pinch zum Zoomen'}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel="Schließen"
          >
            <Text style={styles.close}>Schließen</Text>
          </Pressable>
        </View>

        {imageMode ? (
          <ScrollView
            style={styles.web}
            contentContainerStyle={styles.imageWrap}
            maximumZoomScale={3}
            minimumZoomScale={1}
          >
            <Image
              source={{ uri: url }}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel={title}
            />
          </ScrollView>
        ) : (
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
        )}
      </SafeAreaView>
    </Modal>
  );
});

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
  imageWrap: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  image: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    backgroundColor: '#111',
  },
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
