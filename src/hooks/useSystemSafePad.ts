/**
 * System-Safe-Pad: Statusleiste / Notch / Home-Indicator.
 * Android edge-to-edge meldet oft insets.top === 0 → Floor unter Uhr/Benachrichtigungen.
 */

import { Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ANDROID_TOP_FLOOR = 52;
const IOS_TOP_FLOOR = 28;

export function useSystemSafePad(): { top: number; bottom: number } {
  const insets = useSafeAreaInsets();
  const androidStatus =
    Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
  const topFloor = Platform.OS === 'android' ? ANDROID_TOP_FLOOR : IOS_TOP_FLOOR;
  return {
    top: Math.max(insets.top, androidStatus, topFloor),
    bottom: Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 0),
  };
}
