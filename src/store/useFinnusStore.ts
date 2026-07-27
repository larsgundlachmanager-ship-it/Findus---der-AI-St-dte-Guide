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

export type GpsStatus = 'idle' | 'searching' | 'fix' | 'denied';

/** Findus-Präsenz: ok=grün, degraded/offline=orange. */
export type FindusPresence = 'ok' | 'degraded' | 'offline';

/** TTS-Backend: lokal (Kokoro/Piper-Hybrid) oder OpenAI Speech API. */
export type TtsProvider = 'kokoro' | 'openai';

let attentionClearTimer: ReturnType<typeof setTimeout> | null = null;

interface FinnusState {
  currentLocationName: string | null;
  currentPoiId: number | null;
  chatHistory: ChatMessage[];
  /** Text, den Piper gerade spricht (Untertitel-Overlay). */
  subtitleText: string | null;
  isSimulationMode: boolean;
  isPlayingAudio: boolean;
  isListening: boolean;
  isGenerating: boolean;
  /** Präsenzfarbe: ok=grün, degraded/offline=orange. */
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
  /** Zeitstempel letzter erfolgreicher Fix. */
  lastGpsAtMs: number | null;
  lastGpsLat: number | null;
  lastGpsLng: number | null;
  /** OS-Standort-Dienste an/aus (letzter Check). */
  gpsServicesEnabled: boolean | null;
  /** true wenn Piper-Session warm im Speicher liegt */
  kokoroReady: boolean;
  /** Hinweis z. B. „Sprachdatei wird korrigiert…“ */
  kokoroStatusMessage: string | null;
  /** 0–1 während Modell-Download, sonst null */
  kokoroDownloadProgress: number | null;
  /** z. B. „Deutsches Sprachmodell (310 MB)…“ */
  kokoroDownloadLabel: string | null;
  /**
   * TTS-Provider: 'openai' = Cloud (tts-1 / nova),
   * 'kokoro' = lokale Piper/Kokoro-Pipeline.
   */
  ttsProvider: TtsProvider;

  /** Smart Compass */
  navActive: boolean;
  navVisible: boolean;
  navMode: NavMode | null;
  navTargetName: string | null;
  navDistanceM: number | null;
  navBearingRel: number | null;
  /** Realtime walk / bicycle / transit. */
  transportMode: TransportMode | null;
  /** ÖPNV: verbleibende Stationen (null = nicht Transit). */
  remainingStations: number | null;
  /** Nächster Zwischenpunkt auf der Route. */
  navNextTargetName: string | null;
  /** Meter bis zum nächsten Pfeil-Ziel. */
  navLegDistanceM: number | null;
  /** Gesamtstrecke beim Nav-Start (Meter). */
  navTotalDistanceM: number | null;
  pendingNavOffer: PendingNavOffer | null;
  /** Weitere Optionen aus Concierge („Welchen nehmen wir?“). */
  pendingNavAlternatives: PendingNavOffer[];
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

  setCurrentLocationName: (name: string | null) => void;
  setCurrentPoiId: (id: number | null) => void;
  setSimulationMode: (enabled: boolean) => void;
  setIsPlayingAudio: (playing: boolean) => void;
  setIsListening: (listening: boolean) => void;
  setIsGenerating: (generating: boolean) => void;
  setFindusPresence: (presence: FindusPresence) => void;
  setSubtitleText: (text: string | null) => void;
  setKokoroReady: (ready: boolean) => void;
  setKokoroStatusMessage: (message: string | null) => void;
  setKokoroDownloadProgress: (progress: number | null) => void;
  setKokoroDownloadLabel: (label: string | null) => void;
  setTtsProvider: (provider: TtsProvider) => void;
  setPois: (pois: Poi[]) => void;
  setLastVisitedPoiId: (id: number | null) => void;
  setLastMealHintAtMs: (ms: number | null) => void;
  setGpsStatus: (status: GpsStatus, accuracyM?: number | null) => void;
  setGpsWatching: (watching: boolean) => void;
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

  setPendingNavOffer: (offer: PendingNavOffer | null) => void;
  setPendingNavAlternatives: (offers: PendingNavOffer[]) => void;
  setActiveConciergeCard: (card: ConciergeCardState | null) => void;
  setPendingAffiliateOffer: (action: QuickAction | null) => void;
  setAffiliateRedirectAcked: (acked: boolean) => void;
  setGygWidget: (opts: GygWidgetOptions | null) => void;
  setCityMap: (map: CityMapView | null) => void;
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
  isListening: false,
  isGenerating: false,
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
  lastGpsAtMs: null,
  lastGpsLat: null,
  lastGpsLng: null,
  gpsServicesEnabled: null,
  kokoroReady: false,
  kokoroStatusMessage: null,
  kokoroDownloadProgress: null,
  kokoroDownloadLabel: null,
  ttsProvider: 'openai',

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
  pendingNavOffer: null,
  pendingNavAlternatives: [],
  activeConciergeCard: null,
  pendingAffiliateOffer: null,
  affiliateRedirectAcked: false,
  gygWidget: null,
  cityMap: null,
  attentionCue: null,

  setCurrentLocationName: (name) => set({ currentLocationName: name }),
  setCurrentPoiId: (id) => set({ currentPoiId: id }),
  setSimulationMode: (enabled) => set({ isSimulationMode: enabled }),
  setIsPlayingAudio: (playing) => set({ isPlayingAudio: playing }),
  setIsListening: (listening) => set({ isListening: listening }),
  setIsGenerating: (generating) => set({ isGenerating: generating }),
  setFindusPresence: (presence) => set({ findusPresence: presence }),
  setSubtitleText: (text) => {
    set({ subtitleText: text });
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
  setKokoroReady: (ready) => set({ kokoroReady: ready }),
  setKokoroStatusMessage: (message) => set({ kokoroStatusMessage: message }),
  setKokoroDownloadProgress: (progress) =>
    set({ kokoroDownloadProgress: progress }),
  setKokoroDownloadLabel: (label) => set({ kokoroDownloadLabel: label }),
  setTtsProvider: (provider) => set({ ttsProvider: provider }),
  setPois: (pois) => set({ pois }),
  setLastVisitedPoiId: (id) => set({ lastVisitedPoiId: id }),
  setLastMealHintAtMs: (ms) => set({ lastMealHintAtMs: ms }),
  setGpsStatus: (status, accuracyM) =>
    set((state) => ({
      gpsStatus: status,
      gpsAccuracyM: accuracyM === undefined ? state.gpsAccuracyM : accuracyM,
    })),
  setGpsWatching: (watching) => set({ gpsWatching: watching }),
  setGpsServicesEnabled: (enabled) => set({ gpsServicesEnabled: enabled }),
  reportGpsFix: (fix) =>
    set({
      gpsStatus: 'fix',
      gpsAccuracyM:
        typeof fix.accuracy === 'number' ? fix.accuracy : null,
      lastGpsAtMs: Date.now(),
      lastGpsLat: fix.lat,
      lastGpsLng: fix.lng,
    }),
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
    set((state) => ({
      visitedHistory: [...state.visitedHistory, entry].slice(-40),
    })),

  addChatMessage: (message) =>
    set((state) => ({
      chatHistory: [...state.chatHistory, createMessage(message)],
    })),

  setChatHistory: (messages) =>
    set({ chatHistory: messages.map(createMessage) }),

  setPendingNavOffer: (offer) => set({ pendingNavOffer: offer }),

  setPendingNavAlternatives: (offers) =>
    set({ pendingNavAlternatives: offers ?? [] }),

  setActiveConciergeCard: (card) => set({ activeConciergeCard: card }),

  setPendingAffiliateOffer: (action) =>
    set({ pendingAffiliateOffer: action }),

  setAffiliateRedirectAcked: (acked) =>
    set({ affiliateRedirectAcked: acked }),

  setGygWidget: (opts) => set({ gygWidget: opts }),

  setCityMap: (map) => set({ cityMap: map }),

  patchNavigation: (partial) => set(partial),

  resetTourContext: () =>
    set({
      currentLocationName: null,
      currentPoiId: null,
      lastVisitedPoiId: null,
      lastMealHintAtMs: null,
      softPitchedSpotKeys: [],
      heardApproachSpotKeys: [],
      toldFactKeys: [],
      visitedHistory: [],
      pendingNavOffer: null,
      pendingNavAlternatives: [],
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
      attentionCue: null,
    }),
}));
