import { create } from 'zustand';
import type { ChatMessage } from '../db/types';
import type { Poi } from '../db/types';
import type { VisitedPlaceMemory } from '../services/ai/sessionMemory';
import type {
  AttentionCue,
  NavMode,
  PendingNavOffer,
  TransportMode,
} from '../services/navigation/navigationTypes';
import type { ConciergeCardState, QuickAction } from '../types/concierge';
import type { GygWidgetOptions } from '../services/affiliate/affiliateService';
import type { CityMapView } from '../services/cityMapService';
import { ATTENTION_CUE_MS } from '../services/navigation/navigationTypes';
import { scanAttentionCue } from '../services/navigation/attentionCues';
import { hapticAttentionCue } from '../services/navigation/haptics';
import type { MultiStopTour } from '../services/navigation/multiStopTour';
import type { TravelMode } from '../services/navigation/travelModeContext';
import type { NavPhase } from '../services/navigation/navigationTypes';
import type { DiscoveryCandidate } from '../services/navigation/contextualDiscovery';
import { recordWalkFix } from '../services/discovery/walkTrackService';
import { useGpsStore } from './useGpsStore';
import { upsertCachedDestination } from '../services/navigation/offlineNavCache';
import { saveStampPassport } from '../services/navigation/stampPassportPersistence';

/** ~0.8 m — skip Finnus lat/lng notify for GPS jitter (UI coords: useGpsStore). */
const GPS_EPS_DEG = 0.000008;

export type GpsStatus = 'idle' | 'searching' | 'fix' | 'denied';

/** Findus-Präsenz: ok=grün, degraded=orange, offline=grau. */
export type FindusPresence = 'ok' | 'degraded' | 'offline';

/** TTS-Backend: Cartesia sonic-3.5 (primär) oder System-Fallback (Dev). */
export type TtsProvider = 'cartesia' | 'system';

let attentionClearTimer: ReturnType<typeof setTimeout> | null = null;

interface FinnusState {
  currentLocationName: string | null;
  currentPoiId: number | null;
  chatHistory: ChatMessage[];
  /** Gesprochener Text für Live-Untertitel (1:1 Wort-Feed). */
  subtitleText: string | null;
  isSimulationMode: boolean;
  /**
   * TTS-Session aktiv (Synth + Playback) — blockiert andere Module.
   * Nicht für Kreis/„Ich erzähle“ nutzen → siehe isAudiblySpeaking.
   */
  isPlayingAudio: boolean;
  /**
   * Echt hörbares Audio läuft gerade.
   * Steuert Kreis-Standby, „Ich erzähle…“ und Untertitel-Idle.
   */
  isAudiblySpeaking: boolean;
  isListening: boolean;
  isGenerating: boolean;
  /** Route wird gerade berechnet (Kompass blau drehen). */
  navRouteLoading: boolean;
  /** Präsenzfarbe: ok=grün, degraded=orange, offline=grau. */
  findusPresence: FindusPresence;
  lastVisitedPoiId: number | null;
  /** Session: letzter Food-/Mahlzeit-Hinweis (Cooldown). */
  lastMealHintAtMs: number | null;
  /** Session: Spot-Keys mit Soft-Pitch. */
  softPitchedSpotKeys: string[];
  /** Spot-Keys, deren Wegweiser schon gespielt wurde. */
  heardApproachSpotKeys: string[];
  /** Alle in dieser Tour gesprochenen Fakt-Keys (Dedup). */
  toldFactKeys: string[];
  /** Tour-Gedächtnis: besuchte Orte + Kernfakten. */
  visitedHistory: VisitedPlaceMemory[];
  pois: Poi[];
  /** GPS-Status für Entwickler / Diagnose. */
  gpsStatus: GpsStatus;
  gpsAccuracyM: number | null;
  /** true = watchPosition läuft (Real-GPS). */
  gpsWatching: boolean;
  /** true = User muss „Tour starten“ tippen (Play Prominent Disclosure). */
  needsTourStart: boolean;
  /** Zeitstempel letzter erfolgreicher Fix. */
  lastGpsAtMs: number | null;
  lastGpsLat: number | null;
  lastGpsLng: number | null;
  /** OS-Standort-Dienste an/aus (letzter Check). */
  gpsServicesEnabled: boolean | null;
  /** true wenn TTS bereit ist (Cartesia / System-Fallback) */
  ttsReady: boolean;
  /** Hinweis z. B. „Stimme wird vorbereitet…“ */
  ttsStatusMessage: string | null;
  /** 0–1 während Asset-Download, sonst null */
  ttsDownloadProgress: number | null;
  /** z. B. „Cartesia TTS wird geladen…“ */
  ttsDownloadLabel: string | null;
  /**
   * TTS-Provider: 'cartesia' = sonic-3.5 (primär).
   * 'system' = expo-speech erzwingen (Dev).
   */
  ttsProvider: TtsProvider;
  /** Premium → Gemini Pro erlaubt (sonst Flash-Lite). */
  isPremiumSubscriber: boolean;

  /** Smart Compass */
  navActive: boolean;
  navVisible: boolean;
  navMode: NavMode | null;
  navTargetName: string | null;
  navDistanceM: number | null;
  navBearingRel: number | null;
  /** Realtime walk / bicycle / transit. */
  transportMode: TransportMode | null;
  /**
   * Session-Override: Zu Fuß / Zweirad / Öffis.
   * null = aus Profil oder GPS ableiten.
   */
  preferredTravelMode: TravelMode | null;
  /** ÖPNV: verbleibende Stationen (null = nicht Transit). */
  remainingStations: number | null;
  /** Nächster Zwischenpunkt auf der Route. */
  navNextTargetName: string | null;
  /** Meter bis zum nächsten Pfeil-Ziel. */
  navLegDistanceM: number | null;
  /** Gesamtstrecke beim Nav-Start (Meter). */
  navTotalDistanceM: number | null;
  /** Rest-ETA in Minuten (nur aus Route × Pace, nie Luftlinie). */
  navEtaMin: number | null;
  /** Kurzer Turn-Hinweis für Kompass-HUD. */
  navTurnHint: string | null;
  /** Walk / board / ride / alight. */
  navPhase: NavPhase | null;
  /** Multistopp-Tour (Joggen / Erkunden / Essen). */
  multiStopTour: MultiStopTour | null;
  /** Contextual discovery Fast-Click candidates. */
  discoveryCandidates: DiscoveryCandidate[];
  /** Multi-stop queue sheet visibility. */
  stopQueueVisible: boolean;
  pendingNavOffer: PendingNavOffer | null;
  /** Weitere Optionen aus Concierge („Welchen nehmen wir?“). */
  pendingNavAlternatives: PendingNavOffer[];
  /** Conversation gate: arm when a user turn starts. */
  poiTriggerGateArmed: boolean;
  /** After assistant finished speaking, suppress POI/shop triggers briefly. */
  poiTriggerCooldownUntilMs: number | null;
  /** Strukturierte Spickzettel-Karte (nach Stimme). */
  activeConciergeCard: ConciergeCardState | null;
  /** Letztes Partner-Angebot für Voice „Ja, buchen“. */
  pendingAffiliateOffer: QuickAction | null;
  /** Einmaliger Affiliate-Hinweis in dieser Sitzung bestätigt. */
  affiliateRedirectAcked: boolean;
  /** GetYourGuide In-App-Widget. */
  gygWidget: GygWidgetOptions | null;
  /** Offizielle Stadt-/Inselkarte (WebView). */
  cityMap: CityMapView | null;
  attentionCue: AttentionCue;
  /** HomeScreen öffnet Settings, wenn sich der Timestamp ändert. */
  settingsOpenRequestAtMs: number | null;
  /** Optional: Setup-Untersektion nach Öffnen (z. B. voice). */
  settingsOpenFocus: 'voice' | null;

  setCurrentLocationName: (name: string | null) => void;
  setCurrentPoiId: (id: number | null) => void;
  setSimulationMode: (enabled: boolean) => void;
  setIsPlayingAudio: (playing: boolean) => void;
  setIsAudiblySpeaking: (speaking: boolean) => void;
  setIsListening: (listening: boolean) => void;
  setIsGenerating: (generating: boolean) => void;
  setNavRouteLoading: (loading: boolean) => void;
  setFindusPresence: (presence: FindusPresence) => void;
  /** Live-Untertitel (1:1 Wort-Feed) + Navi Attention-Cues. */
  setSubtitleText: (text: string | null) => void;
  /** Attention-Cues ohne UI-Update. */
  noteSpokenText: (text: string | null) => void;
  setTtsReady: (ready: boolean) => void;
  setTtsStatusMessage: (message: string | null) => void;
  setTtsDownloadProgress: (progress: number | null) => void;
  setTtsDownloadLabel: (label: string | null) => void;
  setTtsProvider: (provider: TtsProvider) => void;
  setIsPremiumSubscriber: (premium: boolean) => void;
  setPois: (pois: Poi[]) => void;
  setLastVisitedPoiId: (id: number | null) => void;
  setLastMealHintAtMs: (ms: number | null) => void;
  setGpsStatus: (status: GpsStatus, accuracyM?: number | null) => void;
  setGpsWatching: (watching: boolean) => void;
  setNeedsTourStart: (needs: boolean) => void;
  setGpsServicesEnabled: (enabled: boolean | null) => void;
  reportGpsFix: (fix: {
    lat: number;
    lng: number;
    accuracy?: number | null;
  }) => void;
  addSoftPitchedSpotKey: (key: string) => void;
  addHeardApproachSpotKey: (key: string) => void;
  addToldFactKeys: (keys: string[]) => void;
  addVisitedPlace: (entry: VisitedPlaceMemory) => void;
  addChatMessage: (message: ChatMessage) => void;
  setChatHistory: (messages: ChatMessage[]) => void;
  resetTourContext: () => void;

  setPreferredTravelMode: (mode: TravelMode | null) => void;
  setPendingNavOffer: (offer: PendingNavOffer | null) => void;
  setMultiStopTour: (tour: MultiStopTour | null) => void;
  setDiscoveryCandidates: (c: DiscoveryCandidate[]) => void;
  setStopQueueVisible: (visible: boolean) => void;
  setPendingNavAlternatives: (offers: PendingNavOffer[]) => void;
  setPoiTriggerGateArmed: (armed: boolean) => void;
  setPoiTriggerCooldownUntilMs: (untilMs: number | null) => void;
  setActiveConciergeCard: (card: ConciergeCardState | null) => void;
  setPendingAffiliateOffer: (action: QuickAction | null) => void;
  setAffiliateRedirectAcked: (acked: boolean) => void;
  setGygWidget: (opts: GygWidgetOptions | null) => void;
  setCityMap: (map: CityMapView | null) => void;
  requestOpenSettings: (focus?: 'voice' | null) => void;
  patchNavigation: (
    partial: Partial<{
      navActive: boolean;
      navVisible: boolean;
      navMode: NavMode | null;
      navTargetName: string | null;
      navDistanceM: number | null;
      navBearingRel: number | null;
      attentionCue: AttentionCue;
      transportMode: TransportMode | null;
      remainingStations: number | null;
      navNextTargetName: string | null;
      navLegDistanceM: number | null;
      navTotalDistanceM: number | null;
      navEtaMin: number | null;
      navTurnHint: string | null;
      navPhase: NavPhase | null;
    }>,
  ) => void;
}

function createMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    id: message.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: message.createdAt ?? Date.now(),
  };
}

export const useFinnusStore = create<FinnusState>((set, get) => ({
  currentLocationName: null,
  currentPoiId: null,
  chatHistory: [],
  subtitleText: null,
  isSimulationMode: false,
  isPlayingAudio: false,
  isAudiblySpeaking: false,
  isListening: false,
  isGenerating: false,
  navRouteLoading: false,
  findusPresence: 'ok',
  lastVisitedPoiId: null,
  lastMealHintAtMs: null,
  softPitchedSpotKeys: [],
  heardApproachSpotKeys: [],
  toldFactKeys: [],
  visitedHistory: [],
  pois: [],
  gpsStatus: 'idle',
  gpsAccuracyM: null,
  gpsWatching: false,
  needsTourStart: false,
  lastGpsAtMs: null,
  lastGpsLat: null,
  lastGpsLng: null,
  gpsServicesEnabled: null,
  ttsReady: false,
  ttsStatusMessage: null,
  ttsDownloadProgress: null,
  ttsDownloadLabel: null,
  ttsProvider: 'cartesia',
  isPremiumSubscriber: false,

  navActive: false,
  navVisible: false,
  navMode: null,
  navTargetName: null,
  navDistanceM: null,
  navBearingRel: null,
  transportMode: null,
  preferredTravelMode: null,
  remainingStations: null,
  navNextTargetName: null,
  navLegDistanceM: null,
  navTotalDistanceM: null,
  navEtaMin: null,
  navTurnHint: null,
  navPhase: null,
  multiStopTour: null,
  discoveryCandidates: [],
  stopQueueVisible: false,
  pendingNavOffer: null,
  pendingNavAlternatives: [],
  poiTriggerGateArmed: false,
  poiTriggerCooldownUntilMs: null,
  activeConciergeCard: null,
  pendingAffiliateOffer: null,
  affiliateRedirectAcked: false,
  gygWidget: null,
  cityMap: null,
  attentionCue: null,
  settingsOpenRequestAtMs: null,
  settingsOpenFocus: null,

  setCurrentLocationName: (name) => set({ currentLocationName: name }),
  setCurrentPoiId: (id) => set({ currentPoiId: id }),
  setSimulationMode: (enabled) => set({ isSimulationMode: enabled }),
  setIsPlayingAudio: (playing) => set({ isPlayingAudio: playing }),
  setIsAudiblySpeaking: (speaking) => set({ isAudiblySpeaking: speaking }),
  setIsListening: (listening) => set({ isListening: listening }),
  setIsGenerating: (generating) => set({ isGenerating: generating }),
  setNavRouteLoading: (loading) => set({ navRouteLoading: loading }),
  setFindusPresence: (presence) => set({ findusPresence: presence }),
  setSubtitleText: (text) => {
    set({ subtitleText: text });
    if (text) {
      try {
        const {
          noteNarrationSpokenProgress,
        } = require('../services/session/narrationResumeState') as {
          noteNarrationSpokenProgress: (t: string) => void;
        };
        noteNarrationSpokenProgress(text);
      } catch {
        /* soft */
      }
    }
    if (!text || !get().navActive) return;
    const cue = scanAttentionCue(text);
    if (!cue) return;
    hapticAttentionCue();
    set({ attentionCue: cue });
    if (attentionClearTimer) clearTimeout(attentionClearTimer);
    attentionClearTimer = setTimeout(() => {
      set({ attentionCue: null });
      attentionClearTimer = null;
    }, ATTENTION_CUE_MS);
  },
  noteSpokenText: (text) => {
    if (!text || !get().navActive) return;
    const cue = scanAttentionCue(text);
    if (!cue) return;
    hapticAttentionCue();
    set({ attentionCue: cue });
    if (attentionClearTimer) clearTimeout(attentionClearTimer);
    attentionClearTimer = setTimeout(() => {
      set({ attentionCue: null });
      attentionClearTimer = null;
    }, ATTENTION_CUE_MS);
  },
  setTtsReady: (ready) => set({ ttsReady: ready }),
  setTtsStatusMessage: (message) => set({ ttsStatusMessage: message }),
  setTtsDownloadProgress: (progress) => set({ ttsDownloadProgress: progress }),
  setTtsDownloadLabel: (label) => set({ ttsDownloadLabel: label }),
  setTtsProvider: (provider) => set({ ttsProvider: provider }),
  setIsPremiumSubscriber: (premium) => set({ isPremiumSubscriber: premium }),
  setPois: (pois) => set({ pois }),
  setLastVisitedPoiId: (id) => set({ lastVisitedPoiId: id }),
  setLastMealHintAtMs: (ms) => set({ lastMealHintAtMs: ms }),
  setGpsStatus: (status, accuracyM) =>
    set((state) => ({
      gpsStatus: status,
      gpsAccuracyM: accuracyM === undefined ? state.gpsAccuracyM : accuracyM,
    })),
  setGpsWatching: (watching) => set({ gpsWatching: watching }),
  setNeedsTourStart: (needs) => set({ needsTourStart: needs }),
  setGpsServicesEnabled: (enabled) => set({ gpsServicesEnabled: enabled }),
  reportGpsFix: (fix) => {
    // Map/diagnostics subscribe to useGpsStore — not the main UI store.
    useGpsStore.getState().reportFix(fix);
    recordWalkFix(fix.lat, fix.lng);
    // Soft-Stamp ohne zyklischen Import
    void import('../services/discovery/walkStampService')
      .then((m) => m.stampNearbyPoisFromWalk(fix.lat, fix.lng))
      .catch(() => undefined);
    const state = get();
    const nextAcc =
      typeof fix.accuracy === 'number' ? fix.accuracy : state.gpsAccuracyM;
    const samePos =
      state.lastGpsLat != null &&
      state.lastGpsLng != null &&
      Math.abs(state.lastGpsLat - fix.lat) < GPS_EPS_DEG &&
      Math.abs(state.lastGpsLng - fix.lng) < GPS_EPS_DEG;
    if (samePos && state.gpsStatus === 'fix') {
      // Avoid FinnusStore.set() on every GPS tick — selectors would all re-run.
      // Staleness for services: refresh at most every 5s.
      const age = Date.now() - (state.lastGpsAtMs ?? 0);
      if (age < 5_000) return;
      set({ lastGpsAtMs: Date.now(), gpsAccuracyM: nextAcc });
      return;
    }
    set({
      gpsStatus: 'fix',
      gpsAccuracyM: nextAcc,
      lastGpsAtMs: Date.now(),
      lastGpsLat: fix.lat,
      lastGpsLng: fix.lng,
    });
  },
  addSoftPitchedSpotKey: (key) =>
    set((state) =>
      state.softPitchedSpotKeys.includes(key)
        ? state
        : { softPitchedSpotKeys: [...state.softPitchedSpotKeys, key] },
    ),
  addHeardApproachSpotKey: (key) =>
    set((state) =>
      state.heardApproachSpotKeys.includes(key)
        ? state
        : { heardApproachSpotKeys: [...state.heardApproachSpotKeys, key] },
    ),
  addToldFactKeys: (keys) =>
    set((state) => {
      const next = [...state.toldFactKeys];
      for (const k of keys) {
        const key = k.trim().toLowerCase();
        if (!key || next.includes(key)) continue;
        next.push(key);
      }
      return { toldFactKeys: next.slice(-400) };
    }),

  addVisitedPlace: (entry) =>
    set((state) => {
      const idx = state.visitedHistory.findIndex(
        (v) =>
          v.poiId === entry.poiId &&
          Math.abs(v.visitedAt - entry.visitedAt) < 6 * 60 * 60_000,
      );
      if (idx >= 0) {
        const cur = state.visitedHistory[idx]!;
        const needTimeline =
          entry.onTimeline === true && cur.onTimeline !== true;
        const needCoords =
          (cur.lat == null || cur.lng == null) &&
          entry.lat != null &&
          entry.lng != null &&
          Number.isFinite(entry.lat) &&
          Number.isFinite(entry.lng);
        if (needTimeline || needCoords) {
          const next = [...state.visitedHistory];
          next[idx] = {
            ...cur,
            onTimeline: needTimeline ? true : cur.onTimeline,
            keyFacts:
              entry.keyFacts.length > 0 ? entry.keyFacts : cur.keyFacts,
            kind: entry.kind || cur.kind,
            lat: cur.lat ?? entry.lat ?? null,
            lng: cur.lng ?? entry.lng ?? null,
          };
          void saveStampPassport(next);
          return { visitedHistory: next };
        }
        return state;
      }
      const visitedHistory = [...state.visitedHistory, entry].slice(-8_000);
      void saveStampPassport(visitedHistory);
      return { visitedHistory };
    }),

  addChatMessage: (message) =>
    set((state) => ({
      chatHistory: [...state.chatHistory, createMessage(message)],
    })),

  setChatHistory: (messages) =>
    set({ chatHistory: messages.map(createMessage) }),

  setPendingNavOffer: (offer) => {
    if (
      offer &&
      typeof offer.lat === 'number' &&
      typeof offer.lng === 'number' &&
      Number.isFinite(offer.lat) &&
      Number.isFinite(offer.lng) &&
      offer.name?.trim()
    ) {
      void upsertCachedDestination({
        name: offer.name.trim(),
        lat: offer.lat,
        lng: offer.lng,
        poiId: offer.poiId >= 0 ? offer.poiId : null,
        source: 'offer',
        searchQuery: offer.name.trim(),
      }).catch(() => undefined);
    }
    set({ pendingNavOffer: offer });
  },

  setPreferredTravelMode: (mode) => set({ preferredTravelMode: mode }),

  setMultiStopTour: (tour) => set({ multiStopTour: tour }),

  setDiscoveryCandidates: (c) => set({ discoveryCandidates: c ?? [] }),

  setStopQueueVisible: (visible) => set({ stopQueueVisible: visible }),

  setPendingNavAlternatives: (offers) =>
    set({ pendingNavAlternatives: offers ?? [] }),

  setPoiTriggerGateArmed: (armed) => set({ poiTriggerGateArmed: armed }),

  setPoiTriggerCooldownUntilMs: (untilMs) =>
    set({ poiTriggerCooldownUntilMs: untilMs }),

  setActiveConciergeCard: (card) => set({ activeConciergeCard: card }),

  setPendingAffiliateOffer: (action) =>
    set({ pendingAffiliateOffer: action }),

  setAffiliateRedirectAcked: (acked) =>
    set({ affiliateRedirectAcked: acked }),

  setGygWidget: (opts) => set({ gygWidget: opts }),

  setCityMap: (map) => set({ cityMap: map }),
  requestOpenSettings: (focus = null) =>
    set({
      settingsOpenRequestAtMs: Date.now(),
      settingsOpenFocus: focus ?? null,
    }),

  patchNavigation: (partial) =>
    set((state) => {
      const next = { ...partial };
      // Skip tiny bearing/distance churn so Audio/HUD don't re-render every tick.
      if (
        typeof next.navBearingRel === 'number' &&
        typeof state.navBearingRel === 'number' &&
        Math.abs(next.navBearingRel - state.navBearingRel) < 0.75
      ) {
        delete next.navBearingRel;
      }
      if (
        typeof next.navDistanceM === 'number' &&
        typeof state.navDistanceM === 'number' &&
        Math.abs(next.navDistanceM - state.navDistanceM) < 5
      ) {
        delete next.navDistanceM;
      }
      if (
        typeof next.navLegDistanceM === 'number' &&
        typeof state.navLegDistanceM === 'number' &&
        Math.abs(next.navLegDistanceM - state.navLegDistanceM) < 5
      ) {
        delete next.navLegDistanceM;
      }
      if (Object.keys(next).length === 0) return state;
      return next;
    }),

  resetTourContext: () =>
    set({
      currentLocationName: null,
      currentPoiId: null,
      lastVisitedPoiId: null,
      lastMealHintAtMs: null,
      softPitchedSpotKeys: [],
      heardApproachSpotKeys: [],
      toldFactKeys: [],
      // visitedHistory bleibt — Stempelkarte ist persistent, kein Session-Reset
      pendingNavOffer: null,
      pendingNavAlternatives: [],
      poiTriggerGateArmed: false,
      poiTriggerCooldownUntilMs: null,
      activeConciergeCard: null,
      pendingAffiliateOffer: null,
      gygWidget: null,
      cityMap: null,
      navActive: false,
      navVisible: false,
      navMode: null,
      navTargetName: null,
      navDistanceM: null,
      navBearingRel: null,
      transportMode: null,
      remainingStations: null,
      navNextTargetName: null,
      navLegDistanceM: null,
      navTotalDistanceM: null,
      navEtaMin: null,
      navTurnHint: null,
      navPhase: null,
      multiStopTour: null,
      discoveryCandidates: [],
      stopQueueVisible: false,
      attentionCue: null,
    }),
}));
