import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  /** Optionaler Hinweis statt der Standard-Meldung */
  subtitle?: string;
}

const DEFAULT_SUBTITLE = 'Schreib deine Frage an Yorro.';

/**
 * Tippen-Frage nach Mic-Kurz-Tipp.
 * Overlay-View (kein RN-Modal): Android + Karten-WebView macht aus
 * `<Modal transparent>` oft ein winziges Fenster oben rechts.
 */
export function QuestionModal({
  visible,
  onClose,
  onSubmit,
  subtitle = DEFAULT_SUBTITLE,
}: Props) {
  const insets = useSafeAreaInsets();
  const kbInset = useKeyboardInset();
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) {
      setText('');
      Keyboard.dismiss();
      return;
    }
    // Autofocus leicht verzögern — sonst öffnet/schließt die Tastatur auf Android kurz.
    const id = setTimeout(() => {
      inputRef.current?.focus();
    }, 60);
    return () => clearTimeout(id);
  }, [visible]);

  if (!visible) return null;

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    onSubmit(trimmed);
    onClose();
  }

  // Tastatur + Extra-Gap — sonst klebt „Fragen“ unter der Soft-Keyboard-Leiste.
  const padBottom =
    kbInset > 40
      ? kbInset + spacing.md
      : Math.max(insets.bottom, spacing.md) + spacing.sm;

  return (
    <View
      pointerEvents="box-none"
      style={styles.root}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel="Tippfeld schließen"
      />
      <View
        style={[styles.sheetWrap, { paddingBottom: padBottom }]}
        pointerEvents="box-none"
      >
        <View style={styles.card} pointerEvents="auto">
          <Text style={styles.title}>Frage an Yorro</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {/* Buttons über dem Feld — bleiben über der Tastatur tippbar. */}
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.secondary}>
              <Text style={styles.secondaryText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              style={styles.primary}
              testID="findusAskSubmit"
              accessibilityLabel="Fragen"
            >
              <Text style={styles.primaryText}>Fragen</Text>
            </Pressable>
          </View>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="z. B. Seit wann gibt es den Bahnhof?"
            placeholderTextColor={colors.textMuted}
            multiline={false}
            autoFocus={false}
            blurOnSubmit
            returnKeyType="send"
            submitBehavior="submit"
            enablesReturnKeyAutomatically
            onSubmitEditing={handleSubmit}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === 'Enter') handleSubmit();
            }}
            testID="findusAskInput"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.askSheet,
    elevation: UI_LAYER.askSheet,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheetWrap: {
    width: '100%',
  },
  card: {
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    marginTop: 6,
    marginBottom: spacing.sm,
    lineHeight: 21,
  },
  input: {
    minHeight: 56,
    fontSize: 17,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    textAlignVertical: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  secondary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryText: {
    color: colors.textMuted,
    fontSize: 16,
  },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 22,
    minHeight: 44,
    justifyContent: 'center',
  },
  primaryText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 16,
  },
});
