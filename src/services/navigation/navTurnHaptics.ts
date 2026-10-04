/**
 * Hands-free Turn-Haptik — Hosentasche ohne Display.
 * Rechts: kurz. Links: kurz + länger.
 */

import { Platform, Vibration } from 'react-native';

export type NavTurnHapticSide = 'left' | 'right' | 'uturn' | 'arrive' | 'warn';

function sideFromManeuver(maneuver: string | null | undefined): NavTurnHapticSide | null {
  const m = (maneuver ?? '').toLowerCase();
  if (!m) return null;
  if (m.includes('uturn') || m.includes('u-turn')) return 'uturn';
  if (m.includes('left')) return 'left';
  if (m.includes('right')) return 'right';
  return null;
}

/** Pattern in ms: vibrate, pause, vibrate… */
function patternFor(side: NavTurnHapticSide): number[] {
  if (side === 'right') return [0, 90];
  if (side === 'left') return [0, 90, 80, 220];
  if (side === 'uturn') return [0, 90, 70, 90, 70, 220];
  if (side === 'arrive') return [0, 120, 100, 120, 100, 280];
  return [0, 70]; // warn
}

export function vibrateNavTurn(side: NavTurnHapticSide): void {
  try {
    const p = patternFor(side);
    if (Platform.OS === 'android') {
      Vibration.vibrate(p);
    } else {
      // iOS: nur ein Burst — Pattern eingeschränkt
      Vibration.vibrate(side === 'left' || side === 'uturn' || side === 'arrive' ? 180 : 90);
    }
  } catch {
    /* soft */
  }
}

export function vibrateNavTurnFromManeuver(
  maneuver: string | null | undefined,
): void {
  const side = sideFromManeuver(maneuver);
  if (!side) return;
  vibrateNavTurn(side);
}
