/**
 * Gemini Text-Engine — Findus Audioguide.
 * Master-Prompt: buildMasterSystemInstruction (personaEngine).
 */

/**
 * Primär: gemini-3.5-flash — akzeptiert thinkingBudget:0 (volle Stories).
 * Ältere 2.5/2.0-IDs sind für neue Keys oft 404.
 */
export const GEMINI_MODEL = 'gemini-3.5-flash';

/**
 * Fallback-Kette (Reihenfolge = Latenz/Stabilität).
 * flash-lite-latest: oft ohne Thinking → schnell + volle Länge.
 * flash-latest: Thinking an, braucht hohe maxOutputTokens.
 */
export const GEMINI_MODEL_FALLBACKS = [
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
] as const;

/** @deprecated alias — erster Fallback */
export const GEMINI_MODEL_FALLBACK = GEMINI_MODEL_FALLBACKS[0];

/** Höhere Kreativität = weniger robotische Wiederholungen. */
export const GEMINI_TEMPERATURE = 0.85;

/**
 * Story-Calls: Thinking (falls nicht abschaltbar) frisst Tokens.
 * 8192 lässt genug Raum für Thinking + 8–14 Sätze.
 */
export const GEMINI_STORY_MAX_OUTPUT_TOKENS = 8192;

export const GEMINI_API_BASE =
  'https://generativelanguage.googleapis.com/v1beta';

/**
 * Minimaler Boot-Fallback — Live-Pfad nutzt immer buildMasterSystemInstruction.
 * @deprecated Nicht erweitern; Master-Prompt ist SSOT.
 */
export const FINDUS_GEMINI_SYSTEM_INSTRUCTION = `Du BIST Findus — ein lebendiger Kumpel neben dem Nutzer, kein Roboter und kein Textbuch. Sprich umgangssprachlich, spontan und menschlich.`;
