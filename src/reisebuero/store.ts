import { create } from 'zustand';
import { applyOriginDefaults } from './originDefaults';
import { applyAskedContext, applyLedgerCorrections, parseBriefSlots } from './parseBriefSlots';
import {
  cloneEmptyLedger,
  deactivateUnmatchedSlots,
  mergeLedger,
} from './slotLedger';
import type { ChatTurn, ReiseOption, ReiseTrip, FunnelLogLine } from './types';

function nid(): string {
  return `rb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function emptyTrip(name = 'Neue Reise'): ReiseTrip {
  return {
    id: nid(),
    name,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    ledger: applyOriginDefaults(cloneEmptyLedger()),
    askedSlotKeys: [],
    frozen: false,
    refineCount: 0,
    initialProSearchDone: false,
    chat: [],
    options: [],
    funnelLog: [],
    searching: false,
    searchError: null,
    selectedOptionId: null,
    questionHint: '',
  };
}

type Store = {
  overlayOpen: boolean;
  trip: ReiseTrip;
  openOverlay: (opts?: { reset?: boolean; seedText?: string }) => void;
  closeOverlay: () => void;
  ingestUserText: (text: string) => void;
  appendAssistant: (text: string, hint?: string) => void;
  markAsked: (key: string) => void;
  markRecapDone: () => void;
  setSearching: (on: boolean, error?: string | null) => void;
  setOptions: (opts: ReiseOption[], log: FunnelLogLine[]) => void;
  selectOption: (id: string | null) => void;
  bumpRefine: () => void;
  unfreeze: () => void;
};

export const useReisebueroStore = create<Store>((set, get) => ({
  overlayOpen: false,
  trip: emptyTrip(),

  openOverlay: (opts) => {
    try {
      const { stopVoiceOnUserTap } = require('../module2/speech/speechQueue') as {
        stopVoiceOnUserTap: () => Promise<void>;
      };
      void stopVoiceOnUserTap();
    } catch {
      /* soft */
    }
    if (opts?.reset || !get().trip.chat.length) {
      const trip = emptyTrip();
      if (opts?.seedText) {
        const patch = parseBriefSlots(opts.seedText);
        trip.ledger = deactivateUnmatchedSlots(
          applyOriginDefaults(mergeLedger(trip.ledger, patch)),
        );
        trip.chat.push({
          id: nid(),
          role: 'user',
          text: opts.seedText,
          atMs: Date.now(),
        });
      }
      set({ overlayOpen: true, trip });
      return;
    }
    set({ overlayOpen: true });
  },

  closeOverlay: () => set({ overlayOpen: false, trip: emptyTrip() }),

  ingestUserText: (text) => {
    const t = (text || '').trim();
    if (!t) return;
    const trip = get().trip;
    if (trip.frozen) return;
    const lastAsst = [...trip.chat].reverse().find((c) => c.role === 'assistant')?.text ?? '';
    const norm = (s: string) => s.toLowerCase().replace(/[?!.,]/g, '').replace(/\s+/g, ' ').trim();
    const nu = norm(t);
    const nq = norm(lastAsst);
    if (nq.length > 18 && (nu === nq || (nu.length > 12 && nq.includes(nu)) || (nu.length > 18 && nu.includes(nq.slice(0, 28))))) {
      return;
    }
    const lastAsk = trip.askedSlotKeys[trip.askedSlotKeys.length - 1] ?? null;
    const patch = applyAskedContext(t, lastAsk, parseBriefSlots(t, Date.now(), trip.ledger));
    if (
      lastAsk === 'origin' &&
      !patch.originCity &&
      /^(ja|hier|von\s+hier|zuhause|genau|passt|klar)\b/iu.test(t) &&
      trip.ledger.originCity?.value
    ) {
      patch.originCity = { ...trip.ledger.originCity, source: 'user', hardness: 'must' };
    }
    const ledger = applyLedgerCorrections(
      t,
      deactivateUnmatchedSlots(applyOriginDefaults(mergeLedger(trip.ledger, patch))),
    );
    const turn: ChatTurn = { id: nid(), role: 'user', text: t, atMs: Date.now() };
    set({
      trip: {
        ...trip,
        ledger,
        chat: [...trip.chat, turn],
        updatedAtMs: Date.now(),
      },
    });
    try {
      const { rememberTripTaste } = require('./tasteMemory') as {
        rememberTripTaste: (l: typeof ledger, ask?: string | null) => Promise<void>;
      };
      void rememberTripTaste(ledger, lastAsk);
    } catch {
      /* soft */
    }
  },

  appendAssistant: (text, hint) => {
    const trip = get().trip;
    const turn: ChatTurn = {
      id: nid(),
      role: 'assistant',
      text: (text || '').trim(),
      atMs: Date.now(),
    };
    if (!turn.text) return;
    set({
      trip: {
        ...trip,
        chat: [...trip.chat, turn],
        questionHint: (hint || '').trim() || trip.questionHint,
        updatedAtMs: Date.now(),
      },
    });
  },

  markAsked: (key) => {
    const trip = get().trip;
    if (trip.askedSlotKeys.includes(key)) return;
    set({
      trip: { ...trip, askedSlotKeys: [...trip.askedSlotKeys, key] },
    });
  },

  markRecapDone: () => {
    const trip = get().trip;
    set({
      trip: {
        ...trip,
        ledger: mergeLedger(trip.ledger, {
          recapDone: { value: true, source: 'inferred', hardness: 'inferred' },
        }),
      },
    });
  },

  setSearching: (on, error = null) => {
    const trip = get().trip;
    set({
      trip: {
        ...trip,
        searching: on,
        searchError: error,
        frozen: on ? true : trip.frozen,
      },
    });
  },

  setOptions: (opts, log) => {
    const trip = get().trip;
    set({
      trip: {
        ...trip,
        options: opts,
        funnelLog: log,
        searching: false,
        frozen: true,
        initialProSearchDone:
          trip.initialProSearchDone || (opts.length > 0),
      },
    });
  },

  selectOption: (id) => {
    const trip = get().trip;
    set({ trip: { ...trip, selectedOptionId: id } });
  },

  bumpRefine: () => {
    const trip = get().trip;
    set({
      trip: {
        ...trip,
        frozen: false,
        refineCount: trip.refineCount + 1,
        options: [],
        selectedOptionId: null,
      },
    });
  },

  unfreeze: () => {
    const trip = get().trip;
    set({ trip: { ...trip, frozen: false } });
  },
}));

/** Reisebüro-Overlay: Hintergrund-TTS (Nav, Plan, Bahn) darf nicht reingrätschen. */
export function isReisebueroOverlayOpen(): boolean {
  try {
    return useReisebueroStore.getState().overlayOpen === true;
  } catch {
    return false;
  }
}
