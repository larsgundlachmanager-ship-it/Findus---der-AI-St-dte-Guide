/**
 * Moderner Info-Sheet für Onboarding-Optionen (statt Alert.alert).
 */

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';

type Props = {
  visible: boolean;
  title: string;
  body: string;
  onClose: () => void;
};

export function OnboardingInfoSheet({
  visible,
  title,
  body,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { marginBottom: Math.max(insets.bottom, spacing.xl) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.kicker}>Info</Text>
          <Text style={styles.title}>{title}</Text>
          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyScrollContent}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.body}>{body}</Text>
          </ScrollView>
          <Pressable style={styles.btn} onPress={onClose}>
            <Text style={styles.btnLabel}>Verstanden</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 10, 14, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.xl,
    maxHeight: '78%',
    borderRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    backgroundColor: '#1A1F28',
    borderWidth: 1,
    borderColor: 'rgba(196, 163, 90, 0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: spacing.md,
  },
  kicker: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  bodyScroll: {
    flexGrow: 0,
    maxHeight: 320,
    marginBottom: spacing.lg,
  },
  bodyScrollContent: {
    flexGrow: 0,
  },
  body: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 15,
    lineHeight: 22,
  },
  btn: {
    alignSelf: 'stretch',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  btnLabel: {
    color: '#1A1408',
    fontWeight: '800',
    fontSize: 15,
  },
});
