import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  /** Optionaler Hinweis statt der Standard-Meldung */
  subtitle?: string;
}

const DEFAULT_SUBTITLE = 'Schreib deine Frage an Findus.';

export function QuestionModal({
  visible,
  onClose,
  onSubmit,
  subtitle = DEFAULT_SUBTITLE,
}: Props) {
  const [text, setText] = useState('');

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    onSubmit(trimmed);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Frage an Findus</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="z. B. Seit wann gibt es den Bahnhof?"
            placeholderTextColor={colors.textMuted}
            multiline
            autoFocus
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.secondary}>
              <Text style={styles.secondaryText}>Abbrechen</Text>
            </Pressable>
            <Pressable onPress={handleSubmit} style={styles.primary}>
              <Text style={styles.primaryText}>Fragen</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: 18,
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.sm,
    color: colors.text,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  secondaryText: {
    color: colors.textMuted,
    fontSize: 15,
  },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  primaryText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 15,
  },
});
