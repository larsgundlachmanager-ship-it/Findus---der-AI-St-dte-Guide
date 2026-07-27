import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';

interface Props {
  onPressIn: () => void;
  onPressOut: () => void;
  isListening: boolean;
  isFinalizing?: boolean;
  isGenerating: boolean;
  partialText?: string;
}

export function MicButton({
  onPressIn,
  onPressOut,
  isListening,
  isFinalizing = false,
  isGenerating,
  partialText,
}: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isListening) {
      pulse.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.14,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isListening, pulse]);

  return (
    <View style={styles.wrap}>
      {(isListening || isFinalizing || partialText) && (
        <View style={styles.chatBubble}>
          <Text style={styles.partial} numberOfLines={4}>
            {partialText ||
              (isFinalizing ? 'Letzte Wörter…' : 'Ich höre zu…')}
          </Text>
        </View>
      )}

      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Pressable
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={isGenerating}
          style={[
            styles.button,
            isListening && styles.buttonActive,
            isGenerating && styles.buttonDisabled,
          ]}
          accessibilityLabel="Mikrofon – kurz tippen zum Schreiben, halten zum Sprechen"
          accessibilityState={{ busy: isListening || isGenerating }}
        >
          {isGenerating ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <View style={[styles.micCore, isListening && styles.micCoreActive]} />
          )}
        </Pressable>
      </Animated.View>

      <Text style={styles.hint}>
        {isGenerating
          ? 'Findus denkt nach…'
          : isFinalizing
            ? 'Letzte Wörter werden erkannt…'
            : isListening
              ? 'Loslassen zum Senden'
              : 'Kurz tippen zum Schreiben · Halten zum Sprechen'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  button: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  buttonActive: {
    backgroundColor: colors.danger,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  micCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bg,
  },
  micCoreActive: {
    backgroundColor: colors.text,
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  hint: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  chatBubble: {
    maxWidth: '92%',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  partial: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
});
