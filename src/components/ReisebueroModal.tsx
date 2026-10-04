import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { UI_LAYER } from '../constants/uiLayers';
import { SwipeBackView } from './SwipeBackView';
import { SubtitlesSlot, SUBTITLE_SLOT_H } from './liveStage';
import {
  runBriefingReply,
  runOpeningGreeting,
  runRecapSpeech,
} from '../reisebuero/briefingChat';
import {
  isBriefComplete,
  searchReadyGaps,
} from '../reisebuero/completeness';
import { briefScoreHint, briefMissingLines, computeBriefScore } from '../reisebuero/briefScore';
import type {
  FactThumb,
  ReiseLedger,
  ReiseOption,
} from '../reisebuero/types';
import { TripStoryScroll } from './reisebuero/TripStoryScroll';
import { ResearchTheater } from './reisebuero/ResearchTheater';
import { ConfirmSheet } from './reisebuero/ConfirmSheet';
import {
  buildCoverHeadline,
  buildCoverSubline,
  resolveOptionPhoto,
} from '../reisebuero/research/storyMagazine';
import {
  type FlipchartNote,
  type NoteTier,
  emojiForWishText,
  isPinNeedleEmoji,
} from '../reisebuero/flipchartNotes';
import {
  isReisebueroMicActive,
  isReisebueroMicHeldForTts,
  pauseReisebueroLiveForTyping as pauseReisebueroMicForTyping,
  resumeReisebueroLiveAfterTyping as resumeReisebueroMicAfterTyping,
  runReisebueroSpeech,
  waitReisebueroSpeechIdle,
  startReisebueroLive as startReisebueroMic,
  stopReisebueroLive as stopReisebueroMic,
  ensureReisebueroMicListening,
  subscribeReisebueroLive as subscribeReisebueroMic,
  type ReisebueroMicPhase,
} from '../reisebuero/reisebueroLiveChat';
import { runReisebueroFunnel } from '../reisebuero/research/funnel';
import { speechTopTwoSummary } from '../reisebuero/research/optionCard';
import { useReisebueroStore } from '../reisebuero/store';
import { tripShelfTitle, reiseHeaderTitle } from '../reisebuero/tripShelf';
import { looksLikeVerifyRequest, looksLikeGapAddOn, runLiveVerify } from '../reisebuero/liveVerify';
import {
  magazineOptionsCoverHint,
  targetOptionCount,
} from '../reisebuero/optionPolicy';
import { shelfCheckOffChips } from '../reisebuero/shelfAskedPrefs';
import { phaseToAct, REISE_ACT_LABEL } from '../reisebuero/acts';
import {
  isRecapAdditive,
  isRecapChange,
  isRecapConfirm,
  isRecapHardRestart,
  RECAP_REJECT_RE,
  recapAdditiveWantsSearch,
} from '../reisebuero/recapIntent';
import { speakRuntimeText } from '../runtime/speechModule';

/** Strict-Mode-sicher: Boot pro Trip-ID (neue Reise → neues Greeting). */
let reisebueroBootedTripId: string | null = null;

type Props = {
  visible: boolean;
  onClose: () => void;
};

export const ReisebueroModal = React.memo(function ReisebueroModal({
  visible,
  onClose,
}: Props) {
  const trip = useReisebueroStore((s) => s.trip);
  const uiMode = useReisebueroStore((s) => s.uiMode);
  const savedTrips = useReisebueroStore((s) => s.savedTrips);
  const startNewTrip = useReisebueroStore((s) => s.startNewTrip);
  const openSavedTrip = useReisebueroStore((s) => s.openSavedTrip);
  const deleteSavedTrip = useReisebueroStore((s) => s.deleteSavedTrip);
  const backToHub = useReisebueroStore((s) => s.backToHub);
  const hydrateTripShelf = useReisebueroStore((s) => s.hydrateTripShelf);
  const ingest = useReisebueroStore((s) => s.ingestUserText);
  const selectOption = useReisebueroStore((s) => s.selectOption);
  const bumpRefine = useReisebueroStore((s) => s.bumpRefine);
  const markRecapDone = useReisebueroStore((s) => s.markRecapDone);
  const setPhase = useReisebueroStore((s) => s.setPhase);
  const syncSearchReadySticky = useReisebueroStore((s) => s.syncSearchReadySticky);
  const ingestLivePartial = useReisebueroStore((s) => s.ingestLivePartial);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState('');
  const [micPhase, setMicPhase] = useState<ReisebueroMicPhase>('idle');
  const [searchConfirm, setSearchConfirm] = useState<null | {
    title: string;
    body: string;
    must: string[];
    nice: string[];
    zone: 'red' | 'yellow' | 'green';
    scoreHint?: string;
    hero?: string;
  }>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<null | { id: string; title: string }>(null);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const subtitleFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePartialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userMutedMicRef = useRef(false);
  const insets = useSafeAreaInsets();
  const kbInset = useKeyboardInset();
  const kbOpen = kbInset > 40;
  const padBottom = kbOpen
    ? kbInset + spacing.lg + 28
    : Math.max(insets.bottom, spacing.sm);
  const busyRef = useRef(false);
  const typingRef = useRef(false);
  const pendingRef = useRef<string[]>([]);
  const inputRef = useRef<TextInput>(null);
  const sendHoldRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  const selected = trip.options.find((o) => o.id === trip.selectedOptionId) ?? null;
  const ready = isBriefComplete(trip.ledger);
  const briefScore = useMemo(() => computeBriefScore(trip.ledger), [trip.ledger]);
  const searchReady = trip.searchReadySticky || ready;
  const questionHint = trip.questionHint;
  const openAskKey =
    trip.askedSlotKeys.length > 0 ? trip.askedSlotKeys[trip.askedSlotKeys.length - 1]! : null;
  const openQuestion = useMemo(() => {
    const q = (questionHint || '').trim();
    if (q) return q;
    for (let i = trip.chat.length - 1; i >= 0; i -= 1) {
      const c = trip.chat[i];
      if (c?.role === 'assistant' && /\?\s*$/.test(c.text.trim())) {
        const parts = c.text.trim().split(/(?<=[.!])\s+/);
        return parts[parts.length - 1] || c.text.trim();
      }
    }
    return 'Was soll noch aufs Board?';
  }, [questionHint, trip.chat]);
  const notes = useMemo(() => trip.llmFlipchartNotes ?? [], [trip.llmFlipchartNotes]);
  const shelfChips = useMemo(
    () =>
      trip.phase === 'briefing' || trip.phase === 'recap'
        ? shelfCheckOffChips(trip.ledger)
        : [],
    [trip.phase, trip.ledger],
  );
  const boardQuestionShort = useMemo(() => {
    if (trip.phase === 'recap') return 'Passt das so?';
    const open = notes.find((n) => n.id === 'open_q' || n.emoji === '❓');
    if (open?.label) return open.label;
    return (openQuestion || '').trim() || (openAskKey ? `${openAskKey}?` : '?');
  }, [trip.phase, notes, openQuestion, openAskKey]);
  const listening = micPhase === 'listening';
  const inResearch = trip.searching || trip.phase === 'research';
  const thinkingUi = trip.thinking || busy || micPhase === 'processing';
  const prevNoteIds = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!trip.selectedOptionId) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, 40);
    return () => clearTimeout(t);
  }, [trip.selectedOptionId]);

  const speakSafe = useCallback(async (speech: string) => {
    const text = (speech || '').trim();
    if (!text) return;
    try {
      await Promise.race([
        runReisebueroSpeech(async () => {
          await speakRuntimeText(text);
        }, text),
        new Promise<void>((resolve) => setTimeout(resolve, 45_000)),
      ]);
    } catch {
      /* Mic muss trotzdem wieder an */
    }
  }, []);

  /** Magazin-Detail: Speech nur wenn Funnel-Pitch noch nicht gesprochen. */
  const lastMagazineSpeechRef = useRef<string | null>(null);
  useEffect(() => {
    const id = trip.selectedOptionId;
    if (!id) {
      lastMagazineSpeechRef.current = null;
      return;
    }
    const opt = useReisebueroStore.getState().trip.options.find((o) => o.id === id);
    const speech = (opt?.speechSummary || '').trim();
    if (!speech) return;
    const key = `${id}::${speech}`;
    // Funnel/Modal spricht Favoriten-Pitch — Magazin nicht doppelt; pending = warten
    const spoken = useReisebueroStore.getState().trip.resultPitchSpokenKey;
    if (spoken === '__funnel_pending__' || spoken === key || spoken === id) return;
    if (lastMagazineSpeechRef.current === key) return;
    lastMagazineSpeechRef.current = key;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      useReisebueroStore.getState().markResultPitchSpoken(key);
      await speakSafe(speech);
      if (cancelled || userMutedMicRef.current || typingRef.current) return;
      if (!useReisebueroStore.getState().overlayOpen) return;
      await ensureReisebueroMicListening();
    })();
    return () => {
      cancelled = true;
    };
  }, [trip.selectedOptionId, speakSafe]);

  const runFunnelAfterConfirm = useCallback(async (opts?: { softForce?: boolean }) => {
    const store = useReisebueroStore.getState();
    let led = store.trip.ledger;
    if (opts?.softForce && !isBriefComplete(led)) {
      // Soft-Suche: fehlende Booking-Pflicht mit Defaults füllen (z. B. Flug-Gepäck 1/0)
      try {
        const { entry, mergeLedger } = require('../reisebuero/slotLedger') as typeof import('../reisebuero/slotLedger');
        const patch: Partial<ReiseLedger> = {};
        if (
          led.mode?.value === 'fly' &&
          !led.bookedFlight?.value &&
          led.cabinBags == null &&
          led.checkedBags == null
        ) {
          patch.cabinBags = entry(1, 'inferred');
          patch.checkedBags = entry(0, 'inferred');
        }
        if (Object.keys(patch).length) {
          const next = mergeLedger(led, patch);
          useReisebueroStore.setState({
            trip: { ...store.trip, ledger: next, updatedAtMs: Date.now() },
          });
          led = next;
        }
      } catch {
        /* soft */
      }
    }
    if (!isBriefComplete(led)) {
      syncSearchReadySticky();
      setPhase('briefing');
      const speech = await runBriefingReply();
      await speakSafe(speech);
      return;
    }
    markRecapDone();
    setPhase('research');
    void stopReisebueroMic();
    try {
      await runReisebueroFunnel();
    } finally {
      try {
        const { endReiseResearchLifecycle } = await import(
          '../reisebuero/research/researchLifecycle'
        );
        const snap0 = useReisebueroStore.getState().trip;
        await endReiseResearchLifecycle({
          ok: (snap0.options?.length ?? 0) > 0,
          optionCount: snap0.options?.length ?? 0,
        });
      } catch {
        /* soft */
      }
    }
    const snap = useReisebueroStore.getState().trip;
    // Im Vordergrund: Pitch; sonst hat Lifecycle schon „Hey …, ich bin fertig“ gepusht
    try {
      const { shouldSpeakResearchResultInApp } = await import(
        '../reisebuero/research/researchLifecycle'
      );
      if (!shouldSpeakResearchResultInApp()) {
        // Away: Push statt Pitch — Magazin darf später 1× sprechen
        useReisebueroStore.getState().markResultPitchSpoken(null);
        return;
      }
    } catch {
      /* soft — sprechen */
    }
    const fav = snap.options[0];
    const speech = speechTopTwoSummary(snap.options);
    if (speech?.trim()) {
      const key = fav?.id && fav.speechSummary
        ? `${fav.id}::${fav.speechSummary.trim()}`
        : fav?.id || `pitch:${speech.slice(0, 40)}`;
      // VOR speak: Magazin-Effekt blocken (selectedOptionId ist schon gesetzt)
      useReisebueroStore.getState().markResultPitchSpoken(key);
      lastMagazineSpeechRef.current = key;
      await speakSafe(speech);
    }
  }, [markRecapDone, setPhase, speakSafe, syncSearchReadySticky]);

  const handleRef = useRef<(text: string) => Promise<void>>(async () => {});
  const handleUtterance = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      // Briefing nie wegen altem frozen/thinking blocken.
      const snap0 = useReisebueroStore.getState().trip;
      if (snap0.frozen || snap0.thinking) {
        useReisebueroStore.setState({
          trip: { ...snap0, frozen: false, thinking: false },
        });
      }

      busyRef.current = true;
      setBusy(true);
      setPartial('');
      try {
        console.log('[Reisebuero] handleUtterance:', t.slice(0, 100));
        const phase = useReisebueroStore.getState().trip.phase;

        if (
          (phase === 'results' || phase === 'detail' || phase === 'verify') &&
          (looksLikeVerifyRequest(t) || looksLikeGapAddOn(t))
        ) {
          ingest(t);
          const speech = await runLiveVerify(t);
          await speakSafe(speech);
          return;
        }

        // Akt-4 Magazin: Mic-Feinschliff — kein Briefing-Katalog
        if (phase === 'results' || phase === 'detail' || phase === 'verify') {
          const {
            composeMagazineRefineAck,
            magazineWantsResearchAgain,
          } = require('../reisebuero/magazineRefine') as typeof import('../reisebuero/magazineRefine');
          ingest(t);
          if (magazineWantsResearchAgain(t)) {
            await runFunnelAfterConfirm();
            return;
          }
          const speech = composeMagazineRefineAck(useReisebueroStore.getState().trip.ledger, t);
          await speakSafe(speech);
          syncSearchReadySticky();
          return;
        }

        if (phase === 'recap') {
          if (isRecapConfirm(t)) {
            ingest(t);
            await runFunnelAfterConfirm();
            return;
          }
          if (isRecapChange(t)) {
            if (isRecapHardRestart(t)) {
              setPhase('briefing');
              ingest(t);
              const speech = await runBriefingReply();
              await speakSafe(speech);
              syncSearchReadySticky();
              return;
            }
            ingest(t);
            const speech = await runRecapSpeech();
            await speakSafe(speech);
            syncSearchReadySticky();
            return;
          }
          // Additive / sonstiges auf Recap → Akt 2 bleiben, Flipchart refreshen
          if (isRecapAdditive(t)) {
            ingest(t);
            syncSearchReadySticky();
            if (recapAdditiveWantsSearch(t)) {
              await runFunnelAfterConfirm();
              return;
            }
            const speech = await runRecapSpeech();
            await speakSafe(speech);
            return;
          }
        }

        // „Ja“ nur auf Ready/Wrap-up → Kurzcheck — nicht jedes Ja nach Ready-Flag
        const keys = useReisebueroStore.getState().trip.askedSlotKeys;
        const lastAsk = keys[keys.length - 1];
        if (
          phase === 'briefing' &&
          (lastAsk === 'ready_announce' || lastAsk === 'wrap_up') &&
          isRecapConfirm(t) &&
          !RECAP_REJECT_RE.test(t)
        ) {
          ingest(t);
          const after = useReisebueroStore.getState().trip;
          if (after.ledger.recapDone?.value || isRecapConfirm(t)) {
            busyRef.current = true;
            setBusy(true);
            try {
              const speech = await runRecapSpeech();
              await speakSafe(speech);
            } finally {
              busyRef.current = false;
              setBusy(false);
            }
            return;
          }
        }

        ingest(t);
        const afterIngest = useReisebueroStore.getState().trip;
        if (afterIngest.phase === 'briefing' && afterIngest.ledger.recapDone?.value) {
          const speech = await runRecapSpeech();
          await speakSafe(speech);
          return;
        }
        const speech = await runBriefingReply();
        await speakSafe(speech);
        syncSearchReadySticky();
      } catch (e) {
        console.warn('[Reisebuero] handleUtterance failed', e);
      } finally {
        busyRef.current = false;
        setBusy(false);
        const queued = pendingRef.current.shift();
        if (queued) {
          void handleRef.current(queued);
        } else if (!typingRef.current && !userMutedMicRef.current) {
          void (async () => {
            await waitReisebueroSpeechIdle({ postIdleMs: 480 });
            if (userMutedMicRef.current || typingRef.current) return;
            if (!useReisebueroStore.getState().overlayOpen) return;
            // Nach Frage: STT hart neu — Capture-Mode darf nicht „listening aber taub“ bleiben
            await ensureReisebueroMicListening();
            await new Promise((r) => setTimeout(r, 350));
            if (userMutedMicRef.current || typingRef.current) return;
            if (!useReisebueroStore.getState().overlayOpen) return;
            await ensureReisebueroMicListening();
          })();
        }
      }
    },
    [ingest, runFunnelAfterConfirm, setPhase, speakSafe, syncSearchReadySticky],
  );
  handleRef.current = handleUtterance;

  // Ask-Server / Deep-Link / Tippfeld → dieselbe Pipeline wie Mic/Senden
  const pendingUtterance = useReisebueroStore((s) => s.pendingUtterance);
  useEffect(() => {
    if (!visible || uiMode !== 'active') return;
    if (!pendingUtterance) return;
    const t = useReisebueroStore.getState().consumePendingUtterance();
    if (!t) return;
    void handleRef.current(t);
  }, [pendingUtterance, visible, uiMode]);

  const micHandlers = useCallback(
    () => ({
      onUtterance: (text: string) => handleRef.current(text),
      onPartial: (text: string) => {
        const t = (text || '').trim();
        if (!t) return;
        setPartial(t);
        if (subtitleFadeRef.current) clearTimeout(subtitleFadeRef.current);
        subtitleFadeRef.current = null;
        // Live-Flipchart: während Reden Stickers nachziehen (debounced)
        if (livePartialTimerRef.current) clearTimeout(livePartialTimerRef.current);
        livePartialTimerRef.current = setTimeout(() => {
          livePartialTimerRef.current = null;
          try {
            ingestLivePartial(t);
          } catch {
            /* soft */
          }
        }, 380);
      },
      onPhase: setMicPhase,
    }),
    [ingestLivePartial],
  );

  useEffect(() => {
    const ids = notes.map((n) => n.id);
    const added = ids.filter((id) => !prevNoteIds.current.has(id));
    prevNoteIds.current = new Set(ids);
    if (!added.length) return;
    setFreshIds(new Set(added));
    const timer = setTimeout(() => setFreshIds(new Set()), 5000);
    return () => clearTimeout(timer);
  }, [notes]);

  useEffect(() => {
    return subscribeReisebueroMic((_on, phase) => setMicPhase(phase));
  }, []);

  // Untertitel: nach Cut / Pause schnell ausblenden (kein Status-Banner)
  useEffect(() => {
    if (micPhase === 'listening') return;
    if (!partial.trim()) return;
    if (subtitleFadeRef.current) clearTimeout(subtitleFadeRef.current);
    subtitleFadeRef.current = setTimeout(() => {
      setPartial('');
      subtitleFadeRef.current = null;
    }, 1100);
    return () => {
      if (subtitleFadeRef.current) clearTimeout(subtitleFadeRef.current);
    };
  }, [micPhase, partial]);

  useEffect(() => {
    if (!visible) {
      setPartial('');
      if (subtitleFadeRef.current) {
        clearTimeout(subtitleFadeRef.current);
        subtitleFadeRef.current = null;
      }
    }
  }, [visible]);


  // Tastatur zu → Mic wieder an (Inset kommt aus useKeyboardInset).
  const prevKbOpen = useRef(false);
  useEffect(() => {
    if (!visible) {
      prevKbOpen.current = false;
      typingRef.current = false;
      return;
    }
    const wasOpen = prevKbOpen.current;
    prevKbOpen.current = kbOpen;
    if (wasOpen && !kbOpen) {
      typingRef.current = false;
      if (busyRef.current || sendHoldRef.current || isReisebueroMicHeldForTts()) return;
      void resumeReisebueroMicAfterTyping();
    }
  }, [visible, kbOpen]);

  const micHandlersRef = useRef(micHandlers);
  micHandlersRef.current = micHandlers;
  const speakSafeRef = useRef(speakSafe);
  speakSafeRef.current = speakSafe;
  const syncReadyRef = useRef(syncSearchReadySticky);
  syncReadyRef.current = syncSearchReadySticky;

  // Boot nur im aktiven Trip (nicht im Hub) — neue Trip-ID = neues Greeting + Mic
  useEffect(() => {
    if (!visible) {
      reisebueroBootedTripId = null;
      void stopReisebueroMic();
      return;
    }
    void hydrateTripShelf();
    if (uiMode !== 'active') {
      reisebueroBootedTripId = null;
      void stopReisebueroMic();
      return;
    }
    const tripId = useReisebueroStore.getState().trip.id;
    if (reisebueroBootedTripId === tripId) return;
    reisebueroBootedTripId = tripId;
    userMutedMicRef.current = false;

    void (async () => {
      try {
        Keyboard.dismiss();
        inputRef.current?.blur();
      } catch {
        /* soft */
      }
      const snapshot = useReisebueroStore.getState().trip;
      const userTurns = snapshot.chat.filter((c) => c.role === 'user').length;
      const last = snapshot.chat[snapshot.chat.length - 1];
      setBusy(true);
      busyRef.current = true;
      try {
        if (userTurns === 0) {
          const existing = snapshot.chat.find((c) => c.role === 'assistant')?.text;
          const speech = existing?.trim() || (await runOpeningGreeting());
          await speakSafeRef.current(speech);
        } else if (last?.role === 'user') {
          const speech = await runBriefingReply();
          await speakSafeRef.current(speech);
          syncReadyRef.current();
        }
      } catch (e) {
        console.warn('[Reisebuero] opening speech failed', e);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }

      if (!useReisebueroStore.getState().overlayOpen) return;
      if (useReisebueroStore.getState().uiMode !== 'active') return;
      if (useReisebueroStore.getState().trip.id !== tripId) return;
      await waitReisebueroSpeechIdle({ postIdleMs: 200 });
      if (!useReisebueroStore.getState().overlayOpen) return;
      if (useReisebueroStore.getState().uiMode !== 'active') return;
      if (useReisebueroStore.getState().trip.id !== tripId) return;

      const res = await startReisebueroMic(micHandlersRef.current());
      if (!res.ok) {
        // Tippen-only Geräte (z. B. S7 ohne Speech Services): kein Blocker-Alert.
        console.warn('[Reisebuero] auto-mic soft-fail:', res.message);
        userMutedMicRef.current = true;
        return;
      }
      userMutedMicRef.current = false;
      await ensureReisebueroMicListening();
    })();
  }, [visible, uiMode, hydrateTripShelf, trip.id]);

  const send = useCallback(async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    sendHoldRef.current = true;
    Keyboard.dismiss();
    inputRef.current?.blur();
    // Tippen IMMER verarbeiten — nie hinter Greeting/busy verschwinden.
    try {
      await handleUtterance(t);
    } finally {
      sendHoldRef.current = false;
    }
  }, [draft, handleUtterance]);

  const onInputFocus = useCallback(() => {
    typingRef.current = true;
    sendHoldRef.current = false;
    void pauseReisebueroMicForTyping();
  }, []);

  const onInputBlur = useCallback(() => {
    typingRef.current = false;
    if (busyRef.current || sendHoldRef.current || isReisebueroMicHeldForTts()) {
      // Nicht hängen lassen: sobald TTS/busy weg, Mic wieder an (Force, nicht nur unpause).
      void (async () => {
        for (let i = 0; i < 48; i += 1) {
          await new Promise((r) => setTimeout(r, 250));
          if (!useReisebueroStore.getState().overlayOpen) return;
          if (typingRef.current || userMutedMicRef.current) return;
          if (busyRef.current || sendHoldRef.current) continue;
          // Nach Timeout processing trotzdem lösen — sonst Mic tot
          if (i >= 12 || !isReisebueroMicHeldForTts()) {
            await ensureReisebueroMicListening();
            return;
          }
        }
        if (!userMutedMicRef.current && !typingRef.current) {
          await ensureReisebueroMicListening();
        }
      })();
      return;
    }
    void resumeReisebueroMicAfterTyping();
  }, []);

  /** Optional: Mute — bei Stop noch offenen Text committen. */
  const toggleMic = useCallback(async () => {
    if (listening || isReisebueroMicActive() || micPhase === 'processing') {
      setPartial('');
      userMutedMicRef.current = true;
      await stopReisebueroMic();
      return;
    }
    userMutedMicRef.current = false;
    const res = await startReisebueroMic(micHandlers());
    if (!res.ok && res.message) {
      setMicNotice(res.message);
    }
  }, [listening, micHandlers, micPhase]);

  // Session tot / Phase idle / processing klebt ohne busy → Mic heilen (außer User-Mute/Tippen)
  useEffect(() => {
    if (!visible || uiMode !== 'active') return;
    if (userMutedMicRef.current || typingRef.current || kbOpen) return;
    const phaseNow = useReisebueroStore.getState().trip.phase;
    if (phaseNow === 'research') return;
    const stuckProcessing = micPhase === 'processing' && !busy;
    if (busy && !stuckProcessing) return;
    if (micPhase === 'listening' && !stuckProcessing) return;
    const delay = stuckProcessing ? 2200 : 1400;
    const timer = setTimeout(() => {
      if (userMutedMicRef.current || typingRef.current || busyRef.current) return;
      if (!useReisebueroStore.getState().overlayOpen) return;
      if (uiMode !== 'active') return;
      const tripNow = useReisebueroStore.getState().trip;
      if (tripNow.phase === 'research' || tripNow.searching) return;
      void ensureReisebueroMicListening();
    }, delay);
    return () => clearTimeout(timer);
  }, [busy, kbOpen, micPhase, uiMode, visible]);

  // Briefing-/Magazin-Heartbeat: alle 5s prüfen, ob Mic wirklich lebt
  useEffect(() => {
    if (!visible || uiMode !== 'active') return;
    const phase = trip.phase;
    const inBrief = phase === 'briefing' || phase === 'recap';
    const inMagazine =
      Boolean(trip.selectedOptionId) &&
      (phase === 'results' || phase === 'detail' || phase === 'verify');
    if (!inBrief && !inMagazine) return;
    const tick = setInterval(() => {
      if (userMutedMicRef.current || typingRef.current || kbOpen || busyRef.current) return;
      if (isReisebueroMicHeldForTts()) return;
      if (!useReisebueroStore.getState().overlayOpen) return;
      void ensureReisebueroMicListening();
    }, 5000);
    return () => clearInterval(tick);
  }, [kbOpen, trip.phase, trip.selectedOptionId, uiMode, visible]);

  const startRecap = useCallback(async () => {
    busyRef.current = true;
    setBusy(true);
    try {
      const speech = await runRecapSpeech();
      await speakSafe(speech);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [speakSafe]);

  const search = useCallback(() => {
    // Während Recherche: erneut starten (kein Early-Return auf searching)
    if (trip.searching || trip.phase === 'research') {
      busyRef.current = true;
      setBusy(true);
      void (async () => {
        try {
          await runFunnelAfterConfirm();
        } finally {
          busyRef.current = false;
          setBusy(false);
        }
      })();
      return;
    }

    if (busyRef.current) return;

    if (trip.phase === 'recap' && briefScore.zone === 'green') {
      busyRef.current = true;
      setBusy(true);
      void (async () => {
        try {
          await runFunnelAfterConfirm();
        } finally {
          busyRef.current = false;
          setBusy(false);
        }
      })();
      return;
    }

    // Grün = Pflicht voll → direkt Recap/Suche. Gelb/Rot → hübsches Confirm.
    if (briefScore.zone === 'green') {
      void startRecap();
      return;
    }

    const must = briefMissingLines(briefScore, 'must');
    const nice = briefMissingLines(briefScore, 'nice');
    const hard = searchReadyGaps(trip.ledger).map((g) => g.label);
    const mustShow = [...new Set([...hard, ...must])].slice(0, 5);
    const thin = briefScore.zone === 'red';
    setSearchConfirm({
      title: thin ? 'Brief noch etwas dünn' : 'Noch nicht ganz fertig',
      body: mustShow.length
        ? 'Du kannst trotzdem sofort recherchieren — mit den offenen Punkten wird’s nur treffsicherer.'
        : 'Pflicht steht. Optionaler Feinschliff wäre nice — oder direkt loslegen.',
      must: mustShow,
      nice: nice.slice(0, 4),
      zone: briefScore.zone,
      scoreHint: `Brief ${briefScore.score}%`,
      hero: thin ? '📝' : '🪴',
    });
  }, [briefScore, runFunnelAfterConfirm, startRecap, trip.ledger, trip.phase, trip.searching]);

  const close = useCallback(() => {
    void stopReisebueroMic();
    onClose();
  }, [onClose]);

  const micStyle = listening
    ? styles.micListen
    : thinkingUi
      ? styles.micThink
      : styles.micStandby;

  const micLabel = listening ? 'Mic an' : thinkingUi ? 'Kurz…' : 'Mic';

  const searchLabel =
    trip.phase === 'results' || trip.phase === 'detail'
      ? 'Zur Auswertung'
      : trip.searching || trip.phase === 'research'
        ? 'Erneut suchen'
        : trip.phase === 'recap'
          ? 'Passt — Suche starten'
          : briefScore.zone === 'green'
            ? `Grün · Suche starten · ${briefScore.score}%`
            : briefScore.zone === 'yellow'
              ? `Gelb · Suche möglich · ${briefScore.score}%`
              : `Rot · Brief ${briefScore.score}%`;

  const searchBtnZoneStyle =
    trip.phase === 'results' || trip.phase === 'detail'
      ? styles.searchBtnGreen
      : trip.phase === 'recap'
        ? briefScore.zone === 'green'
          ? styles.searchBtnGreen
          : styles.searchBtnYellow
        : briefScore.zone === 'green'
          ? styles.searchBtnGreen
          : briefScore.zone === 'yellow'
            ? styles.searchBtnYellow
            : styles.searchBtnRed;

  const briefHintColor =
    briefScore.zone === 'green'
      ? colors.online
      : briefScore.zone === 'yellow'
        ? colors.accent
        : colors.danger;

  if (!visible) return null;

  if (uiMode === 'hub') {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: padBottom }]}>
          <SwipeBackView enabled onBack={close} style={styles.flex} captureHardwareBack>
            <SafeAreaView style={styles.safe} edges={['top']}>
              <View style={styles.top}>
                <Pressable onPress={close} accessibilityLabel="Schließen" style={styles.iconBtn}>
                  <Feather name="x" size={22} color={colors.text} />
                </Pressable>
                <View style={styles.titleCol}>
                  <Text style={styles.title}>Yorros Reisebüro</Text>
                  <Text style={styles.actBadge}>Deine Reisen</Text>
                </View>
                <Pressable
                  onPress={() => {
                    startNewTrip();
                  }}
                  accessibilityLabel="Neue Reise"
                  style={styles.iconBtn}
                >
                  <Feather name="plus" size={24} color={colors.accent} />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.hubBody}>
                {!savedTrips.length ? (
                  <Text style={styles.hubEmpty}>
                    Noch keine gespeicherte Reise. Tippe +, um eine neue zu planen.
                  </Text>
                ) : (
                  savedTrips.map((t) => {
                    const preview = (t.llmFlipchartNotes || []).slice(0, 6);
                    const hasResults = (t.options?.length ?? 0) > 0;
                    return (
                      <Pressable
                        key={t.id}
                        style={styles.hubCard}
                        onPress={() => openSavedTrip(t.id)}
                        onLongPress={() => {
                          setDeleteConfirm({ id: t.id, title: tripShelfTitle(t) });
                        }}
                      >
                        <View style={styles.hubCardTop}>
                          <Text style={styles.hubCardTitle}>{tripShelfTitle(t)}</Text>
                          <Text style={styles.hubCardMeta}>
                            {hasResults ? 'Auswertung bereit' : REISE_ACT_LABEL[phaseToAct(t.phase)] || 'Planen'}
                          </Text>
                        </View>
                        <View style={styles.hubChips}>
                          {preview.map((n) => (
                            <View key={n.id} style={[styles.hubChip, tierStyle(n.tier)]}>
                              <Text style={styles.hubChipText} numberOfLines={1}>
                                {n.emoji} {n.label}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
              <Pressable style={styles.hubPlusBtn} onPress={() => startNewTrip()}>
                <Feather name="plus" size={22} color={colors.bg} />
                <Text style={styles.hubPlusText}>Neue Reise planen</Text>
              </Pressable>
            </SafeAreaView>
          </SwipeBackView>
        </View>
        {deleteConfirm ? (
          <ConfirmSheet
            title="Reise löschen?"
            body={`„${deleteConfirm.title}“ wirklich aus dem Regal nehmen?`}
            zone="red"
            primaryLabel="Löschen"
            primaryTone="danger"
            onCancel={() => setDeleteConfirm(null)}
            onPrimary={() => {
              deleteSavedTrip(deleteConfirm.id);
              setDeleteConfirm(null);
            }}
          />
        ) : null}
      </View>
    );
  }

  const isRecap = trip.phase === 'recap';
  // Akt 2: Flipchart/Legend unverändert — nur Badge + Board-Frage wechseln
  const showLegend =
    !inResearch &&
    trip.askedSlotKeys.filter((k) => k !== 'ready_announce' && k !== 'keep_talking' && k !== 'wrap_up')
      .length < 3;
  const actNum =
    (['collect', 'confirm', 'research', 'present', 'commit'].indexOf(phaseToAct(trip.phase)) + 1) || 1;
  const actLabel = inResearch
    ? 'Akt 3'
    : isRecap
      ? 'Akt 2'
      : `Akt ${actNum} · ${REISE_ACT_LABEL[phaseToAct(trip.phase)]}`;
  const headerTitle = inResearch
    ? 'Recherche'
    : reiseHeaderTitle(trip, { showLegend });

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.sheet, { paddingBottom: padBottom }]}>
        <SwipeBackView
          enabled
          onBack={selected ? () => selectOption(null) : close}
          style={styles.flex}
          captureHardwareBack
        >
          <SafeAreaView style={styles.safe} edges={['top']}>
            {selected ? null : (
            <View style={styles.top}>
              <Pressable
                onPress={() => {
                  void stopReisebueroMic();
                  backToHub();
                }}
                accessibilityLabel="Zurück zu Reisen"
                style={styles.iconBtn}
              >
                <Feather name="chevron-left" size={24} color={colors.text} />
              </Pressable>
              <View style={styles.titleCol}>
                <Text style={styles.title} numberOfLines={1}>
                  {headerTitle}
                </Text>
                <Text style={styles.actUnderTitle} numberOfLines={1}>
                  {actLabel}
                </Text>
              </View>
              <Pressable onPress={close} accessibilityLabel="Schließen" style={styles.iconBtn}>
                <Feather name="x" size={22} color={colors.text} />
              </Pressable>
            </View>
            )}

            {selected ? (
              <View style={styles.flex}>
                <TripStoryScroll
                  opt={selected}
                  siblings={trip.options}
                  onClose={() => selectOption(null)}
                  onSwitch={(id) => selectOption(id)}
                  onExit={close}
                />
              </View>
            ) : inResearch ? (
              <View style={styles.flex}>
                <ResearchTheater
                  steps={trip.researchSteps}
                  sparks={trip.researchSparks ?? []}
                  verifyProgress={trip.verifyProgress}
                  etaMin={trip.researchEtaMin}
                  error={trip.searchError}
                />
              </View>
            ) : (
              <ScrollView
                ref={scrollRef}
                contentContainerStyle={styles.body}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {trip.phase === 'results' || trip.phase === 'detail' || trip.phase === 'verify' ? (
                  /* Akt 4: nur Optionen + Favoriten-Pitch — kein Flipchart oben */
                  null
                ) : (
                  <FlipchartBoard
                    notes={notes}
                    freshIds={isRecap ? new Set() : freshIds}
                    showLegend={showLegend}
                    question={boardQuestionShort}
                    shelfChips={shelfChips}
                  />
                )}

                {busy ? (
                  <ActivityIndicator color={colors.thinking} style={{ marginVertical: 6 }} />
                ) : null}

                {trip.searchError ? <Text style={styles.err}>{trip.searchError}</Text> : null}

                {trip.options.length ? (
                  <View style={styles.tiles}>
                    <Text style={styles.coverHint}>
                      {magazineOptionsCoverHint(trip.ledger, trip.options.length)}
                    </Text>
                    {trip.options
                      .slice(0, Math.max(targetOptionCount(trip.ledger), 2))
                      .map((opt) => (
                      <OptionCard
                        key={opt.id}
                        opt={opt}
                        ledger={trip.ledger}
                        selected={false}
                        onPress={() => selectOption(opt.id)}
                      />
                    ))}
                    <Pressable onPress={bumpRefine} style={styles.refineBtn}>
                      <Text style={styles.refineText}>Brief ändern</Text>
                    </Pressable>
                  </View>
                ) : null}
              </ScrollView>
            )}

            {inResearch ? null : (
            <View
              style={[
                styles.composer,
                kbOpen ? styles.composerKb : null,
                selected ? styles.composerMagazine : null,
              ]}
            >
                <View style={styles.subtitleLane} pointerEvents="none">
                  {partial.trim() ? <SubtitlesSlot text={partial.trim()} /> : null}
                </View>
              <View style={styles.inputRow}>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={selected ? 'Feedback zum Plan…' : 'Antwort tippen…'}
                  placeholderTextColor={colors.textMuted}
                  editable={true}
                  onFocus={onInputFocus}
                  onBlur={onInputBlur}
                  onSubmitEditing={() => void send()}
                  blurOnSubmit
                  submitBehavior="submit"
                  returnKeyType="send"
                  enablesReturnKeyAutomatically
                  autoFocus={false}
                  testID="reisebueroTypeInput"
                />
                <Pressable
                  onPress={() => void send()}
                  style={styles.send}
                  accessibilityLabel="Senden"
                >
                  <Feather name="send" size={18} color={colors.bg} />
                </Pressable>
              </View>

              {kbOpen ? null : (
                <>
                  {selected ? null : (
                    <Pressable
                      onPress={search}
                      style={[styles.searchBtn, searchBtnZoneStyle]}
                    >
                      <Text style={styles.searchBtnText}>{searchLabel}</Text>
                    </Pressable>
                  )}
                  {!selected && trip.phase === 'briefing' ? (
                    <Text style={[styles.briefHint, { color: briefHintColor }]}>
                      {briefScoreHint(briefScore)}
                    </Text>
                  ) : null}

                  <Pressable
                    onPress={() => void toggleMic()}
                    disabled={trip.frozen && !listening}
                    style={[styles.micBtn, selected ? styles.micBtnMagazine : null, micStyle]}
                    accessibilityLabel={listening ? 'Mikrofon optional stummschalten' : 'Mikrofon wieder einschalten'}
                  >
                    <Feather
                      name={listening ? 'stop-circle' : thinkingUi ? 'loader' : 'mic'}
                      size={selected ? 32 : 28}
                      color={colors.bg}
                    />
                    <Text style={styles.micLabel}>
                      {selected
                        ? listening
                          ? 'Zuhören…'
                          : thinkingUi
                            ? 'Kurz…'
                            : 'Sag Feedback'
                        : micLabel}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
            )}
          </SafeAreaView>
        </SwipeBackView>
      </View>
      {searchConfirm ? (
        <ConfirmSheet
          title={searchConfirm.title}
          body={searchConfirm.body}
          zone={searchConfirm.zone}
          must={searchConfirm.must}
          nice={searchConfirm.nice}
          scoreHint={searchConfirm.scoreHint}
          hero={searchConfirm.hero}
          primaryLabel="Trotzdem recherchieren"
          cancelLabel="Noch ergänzen"
          onCancel={() => setSearchConfirm(null)}
          onPrimary={() => {
            setSearchConfirm(null);
            void (async () => {
              if (busyRef.current) return;
              busyRef.current = true;
              setBusy(true);
              try {
                // Soft: Defaults für offene Booking-Pflicht, dann Recherche
                await runFunnelAfterConfirm({ softForce: true });
              } finally {
                busyRef.current = false;
                setBusy(false);
              }
            })();
          }}
        />
      ) : null}
      {micNotice ? (
        <ConfirmSheet
          title="Mikrofon"
          body={micNotice}
          zone="yellow"
          primaryLabel="Alles klar"
          singleAction
          onPrimary={() => setMicNotice(null)}
        />
      ) : null}
    </View>
  );
});

function FlipchartBoard({
  notes,
  freshIds,
  compact,
  showLegend = true,
  question,
  shelfChips = [],
}: {
  notes: FlipchartNote[];
  freshIds: Set<string>;
  compact?: boolean;
  showLegend?: boolean;
  question?: string;
  /** Prefs vom Shelf — gefragt früher → abgehakt (✓ Thema). */
  shelfChips?: { id: string; topic: string }[];
}) {
  const empty = !notes.length;

  return (
    <View style={[styles.boardWrap, compact ? styles.boardWrapCompact : null]}>
      <Text style={styles.boardQuestion} numberOfLines={3}>
        {question?.trim() || 'Wie kann ich dir helfen?'}
      </Text>

      {shelfChips.length ? (
        <View style={styles.shelfChipRow} accessibilityLabel="Prefs vom Shelf abgehakt">
          {shelfChips.map((c) => (
            <Text key={c.id} style={styles.shelfChip}>
              ✓ {c.topic}
            </Text>
          ))}
        </View>
      ) : null}

      {compact || !showLegend ? null : (
        <View style={styles.legendRow}>
          <Text style={styles.legendChipMust}>🟢 Muss</Text>
          <Text style={styles.legendChipWish}>🟡 Wunsch</Text>
          <Text style={styles.legendChipOpt}>⚪ Optional</Text>
          <Text style={styles.legendChipNope}>🔴 No-Go</Text>
        </View>
      )}

      {empty ? (
        <View style={styles.boardEmptyWrap}>
          <Text style={styles.boardEmptyEmoji}>✨🎤🎯</Text>
          <Text style={styles.boardEmpty}>
            Noch nichts angepinnt — erzähl einfach los, Stickers poppen live rein.
          </Text>
        </View>
      ) : (
        <View style={styles.noteRow}>
          {notes.map((n, i) => (
            <NoteSticker
              key={n.id}
              note={n}
              fresh={freshIds.has(n.id)}
              tilt={(i % 5) - 2}
              bounce={freshIds.has(n.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function NoteSticker({
  note,
  fresh,
  tilt = 0,
  bounce = false,
}: {
  note: FlipchartNote;
  fresh?: boolean;
  tilt?: number;
  bounce?: boolean;
}) {
  const raw = (note.emoji || '').trim();
  const emoji =
    !raw || isPinNeedleEmoji(raw) || raw === '📝'
      ? emojiForWishText(note.label, '✨')
      : raw;
  const scale = useRef(new Animated.Value(bounce ? 0.72 : 1)).current;
  useEffect(() => {
    if (!bounce) return;
    scale.setValue(0.72);
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [bounce, note.id, scale]);

  return (
    <Animated.View
      style={[
        styles.sticker,
        tierStyle(note.tier),
        fresh ? styles.stickerFresh : null,
        {
          transform: [{ rotate: `${tilt * 0.55}deg` }, { scale }],
        },
      ]}
    >
      <Text style={styles.stickerEmoji}>{emoji}</Text>
      <Text style={styles.stickerLabel}>{note.label}</Text>
    </Animated.View>
  );
}

function tierStyle(tier: NoteTier) {
  if (tier === 'critical') return styles.stickerMust;
  if (tier === 'nope') return styles.stickerNope;
  if (tier === 'optional') return styles.stickerOptional;
  return styles.stickerSoft;
}

function OptionCard({
  opt,
  ledger,
  selected,
  onPress,
}: {
  opt: ReiseOption;
  ledger: ReiseLedger;
  selected: boolean;
  onPress: () => void;
}) {
  const scoreColor =
    opt.matchScore >= 92 ? colors.online : opt.matchScore >= 80 ? colors.accent : colors.danger;
  const photo = resolveOptionPhoto(opt);
  const headline = buildCoverHeadline(opt, ledger);
  const subline = buildCoverSubline(opt, ledger);
  const price = opt.buyInEur ?? opt.pricePerPerson;
  const fenster = (opt.decisionNotes ?? [])
    .find((d) => /^Fenster:/i.test(d))
    ?.replace(/^Fenster:\s*/i, '')
    .trim();
  const staySpur = (opt.decisionNotes ?? [])
    .find((d) => /^Stay-Spur:/i.test(d))
    ?.replace(/^Stay-Spur:\s*/i, '')
    .trim();
  const kindBadge = fenster
    ? `Flugfenster · ${fenster}`
    : staySpur
      ? `Stay-Spur · ${staySpur}`
      : null;
  return (
    <Pressable onPress={onPress} style={[styles.card, selected && styles.cardOn]}>
      <View style={styles.cardTop}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.cardImg} />
        ) : (
          <View style={[styles.cardImg, styles.tileImgPh]} />
        )}
        <View style={[styles.match, { borderColor: scoreColor }]}>
          <Text style={[styles.matchPct, { color: scoreColor }]}>{opt.matchScore}%</Text>
          <Text style={styles.matchCap}>Match</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        {kindBadge ? <Text style={styles.cardFenster}>{kindBadge}</Text> : null}
        <Text style={styles.cardTitle}>{headline}</Text>
        <Text style={styles.cardPlace}>{subline}</Text>
        {price != null ? (
          <Text style={styles.cardPrice}>{Math.round(price)}€ p.P.</Text>
        ) : (
          <Text style={styles.cardPriceMuted}>Preis live offen</Text>
        )}
        {opt.facts.length ? <FactRow facts={opt.facts} /> : null}
        <Text style={styles.cardOpenCta}>Reise ansehen →</Text>
      </View>
    </Pressable>
  );
}

function FactRow({ facts }: { facts: FactThumb[] }) {
  return (
    <View style={styles.facts}>
      {facts.map((f) => (
        <View key={f.id} style={[styles.fact, f.met ? styles.factMet : styles.factMiss]}>
          <Text style={styles.factEmoji}>{f.emoji}</Text>
          <Feather
            name={f.met ? 'thumbs-up' : 'thumbs-down'}
            size={12}
            color={f.met ? colors.online : colors.danger}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.overlay,
    backgroundColor: 'rgba(8,20,16,0.55)',
  },
  sheet: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  safe: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  titleCol: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  actUnderTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  actBadge: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 2 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 16, gap: 10 },
  bodyDetail: { flexGrow: 1, paddingBottom: 8 },
  boardWrap: {
    marginTop: 0,
    gap: 12,
  },
  boardWrapCompact: { marginTop: 0 },
  boardQuestion: {
    color: colors.accent,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  shelfChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: -4,
  },
  shelfChip: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  boardEmpty: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'left',
    paddingVertical: 4,
  },
  boardEmptyWrap: { gap: 6, paddingVertical: 4 },
  boardEmptyEmoji: { fontSize: 22, letterSpacing: 4 },
  pitchBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(196,163,90,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(196,163,90,0.45)',
    marginBottom: 4,
  },
  pitchEmoji: { fontSize: 22, lineHeight: 26 },
  pitchBody: { flex: 1, gap: 2 },
  pitchTitle: { color: colors.accent, fontWeight: '800', fontSize: 15 },
  pitchWhy: { color: colors.text, fontSize: 13, lineHeight: 18 },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendChipMust: { color: colors.online, fontSize: 11, fontWeight: '700' },
  legendChipWish: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  legendChipOpt: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  legendChipNope: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  noteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'flex-start',
  },
  sticker: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  stickerMust: { backgroundColor: 'rgba(159,224,180,0.92)', borderColor: 'rgba(47,143,85,0.4)' },
  stickerSoft: { backgroundColor: 'rgba(246,225,138,0.92)', borderColor: 'rgba(196,160,53,0.4)' },
  stickerOptional: { backgroundColor: 'rgba(255,255,255,0.86)', borderColor: 'rgba(255,255,255,0.35)' },
  stickerNope: { backgroundColor: 'rgba(240,160,148,0.92)', borderColor: 'rgba(179,74,60,0.4)' },
  stickerFresh: { borderWidth: 2, borderColor: '#4F8CFF' },
  stickerEmoji: { fontSize: 14, lineHeight: 18 },
  stickerLabel: {
    color: '#1A2E28',
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 15,
    flexShrink: 1,
  },
  subtitleLane: {
    minHeight: SUBTITLE_SLOT_H,
    justifyContent: 'center',
    marginBottom: 2,
  },
  hubBody: { padding: spacing.md, gap: 12, paddingBottom: 24 },
  hubEmpty: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 48,
    lineHeight: 22,
  },
  hubCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  hubCardTop: { gap: 2 },
  hubCardTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  hubCardMeta: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  hubChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hubChip: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    maxWidth: '48%',
  },
  hubChipText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  hubPlusBtn: {
    margin: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  hubPlusText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  theater: {
    backgroundColor: colors.bgElevated,
    borderRadius: 18,
    padding: spacing.md,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  theaterHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  theaterHeroEmoji: { fontSize: 36 },
  theaterHeroText: { flex: 1, gap: 2 },
  theaterKicker: {
    color: colors.wave,
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  theaterTitle: { color: colors.text, fontWeight: '800', fontSize: 17, lineHeight: 22 },
  theaterPct: { color: colors.textMuted, fontSize: 11, fontWeight: '700', alignSelf: 'flex-end' },
  theaterEmpty: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  stageRail: { gap: 8, paddingVertical: 2 },
  stageChip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 88,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stageChipActive: {
    borderColor: colors.thinking,
    backgroundColor: 'rgba(120, 200, 255, 0.12)',
  },
  stageChipDone: {
    borderColor: colors.online,
    backgroundColor: 'rgba(80, 200, 140, 0.12)',
  },
  stageChipEmoji: { fontSize: 18 },
  stageChipLabel: { color: colors.text, fontSize: 11, fontWeight: '700', maxWidth: 92 },
  compareBoard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  compareBoardTitle: { color: colors.text, fontWeight: '800', fontSize: 13 },
  weatherStrip: {
    backgroundColor: 'rgba(120, 200, 255, 0.1)',
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(120, 200, 255, 0.25)',
  },
  weatherStripTitle: { color: colors.wave, fontWeight: '800', fontSize: 13 },
  themeStrip: {
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
  },
  themeStripEvents: {
    backgroundColor: 'rgba(255, 180, 80, 0.1)',
    borderColor: 'rgba(255, 180, 80, 0.28)',
  },
  themeStripWish: {
    backgroundColor: 'rgba(200, 140, 255, 0.1)',
    borderColor: 'rgba(200, 140, 255, 0.28)',
  },
  themeStripFlight: {
    backgroundColor: 'rgba(80, 180, 255, 0.1)',
    borderColor: 'rgba(80, 180, 255, 0.28)',
  },
  themeStripTitle: { color: colors.text, fontWeight: '800', fontSize: 13 },
  sparkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  liveFeed: { gap: 8 },
  liveFeedTitle: { color: colors.textMuted, fontWeight: '800', fontSize: 12 },
  sparkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '48%',
  },
  sparkChipWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sparkChipHot: { borderColor: colors.accent },
  sparkChipDeal: { borderColor: '#ff8a3d', backgroundColor: 'rgba(255,138,61,0.12)' },
  sparkChipFlight: { borderColor: colors.wave },
  sparkChipStay: { borderColor: colors.online },
  sparkEmoji: { fontSize: 16 },
  sparkTextCol: { flexShrink: 1, gap: 1 },
  sparkLabel: { color: colors.text, fontWeight: '800', fontSize: 12 },
  sparkSub: { color: colors.textMuted, fontSize: 10 },
  theaterRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  theaterDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  theaterDotPending: { backgroundColor: colors.textMuted },
  theaterDotActive: { backgroundColor: colors.thinking },
  theaterDotDone: { backgroundColor: colors.online },
  theaterDotPivot: { backgroundColor: colors.accent },
  theaterTextCol: { flex: 1, gap: 2 },
  theaterStepTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  theaterStepDetail: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  theaterStatus: { color: colors.textMuted, fontWeight: '800', width: 18, textAlign: 'center' },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.thinking,
  },
  recapBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.sm,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.online,
  },
  recapTitle: { color: colors.online, fontWeight: '800', fontSize: 14, marginBottom: 2 },
  recapLine: { color: colors.text, fontSize: 13, lineHeight: 18 },
  recapHint: { color: colors.textMuted, fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  err: { color: colors.danger, fontSize: 13 },
  tiles: { gap: 14, marginTop: 4 },
  coverHint: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardOn: { borderColor: colors.accent },
  cardTop: { position: 'relative' },
  cardImg: { width: '100%', height: 158, backgroundColor: colors.bgElevated },
  tileImgPh: { backgroundColor: colors.bgElevated },
  match: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    backgroundColor: 'rgba(15,44,36,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchPct: { fontWeight: '800', fontSize: 16 },
  matchCap: { color: colors.textMuted, fontSize: 9, fontWeight: '700' },
  cardBody: { padding: spacing.sm, gap: 4 },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 17 },
  cardFit: { color: colors.wave, fontSize: 12, fontWeight: '700' },
  cardPlace: { color: colors.textMuted, fontSize: 13 },
  cardFenster: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 12,
    marginTop: 2,
  },
  cardPrice: { color: colors.text, fontWeight: '800', fontSize: 15, marginTop: 2 },
  cardPriceMuted: { color: colors.textMuted, fontWeight: '600' },
  cardRest: { color: colors.wave, fontSize: 12, fontWeight: '600' },
  cardWhy: { color: colors.text, fontSize: 13, lineHeight: 18, marginTop: 4, fontStyle: 'italic' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  factMet: { backgroundColor: 'rgba(61,207,122,0.16)' },
  factMiss: { backgroundColor: 'rgba(217,107,92,0.16)' },
  factEmoji: { fontSize: 14 },
  refineBtn: { alignSelf: 'center', padding: 8 },
  refineText: { color: colors.accent, fontWeight: '700' },
  story: {
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    padding: spacing.md,
    gap: 10,
  },
  storyClose: { alignSelf: 'flex-start' },
  storyTopBar: { gap: 8 },
  sibRow: { flexGrow: 0 },
  sibChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginRight: 8,
  },
  sibChipOn: { backgroundColor: 'rgba(61,207,122,0.25)', borderWidth: 1, borderColor: colors.online },
  sibChipText: { color: colors.text, fontWeight: '700', fontSize: 12, maxWidth: 120 },
  storyHero: {
    width: '100%',
    height: 180,
    borderRadius: 14,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyTitle: { color: colors.text, fontWeight: '800', fontSize: 20 },
  storyPlace: { color: colors.textMuted, fontWeight: '700', fontSize: 14, marginTop: -4 },
  priceBox: {
    backgroundColor: 'rgba(196,163,90,0.12)',
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  priceSub: { color: colors.text, fontSize: 12, lineHeight: 17 },
  bookToggle: { paddingVertical: 4 },
  cardOpenCta: {
    color: colors.online,
    fontWeight: '800',
    fontSize: 13,
    marginTop: 8,
  },
  storySection: {
    color: colors.textMuted,
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  notesBlock: { gap: 2 },
  noteLine: { color: colors.text, fontSize: 13, lineHeight: 18 },
  linkBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkText: { color: colors.bg, fontWeight: '800' },
  timelineBtn: {
    backgroundColor: colors.online,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  timelineBtnText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  composer: {
    padding: spacing.md,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  composerKb: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  composerMagazine: {
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  searchBtn: { borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  /** Gelb klar als Ampel — etwas kräftiger als normales Accent-Gold. */
  searchBtnYellow: { backgroundColor: '#D4A017' },
  searchBtnGreen: { backgroundColor: colors.online },
  searchBtnRed: { backgroundColor: colors.danger },
  searchBtnText: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  briefHint: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: -4,
    marginBottom: 4,
    paddingHorizontal: 8,
    fontWeight: '600',
  },
  buyInBig: { color: colors.accent, fontWeight: '800', fontSize: 16, marginTop: 4 },
  dayPager: { gap: 8, marginTop: 8 },
  dayTabs: { flexGrow: 0 },
  dayTab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginRight: 8,
  },
  dayTabOn: { backgroundColor: 'rgba(196,163,90,0.35)', borderWidth: 1, borderColor: colors.accent },
  dayTabText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  dayBody: { gap: 6 },
  dayBlock: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  dayBlockTitle: { color: colors.text, fontWeight: '800', fontSize: 13 },
  dayBlockDetail: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  choiceRowOn: { borderColor: colors.accent, backgroundColor: 'rgba(196,163,90,0.12)' },
  choiceImg: { width: 56, height: 56, borderRadius: 8 },
  choiceTitle: { color: colors.text, fontWeight: '800', fontSize: 13 },
  choiceMeta: { color: colors.wave, fontSize: 12, fontWeight: '600' },
  linkBtnSmall: {
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  bookSheetBtn: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  bookSheet: { gap: 6, marginTop: 8 },
  bookItem: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  bookItemDone: { backgroundColor: 'rgba(61,207,122,0.2)' },
  bookItemText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  micBtn: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  micBtnMagazine: {
    paddingVertical: 18,
    minHeight: 58,
  },
  micStandby: { backgroundColor: colors.online },
  micListen: { backgroundColor: colors.danger },
  micThink: { backgroundColor: colors.thinking },
  micLabel: { color: colors.bg, fontWeight: '800', fontSize: 14, flexShrink: 1 },
  partial: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic', paddingHorizontal: 4 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
