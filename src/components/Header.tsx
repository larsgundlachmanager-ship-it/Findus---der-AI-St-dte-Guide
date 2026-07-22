import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { useFinnusStore } from '../store/useFinnusStore';

type Props = {
  onOpenSettings?: () => void;
  /** Für Tutorials / measureInWindow */
  settingsRef?: React.RefObject<View | null>;
  settingsDisabled?: boolean;
};

export function Header({
  onOpenSettings,
  settingsRef,
  settingsDisabled,
}: Props) {
  const currentLocationName = useFinnusStore((s) => s.currentLocationName);
  const isSimulationMode = useFinnusStore((s) => s.isSimulationMode);

  return (
    <View style={styles.row}>
      <View style={styles.locationBlock}>
        <Text style={styles.label}>Standort</Text>
        <Text style={styles.location}>
          {currentLocationName ?? 'Suche Standort...'}
        </Text>
        {isSimulationMode ? (
          <Text style={styles.simBadge}>GPS-Simulation aktiv</Text>
        ) : null}
      </View>

      {onOpenSettings || settingsRef ? (
        <View ref={settingsRef} collapsable={false}>
          <Pressable
            onPress={onOpenSettings}
            disabled={settingsDisabled || !onOpenSettings}
            style={[
              styles.settingsBtn,
              (settingsDisabled || !onOpenSettings) && styles.settingsBtnDisabled,
            ]}
            accessibilityLabel="Einstellungen"
          >
            <Text style={styles.settingsIcon}>⚙️</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  locationBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  location: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 26,
    flexShrink: 1,
  },
  simBadge: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 2,
  },
  settingsBtnDisabled: {
    opacity: 0.55,
  },
  settingsIcon: {
    fontSize: 18,
  },
});
