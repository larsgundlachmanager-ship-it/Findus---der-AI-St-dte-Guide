/**
 * App-eigener Standort-Hinweis (Google Play Prominent Disclosure)
 * — erscheint VOR dem Android/iOS-Systemdialog.
 * Overlay statt RN-Modal (Android: oft nur Abdunkelung / Fragmente).
 */

import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import {
  LOCATION_DISCLOSURE_COPY,
  markLocationDisclosureAccepted,
  registerLocationDisclosurePresenter,
  type LocationDisclosureKind,
  type LocationDisclosureResult,
} from '../services/location/locationProminentDisclosure';

type Pending = {
  kind: LocationDisclosureKind;
  resolve: (result: LocationDisclosureResult) => void;
};

/**
 * Einmal in App.tsx mounten — registriert den Presenter für locationService.
 */
export function LocationProminentDisclosureHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    registerLocationDisclosurePresenter(({ kind }) => {
      return new Promise<LocationDisclosureResult>((resolve) => {
        setPending({ kind, resolve });
      });
    });
    return () => {
      registerLocationDisclosurePresenter(null);
    };
  }, []);

  const finish = (result: LocationDisclosureResult) => {
    if (!pending) return;
    if (result === 'accepted') markLocationDisclosureAccepted();
    pending.resolve(result);
    setPending(null);
  };

  if (!pending) return null;

  const copy = LOCATION_DISCLOSURE_COPY[pending.kind];

  return (
    <View
      style={styles.overlay}
      pointerEvents="auto"
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdropHit}
        onPress={() => finish('declined')}
        accessibilityLabel="Nicht jetzt"
      />
      <View style={styles.centerWrap} pointerEvents="box-none">
        <View
          style={styles.card}
          accessibilityRole="summary"
          accessibilityLabel={copy.title}
        >
          <Text style={styles.eyebrow}>Berechtigung</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>

          <View style={styles.actions}>
            <Pressable
              onPress={() => finish('declined')}
              style={styles.secondary}
              accessibilityRole="button"
              accessibilityLabel="Nicht jetzt"
            >
              <Text style={styles.secondaryText}>Nicht jetzt</Text>
            </Pressable>
            <Pressable
              onPress={() => finish('accepted')}
              style={styles.primary}
              accessibilityRole="button"
              accessibilityLabel="Weiter"
            >
              <Text style={styles.primaryText}>Weiter</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay + 30,
    elevation: UI_LAYER.overlay + 30,
  },
  backdropHit: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: 18,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  secondary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  secondaryText: {
    color: colors.textMuted,
    fontWeight: '600',
    fontSize: 15,
  },
  primary: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  primaryText: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 15,
  },
});
