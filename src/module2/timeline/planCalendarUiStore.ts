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
    | 'prompt';
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
  /**
   * Einzel-Aufgabe/Termin: gleiche Planung, Timeline bleibt zu (Chat + Speech).
   * requestOpenPlanCalendar ist dann No-Op.
   */
  headlessPlanning: boolean;
  shortAnswers: PlanShortAnswer[];
  mirroredActions: QuickAction[];
  pendingChoice: PlanPendingChoice | null;
  /** Live-Anzeige: Timeline scrollt zu dem, was Findus gerade ändert */
  scrollTarget: PlanScrollTarget;
  scrollTargetAtMs: number;
  /** Agent will sichtbaren Kalender-Tag wechseln (morgen / …) */
  requestedDayKey: string | null;
  requestedDayAtMs: number;
  requestOpen: () => void;
  requestClose: () => void;
  clearOpenRequest: () => void;
  clearCloseRequest: () => void;
  setCalendarVisible: (visible: boolean) => void;
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
};

export const usePlanCalendarUiStore = create<Store>((set) => ({
  openRequestAtMs: null,
  closeRequestAtMs: null,
  calendarVisible: false,
  headlessPlanning: false,
  shortAnswers: [],
  mirroredActions: [],
  pendingChoice: null,
  scrollTarget: null,
  scrollTargetAtMs: 0,
  requestedDayKey: null,
  requestedDayAtMs: 0,
  requestOpen: () =>
    set({ openRequestAtMs: Date.now(), closeRequestAtMs: null }),
  requestClose: () => set({ closeRequestAtMs: Date.now() }),
  clearOpenRequest: () => set({ openRequestAtMs: null }),
  clearCloseRequest: () => set({ closeRequestAtMs: null }),
  setCalendarVisible: (calendarVisible) => set({ calendarVisible }),
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

export function requestClosePlanCalendar(): void {
  usePlanCalendarUiStore.getState().requestClose();
}

export function requestDayKey(dayKey: string): void {
  usePlanCalendarUiStore.getState().requestDayKey(dayKey);
}
