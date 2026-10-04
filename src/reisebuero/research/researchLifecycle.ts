/**
 * Reisebüro Akt-3 Research: weiterlaufen bei Display-aus / WhatsApp / Anruf,
 * Fertig-Push wenn der User nicht im Vordergrund ist.
 *
 * Kein Audio-Keepalive (würde Anrufe stören). Keep-awake + Sticky-Hinweis
 * helfen gegen Display-Sleep; Netzwerk-Awaits laufen nach App-Wechsel weiter,
 * sobald der JS-Thread wieder wach ist.
 */

import { AppState, Platform, Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  configureNotificationHandler,
  requestNotificationPermission,
} from '../../services/notifications/notificationService';
import { getCachedUserProfile } from '../../services/userProfileService';
import {
  buildResearchDoneBody,
} from './researchLifecycleCopy';

export {
  buildResearchDoneBody,
  resolveResearchNotifyFirstName,
} from './researchLifecycleCopy';

export const REISE_RESEARCH_CHANNEL_ID = 'yorro-reisebuero-research-v1';
export const REISE_RESEARCH_PROGRESS_ID = 'yorro-reisebuero-research-progress';
export const REISE_RESEARCH_DONE_ID = 'yorro-reisebuero-research-done';
export const REISE_RESEARCH_DATA_TYPE = 'reisebuero_research';

const KEEP_AWAKE_TAG = 'reisebuero-research';

let active = false;
let channelReady = false;
let tapListenerReady = false;
let leftForegroundDuringRun = false;
let endedOnce = false;
let appStateSub: { remove: () => void } | null = null;

export function isReiseResearchLifecycleActive(): boolean {
  return active;
}

/** User ist gerade in der App (Vordergrund). */
export function isUserInAppForeground(): boolean {
  return AppState.currentState === 'active';
}

function profileFirstName(): string | null {
  return getCachedUserProfile()?.firstName ?? null;
}

async function ensureChannel(): Promise<void> {
  await configureNotificationHandler();
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(REISE_RESEARCH_CHANNEL_ID, {
    name: 'Reisebüro Recherche',
    description: 'Läuft weiter, wenn das Display aus ist — fertig mit Hinweis',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 220, 100, 220],
    lightColor: '#C4A35A',
    sound: 'default',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  channelReady = true;
}

async function activateKeepAwakeSoft(): Promise<void> {
  try {
    const mod = await import('expo-keep-awake');
    if (typeof mod.activateKeepAwakeAsync === 'function') {
      await mod.activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    } else if (typeof (mod as { activateKeepAwake?: (t: string) => void }).activateKeepAwake === 'function') {
      (mod as { activateKeepAwake: (t: string) => void }).activateKeepAwake(KEEP_AWAKE_TAG);
    }
  } catch {
    /* optional dependency via expo */
  }
}

function deactivateKeepAwakeSoft(): void {
  try {
    // sync require — deactivate should not be async-gated
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-keep-awake') as {
      deactivateKeepAwake?: (t?: string) => void;
    };
    mod.deactivateKeepAwake?.(KEEP_AWAKE_TAG);
  } catch {
    /* soft */
  }
}

async function dismissNotif(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    /* ignore */
  }
  try {
    await Notifications.dismissNotificationAsync(id);
  } catch {
    /* ignore */
  }
}

async function showProgressNotification(): Promise<void> {
  try {
    await ensureChannel();
    const perm = await requestNotificationPermission();
    if (!perm.granted) return;
    await dismissNotif(REISE_RESEARCH_PROGRESS_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: REISE_RESEARCH_PROGRESS_ID,
      content: {
        title: 'Yorro recherchiert',
        body: 'Deine Reiseideen — du kannst kurz weg, ich arbeite weiter.',
        sticky: true,
        autoDismiss: false,
        sound: false,
        data: { type: REISE_RESEARCH_DATA_TYPE, kind: 'progress' },
        ...(Platform.OS === 'android'
          ? { channelId: REISE_RESEARCH_CHANNEL_ID }
          : null),
      },
      trigger: null,
    });
  } catch (err) {
    if (__DEV__) console.warn('[reiseResearch] progress notif failed', err);
  }
}

function pulseDone(): void {
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 220, 100, 220]);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Fertig-Push nur wenn User nicht im Vordergrund (Display aus / andere App / Anruf).
 */
export async function notifyResearchDoneIfAway(opts?: {
  firstName?: string | null;
  optionCount?: number;
  ok?: boolean;
}): Promise<boolean> {
  if (isUserInAppForeground()) return false;

  try {
    await ensureChannel();
    const perm = await requestNotificationPermission();
    if (!perm.granted) return false;

    await dismissNotif(REISE_RESEARCH_DONE_ID);
    await dismissNotif(REISE_RESEARCH_PROGRESS_ID);

    const body =
      opts?.ok === false
        ? 'Hey — die Recherche ist durch, aber ohne Treffer. Tippen zum Anpassen.'
        : buildResearchDoneBody(opts?.firstName ?? profileFirstName());
    const n = opts?.optionCount ?? 0;
    const title =
      opts?.ok === false
        ? 'Yorro Reisebüro'
        : n > 0
          ? `Yorro — ${n} Idee${n === 1 ? '' : 'n'} bereit`
          : 'Yorro Reisebüro';

    pulseDone();
    await Notifications.scheduleNotificationAsync({
      identifier: REISE_RESEARCH_DONE_ID,
      content: {
        title,
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: {
          type: REISE_RESEARCH_DATA_TYPE,
          kind: 'done',
          optionCount: n,
        },
        ...(Platform.OS === 'android'
          ? { channelId: REISE_RESEARCH_CHANNEL_ID }
          : null),
      },
      trigger: null,
    });
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[reiseResearch] done notif failed', err);
    return false;
  }
}

function openReisebueroFromDoneTap(): void {
  try {
    const { useReisebueroStore } = require('../store') as typeof import('../store');
    const st = useReisebueroStore.getState();
    const trip = st.trip;
    const resume =
      trip.searching ||
      trip.phase === 'research' ||
      trip.phase === 'results' ||
      trip.phase === 'detail' ||
      trip.phase === 'verify' ||
      (trip.options?.length ?? 0) > 0;
    useReisebueroStore.setState({
      overlayOpen: true,
      uiMode: resume ? 'active' : 'hub',
      trip: { ...trip, frozen: false, thinking: false },
    });
  } catch (err) {
    if (__DEV__) console.warn('[reiseResearch] open overlay failed', err);
  }
}

export function bootstrapReiseResearchTapHandler(): void {
  if (tapListenerReady) return;
  tapListenerReady = true;
  void (async () => {
    try {
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as {
          type?: string;
          kind?: string;
        };
        if (data?.type !== REISE_RESEARCH_DATA_TYPE) return;
        if (data.kind === 'done' || data.kind === 'progress') {
          openReisebueroFromDoneTap();
        }
      });
      const last = await Notifications.getLastNotificationResponseAsync();
      if (last) {
        const data = last.notification.request.content.data as {
          type?: string;
        };
        if (data?.type === REISE_RESEARCH_DATA_TYPE) {
          openReisebueroFromDoneTap();
        }
      }
    } catch (err) {
      if (__DEV__) console.warn('[reiseResearch] tap listener failed', err);
    }
  })();
}

bootstrapReiseResearchTapHandler();

function onAppStateChange(next: string): void {
  if (!active) return;
  if (next === 'inactive' || next === 'background') {
    leftForegroundDuringRun = true;
  }
}

/** Start Akt 3 — Keep-awake + Sticky „recherchiert“. */
export async function beginReiseResearchLifecycle(): Promise<void> {
  if (active) {
    leftForegroundDuringRun = leftForegroundDuringRun || !isUserInAppForeground();
    return;
  }
  active = true;
  endedOnce = false;
  leftForegroundDuringRun = !isUserInAppForeground();
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', onAppStateChange);
  }
  bootstrapReiseResearchTapHandler();
  await activateKeepAwakeSoft();
  await showProgressNotification();
}

export type EndReiseResearchOpts = {
  ok: boolean;
  optionCount?: number;
};

/**
 * Ende Akt 3 — Keep-awake aus, Progress weg, ggf. „Hey …, ich bin fertig“.
 * Idempotent (mehrfach aufrufbar). notifiedAway=true → keine In-App-Speech.
 */
export async function endReiseResearchLifecycle(
  opts: EndReiseResearchOpts,
): Promise<{ notifiedAway: boolean }> {
  if (endedOnce) {
    await dismissNotif(REISE_RESEARCH_PROGRESS_ID);
    return { notifiedAway: false };
  }
  endedOnce = true;
  active = false;
  deactivateKeepAwakeSoft();
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
  leftForegroundDuringRun = false;

  await dismissNotif(REISE_RESEARCH_PROGRESS_ID);

  const notifiedAway = await notifyResearchDoneIfAway({
    ok: opts.ok,
    optionCount: opts.optionCount ?? 0,
  });
  return { notifiedAway };
}

/** Ob nach Funnel noch In-App gesprochen werden soll. */
export function shouldSpeakResearchResultInApp(): boolean {
  return isUserInAppForeground();
}
