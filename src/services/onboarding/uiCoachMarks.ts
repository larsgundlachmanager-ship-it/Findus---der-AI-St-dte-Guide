/**
 * UI-Coach-Marks: einmalige Pfeil-/Text-Hinweise bis der User die Geste getestet hat.
 * Persistiert lokal — danach nie wieder.
 */

import * as FileSystem from 'expo-file-system';
import { markFeatureTipCompleted } from '../ai/featureTips';
import {
  loadMicHintPrefs,
  markMicHoldUsed,
  markMicTapUsed,
  shouldShowMicHint,
} from '../ui/micHintPrefs';
import {
  loadHudHintPrefs,
  markHudLongPressMoreUsed,
  markHudRouteOverlayUsed,
  markHudStempelkarteUsed,
  shouldShowLongPressMoreHint,
  shouldShowRouteOverlayHint,
  shouldShowStempelkarteHint,
} from '../ui/hudHintPrefs';
import {
  loadStampPassportUxPrefs,
  markStampMapInteracted,
  shouldShowStampMapOnboarding,
} from '../ui/stampPassportUxPrefs';

const PATH = `${FileSystem.documentDirectory}findus-ui-coach-marks.json`;

export type UiCoachMarkId =
  | 'mic'
  | 'plan_calendar'
  | 'settings_gear'
  | 'stamp_map'
  | 'triggers'
  | 'nav_cancel'
  | 'live_delays'
  | 'planning';

export type UiCoachMarkState = {
  completed: UiCoachMarkId[];
};

const ALL: UiCoachMarkId[] = [
  'mic',
  'plan_calendar',
  'settings_gear',
  'stamp_map',
  'triggers',
  'nav_cancel',
  'live_delays',
  'planning',
];

let cache: UiCoachMarkState | null = null;
let loaded = false;

async function persist(): Promise<void> {
  if (!cache) return;
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export async function loadUiCoachMarks(): Promise<UiCoachMarkState> {
  if (loaded && cache) return cache;
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (info.exists) {
      const raw = await FileSystem.readAsStringAsync(PATH);
      const parsed = JSON.parse(raw) as Partial<UiCoachMarkState>;
      const completed = Array.isArray(parsed.completed)
        ? parsed.completed.filter((id): id is UiCoachMarkId =>
            ALL.includes(id as UiCoachMarkId),
          )
        : [];
      cache = { completed: [...new Set(completed)] };
      return cache;
    }
  } catch {
    /* fresh */
  }
  cache = { completed: [] };
  return cache;
}

export function getUiCoachMarks(): UiCoachMarkState {
  return cache ?? { completed: [] };
}

export function isUiCoachMarkDone(id: UiCoachMarkId): boolean {
  return getUiCoachMarks().completed.includes(id);
}

export async function markUiCoachDone(id: UiCoachMarkId): Promise<void> {
  const state = cache ?? (await loadUiCoachMarks());
  if (state.completed.includes(id)) return;
  cache = { completed: [...state.completed, id] };
  await persist();

  // Feature-Tip-Checkliste spiegeln
  if (id === 'mic') void markFeatureTipCompleted('voice_mic');
  if (id === 'plan_calendar' || id === 'planning') {
    void markFeatureTipCompleted('plan_calendar');
  }
  if (id === 'settings_gear') void markFeatureTipCompleted('settings_gear');
  if (id === 'stamp_map') void markFeatureTipCompleted('visit_passport');
  if (id === 'triggers') void markFeatureTipCompleted('triggers');
  if (id === 'nav_cancel' || id === 'live_delays') {
    void markFeatureTipCompleted('navigation');
  }
}

/** Sichtbarkeit der Homescreen-Hints (kombiniert alte Prefs + Coach-Marks). */
export function shouldShowCoachMic(): boolean {
  if (isUiCoachMarkDone('mic')) return false;
  return shouldShowMicHint();
}

export function shouldShowCoachPlanCalendar(): boolean {
  return !isUiCoachMarkDone('plan_calendar');
}

export function shouldShowCoachSettings(): boolean {
  return !isUiCoachMarkDone('settings_gear');
}

export function shouldShowCoachStamp(stampCount: number): boolean {
  if (isUiCoachMarkDone('stamp_map')) return false;
  return shouldShowStempelkarteHint(stampCount);
}

export function shouldShowCoachNavCancel(): boolean {
  return !isUiCoachMarkDone('nav_cancel');
}

export async function bootstrapUiCoachMarks(): Promise<void> {
  await Promise.all([
    loadUiCoachMarks(),
    loadMicHintPrefs(),
    loadHudHintPrefs(),
    loadStampPassportUxPrefs(),
  ]);
}

/** Convenience: User-Aktionen → Coach + Legacy-Prefs. */
export async function onUserOpenedPlanCalendar(): Promise<void> {
  await markUiCoachDone('plan_calendar');
  await markUiCoachDone('planning');
}

export async function onUserOpenedSettings(): Promise<void> {
  await markUiCoachDone('settings_gear');
}

export async function onUserOpenedTriggers(): Promise<void> {
  await markUiCoachDone('triggers');
  await markUiCoachDone('settings_gear');
}

export async function onUserUsedMicHold(): Promise<void> {
  await markMicHoldUsed();
  await markUiCoachDone('mic');
}

export async function onUserUsedMicTap(): Promise<void> {
  await markMicTapUsed();
  // Mic-Hint bleibt bis auch Hold einmal genutzt — außer beides schon ok
  if (!shouldShowMicHint()) await markUiCoachDone('mic');
}

export async function onUserOpenedStampMap(): Promise<void> {
  await markHudStempelkarteUsed();
  await markStampMapInteracted();
  await markUiCoachDone('stamp_map');
}

export async function onUserCancelledNavLongPress(): Promise<void> {
  await markUiCoachDone('nav_cancel');
  await markHudLongPressMoreUsed();
}

export async function onUserHeardLiveDelayDemo(): Promise<void> {
  await markUiCoachDone('live_delays');
}

export {
  shouldShowLongPressMoreHint,
  shouldShowRouteOverlayHint,
  shouldShowStampMapOnboarding,
  markHudRouteOverlayUsed,
};
