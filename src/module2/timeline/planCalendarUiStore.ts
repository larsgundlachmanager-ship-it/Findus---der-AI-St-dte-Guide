/**
 * UI-Bridge: Kalender öffnen + Short-Answers + Action-Buttons auch im Planungsmodus.
 */

import { create } from 'zustand';
import type { QuickAction } from '../../types/concierge';

export type PlanShortAnswer = {
  id: string;
  label: string;
  /** Wird an follow-up / machine gereicht */
  action:
    | 'plan_pick'
    | 'plan_advance'
    | 'plan_confirm'
    | 'plan_accept'
    | 'plan_reject'
    | 'prompt'
    | 'plan_location';
  pick?: string;
  prompt?: string;
};

/** Eine Wahl-Karte im Timeline-Split (A | B). */
export type PlanProposalActionCard = {
  id: string;
  /** UI-Label, z. B. „🗺️ Maps“ / „🌐 Website“ */
  label: string;
  url: string;
};

export type PlanChoiceCard = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  /** Fertiger Pitch (gesprochen) — Speech/Translation */
  subtitle: string;
  /** 1–3 Stichpunkte für die Timeline-Karte (kein Fließtext) */
  bullets?: string[];
  mapsUrl: string;
  menuUrl?: string | null;
  walkMinFromPrev?: number | null;
  placeId?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  /** Öffnungszeiten aus Discovery — Commit-Gate */
  openNow?: boolean | null;
  opensAtMin?: number | null;
  closesAtMin?: number | null;
  /** 🥇 Favorit / 🥈 Alternative — UI-Prefix */
  proposalRole?: 'favorite' | 'alternative';
  /** Action-Cards nur für Action-Board oben (nicht unter der Timeline-Karte) */
  actionCards?: PlanProposalActionCard[];
  /** Places-Telefon — Confirm → Anruf/Reservierung 1:1 */
  phoneNumber?: string | null;
};

export type PlanPendingChoice = {
  stepKey: string;
  headline: string;
  anchorTimeMs: number | null;
  anchorTimeLabel: string | null;
  options: [PlanChoiceCard, PlanChoiceCard];
  /** Tippen in Timeline wählt den Vorschlag; Bestätigen rechts committed */
  selectedOptionId?: string | null;
  /** PROPOSAL_ITEM — blauer Rahmen in Timeline */
  uiPhase?: 'proposal';
};

export type PlanScrollTarget =
  | { kind: 'open_plans' }
  | { kind: 'stop'; stopId: string }
  | { kind: 'choice'; stepKey: string }
  | null;

type Store = {
  openRequestAtMs: number | null;
  closeRequestAtMs: number | null;
  /** Timeline sichtbar (HomeScreen synced) — Mic → nur Modul 5 */
  calendarVisible: boolean;
  /** Keep-alive nach erstem Open/Premount — kein Cold-Mount */
  calendarMounted: boolean;
  /** Wann zuletzt geschlossen (für 30-Min-Stale-Purge) */
  calendarHiddenAtMs: number | null;
  /** Letzte Interaktion im Planungsmodul (offene Wünsche verwerfen) */
  lastPlanInteractionAtMs: number | null;
  /**
   * Einzel-Aufgabe/Termin: gleiche Planung, Timeline bleibt zu (Chat + Speech).
   * requestOpenPlanCalendar ist dann No-Op.
   */
  headlessPlanning: boolean;
  shortAnswers: PlanShortAnswer[];
  mirroredActions: QuickAction[];
  pendingChoice: PlanPendingChoice | null;
  /** Live-Anzeige: Timeline scrollt zu dem, was Yorro gerade ändert */
  scrollTarget: PlanScrollTarget;
  scrollTargetAtMs: number;
  /** Agent will sichtbaren Kalender-Tag wechseln (morgen / …) */
  requestedDayKey: string | null;
  requestedDayAtMs: number;
  /** Nav-Leg wird neu geroutet — UI zeigt Spinner */
  routeComputingIds: Record<string, true>;
  requestOpen: () => void;
  requestClose: () => void;
  clearOpenRequest: () => void;
  clearCloseRequest: () => void;
  setCalendarVisible: (visible: boolean) => void;
  premountCalendar: () => void;
  markCalendarHidden: () => void;
  clearCalendarHidden: () => void;
  setHeadlessPlanning: (headless: boolean) => void;
  setShortAnswers: (answers: PlanShortAnswer[]) => void;
  clearShortAnswers: () => void;
  setMirroredActions: (actions: QuickAction[]) => void;
  clearMirroredActions: () => void;
  setPendingChoice: (choice: PlanPendingChoice | null) => void;
  clearPendingChoice: () => void;
  setScrollTarget: (target: PlanScrollTarget) => void;
  clearScrollTarget: () => void;
  requestDayKey: (dayKey: string) => void;
  clearRequestedDayKey: () => void;
  /** Stop den der User gerade tippt/sieht — Agent-Fokus. */
  focusedStopId: string | null;
  setFocusedStopId: (id: string | null) => void;
  touchPlanInteraction: () => void;
  markRouteComputing: (id: string, on: boolean) => void;
};

export const usePlanCalendarUiStore = create<Store>((set) => ({
  openRequestAtMs: null,
  closeRequestAtMs: null,
  calendarVisible: false,
  calendarMounted: false,
  calendarHiddenAtMs: null,
  lastPlanInteractionAtMs: null,
  headlessPlanning: false,
  shortAnswers: [],
  mirroredActions: [],
  pendingChoice: null,
  scrollTarget: null,
  scrollTargetAtMs: 0,
  requestedDayKey: null,
  requestedDayAtMs: 0,
  focusedStopId: null as string | null,
  routeComputingIds: {},
  requestOpen: () => {
    try {
      const { useHomeMapUiStore } = require('../../store/useHomeMapUiStore') as {
        useHomeMapUiStore: {
          getState: () => {
            placePopup: unknown;
            setPlacePopup: (p: null) => void;
          };
        };
      };
      if (useHomeMapUiStore.getState().placePopup) {
        useHomeMapUiStore.getState().setPlacePopup(null);
      }
    } catch {
      /* soft */
    }
    set({ openRequestAtMs: Date.now(), closeRequestAtMs: null });
  },
  requestClose: () => set({ closeRequestAtMs: Date.now() }),
  clearOpenRequest: () => set({ openRequestAtMs: null }),
  clearCloseRequest: () => set({ closeRequestAtMs: null }),
  setCalendarVisible: (calendarVisible) => {
    try {
      const {
        noteOverlayBusy,
      } = require('../../services/boot/interactiveBootGate') as {
        noteOverlayBusy: (busy: boolean) => void;
      };
      if (calendarVisible) {
        try {
          const {
            useHomeMapUiStore,
          } = require('../../store/useHomeMapUiStore') as {
            useHomeMapUiStore: {
              getState: () => {
                placePopup: unknown;
                setPlacePopup: (p: null) => void;
              };
            };
          };
          if (useHomeMapUiStore.getState().placePopup) {
            useHomeMapUiStore.getState().setPlacePopup(null);
          }
        } catch {
          /* soft */
        }
        noteOverlayBusy(true);
      } else {
        // Settings kann parallel offen sein
        try {
          const {
            useHomeOverlayStore,
          } = require('../../store/useHomeOverlayStore') as {
            useHomeOverlayStore: {
              getState: () => { settingsVisible: boolean; seekVisible: boolean };
            };
          };
          const o = useHomeOverlayStore.getState();
          if (!o.settingsVisible && !o.seekVisible) noteOverlayBusy(false);
        } catch {
          noteOverlayBusy(false);
        }
      }
    } catch {
      /* soft */
    }
    set(
      calendarVisible
        ? { calendarVisible: true, calendarMounted: true }
        : { calendarVisible: false },
    );
  },
  premountCalendar: () => set({ calendarMounted: true }),
  markCalendarHidden: () => set({ calendarHiddenAtMs: Date.now() }),
  clearCalendarHidden: () => set({ calendarHiddenAtMs: null }),
  setHeadlessPlanning: (headlessPlanning) => set({ headlessPlanning }),
  setShortAnswers: (shortAnswers) => set({ shortAnswers }),
  clearShortAnswers: () => set({ shortAnswers: [] }),
  setMirroredActions: (mirroredActions) => set({ mirroredActions }),
  clearMirroredActions: () => set({ mirroredActions: [] }),
  setPendingChoice: (pendingChoice) => set({ pendingChoice }),
  clearPendingChoice: () => set({ pendingChoice: null }),
  setScrollTarget: (scrollTarget) =>
    set({ scrollTarget, scrollTargetAtMs: Date.now() }),
  clearScrollTarget: () => set({ scrollTarget: null }),
  requestDayKey: (dayKey) =>
    set({ requestedDayKey: dayKey, requestedDayAtMs: Date.now() }),
  clearRequestedDayKey: () => set({ requestedDayKey: null }),
  setFocusedStopId: (focusedStopId: string | null) => set({ focusedStopId }),
  touchPlanInteraction: () => set({ lastPlanInteractionAtMs: Date.now() }),
  markRouteComputing: (id, on) =>
    set((s) => {
      const next = { ...s.routeComputingIds };
      if (on) next[id] = true;
      else delete next[id];
      return { routeComputingIds: next };
    }),
}));

export function requestPlanScroll(target: PlanScrollTarget): void {
  usePlanCalendarUiStore.getState().setScrollTarget(target);
}

/** Einzel-Termin/Aufgabe: gleiche Engine, kein Kalender-Modal. */
export function setHeadlessPlanningSession(active: boolean): void {
  usePlanCalendarUiStore.getState().setHeadlessPlanning(active);
}

export function isHeadlessPlanningSession(): boolean {
  return usePlanCalendarUiStore.getState().headlessPlanning;
}

export function requestOpenPlanCalendar(): void {
  if (usePlanCalendarUiStore.getState().headlessPlanning) return;
  usePlanCalendarUiStore.getState().requestOpen();
}

/** Kalender sichtbar machen und einen Frame für den Paint freigeben. */
export async function revealPlanCalendarNow(
  dayKey?: string | null,
): Promise<void> {
  const ui = usePlanCalendarUiStore.getState();
  ui.setHeadlessPlanning(false);
  if (dayKey && /^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    ui.requestDayKey(dayKey);
  }
  requestOpenPlanCalendar();
  await new Promise<void>((resolve) => setTimeout(resolve, 48));
}

export function requestClosePlanCalendar(): void {
  usePlanCalendarUiStore.getState().requestClose();
}

export function requestDayKey(dayKey: string): void {
  usePlanCalendarUiStore.getState().requestDayKey(dayKey);
}
