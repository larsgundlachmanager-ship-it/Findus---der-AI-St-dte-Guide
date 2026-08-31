/**
 * Gemini Text-Engine — Yorro Audioguide.
 * Cost Control SSOT: Flash-Lite ~98%, Pro nur gated.
 * Master-Prompt: buildMasterSystemInstruction (personaEngine).
 */

/**
 * Primär (~99%): Flash-Lite Alias — stabile Availability für neue Keys.
 * (gemini-2.5-flash-lite liefert für neue Projekte oft 404 „no longer available“.)
 */
export const GEMINI_MODEL = 'gemini-flash-lite-latest';

/**
 * Availability-Fallback (Reihenfolge = Latenz/Stabilität).
 * Kein Pro hier — Pro nur über modelTier / resolveGeminiModels.
 */
export const GEMINI_MODEL_FALLBACKS = [
  'gemini-3.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
] as const;

/** @deprecated alias — erster Fallback */
export const GEMINI_MODEL_FALLBACK = GEMINI_MODEL_FALLBACKS[0];

/**
 * Strict Pro — NUR bei:
 * - Deep-History Multi-Hop fail auf Flash
 * - Multi-Stop-Itinerary > 5 Stops (komplexe Optimierung)
 * - Authentifizierter Premium-Subscriber
 */
export const GEMINI_MODEL_PRO = 'gemini-2.5-pro';

export const GEMINI_MODEL_PRO_FALLBACKS = [
  'gemini-pro-latest',
  'gemini-2.5-flash',
] as const;

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
export const FINDUS_GEMINI_SYSTEM_INSTRUCTION = `Du BIST Yorro — ein lebendiger Kumpel neben dem Nutzer, kein Roboter und kein Textbuch. Sprich umgangssprachlich, spontan und menschlich.`;
