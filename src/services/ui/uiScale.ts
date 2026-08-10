/**
 * Globale UI-Größe: Text & Buttons.
 * Default auto = ab Alter 55 größer; Override in Einstellungen oder per Sprache.
 */

import { create } from 'zustand';
import { getCachedUserProfile, subscribeUserProfile } from '../userProfileService';
import type { UserProfile } from '../../types/userProfile';

export type UiScalePref = 'auto' | 'normal' | 'large';

export type UiScaleLevel = 'normal' | 'large';

type UiScaleState = {
  textLevel: UiScaleLevel;
  buttonLevel: UiScaleLevel;
  textMul: number;
  buttonMul: number;
  refresh: () => void;
};

const MUL: Record<UiScaleLevel, number> = {
  normal: 1,
  large: 1.22,
};

function resolveLevel(
  pref: UiScalePref | undefined,
  age: number | null | undefined,
): UiScaleLevel {
  if (pref === 'normal' || pref === 'large') return pref;
  // auto / unset
  return typeof age === 'number' && Number.isFinite(age) && age >= 55
    ? 'large'
    : 'normal';
}

function fromProfile(p: UserProfile | null): Omit<UiScaleState, 'refresh'> {
  const age = p?.age;
  const textLevel = resolveLevel(p?.uiTextScale, age);
  const buttonLevel = resolveLevel(p?.uiButtonScale, age);
  return {
    textLevel,
    buttonLevel,
    textMul: MUL[textLevel],
    buttonMul: MUL[buttonLevel],
  };
}

export const useUiScaleStore = create<UiScaleState>((set) => ({
  ...fromProfile(getCachedUserProfile()),
  refresh: () => set(fromProfile(getCachedUserProfile())),
}));

let unsub: (() => void) | null = null;

/** Einmal beim App-Start: Profil-Änderungen → UI-Scale. */
export function startUiScaleSync(): () => void {
  useUiScaleStore.getState().refresh();
  if (unsub) unsub();
  unsub = subscribeUserProfile(() => {
    useUiScaleStore.getState().refresh();
  });
  return () => {
    unsub?.();
    unsub = null;
  };
}

export function scaleText(size: number, mul?: number): number {
  const m = mul ?? useUiScaleStore.getState().textMul;
  return Math.round(size * m);
}

export function scaleButton(size: number, mul?: number): number {
  const m = mul ?? useUiScaleStore.getState().buttonMul;
  return Math.round(size * m);
}

/** Voice / Settings: „größere Schrift“, „normale Buttons“, … */
export function parseUiScaleVoice(
  text: string,
): Partial<Pick<UserProfile, 'uiTextScale' | 'uiButtonScale'>> | null {
  const t = text.toLowerCase();
  const out: Partial<Pick<UserProfile, 'uiTextScale' | 'uiButtonScale'>> = {};

  const wantsLarge =
    /\b(größer|groesser|grosse?\s+schrift|große?\s+schrift|grösser|grosse?\s+buttons?|große?\s+buttons?|lesbarer|besser\s+lesen)\b/i.test(
      t,
    );
  const wantsNormal =
    /\b(normale?\s+schrift|normale?\s+größe|normale?\s+groesse|kleinere?\s+schrift|kompakt|standard\s+größe|standard\s+groesse|normale?\s+buttons?)\b/i.test(
      t,
    );
  const aboutText = /\b(schrift|text|lesen|buchstaben)\b/i.test(t);
  const aboutBtn = /\b(button|buttons|taste|tasten|klick)\b/i.test(t);

  if (wantsLarge) {
    if (aboutBtn && !aboutText) out.uiButtonScale = 'large';
    else if (aboutText && !aboutBtn) out.uiTextScale = 'large';
    else {
      out.uiTextScale = 'large';
      out.uiButtonScale = 'large';
    }
  } else if (wantsNormal) {
    if (aboutBtn && !aboutText) out.uiButtonScale = 'normal';
    else if (aboutText && !aboutBtn) out.uiTextScale = 'normal';
    else {
      out.uiTextScale = 'normal';
      out.uiButtonScale = 'normal';
    }
  } else if (/\b(automatisch|wie\s+alter|auto)\b/i.test(t) && /\b(schrift|größe|groesse|ui|anzeige)\b/i.test(t)) {
    out.uiTextScale = 'auto';
    out.uiButtonScale = 'auto';
  } else {
    return null;
  }
  return out;
}
