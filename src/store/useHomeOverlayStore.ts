/**
 * Home-Overlays (Settings / Orte / Pass / Tippfeld) unabhängig vom
 * Voice/GPS-Render der Karte. Sichtbarkeit hier, nicht in HomeScreen-State.
 */

import { create } from 'zustand';

export type HomeOverlayPassportTab = 'discover' | 'route';

type HomeOverlayState = {
  settingsVisible: boolean;
  settingsMounted: boolean;
  seekVisible: boolean;
  seekMounted: boolean;
  passportVisible: boolean;
  passportTab: HomeOverlayPassportTab;
  questionVisible: boolean;
  questionSubtitle: string;
  openSettings: () => void;
  closeSettings: () => void;
  openSeek: () => void;
  closeSeek: () => void;
  /** Idle: Settings/Orte einmal mounten (sichtbar=false). */
  premountOverlays: () => void;
  openPassport: (tab?: HomeOverlayPassportTab) => void;
  closePassport: () => void;
  openQuestion: (subtitle: string) => void;
  closeQuestion: () => void;
};

export const HOME_QUESTION_DEFAULT_SUBTITLE =
  'Schreib deine Frage an Yorro.';

function releaseOverlayBusyIfIdle(opts: {
  settingsVisible: boolean;
  seekVisible: boolean;
}): void {
  try {
    const { usePlanCalendarUiStore } = require('../module2/timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: {
        getState: () => { calendarVisible: boolean };
      };
    };
    if (
      opts.settingsVisible ||
      opts.seekVisible ||
      usePlanCalendarUiStore.getState().calendarVisible
    ) {
      return;
    }
    const { noteOverlayBusy } = require('../services/boot/interactiveBootGate') as {
      noteOverlayBusy: (busy: boolean) => void;
    };
    noteOverlayBusy(false);
  } catch {
    try {
      const { noteOverlayBusy } = require('../services/boot/interactiveBootGate') as {
        noteOverlayBusy: (busy: boolean) => void;
      };
      noteOverlayBusy(false);
    } catch {
      /* soft */
    }
  }
}

function holdOverlayBusy(): void {
  try {
    const { noteOverlayBusy } = require('../services/boot/interactiveBootGate') as {
      noteOverlayBusy: (busy: boolean) => void;
    };
    noteOverlayBusy(true);
  } catch {
    /* soft */
  }
}

export const useHomeOverlayStore = create<HomeOverlayState>((set, get) => ({
  settingsVisible: false,
  settingsMounted: false,
  seekVisible: false,
  seekMounted: false,
  passportVisible: false,
  passportTab: 'discover',
  questionVisible: false,
  questionSubtitle: HOME_QUESTION_DEFAULT_SUBTITLE,
  openSettings: () => {
    holdOverlayBusy();
    set({ settingsVisible: true, settingsMounted: true });
  },
  closeSettings: () => {
    set({ settingsVisible: false });
    const s = get();
    releaseOverlayBusyIfIdle({
      settingsVisible: false,
      seekVisible: s.seekVisible,
    });
  },
  openSeek: () => {
    holdOverlayBusy();
    set({ seekVisible: true, seekMounted: true });
  },
  closeSeek: () => {
    set({ seekVisible: false });
    const s = get();
    releaseOverlayBusyIfIdle({
      settingsVisible: s.settingsVisible,
      seekVisible: false,
    });
  },
  premountOverlays: () =>
    set({ settingsMounted: true, seekMounted: true }),
  openPassport: (tab) =>
    set({
      passportVisible: true,
      passportTab: tab ?? 'discover',
    }),
  closePassport: () => set({ passportVisible: false }),
  openQuestion: (subtitle) =>
    set({ questionVisible: true, questionSubtitle: subtitle }),
  closeQuestion: () => set({ questionVisible: false }),
}));
