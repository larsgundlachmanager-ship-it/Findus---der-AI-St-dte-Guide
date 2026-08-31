/**
 * Standard-Social-Login — Google weiß, Apple schwarz, wie in anderen Apps.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { spacing } from '../../constants/theme';

type Props = {
  onGoogle: () => void;
  onApple: () => void;
  busy?: boolean;
};

export function SocialAuthButtons({ onGoogle, onApple, busy }: Props) {
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onGoogle}
        disabled={!!busy}
        style={[styles.btn, styles.google, busy && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel="Mit Google anmelden"
      >
        <FontAwesome name="google" size={18} color="#4285F4" />
        <Text style={styles.googleText}>Mit Google anmelden</Text>
      </Pressable>
      <Pressable
        onPress={onApple}
        disabled={!!busy}
        style={[styles.btn, styles.apple, busy && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel="Mit Apple anmelden"
      >
        <FontAwesome name="apple" size={20} color="#FFFFFF" />
        <Text style={styles.appleText}>Mit Apple anmelden</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  btn: {
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  google: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DADCE0',
  },
  googleText: {
    color: '#1F1F1F',
    fontSize: 16,
    fontWeight: '600',
  },
  apple: {
    backgroundColor: '#000000',
  },
  appleText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  disabled: { opacity: 0.45 },
});
