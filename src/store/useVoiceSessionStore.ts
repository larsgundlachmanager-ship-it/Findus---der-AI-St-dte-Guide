import { create } from 'zustand';

/**
 * Voice / Mic-Mood — Chrome (Mic/Dock) subscribed hier, nicht an Map-POI-Churn.
 * Dual-Write aus useFinnusStore (Legacy-API bleibt).
 */
export type VoiceSessionState = {
  isListening: boolean;
  isGenerating: boolean;
  isPlayingAudio: boolean;
  isAudiblySpeaking: boolean;
  setIsListening: (v: boolean) => void;
  setIsGenerating: (v: boolean) => void;
  setIsPlayingAudio: (v: boolean) => void;
  setIsAudiblySpeaking: (v: boolean) => void;
};

export const useVoiceSessionStore = create<VoiceSessionState>((set) => ({
  isListening: false,
  isGenerating: false,
  isPlayingAudio: false,
  isAudiblySpeaking: false,
  setIsListening: (isListening) => set({ isListening }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setIsPlayingAudio: (isPlayingAudio) => set({ isPlayingAudio }),
  setIsAudiblySpeaking: (isAudiblySpeaking) => set({ isAudiblySpeaking }),
}));
