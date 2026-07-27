import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

async function pulse(
  style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium,
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Haptics.impactAsync(style);
  } catch {
    // Sensors / haptics unavailable — ignore
  }
}

/** New destination or waypoint set. */
export function hapticNavTargetSet(): void {
  void pulse(Haptics.ImpactFeedbackStyle.Medium);
}

/** Turn coming up soon. */
export function hapticTurnImminent(): void {
  void pulse(Haptics.ImpactFeedbackStyle.Heavy);
}

/** Spontaneous attention cue (look left/right). */
export function hapticAttentionCue(): void {
  void pulse(Haptics.ImpactFeedbackStyle.Light);
}

export type HapticPulseKind = 'single' | 'double' | 'heavy';

/** Generischer Pulse — u. a. Transit „nächste Station“. */
export function triggerHapticPulse(kind: HapticPulseKind = 'single'): void {
  if (kind === 'heavy') {
    void pulse(Haptics.ImpactFeedbackStyle.Heavy);
    return;
  }
  if (kind === 'double') {
    void (async () => {
      await pulse(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((r) => setTimeout(r, 140));
      await pulse(Haptics.ImpactFeedbackStyle.Medium);
    })();
    return;
  }
  void pulse(Haptics.ImpactFeedbackStyle.Medium);
}
