# patch remaining setup UX fixes
from pathlib import Path

# --- userProfile: cityMobilityModes ---
up = Path(r"C:\Users\larsf\Findus 2.0\src\types\userProfile.ts")
ut = up.read_text(encoding="utf-8")
if "cityMobilityModes" not in ut:
    ut = ut.replace(
        "  /** Primäre Mobilität (First-Class, überschreibt Experience-Swipes). */\n  mobilityMode?: MobilityMode | null;\n",
        "  /** Primäre Mobilität (First-Class, überschreibt Experience-Swipes). */\n  mobilityMode?: MobilityMode | null;\n  /** In-Stadt-Mobilität Mehrfach (Fuß/Rad/ÖPNV/Auto). */\n  cityMobilityModes?: MobilityMode[];\n",
    )
    ut = ut.replace(
        "    mobilityMode: null,\n    travelModes: [],\n",
        "    mobilityMode: null,\n    cityMobilityModes: [],\n    travelModes: [],\n",
    )
    up.write_text(ut, encoding="utf-8")
    print("userProfile OK")
else:
    print("userProfile skip")

# --- ExpressSetup Handy label ---
ex = Path(r"C:\Users\larsf\Findus 2.0\src\onboarding\ExpressSetupStep.tsx")
et = ex.read_text(encoding="utf-8")
et2 = et.replace(
    "placeholder={isGuest ? 'Handy' : 'Handy *'}",
    "placeholder={isGuest ? 'Handynummer' : 'Handynummer *'}",
)
if et2 != et:
    ex.write_text(et2, encoding="utf-8")
    print("ExpressSetup OK")
else:
    print("ExpressSetup skip")

# --- Settings Handy ---
ss = Path(r"C:\Users\larsf\Findus 2.0\src\screens\SettingsScreen.tsx")
st = ss.read_text(encoding="utf-8")
st2 = st.replace(
    'placeholder="Handy (z. B. +49 170 …)"',
    'placeholder="Handynummer (z. B. +49 170 …)"',
)
st2 = st2.replace(
    "'Name, E-Mail, optional Handy für Reservierungs-Kontexte.'",
    "'Name, E-Mail, optional Handynummer für Reservierungs-Kontexte.'",
)
if st2 != st:
    ss.write_text(st2, encoding="utf-8")
    print("Settings OK")
else:
    print("Settings skip")

# --- lokale_maerkte midLabel + motive emojis ---
oo = Path(r"C:\Users\larsf\Findus 2.0\src\constants\onboardingOptions.ts")
ot = oo.read_text(encoding="utf-8")
ot2 = ot.replace(
    "    yesLabelDe: 'Zeig mir',\n    yesLabelEn: 'Show me',\n    midLabelDe: 'Gerne',\n    midLabelEn: 'Gladly',\n  },\n  {\n    id: 'barriere_care',",
    "    yesLabelDe: 'Zeig mir',\n    yesLabelEn: 'Show me',\n  },\n  {\n    id: 'barriere_care',",
)
for a, b in [
    ("emoji: '🥳',\n        labelDe: 'Partyurlaub'", "emoji: '🎉',\n        labelDe: 'Partyurlaub'"),
    ("emoji: '🏖️',\n        labelDe: 'Urlaub'", "emoji: '🏖',\n        labelDe: 'Urlaub'"),
    ("emoji: '✈️',\n        labelDe: 'Kurztrip'", "emoji: '✈',\n        labelDe: 'Kurztrip'"),
    ("emoji: '🗓️',\n        labelDe: 'Wochenendtrip'", "emoji: '📅',\n        labelDe: 'Wochenendtrip'"),
]:
    ot2 = ot2.replace(a, b)
if ot2 != ot:
    oo.write_text(ot2, encoding="utf-8")
    print("onboardingOptions OK")
else:
    print("onboardingOptions skip")

# --- safe pad ---
sp = Path(r"C:\Users\larsf\Findus 2.0\src\hooks\useSystemSafePad.ts")
sp.write_text(
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
print("safePad OK")
print("done batch1")
