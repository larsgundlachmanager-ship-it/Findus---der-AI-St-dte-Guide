import { create } from 'zustand';
import { phaseAfterBumpRefine } from './acts';
import { isBriefComplete } from './completeness';
import { applyOriginDefaults } from './originDefaults';
import { applyAskedContext, applyLedgerCorrections, looksLikeGarbageFact, parseBriefSlots } from './parseBriefSlots';
import {
  cloneEmptyLedger,
  deactivateUnmatchedSlots,
  mergeLedger,
} from './slotLedger';
import type {
  ChatTurn,
  DecisionNote,
  FunnelLogLine,
  ReiseOption,
  ReisePhase,
  ReiseTrip,
  ResearchSpark,
  ResearchStep,
} from './types';
import {
  loadSavedTrips,
  persistSavedTrips,
  tripWorthSaving,
  upsertSavedTrip,
} from './tripShelf';

function nid(): string {
  return `rb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function emptyTrip(name = 'Neue Reise', savedTrips?: ReiseTrip[]): ReiseTrip {
  return {
    id: nid(),
    name,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    ledger: applyOriginDefaults(cloneEmptyLedger(), { savedTrips }),
    askedSlotKeys: [],
    frozen: false,
    refineCount: 0,
    initialProSearchDone: false,
    chat: [],
    options: [],
    funnelLog: [],
    researchSteps: [],
    researchSparks: [],
    decisionJournal: [],
    phase: 'briefing',
    searchReadySticky: false,
    searchReadyAnnounced: false,
    searching: false,
    thinking: false,
    verifyProgress: null,
    researchEtaMin: null,
    searchError: null,
    selectedOptionId: null,
    questionHint: '',
    llmFlipchartNotes: null,
    catalogExtras: [],
    recapSpokenOnce: false,
    resultPitchSpokenKey: null,
    recapText: null,
    timelinePushedOptionId: null,
  };
}

export type ReiseUiMode = 'hub' | 'active';

type Store = {
  overlayOpen: boolean;
  /** Tippen/Ask/Deep-Link → Modal (handleUtterance) */
  pendingUtterance: string | null;
  /** Nach Mic-Consent in Settings: Reisebüro wieder öffnen */
  reopenAfterMicConsent: boolean;
  uiMode: ReiseUiMode;
  savedTrips: ReiseTrip[];
  trip: ReiseTrip;
  openOverlay: (opts?: { reset?: boolean; seedText?: string }) => void;
  closeOverlay: () => void;
  setReopenAfterMicConsent: (v: boolean) => void;
  consumeReopenAfterMicConsent: () => boolean;
  hydrateTripShelf: () => Promise<void>;
  startNewTrip: () => void;
  openSavedTrip: (id: string) => void;
  deleteSavedTrip: (id: string) => void;
  backToHub: () => void;
  ingestUserText: (text: string) => void;
  /**
   * Tippen/Ask-Server/Deep-Link → Modal verarbeitet wie Mic/Senden (inkl. Briefing-Reply).
   * Isolation: kein Modul-2, aber nicht still schlucken.
   */
  enqueueUtterance: (text: string) => void;
  consumePendingUtterance: () => string | null;
  /** Während STT: Stickers live mergen — kein Chat-Turn, kein askedContext (kein Ja→Recap). */
  ingestLivePartial: (text: string) => void;
  appendAssistant: (text: string, hint?: string) => void;
  setLlmFlipchartNotes: (notes: import('./flipchartNotes').FlipchartNote[] | null) => void;
  addCatalogExtra: (extra: import('./questionCatalog').CatalogExtra) => void;
  markAsked: (key: string) => void;
  markRecapDone: () => void;
  markSearchReadyAnnounced: () => void;
  setPhase: (phase: ReisePhase) => void;
  setRecapText: (text: string | null) => void;
  setSearching: (on: boolean, error?: string | null) => void;
  setThinking: (on: boolean, progress?: number | null) => void;
  setResearchEtaMin: (min: number | null) => void;
  setResearchSteps: (steps: ResearchStep[]) => void;
  upsertResearchStep: (step: ResearchStep) => void;
  pushResearchSpark: (spark: Omit<ResearchSpark, 'id' | 'atMs'> & { id?: string }) => void;
  clearResearchSparks: () => void;
  appendDecision: (topic: string, detail: string) => void;
  setOptions: (opts: ReiseOption[], log: FunnelLogLine[]) => void;
  selectOption: (id: string | null) => void;
  markResultPitchSpoken: (key: string | null) => void;
  preferStay: (optionId: string, stayId: string) => void;
  preferTransport: (optionId: string, transportId: string) => void;
  markBookingClicked: (optionId: string, itemId: string) => void;
  bumpRefine: () => void;
  unfreeze: () => void;
  markTimelinePushed: (optionId: string) => void;
  syncSearchReadySticky: () => void;
};

function archiveCurrent(get: () => Store, set: (p: Partial<Store>) => void): void {
  const trip = get().trip;
  if (!tripWorthSaving(trip)) return;
  const savedTrips = upsertSavedTrip(get().savedTrips, trip);
  set({ savedTrips });
  void persistSavedTrips(savedTrips);
}

export const useReisebueroStore = create<Store>((set, get) => ({
  overlayOpen: false,
  /** QA/Ask/Deep-Link Warteschlange fürs Modal */
  pendingUtterance: null as string | null,
  reopenAfterMicConsent: false,
  uiMode: 'hub',
  savedTrips: [],
  trip: emptyTrip(),

  setReopenAfterMicConsent: (v) => set({ reopenAfterMicConsent: Boolean(v) }),

  consumeReopenAfterMicConsent: () => {
    const on = get().reopenAfterMicConsent;
    if (on) set({ reopenAfterMicConsent: false });
    return on;
  },

  hydrateTripShelf: async () => {
    const trips = await loadSavedTrips();
    set({ savedTrips: trips });
    const trip = get().trip;
    const blankBrief =
      trip.phase === 'briefing' &&
      (trip.chat?.length ?? 0) === 0 &&
      (trip.options?.length ?? 0) === 0 &&
      trip.ledger.mustHaves?.source !== 'user' &&
      trip.ledger.wishHaves?.source !== 'user';
    if (blankBrief && trips.length) {
      set({
        trip: {
          ...trip,
          ledger: applyOriginDefaults(cloneEmptyLedger(), { savedTrips: trips }),
        },
      });
    }
  },

  openOverlay: (opts) => {
    try {
      const { stopVoiceOnUserTap } = require('../module2/speech/speechQueue') as {
        stopVoiceOnUserTap: () => Promise<void>;
      };
      void stopVoiceOnUserTap();
    } catch {
      /* soft */
    }
    void get().hydrateTripShelf();
    if (opts?.seedText) {
      const trip = emptyTrip('Neue Reise', get().savedTrips);
      const patch = parseBriefSlots(opts.seedText);
      trip.ledger = deactivateUnmatchedSlots(
        applyOriginDefaults(mergeLedger(trip.ledger, patch), {
          savedTrips: get().savedTrips,
        }),
      );
      trip.chat.push({
        id: nid(),
        role: 'user',
        text: opts.seedText,
        atMs: Date.now(),
      });
      if (isBriefComplete(trip.ledger)) trip.searchReadySticky = true;
      trip.frozen = false;
      trip.thinking = false;
      set({ overlayOpen: true, uiMode: 'active', trip });
      return;
    }
    if (opts?.reset) {
      set({ overlayOpen: true, uiMode: 'hub', trip: emptyTrip('Neue Reise', get().savedTrips) });
      return;
    }
    {
      const trip = get().trip;
      const resumeActive =
        trip.searching ||
        trip.phase === 'research' ||
        trip.phase === 'results' ||
        trip.phase === 'detail' ||
        trip.phase === 'verify' ||
        (trip.options?.length ?? 0) > 0 ||
        (trip.chat?.length ?? 0) > 0 ||
        trip.searchReadySticky === true;
      set({
        overlayOpen: true,
        uiMode: resumeActive ? 'active' : 'hub',
        trip: { ...trip, frozen: false, thinking: false },
      });
    }
  },

  closeOverlay: () => {
    const trip = get().trip;
    // Akt-3 Recherche darf weiterlaufen (WhatsApp / Display aus / Modal zu).
    if (trip.searching || trip.phase === 'research') {
      set({ overlayOpen: false });
      return;
    }
    archiveCurrent(get, set);
    set({ overlayOpen: false, uiMode: 'hub', trip: emptyTrip('Neue Reise', get().savedTrips) });
  },

  startNewTrip: () => {
    archiveCurrent(get, set);
    set({ uiMode: 'active', trip: emptyTrip('Neue Reise', get().savedTrips) });
  },

  openSavedTrip: (id) => {
    const found = get().savedTrips.find((t) => t.id === id);
    if (!found) return;
    archiveCurrent(get, set);
    set({
      uiMode: 'active',
      trip: {
        ...found,
        frozen: false,
        thinking: false,
        searching: false,
        researchSparks: found.researchSparks ?? [],
        llmFlipchartNotes: found.llmFlipchartNotes ?? null,
      },
    });
    try {
      const { scheduleLlmFlipchartRefresh } = require('./llmFlipchartNotes') as typeof import('./llmFlipchartNotes');
      scheduleLlmFlipchartRefresh();
    } catch {
      /* soft */
    }
  },

  deleteSavedTrip: (id) => {
    const savedTrips = get().savedTrips.filter((t) => t.id !== id);
    set({ savedTrips });
    void persistSavedTrips(savedTrips);
  },

  backToHub: () => {
    archiveCurrent(get, set);
    set({ uiMode: 'hub', trip: emptyTrip('Neue Reise', get().savedTrips) });
  },

  ingestUserText: (text) => {
    const t = (text || '').trim();
    if (!t) return;
    const trip = get().trip;
    // Nur Research/Funnel hart blocken — Briefing nie schlucken.
    if (
      trip.frozen &&
      trip.phase !== 'briefing' &&
      trip.phase !== 'recap' &&
      trip.phase !== 'results' &&
      trip.phase !== 'detail' &&
      trip.phase !== 'verify'
    ) {
      if (__DEV__) console.warn('[Reisebuero] ingest blocked frozen', trip.phase);
      return;
    }
    const lastAsst = [...trip.chat].reverse().find((c) => c.role === 'assistant')?.text ?? '';
    const norm = (s: string) => s.toLowerCase().replace(/[?!.,]/g, '').replace(/\s+/g, ' ').trim();
    const nu = norm(t);
    const nq = norm(lastAsst);
    // Nur echte Echo-Kopien der Assistentenfrage verwerfen — keine Teilstring-Fallen.
    if (nq.length > 24 && nu === nq) {
      return;
    }
    if (__DEV__) console.log('[Reisebuero] ingest:', t.slice(0, 80));
    const lastAsk = trip.askedSlotKeys[trip.askedSlotKeys.length - 1] ?? null;
    // Meta: Frage wiederholen — kein Slot-Schreiben
    if (/\b(was\s+war\s+die\s+frage|welche\s+frage|nochmal\s+die\s+frage|hab(?:e)?\s+(?:die\s+)?frage\s+vergessen)\b/iu.test(t)) {
      const q =
        (trip.questionHint || '').trim() ||
        (lastAsk ? `Noch einmal zu ${lastAsk}` : '') ||
        'Sag kurz nochmal, worauf ich gerade hinauswollte';
      const turn: ChatTurn = { id: nid(), role: 'user', text: t, atMs: Date.now() };
      const speech = `Klar — die Frage war: ${q.replace(/\?+$/, '')}?`;
      set({
        trip: {
          ...trip,
          chat: [
            ...trip.chat,
            turn,
            { id: nid(), role: 'assistant', text: speech, atMs: Date.now() },
          ],
          questionHint: q,
          updatedAtMs: Date.now(),
        },
      });
      return;
    }
    // Nur reiner Noise ohne offene Frage — sonst immer pin + parse (Flipchart darf nie leer bleiben)
    if (looksLikeGarbageFact(t) && t.length < 80 && !lastAsk) {
      if (__DEV__) console.log('[Reisebuero] ingest skip garbage:', t.slice(0, 60));
      return;
    }
    const patch = applyAskedContext(t, lastAsk, parseBriefSlots(t, Date.now(), trip.ledger));
    try {
      const { pinUserAnswer, boardPinsEntry } = require('./boardPins') as typeof import('./boardPins');
      const pin = pinUserAnswer(lastAsk, t);
      if (pin) patch.boardPins = boardPinsEntry([pin]);
    } catch {
      /* soft */
    }
    if (
      lastAsk === 'origin' &&
      !patch.originCity &&
      /^(ja|hier|von\s+hier|zuhause|genau|passt|klar)\b/iu.test(t) &&
      trip.ledger.originCity?.value
    ) {
      patch.originCity = { ...trip.ledger.originCity, source: 'user', hardness: 'must' };
    }
    // Startort hard-pin: Hub-Liste („Hamburg, Berlin oder Bremen“) darf Heimat nicht
    // überschreiben — aber explizites A→B („von Hamburg nach Split“) schon.
    try {
      const { isExplicitFlightOriginChange } = require('./originCommit') as typeof import('./originCommit');
      if (
        trip.ledger.originCity?.source === 'user' &&
        trip.ledger.originCity.value &&
        patch.originCity &&
        patch.originCity.value !== trip.ledger.originCity.value &&
        /\b(hamburg|berlin|bremen|hannover|flughafen|direktflug)\b/iu.test(t) &&
        !isExplicitFlightOriginChange(t)
      ) {
        delete (patch as { originCity?: unknown }).originCity;
      }
    } catch {
      /* soft */
    }
    const ledger = applyLedgerCorrections(
      t,
      deactivateUnmatchedSlots(
        applyOriginDefaults(mergeLedger(trip.ledger, patch), {
          savedTrips: get().savedTrips,
        }),
      ),
    );
    let askedSlotKeys = trip.askedSlotKeys;
    try {
      const { catalogIdsPossiblyAnswered } = require('./questionCatalog') as typeof import('./questionCatalog');
      const answered = catalogIdsPossiblyAnswered(trip.ledger, ledger);
      if (answered.length) {
        const add = answered.filter((k) => !askedSlotKeys.includes(k));
        if (add.length) askedSlotKeys = [...askedSlotKeys, ...add];
        try {
          const { rememberShelfFromLedger } = require('./shelfAskedPrefs') as typeof import('./shelfAskedPrefs');
          rememberShelfFromLedger(ledger, answered);
        } catch {
          /* soft */
        }
      }
    } catch {
      /* soft */
    }
    const sticky = isBriefComplete(ledger);
    const turn: ChatTurn = { id: nid(), role: 'user', text: t, atMs: Date.now() };
    set({
      trip: {
        ...trip,
        ledger,
        askedSlotKeys,
        searchReadySticky: sticky,
        frozen: trip.phase === 'results' || trip.phase === 'detail' ? false : trip.frozen,
        chat: [...trip.chat, turn],
        updatedAtMs: Date.now(),
      },
    });
    try {
      const { ensureWeddingTimelineStop } = require('../module2/timeline/weddingTimeline') as {
        ensureWeddingTimelineStop: (l: typeof ledger) => boolean;
      };
      ensureWeddingTimelineStop(ledger);
    } catch {
      /* soft */
    }
    try {
      const { scheduleLlmFlipchartRefresh } = require('./llmFlipchartNotes') as typeof import('./llmFlipchartNotes');
      scheduleLlmFlipchartRefresh();
    } catch {
      /* soft */
    }
    try {
      const { rememberTripTaste } = require('./tasteMemory') as {
        rememberTripTaste: (l: typeof ledger, ask?: string | null) => Promise<void>;
      };
      void rememberTripTaste(ledger, lastAsk);
    } catch {
      /* soft */
    }
  },

  enqueueUtterance: (text) => {
    const t = (text || '').trim();
    if (!t) return;
    // Neueste Frage gewinnt — kein Stau aus alten Asks
    set({ pendingUtterance: t });
  },

  consumePendingUtterance: () => {
    const t = get().pendingUtterance;
    if (!t) return null;
    set({ pendingUtterance: null });
    return t;
  },

  ingestLivePartial: (text) => {
    const t = (text || '').trim();
    if (t.length < 8) return;
    const trip = get().trip;
    if (trip.phase !== 'briefing' && trip.phase !== 'recap') return;
    if (trip.searching || trip.phase === 'research') return;
    // Kein applyAskedContext — „ja“ mitten im Satz darf nicht Recap triggern.
    const patch = parseBriefSlots(t, Date.now(), trip.ledger);
    if (!patch || !Object.keys(patch).length) return;
    const ledger = deactivateUnmatchedSlots(
      applyOriginDefaults(mergeLedger(trip.ledger, patch), {
        savedTrips: get().savedTrips,
      }),
    );
    if (ledger === trip.ledger) return;
    set({
      trip: {
        ...trip,
        ledger,
        searchReadySticky: isBriefComplete(ledger),
        updatedAtMs: Date.now(),
      },
    });
    try {
      const { ensureWeddingTimelineStop } = require('../module2/timeline/weddingTimeline') as {
        ensureWeddingTimelineStop: (l: typeof ledger) => boolean;
      };
      ensureWeddingTimelineStop(ledger);
    } catch {
      /* soft */
    }
    try {
      const { scheduleLlmFlipchartRefresh } = require('./llmFlipchartNotes') as typeof import('./llmFlipchartNotes');
      scheduleLlmFlipchartRefresh();
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
    try {
      const { scheduleLlmFlipchartRefresh } = require('./llmFlipchartNotes') as typeof import('./llmFlipchartNotes');
      scheduleLlmFlipchartRefresh();
    } catch {
      /* soft */
    }
  },

  setLlmFlipchartNotes: (notes) => {
    const trip = get().trip;
    set({ trip: { ...trip, llmFlipchartNotes: notes } });
  },

  addCatalogExtra: (extra) => {
    const trip = get().trip;
    if (!extra?.id || trip.catalogExtras.some((e) => e.id === extra.id)) return;
    set({
      trip: {
        ...trip,
        catalogExtras: [...(trip.catalogExtras || []), extra].slice(-12),
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

  markSearchReadyAnnounced: () => {
    const trip = get().trip;
    set({ trip: { ...trip, searchReadyAnnounced: true } });
  },

  setPhase: (phase) => {
    const trip = get().trip;
    if (phase !== 'briefing' && trip.phase === 'briefing') {
      try {
        const { rememberShelfFilled } = require('./shelfAskedPrefs') as typeof import('./shelfAskedPrefs');
        rememberShelfFilled(trip.ledger);
      } catch {
        /* soft */
      }
    }
    set({ trip: { ...trip, phase } });
    // Ab Akt 2+ sofort persistieren, damit Kurzcheck nicht verloren geht.
    if (phase !== 'briefing') {
      archiveCurrent(get, set);
    }
  },

  setRecapText: (text) => {
    const trip = get().trip;
    set({ trip: { ...trip, recapText: text } });
  },

  setSearching: (on, error = null) => {
    const trip = get().trip;
    if (!on) {
      try {
        const { stopResearchProgress } = require('./research/progressController') as typeof import('./research/progressController');
        stopResearchProgress({ complete: false });
      } catch {
        /* soft */
      }
    }
    set({
      trip: {
        ...trip,
        searching: on,
        thinking: on,
        searchError: error,
        frozen: on ? true : trip.frozen,
        phase: on ? 'research' : trip.phase,
        verifyProgress: on ? 0.05 : null,
        researchEtaMin: on ? trip.researchEtaMin : null,
      },
    });
  },

  setThinking: (on, progress = null) => {
    const trip = get().trip;
    set({
      trip: {
        ...trip,
        thinking: on,
        verifyProgress: progress,
        phase: on && trip.phase === 'results' ? 'verify' : trip.phase,
      },
    });
  },

  setResearchEtaMin: (min) => {
    const trip = get().trip;
    const next =
      min == null || !Number.isFinite(min) ? null : Math.max(0, Math.round(min));
    if (trip.researchEtaMin === next) return;
    set({ trip: { ...trip, researchEtaMin: next } });
  },

  setResearchSteps: (steps) => {
    const trip = get().trip;
    set({ trip: { ...trip, researchSteps: steps } });
  },

  upsertResearchStep: (step) => {
    const trip = get().trip;
    const rest = trip.researchSteps.filter((s) => s.id !== step.id);
    set({ trip: { ...trip, researchSteps: [...rest, step] } });
  },

  pushResearchSpark: (spark) => {
    const trip = get().trip;
    let lat = spark.lat ?? undefined;
    let lng = spark.lng ?? undefined;
    try {
      const { enrichSparkGeo } = require('./research/sparkGeo') as typeof import('./research/sparkGeo');
      const geo = enrichSparkGeo({ label: spark.label, lat, lng });
      lat = geo.lat;
      lng = geo.lng;
    } catch {
      /* soft */
    }
    const next: ResearchSpark = {
      id: spark.id || nid(),
      kind: spark.kind,
      emoji: spark.emoji,
      label: spark.label.slice(0, 28),
      sub: spark.sub?.slice(0, 36),
      atMs: Date.now(),
      lat: lat ?? null,
      lng: lng ?? null,
      photoUrl: spark.photoUrl ?? null,
    };
    const prev = trip.researchSparks ?? [];
    // Dedup gleiche Labels kurz hintereinander
    const filtered = prev.filter(
      (s) => !(s.kind === next.kind && s.label.toLowerCase() === next.label.toLowerCase()),
    );
    set({
      trip: {
        ...trip,
        researchSparks: [...filtered, next].slice(-18),
      },
    });
    // Ohne Koords: live geocoden — nur mit Namens-Match, sonst kein Pin
    const needsGeo =
      (next.lat == null || next.lng == null) &&
      (next.kind === 'place' || next.kind === 'stay' || next.kind === 'deal' || next.kind === 'compare');
    if (needsGeo) {
      const sparkId = next.id;
      const sparkLabel = next.label;
      void (async () => {
        try {
          const { resolveSparkGeoLive } = require('./research/sparkGeo') as typeof import('./research/sparkGeo');
          const live = await resolveSparkGeoLive(sparkLabel);
          if (!live) return;
          const cur = get().trip;
          const sparks = (cur.researchSparks ?? []).map((s) =>
            s.id === sparkId && (s.lat == null || s.lng == null)
              ? { ...s, lat: live.lat, lng: live.lng }
              : s,
          );
          set({ trip: { ...cur, researchSparks: sparks } });
        } catch {
          /* soft — Pin bleibt ohne Geo unsichtbar */
        }
      })();
    }
  },

  clearResearchSparks: () => {
    const trip = get().trip;
    set({ trip: { ...trip, researchSparks: [] } });
  },

  appendDecision: (topic, detail) => {
    const trip = get().trip;
    const note: DecisionNote = {
      id: nid(),
      atMs: Date.now(),
      topic,
      detail,
    };
    set({ trip: { ...trip, decisionJournal: [...trip.decisionJournal, note] } });
  },

  setOptions: (opts, log) => {
    const trip = get().trip;
    let options = opts;
    try {
      const { finalizeMagazineOptions } =
        require('./magazineOptionPolicy') as typeof import('./magazineOptionPolicy');
      options = finalizeMagazineOptions(opts, trip.ledger);
    } catch {
      options = opts.slice(0, 4);
    }
    const { buildResultsCoverState } = require('./resultsCover') as typeof import('./resultsCover');
    const covers = buildResultsCoverState(options);
    set({
      trip: {
        ...trip,
        ...covers,
        funnelLog: log,
        searching: false,
        thinking: false,
        verifyProgress: null,
        researchEtaMin: null,
        frozen: false,
        // Magazin wartet — Modal spricht den Favoriten-Pitch genau 1× nach dem Funnel
        resultPitchSpokenKey: '__funnel_pending__',
        initialProSearchDone: trip.initialProSearchDone || options.length > 0,
      },
    });
  },

  markResultPitchSpoken: (key) => {
    const trip = get().trip;
    set({ trip: { ...trip, resultPitchSpokenKey: key } });
  },

  selectOption: (id) => {
    const trip = get().trip;
    const changed = id !== trip.selectedOptionId;
    set({
      trip: {
        ...trip,
        selectedOptionId: id,
        // Andere Option gewählt → Magazin darf deren Pitch einmal vorlesen
        ...(changed ? { resultPitchSpokenKey: null } : {}),
        phase: id ? 'detail' : trip.options.length ? 'results' : trip.phase,
      },
    });
  },

  preferStay: (optionId, stayId) => {
    const trip = get().trip;
    const { applySelectedStayTransport } = require('./research/composePlan') as typeof import('./research/composePlan');
    const adults = trip.ledger.adults?.value ?? 2;
    const options = trip.options.map((o) => {
      if (o.id !== optionId) return o;
      return applySelectedStayTransport({ ...o, selectedStayId: stayId }, adults, trip.ledger);
    });
    set({ trip: { ...trip, options } });
    // Nearby neu ernten am neuen Stay (async, soft)
    void (async () => {
      try {
        const snap = get().trip;
        const opt = snap.options.find((o) => o.id === optionId);
        if (!opt) return;
        const stay = opt.stays?.find((s) => s.id === stayId) || opt.stays?.[0];
        if (!stay?.lat || !stay?.lng) return;
        const { harvestWishEvidence } = await import('./research/wishEvidenceHarvest');
        const { deepEnrichMagazineOption } = await import('./research/magazineEnsure');
        const wishEvidence = await harvestWishEvidence({
          lat: stay.lat,
          lng: stay.lng,
          placeName: opt.placeName,
          stayPhotoUrl: stay.photoUrl || null,
          stayAmenities: '',
          ledger: snap.ledger,
          distanceAnchor: 'stay',
        });
        const patched = await deepEnrichMagazineOption(
          { ...opt, selectedStayId: stayId, wishEvidence },
          snap.ledger,
        );
        const cur = get().trip;
        set({
          trip: {
            ...cur,
            options: cur.options.map((o) => (o.id === optionId ? patched : o)),
          },
        });
      } catch {
        /* soft */
      }
    })();
  },

  preferTransport: (optionId, transportId) => {
    const trip = get().trip;
    const { applySelectedStayTransport } = require('./research/composePlan') as typeof import('./research/composePlan');
    const adults = trip.ledger.adults?.value ?? 2;
    const options = trip.options.map((o) => {
      if (o.id !== optionId) return o;
      return applySelectedStayTransport(
        { ...o, selectedTransportId: transportId },
        adults,
        trip.ledger,
      );
    });
    set({ trip: { ...trip, options } });
  },

  markBookingClicked: (optionId, itemId) => {
    const trip = get().trip;
    const options = trip.options.map((o) => {
      if (o.id !== optionId || !o.bookingChecklist) return o;
      return {
        ...o,
        bookingChecklist: o.bookingChecklist.map((b) =>
          b.id === itemId ? { ...b, clickedAtMs: Date.now() } : b,
        ),
      };
    });
    set({ trip: { ...trip, options } });
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
        researchSteps: [],
        researchSparks: [],
        phase: phaseAfterBumpRefine(trip),
        recapText: null,
      },
    });
  },

  unfreeze: () => {
    const trip = get().trip;
    set({ trip: { ...trip, frozen: false } });
  },

  markTimelinePushed: (optionId) => {
    const trip = get().trip;
    set({ trip: { ...trip, timelinePushedOptionId: optionId } });
  },

  syncSearchReadySticky: () => {
    const trip = get().trip;
    const ready = isBriefComplete(trip.ledger);
    if (ready === trip.searchReadySticky) return;
    set({ trip: { ...trip, searchReadySticky: ready } });
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
