/**
 * Merkt HUD-Entdeckungen: Stempelkarte-Icon, Route-Overlay, Live-Tipps-Tap.
 */

import * as FileSystem from 'expo-file-system';

const PATH = `${FileSystem.documentDirectory}findus-hud-hint.json`;

export type HudHintPrefs = {
  usedStempelkarteTap: boolean;
  usedRouteOverlayTap: boolean;
  /** Tipps per Live-Tap einmal verstanden → Hint ausblenden */
  usedLongPressMore: boolean;
  /** 🥇/🥈 in Timeline oder Pitch einmal gewählt */
  usedTimelineChoice: boolean;
  /** Timeline: Reihenfolge ziehen oder Wischen-Löschen einmal gemacht */
  usedTimelineGesture: boolean;
  /** Pitch-Karte „Tippen zum Wählen“ einmal genutzt */
  usedPitchChoose: boolean;
};

function emptyPrefs(): HudHintPrefs {
  return {
    usedStempelkarteTap: false,
    usedRouteOverlayTap: false,
    usedLongPressMore: false,
    usedTimelineChoice: false,
    usedTimelineGesture: false,
    usedPitchChoose: false,
  };
}

function parsePrefs(parsed: Partial<HudHintPrefs>): HudHintPrefs {
  const base = emptyPrefs();
  return {
    ...base,
    usedStempelkarteTap: parsed.usedStempelkarteTap === true,
    usedRouteOverlayTap: parsed.usedRouteOverlayTap === true,
    usedLongPressMore: parsed.usedLongPressMore === true,
    usedTimelineChoice: parsed.usedTimelineChoice === true,
    usedTimelineGesture: parsed.usedTimelineGesture === true,
    usedPitchChoose: parsed.usedPitchChoose === true,
  };
}

let cache: HudHintPrefs | null = null;
let loaded = false;

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export async function loadHudHintPrefs(): Promise<HudHintPrefs> {
  if (loaded && cache) return cache;
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as Partial<HudHintPrefs>;
      cache = parsePrefs(parsed);
      return cache;
    }
  } catch {
    /* fresh */
  }
  cache = emptyPrefs();
  return cache;
}

export function getHudHintPrefs(): HudHintPrefs | null {
  return cache;
}

/** Stempelkarte-Tipp nur bei ≥1 Stempel und noch nicht entdeckt. */
export function shouldShowStempelkarteHint(stampCount: number): boolean {
  if (stampCount <= 0) return false;
  if (!cache) return true;
  return !cache.usedStempelkarteTap;
}

/** Route-Tipp nur solange Overlay noch nicht per HUD geöffnet wurde. */
export function shouldShowRouteOverlayHint(): boolean {
  if (!cache) return true;
  return !cache.usedRouteOverlayTap;
}

export async function markHudStempelkarteUsed(): Promise<void> {
  const prefs = cache ?? (await loadHudHintPrefs());
  if (prefs.usedStempelkarteTap) return;
  cache = { ...prefs, usedStempelkarteTap: true };
  await persist();
}

export async function markHudRouteOverlayUsed(): Promise<void> {
  const prefs = cache ?? (await loadHudHintPrefs());
  if (prefs.usedRouteOverlayTap) return;
  cache = { ...prefs, usedRouteOverlayTap: true };
  await persist();
}

export function shouldShowLongPressMoreHint(): boolean {
  if (!cache) return true;
  return !cache.usedLongPressMore;
}

export async function markHudLongPressMoreUsed(): Promise<void> {
  const prefs = cache ?? (await loadHudHintPrefs());
  if (prefs.usedLongPressMore) return;
  cache = { ...prefs, usedLongPressMore: true };
  await persist();
}

function hintOn(flag: keyof HudHintPrefs): boolean {
  if (!cache) return true;
  return cache[flag] !== true;
}

async function markFlag(flag: keyof HudHintPrefs): Promise<void> {
  const prefs = cache ?? (await loadHudHintPrefs());
  if (prefs[flag]) return;
  cache = { ...prefs, [flag]: true };
  await persist();
}

/** Timeline-Wahl-Hinweis nur bis zur ersten echten Auswahl. */
export function shouldShowTimelineChoiceHint(): boolean {
  return hintOn('usedTimelineChoice');
}

export async function markTimelineChoiceUsed(): Promise<void> {
  await markFlag('usedTimelineChoice');
}

/** Reihenfolge/Wischen-Hinweis nur bis zur ersten Geste. */
export function shouldShowTimelineGestureHint(): boolean {
  return hintOn('usedTimelineGesture');
}

export async function markTimelineGestureUsed(): Promise<void> {
  await markFlag('usedTimelineGesture');
}

/** Pitch „Tippen zum Wählen“ nur bis zur ersten Wahl. */
export function shouldShowPitchChooseHint(): boolean {
  return hintOn('usedPitchChoose');
}

export async function markPitchChooseUsed(): Promise<void> {
  await markFlag('usedPitchChoose');
  await markFlag('usedTimelineChoice');
}
