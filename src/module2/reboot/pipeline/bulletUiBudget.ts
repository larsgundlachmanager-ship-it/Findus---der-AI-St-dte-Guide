/**
 * bulletMaxChars — 1× täglich messen (RFC v2.1).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BULLET_SURFACE_MAX_CHARS,
  estimateBulletMaxChars,
} from '../../../services/concierge/visualBullets';

const STORAGE_KEY = 'yorro_bullet_ui_budget_v1';

export type BulletUiBudget = {
  bulletMaxChars: number;
  bulletLines: 2;
  bulletCount: 3;
  measuredAt: string;
  screenWidthPx: number;
};

const DEFAULT: BulletUiBudget = {
  bulletMaxChars: BULLET_SURFACE_MAX_CHARS.default,
  bulletLines: 2,
  bulletCount: 3,
  measuredAt: '',
  screenWidthPx: 0,
};

let memBudget: BulletUiBudget | null = null;

function isSameDay(a: string, b: Date): boolean {
  if (!a) return false;
  const d = new Date(a);
  return (
    d.getFullYear() === b.getFullYear() &&
    d.getMonth() === b.getMonth() &&
    d.getDate() === b.getDate()
  );
}

/** Sync Peek — Call-1 nicht hinter AsyncStorage warten. */
export function peekBulletUiBudget(): BulletUiBudget {
  return memBudget ?? { ...DEFAULT };
}

export async function loadBulletUiBudget(): Promise<BulletUiBudget> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      memBudget = { ...DEFAULT, measuredAt: new Date().toISOString() };
      return memBudget;
    }
    const parsed = JSON.parse(raw) as BulletUiBudget;
    if (
      typeof parsed.bulletMaxChars === 'number' &&
      parsed.bulletMaxChars >= 22
    ) {
      memBudget = {
        bulletMaxChars: parsed.bulletMaxChars,
        bulletLines: 2,
        bulletCount: 3,
        measuredAt: parsed.measuredAt || '',
        screenWidthPx: parsed.screenWidthPx || 0,
      };
      return memBudget;
    }
  } catch {
    /* soft */
  }
  memBudget = { ...DEFAULT, measuredAt: new Date().toISOString() };
  return memBudget;
}

export async function noteBulletUiMeasurement(opts: {
  widthPx: number;
  fontSize?: number;
}): Promise<BulletUiBudget> {
  const existing = await loadBulletUiBudget();
  const now = new Date();
  if (
    isSameDay(existing.measuredAt, now) &&
    existing.screenWidthPx === opts.widthPx &&
    existing.bulletMaxChars >= 22
  ) {
    return existing;
  }
  const bulletMaxChars = estimateBulletMaxChars({
    widthPx: opts.widthPx,
    fontSize: opts.fontSize ?? 14,
    lines: 2,
  });
  const next: BulletUiBudget = {
    bulletMaxChars,
    bulletLines: 2,
    bulletCount: 3,
    measuredAt: now.toISOString(),
    screenWidthPx: opts.widthPx,
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* soft */
  }
  memBudget = next;
  return next;
}
