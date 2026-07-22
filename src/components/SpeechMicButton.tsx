import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../constants/theme';

type Props = {
  active: boolean;
  onPress: () => void;
};

export function SpeechMicButton({ active, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.btn, active && styles.btnActive]}
      accessibilityRole="button"
      accessibilityLabel={
        active ? 'Diktat beenden' : 'Per Sprache eingeben'
      }
    >
      <Feather
        name={active ? 'square' : 'mic'}
        size={20}
        color={active ? colors.bg : colors.accent}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnActive: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
});
