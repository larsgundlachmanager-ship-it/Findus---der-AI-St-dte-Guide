from pathlib import Path

sp = Path(r"C:\Users\larsf\Findus 2.0\src\hooks\useSystemSafePad.ts")
tmp = Path(r"C:\Users\larsf\Findus 2.0\src\hooks\useSystemSafePad.ts.new")
tmp.write_text(
    """/**
 * System-Safe-Pad: Statusleiste / Notch / Home-Indicator.
 * Android edge-to-edge meldet oft insets.top === 0 → Floor unter Uhr/Benachrichtigungen.
 * Kurze Displays (Galaxy S7 u.ä.): niedrigerer Floor, weniger toter Luftraum oben.
 */

import { Dimensions, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ANDROID_TOP_FLOOR = 36;
const ANDROID_TOP_FLOOR_TALL = 52;
const IOS_TOP_FLOOR = 28;

export function useSystemSafePad(): { top: number; bottom: number } {
  const insets = useSafeAreaInsets();
  const androidStatus =
    Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
  const shortPhone = Dimensions.get('window').height < 720;
  const topFloor =
    Platform.OS === 'android'
      ? shortPhone
        ? ANDROID_TOP_FLOOR
        : ANDROID_TOP_FLOOR_TALL
      : IOS_TOP_FLOOR;
  return {
    top: Math.max(insets.top, androidStatus, topFloor),
    bottom: Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 0),
  };
}
""",
    encoding="utf-8",
)
print("safePad new written")
