/**
 * Dünner Settings-Einstieg: Chrome sofort, schweres Modul on-demand.
 * Idle-Prefetch holt SettingsScreen.ts, ohne den Baum zu mounten.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { t } from '../i18n';
import type {
  SettingsScreenHandle,
  SettingsScreenProps,
} from './SettingsScreen';

type InnerCmp = React.ForwardRefExoticComponent<
  SettingsScreenProps & React.RefAttributes<SettingsScreenHandle>
>;

let cachedInner: InnerCmp | null = null;

export function prefetchSettingsScreen(): void {
  void loadInner();
}

function loadInner(): Promise<InnerCmp> {
  if (cachedInner) return Promise.resolve(cachedInner);
  return import('./SettingsScreen').then((m) => {
    cachedInner = m.SettingsScreen as InnerCmp;
    return cachedInner;
  });
}

export const SettingsScreenLazy = React.forwardRef<
  SettingsScreenHandle,
  SettingsScreenProps
>(function SettingsScreenLazy(props, ref) {
  const [Inner, setInner] = useState<InnerCmp | null>(() => cachedInner);

  useEffect(() => {
    if (Inner) return;
    void loadInner().then((cmp) => setInner(() => cmp));
  }, [Inner, props.visible]);

  if (!props.visible) {
    if (!cachedInner && !Inner) return null;
    if (!Inner) return null;
    return <Inner {...props} ref={ref} />;
  }
  if (!Inner) {
    return (
      <View style={styles.overlay} pointerEvents="auto">
        <SafeAreaView style={styles.safe} edges={['bottom']}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {t(props.profile.language, 'settings')}
            </Text>
            <Pressable onPress={props.onClose}>
              <Text style={styles.close}>
                {t(props.profile.language, 'close')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.body}>
            <ActivityIndicator color={colors.accent} />
          </View>
        </SafeAreaView>
      </View>
    );
  }
  return <Inner {...props} ref={ref} />;
});

export const SettingsScreen = SettingsScreenLazy;

// Sobald HomeOverlayHost lädt: Bundle-Parse starten (vor erstem Tap).
void loadInner();

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay,
    backgroundColor: colors.bg,
  },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  close: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
