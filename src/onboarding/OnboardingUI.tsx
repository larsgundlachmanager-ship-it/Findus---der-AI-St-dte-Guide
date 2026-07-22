import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, spacing } from '../constants/theme';

export function OnboardingShell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.shell, style]}>{children}</View>;
}

export function StepTitle({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function StepSubtitle({ children }: { children: string }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.primaryBtn, disabled && styles.primaryBtnDisabled]}
      accessibilityRole="button"
    >
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.secondaryBtn}
      accessibilityRole="button"
    >
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  emoji,
  label,
  selected,
  onPress,
  onInfo,
}: {
  emoji: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  onInfo?: () => void;
}) {
  return (
    <View style={[styles.chipWrap, selected && styles.chipSelected]}>
      <Pressable onPress={onPress} style={styles.chipMain}>
        <Text style={styles.chipEmoji}>{emoji}</Text>
        <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
          {label}
        </Text>
      </Pressable>
      {onInfo ? (
        <Pressable
          onPress={onInfo}
          style={styles.infoBtn}
          hitSlop={8}
          accessibilityLabel="Info"
        >
          <Text style={styles.infoText}>i</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  secondaryBtnText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  chipWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 180,
  },
  chipEmoji: {
    fontSize: 16,
  },
  chipLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  chipLabelSelected: {
    color: colors.accent,
  },
  infoBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    fontStyle: 'italic',
  },
});
