import React, { createContext, useContext } from 'react';
import {
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import {
  ONBOARDING_METRICS,
  onboardingDensityForAge,
  type OnboardingDensity,
} from './onboardingDensity';

const DensityCtx = createContext<OnboardingDensity>('compact');

export function OnboardingDensityProvider({
  age,
  density,
  children,
}: {
  age?: number | null;
  density?: OnboardingDensity;
  children: React.ReactNode;
}) {
  const value = density ?? onboardingDensityForAge(age);
  return <DensityCtx.Provider value={value}>{children}</DensityCtx.Provider>;
}

export function useOnboardingDensity(): OnboardingDensity {
  return useContext(DensityCtx);
}

/** Top-Inset inkl. Android-Fallback (Uhr/Statusleiste), wenn SafeArea 0 meldet. */
export function useOnboardingSafePad(): { top: number; bottom: number } {
  const insets = useSafeAreaInsets();
  const androidStatus =
    Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
  // Nothing Phone / edge-to-edge: oft insets.top === 0 → harte Untergrenze unter der Uhr
  const floor = Platform.OS === 'android' ? 52 : 28;
  return {
    top: Math.max(insets.top, androidStatus, floor),
    bottom: Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 0),
  };
}

export function OnboardingShell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { top, bottom } = useOnboardingSafePad();
  return (
    <View
      style={[
        styles.shell,
        {
          paddingTop: top + spacing.md,
          paddingBottom: bottom + spacing.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function StepTitle({ children }: { children: string }) {
  const d = useOnboardingDensity();
  const m = ONBOARDING_METRICS[d];
  return (
    <Text style={[styles.title, { fontSize: m.title }]}>{children}</Text>
  );
}

export function StepSubtitle({ children }: { children: string }) {
  const d = useOnboardingDensity();
  const m = ONBOARDING_METRICS[d];
  return (
    <Text
      style={[
        styles.subtitle,
        { fontSize: m.subtitle, lineHeight: m.subtitleLine },
      ]}
    >
      {children}
    </Text>
  );
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
  const d = useOnboardingDensity();
  const m = ONBOARDING_METRICS[d];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.primaryBtn,
        { paddingVertical: m.primaryPadV },
        disabled && styles.primaryBtnDisabled,
      ]}
      accessibilityRole="button"
    >
      <Text style={[styles.primaryBtnText, { fontSize: m.primaryFont }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SecondaryButton({
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
      style={[styles.secondaryBtn, disabled && { opacity: 0.45 }]}
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
  const d = useOnboardingDensity();
  const m = ONBOARDING_METRICS[d];
  return (
    <View
      style={[
        styles.chipWrap,
        {
          paddingVertical: m.chipPadV,
          paddingLeft: m.chipPadH,
        },
        selected && styles.chipSelected,
      ]}
    >
      <Pressable onPress={onPress} style={styles.chipMain}>
        <Text style={[styles.chipEmoji, { fontSize: m.chipEmoji }]}>
          {emoji}
        </Text>
        <Text
          style={[
            styles.chipLabel,
            { fontSize: m.chipFont },
            selected && styles.chipLabelSelected,
          ]}
        >
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
  },
  title: {
    color: colors.text,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: colors.bg,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  secondaryBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  chipWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: 6,
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
  chipEmoji: {},
  chipLabel: {
    color: colors.text,
    fontWeight: '600',
  },
  chipLabelSelected: {
    color: colors.accent,
  },
  infoBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    fontStyle: 'italic',
  },
});
