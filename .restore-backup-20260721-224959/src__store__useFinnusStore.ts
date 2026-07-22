import { create } from 'zustand';
import type { ChatMessage } from '../db/types';
import type { Poi } from '../db/types';
import type { VisitedHistoryEntry } from '../services/ai/types';

interface FinnusState {
  currentLocationName: string | null;
  currentPoiId: number | null;
  chatHistory: ChatMessage[];
  /** Text, den Kokoro gerade spricht (Untertitel-Overlay). */
  subtitleText: string | null;
  isSimulationMode: boolean;
  isPlayingAudio: boolean;
  isListening: boolean;
  isGenerating: boolean;
  lastVisitedPoiId: number | null;
  /** Session-Gedächtnis: besuchte Orte + genannte Kernfakten dieser Tour. */
  visitedHistory: VisitedHistoryEntry[];
  pois: Poi[];
  /** true wenn Kokoro-Session warm im Speicher liegt */
  kokoroReady: boolean;
  /** Hinweis z. B. „Sprachdatei wird korrigiert…“ */
  kokoroStatusMessage: string | null;
  /** 0–1 während Modell-Download, sonst null */
  kokoroDownloadProgress: number | null;
  /** z. B. „Deutsches Sprachmodell (310 MB)…“ */
  kokoroDownloadLabel: string | null;

  setCurrentLocationName: (name: string | null) => void;
  setCurrentPoiId: (id: number | null) => void;
  setSimulationMode: (enabled: boolean) => void;
  setIsPlayingAudio: (playing: boolean) => void;
  setIsListening: (listening: boolean) => void;
  setIsGenerating: (generating: boolean) => void;
  setSubtitleText: (text: string | null) => void;
  setKokoroReady: (ready: boolean) => void;
  setKokoroStatusMessage: (message: string | null) => void;
  setKokoroDownloadProgress: (progress: number | null) => void;
  setKokoroDownloadLabel: (label: string | null) => void;
  setPois: (pois: Poi[]) => void;
  setLastVisitedPoiId: (id: number | null) => void;
  addVisitedPlace: (entry: VisitedHistoryEntry) => void;
  addChatMessage: (message: ChatMessage) => void;
  setChatHistory: (messages: ChatMessage[]) => void;
  resetTourContext: () => void;
}

function createMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    id: message.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: message.createdAt ?? Date.now(),
  };
}

export const useFinnusStore = create<FinnusState>((set) => ({
  currentLocationName: null,
  currentPoiId: null,
  chatHistory: [],
  subtitleText: null,
  isSimulationMode: true,
  isPlayingAudio: false,
  isListening: false,
  isGenerating: false,
  lastVisitedPoiId: null,
  visitedHistory: [],
  pois: [],
  kokoroReady: false,
  kokoroStatusMessage: null,
  kokoroDownloadProgress: null,
  kokoroDownloadLabel: null,

  setCurrentLocationName: (name) => set({ currentLocationName: name }),
  setCurrentPoiId: (id) => set({ currentPoiId: id }),
  setSimulationMode: (enabled) => set({ isSimulationMode: enabled }),
  setIsPlayingAudio: (playing) => set({ isPlayingAudio: playing }),
  setIsListening: (listening) => set({ isListening: listening }),
  setIsGenerating: (generating) => set({ isGenerating: generating }),
  setSubtitleText: (text) => set({ subtitleText: text }),
  setKokoroReady: (ready) => set({ kokoroReady: ready }),
  setKokoroStatusMessage: (message) => set({ kokoroStatusMessage: message }),
  setKokoroDownloadProgress: (progress) =>
    set({ kokoroDownloadProgress: progress }),
  setKokoroDownloadLabel: (label) => set({ kokoroDownloadLabel: label }),
  setPois: (pois) => set({ pois }),
  setLastVisitedPoiId: (id) => set({ lastVisitedPoiId: id }),

  addVisitedPlace: (entry) =>
    set((state) => ({
      visitedHistory: [...state.visitedHistory, entry].slice(-20),
    })),

  addChatMessage: (message) =>
    set((state) => ({
      chatHistory: [...state.chatHistory, createMessage(message)],
    })),

  setChatHistory: (messages) =>
    set({ chatHistory: messages.map(createMessage) }),

  resetTourContext: () =>
    set({
      currentLocationName: null,
      currentPoiId: null,
      lastVisitedPoiId: null,
      visitedHistory: [],
    }),
}));
