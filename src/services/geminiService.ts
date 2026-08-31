/**
 * Gemini Flash-Lite Text-Engine — Unified Master Prompt + RN-sicheres REST.
 * Cost Control: lite ~98%, Pro nur via modelRouter (Premium / history fail / multi-stop>5).
 */

import {
  FINDUS_GEMINI_SYSTEM_INSTRUCTION,
  GEMINI_API_BASE,
  GEMINI_MODEL,
  GEMINI_STORY_MAX_OUTPUT_TOKENS,
  GEMINI_TEMPERATURE,
} from '../constants/gemini';
import type { MasterPromptContext } from '../types/userProfile';
import type { GeminiConciergeResponse } from '../types/concierge';
import { env } from '../config/env';
import { sentencesFromFullText, splitIntoSentences } from './ai/sentenceStream';
import { extractStreamingChunks } from './audio/punctuationChunker';
import {
  buildDynamicSystemInstruction,
  buildMasterSystemInstruction,
  resolveMasterPromptContext,
} from './personaEngine';
import { getCachedUserProfile } from './userProfileService';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  parseConciergeResponse,
  wrapPlainAsConcierge,
  CONCIERGE_JSON_INSTRUCTION,
} from './concierge/parseConciergeResponse';
import {
  resolveGeminiModels,
  shouldEscalateHistoryToPro,
  type GeminiModelTier,
  type GeminiTaskKind,
  type ResolveGeminiTierInput,
} from './llm/modelRouter';
import {
  clearGeminiCreditsExhausted,
  isGeminiCreditsExhausted,
  isGeminiCreditsExhaustedError,
  isGeminiCreditsExhaustedSync,
  isGeminiSoftRateLimitError,
  noteGeminiCreditsExhausted,
  shouldRetryGeminiAfterExhaustion,
} from './llm/geminiBillingGuard';
import { NATURAL_SPEECH_RATE_RULE } from './ai/promptBuilder';
import { GERMAN_TTS_PROSODY_REMINDER } from './g2p/germanTtsProsodyRules';

export { consumeGeminiCreditsWarning } from './llm/geminiBillingGuard';

/** Cartesia sonic-3.5: Emotion/Atem/Dynamik nur über natürlichen Text. */
const CARTESIA_EMOTION_ENGINE_RULE = `## Cartesia Emotion & Naturalness Engine
Deine Texte werden von Cartesia sonic-3.5 gesprochen — nicht von einem Vorleser.
Emotion, Flüstern, Begeisterung und Atempausen entstehen NUR durch Kontext und Interpunktion.
Schreibe menschlich: Kommas für Atem, Ausrufezeichen für Energie, „..." für Flüstern/Spannung, Gedankenstriche für Pausen.
Keine SSML, keine Regie-Anweisungen, keine phonetischen Umschreibungen.
VERBOTEN im Vorlese-Text (nie aussprechen): „Die Stimme senkt sich…“, „mit tieferer Stimme“, „sprich leiser“, „*flüstert*“, „kichern“, „*kichern*“, Cartesia-/Prosodie-Kommandos.`;

/** Aktive Yorro-System-Instruction = Master Engine + Cartesia Speech Rules. */
export function resolveFindusSystemInstruction(
  override?: string,
  context?: MasterPromptContext,
): string {
  const base = (() => {
    if (override?.trim()) return override.trim();
    try {
      return buildMasterSystemInstruction(
        getCachedUserProfile(),
        context ?? resolveMasterPromptContext(),
      );
    } catch {
      return FINDUS_GEMINI_SYSTEM_INSTRUCTION;
    }
  })();
  return `${base}\n\n${CARTESIA_EMOTION_ENGINE_RULE}\n\n${NATURAL_SPEECH_RATE_RULE}\n\n${GERMAN_TTS_PROSODY_REMINDER}`;
}

export {
  buildDynamicSystemInstruction,
  buildMasterSystemInstruction,
  resolveMasterPromptContext,
};

/** Gemini REST responseSchema für Concierge-JSON. */
const CONCIERGE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    speechText: { type: 'STRING' },
    cardTitle: { type: 'STRING' },
    visualBullets: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      maxItems: 3,
    },
    background_tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING' },
          time: { type: 'STRING' },
          label: { type: 'STRING' },
          dateIso: { type: 'STRING' },
        },
        required: ['type'],
      },
      maxItems: 4,
    },
    quickActions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING' },
          label: { type: 'STRING' },
          payload: {
            type: 'OBJECT',
            properties: {
              targetPoiId: { type: 'STRING' },
              phoneNumber: { type: 'STRING' },
              url: { type: 'STRING' },
              textPrompt: { type: 'STRING' },
              partySize: { type: 'NUMBER' },
              timeLabel: { type: 'STRING' },
              dateIso: { type: 'STRING' },
              gygTourSlug: { type: 'STRING' },
              gygLocationId: { type: 'STRING' },
              destLat: { type: 'NUMBER' },
              destLng: { type: 'NUMBER' },
              destName: { type: 'STRING' },
              destination: { type: 'STRING' },
              durationMs: { type: 'NUMBER' },
            },
          },
        },
        required: ['type', 'label'],
      },
    },
  },
  required: ['speechText', 'visualBullets', 'quickActions'],
} as const;

/** Multi-Turn für Modul-1 POI-Chat (REST contents[]). */
export type GeminiChatTurn = {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
};

export type GeminiGenerateOptions = {
  maxTokens?: number;
  temperature?: number;
  systemInstruction?: string;
  /** Wenn false, keine Yorro-System-Instruction (z. B. JSON-Extraktion). */
  useFindusSystem?: boolean;
  /** First-POI / Landmark-Kontext für den Master-Prompt. */
  masterContext?: MasterPromptContext;
  /** Google Search Grounding für Concierge-Live-Daten. */
  enableGoogleSearch?: boolean;
  /** Erzwingt application/json (+ optionales Schema). */
  responseJson?: boolean;
  /**
   * Nur MIME application/json, ohne Concierge-responseSchema.
   * Für dedizierte Extraktoren (z. B. longFormPlanExtractor).
   */
  jsonMimeOnly?: boolean;
  /** Cost Control: lite (default) | pro (gated). */
  tier?: GeminiModelTier;
  forcePro?: boolean;
  task?: GeminiTaskKind;
  /** Kosten-Ledger-Modul, falls der Task allein nicht reicht. */
  costModule?: import('./diagnostics/costRates').CostModuleId;
  stopCount?: number;
  flashFailed?: boolean;
  /** Hard abort (z. B. Judge-Timeout) — bricht fetch ab, keine weiterlaufenden Kosten. */
  signal?: AbortSignal;
  /** P0: Flash→Pro Auto-Escalation abschalten (Stories / Cost-Caps). */
  allowProEscalate?: boolean;
  /** Vorherige Turns; aktueller `prompt` wird als letzter user-Turn angehängt. */
  chatHistory?: GeminiChatTurn[];
};

type GeminiClient = {
  models: {
    generateContent: (args: {
      model: string;
      contents: string;
      config?: {
        systemInstruction?: string;
        temperature?: number;
        maxOutputTokens?: number;
      };
    }) => Promise<{ text?: string }>;
  };
};

let sdkClient: GeminiClient | null | undefined;

function resolveApiKey(): string {
  // Proxy-Modus: kein Client-Key (auch wenn noch in .env steht — nicht an upstream senden)
  if (env.useLlmProxy()) return '';
  const key = env.geminiApiKey();
  if (!key || key.includes('your-') || key.includes('YOUR_')) return '';
  return key;
}

export function hasGeminiApiKey(): boolean {
  if (resolveApiKey()) return true;
  if (
    env.useLlmProxy() &&
    env.geminiProxyUrl() &&
    env.supabaseAnonKey()
  ) {
    return true;
  }
  return false;
}

export function hasAnyChatLlm(): boolean {
  try {
    const { hasOpenAiApiKey } = require('./llm/openAiChatFallback') as {
      hasOpenAiApiKey: () => boolean;
    };
    return hasGeminiApiKey() || hasOpenAiApiKey();
  } catch {
    return hasGeminiApiKey();
  }
}

async function tryOpenAiFallback(
  prompt: string,
  options?: GeminiGenerateOptions,
): Promise<string> {
  const { generateOpenAiChatText, hasOpenAiApiKey } = await import(
    './llm/openAiChatFallback'
  );
  if (!hasOpenAiApiKey() || options?.signal?.aborted) return '';
  const useSystem = options?.useFindusSystem !== false;
  const system = useSystem
    ? resolveFindusSystemInstruction(
        options?.systemInstruction,
        options?.masterContext,
      )
    : options?.systemInstruction;
  const text = await generateOpenAiChatText({
    prompt,
    system,
    maxTokens: options?.maxTokens,
    temperature: options?.temperature,
    json: options?.responseJson === true || options?.jsonMimeOnly === true,
    signal: options?.signal,
  });
  if (text.trim()) {
    if (__DEV__) console.warn('[llm] OpenAI-Fallback (Gemini leer/Guthaben)');
    try {
      const { noteFallback } = await import('./debug/fallbackLabel');
      noteFallback('OpenAI', 'Gemini-Guthaben leer');
    } catch {
      /* soft */
    }
  }
  return text;
}

async function announceGeminiCreditsEmpty(): Promise<void> {
  const { consumeGeminiCreditsWarning } = await import(
    './llm/geminiBillingGuard'
  );
  const msg = await consumeGeminiCreditsWarning();
  if (!msg) return;
  try {
    useFinnusStore.getState().addChatMessage({
      role: 'assistant',
      content: msg,
    });
  } catch {
    /* soft */
  }
  try {
    const { enqueueSpeech } = await import('../module2/speech/speechQueue');
    enqueueSpeech({
      kind: 'bridging',
      text: msg,
      turnId: `gemini_credits_${Date.now()}`,
    });
  } catch (err) {
    if (__DEV__) console.warn('[gemini-billing] speak failed', err);
  }
}

/** Lazy @google/genai/web — fällt auf REST zurück, wenn Metro/RN das SDK blockt. */
async function tryLoadSdkClient(): Promise<GeminiClient | null> {
  if (sdkClient !== undefined) return sdkClient;
  const apiKey = resolveApiKey();
  if (!apiKey) {
    sdkClient = null;
    return null;
  }
  // Hermes/RN: kein ReadableStream — @google/genai/web braucht das und crasht.
  if (typeof globalThis.ReadableStream === 'undefined') {
    sdkClient = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@google/genai/web') as {
      GoogleGenAI?: new (opts: { apiKey: string }) => GeminiClient;
    };
    if (!mod?.GoogleGenAI) {
      sdkClient = null;
      return null;
    }
    sdkClient = new mod.GoogleGenAI({ apiKey });
    console.log('[gemini] @google/genai SDK geladen');
    return sdkClient;
  } catch (err) {
    console.warn('[gemini] SDK nicht nutzbar, REST-Fallback:', err);
    sdkClient = null;
    return null;
  }
}

let lastGeminiGroundingUrls: string[] = [];

function extractGroundingWebUrls(data: unknown): string[] {
  const root = data as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; url?: string };
        }>;
      };
    }>;
  };
  const chunks =
    root.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const urls: string[] = [];
  for (const c of chunks) {
    const u = String(c.web?.uri || c.web?.url || '').trim();
    if (/^https?:\/\//i.test(u)) urls.push(u);
  }
  return [...new Set(urls)];
}

function noteGeminiGrounding(data: unknown): void {
  const urls = extractGroundingWebUrls(data);
  if (urls.length) lastGeminiGroundingUrls = urls;
}

/** Suchtreffer der letzten Gemini-Google-Search — danach geleert. */
export function takeLastGeminiGroundingUrls(): string[] {
  const urls = lastGeminiGroundingUrls;
  lastGeminiGroundingUrls = [];
  return urls;
}

function extractTextFromRest(data: unknown): string {
  const root = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      thoughtsTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const cand = root.candidates?.[0];
  const usage = root.usageMetadata;
  if (cand?.finishReason && cand.finishReason !== 'STOP') {
    console.warn(
      `[gemini] finishReason=${cand.finishReason} — Antwort evtl. abgeschnitten`,
    );
  }
  if (__DEV__ && usage?.thoughtsTokenCount) {
    console.warn(
      `[gemini] thinkingTokens=${usage.thoughtsTokenCount} candTokens=${usage.candidatesTokenCount ?? '?'}`,
    );
  }
  const parts = cand?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

async function postGenerate(
  model: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (env.useLlmProxy()) {
    const proxy = env.geminiProxyUrl();
    const anon = env.supabaseAnonKey();
    if (!proxy || !anon) {
      throw Object.assign(new Error('Gemini proxy misconfigured'), {
        status: 500,
      });
    }
    const response = await fetch(proxy, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anon}`,
        apikey: anon,
      },
      body: JSON.stringify({ model, body }),
      signal,
    });
    if (!response.ok) {
      const errBody = await response.text();
      throw Object.assign(new Error(`Gemini ${response.status}: ${errBody}`), {
        status: response.status,
        bodyText: errBody,
      });
    }
    return response.json();
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw Object.assign(new Error('Gemini API key missing'), { status: 401 });
  }
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw Object.assign(new Error(`Gemini ${response.status}: ${errBody}`), {
      status: response.status,
      bodyText: errBody,
    });
  }
  return response.json();
}

async function generateViaRest(
  model: string,
  prompt: string,
  options?: GeminiGenerateOptions,
): Promise<string> {
  if (!env.useLlmProxy() && !resolveApiKey()) return '';

  const useSystem = options?.useFindusSystem !== false;
  const systemText = useSystem
    ? resolveFindusSystemInstruction(
        options?.systemInstruction,
        options?.masterContext,
      )
    : options?.systemInstruction;

  // Thinking zählt gegen maxOutputTokens. Story-Calls (≥2k) → Cap ≥8192.
  // flash-latest lehnt thinkingBudget:0 ab (400) → Retry ohne Config + hohes Cap.
  const requested = options?.maxTokens ?? 1024;
  const maxOut =
    requested >= 2000
      ? Math.max(requested, GEMINI_STORY_MAX_OUTPUT_TOKENS)
      : requested;
  const baseGen: Record<string, unknown> = {
    temperature: options?.temperature ?? GEMINI_TEMPERATURE,
    maxOutputTokens: maxOut,
  };
  // JSON + Google Search gleichzeitig oft inkompatibel → JSON hat Vorrang für Concierge-Cards
  const wantJson = options?.responseJson === true;
  const wantSearch = options?.enableGoogleSearch === true && !wantJson;

  // Nur Modelle, die thinkingBudget:0 wirklich akzeptieren — sonst 400 + Extra-Roundtrip.
  const canDisableThinking =
    /^gemini-3(\.5)?-flash(?!-lite)/i.test(model) ||
    /^gemini-2\.5-flash(?!-lite)/i.test(model);
  const generationConfig: Record<string, unknown> = canDisableThinking
    ? { ...baseGen, thinkingConfig: { thinkingBudget: 0 } }
    : {
        ...baseGen,
        maxOutputTokens: Math.max(
          maxOut,
          requested >= 2000 ? GEMINI_STORY_MAX_OUTPUT_TOKENS : maxOut,
        ),
      };

  if (wantJson) {
    generationConfig.responseMimeType = 'application/json';
    if (!options?.jsonMimeOnly) {
      generationConfig.responseSchema = CONCIERGE_RESPONSE_SCHEMA;
    }
  }

  const history = Array.isArray(options?.chatHistory)
    ? options!.chatHistory!.filter(
        (t) =>
          (t.role === 'user' || t.role === 'model') &&
          typeof t.parts?.[0]?.text === 'string',
      )
    : [];
  const body: Record<string, unknown> = {
    contents: [
      ...history,
      { role: 'user', parts: [{ text: prompt }] },
    ],
    generationConfig,
  };
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }
  if (wantSearch) {
    body.tools = [{ google_search: {} }];
  }

  const signal = options?.signal;

  const finish = async (): Promise<string> => {
    const data = await postGenerate(model, body, signal);
    noteGeminiGrounding(data);
    return extractTextFromRest(data);
  };

  try {
    return await finish();
  } catch (err) {
    if (signal?.aborted) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    // Grounding-Tool nicht unterstützt → ohne Search retry
    if (
      wantSearch &&
      /400/.test(msg) &&
      /google_search|tool|invalid argument|Unknown name/i.test(msg)
    ) {
      delete body.tools;
      if (__DEV__) {
        console.warn(
          `[gemini] ${model}: google_search nicht unterstützt — Retry ohne Grounding`,
        );
      }
      return await finish();
    }
    // responseSchema nicht unterstützt → nur MIME json
    if (
      wantJson &&
      /400/.test(msg) &&
      /responseSchema|responseMimeType|invalid argument|Unknown name/i.test(msg)
    ) {
      const gc = { ...baseGen, responseMimeType: 'application/json' };
      body.generationConfig = gc;
      if (__DEV__) {
        console.warn(
          `[gemini] ${model}: responseSchema nicht unterstützt — Retry nur mit JSON MIME`,
        );
      }
      try {
        return await finish();
      } catch {
        delete (body.generationConfig as Record<string, unknown>).responseMimeType;
        return await finish();
      }
    }
    // thinkingConfig ungültig / unbekannt → ohne Thinking, aber mit hohem Cap
    if (/400/.test(msg) && /invalid argument|thinkingConfig|Unknown name/i.test(msg)) {
      const gc: Record<string, unknown> = {
        ...baseGen,
        maxOutputTokens: Math.max(
          maxOut,
          requested >= 2000 ? GEMINI_STORY_MAX_OUTPUT_TOKENS : 4096,
        ),
      };
      if (wantJson) {
        gc.responseMimeType = 'application/json';
        gc.responseSchema = CONCIERGE_RESPONSE_SCHEMA;
      }
      body.generationConfig = gc;
      if (__DEV__) {
        console.warn(
          `[gemini] ${model}: thinkingBudget nicht unterstützt — Retry mit maxOutputTokens=${gc.maxOutputTokens}`,
        );
      }
      return await finish();
    }
    throw new Error(`Gemini (${model}): ${msg}`);
  }
}

async function generateViaSdk(
  model: string,
  prompt: string,
  options?: GeminiGenerateOptions,
): Promise<string> {
  const client = await tryLoadSdkClient();
  if (!client) throw new Error('Gemini SDK unavailable');

  const useSystem = options?.useFindusSystem !== false;
  const systemText = useSystem
    ? resolveFindusSystemInstruction(
        options?.systemInstruction,
        options?.masterContext,
      )
    : options?.systemInstruction;

  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: systemText,
      temperature: options?.temperature ?? GEMINI_TEMPERATURE,
      maxOutputTokens: Math.max(
        options?.maxTokens ?? 1024,
        options?.maxTokens && options.maxTokens >= 2000
          ? GEMINI_STORY_MAX_OUTPUT_TOKENS
          : 0,
      ),
    },
  });
  return (response.text ?? '').trim();
}

function isModelNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    (/404/.test(msg) || /NOT_FOUND/i.test(msg)) &&
    (/not found/i.test(msg) ||
      /is not found/i.test(msg) ||
      /no longer available/i.test(msg) ||
      /NOT_FOUND/i.test(msg))
  );
}


async function noteGeminiUsage(
  prompt: string,
  text: string,
  options: GeminiGenerateOptions | undefined,
  geminiTier: 'lite' | 'pro',
): Promise<void> {
  try {
    const { trackGeminiUsage } = await import('./llm/apiUsageTracker');
    const { mapGeminiTaskToModule } = await import('./diagnostics/costRates');
    trackGeminiUsage(prompt.length, text.length, {
      module: options?.costModule ?? mapGeminiTaskToModule(options?.task),
      label: options?.task ?? 'gemini',
      geminiTier,
    });
  } catch {
    /* ignore */
  }
}

function noteGeminiReachable(): void {
  try {
    const { useRucksackStore } = require('../module2/rucksack/rucksackStore') as {
      useRucksackStore: {
        getState: () => {
          setConnectivity: (c: { offline: boolean; checkedAtMs: number }) => void;
        };
      };
    };
    useRucksackStore.getState().setConnectivity({
      offline: false,
      checkedAtMs: Date.now(),
    });
  } catch {
    /* soft */
  }
}

/**
 * Einmalige Gemini-Antwort.
 * Primär Flash-Lite (~99%); Pro nur wenn Flash dünn/leer/überfordert ist.
 */
export async function generateGeminiText(
  prompt: string,
  options?: GeminiGenerateOptions,
): Promise<string> {
  try {
    await isGeminiCreditsExhausted();
  } catch {
    /* soft */
  }
  if (
    isGeminiCreditsExhaustedSync() &&
    !shouldRetryGeminiAfterExhaustion()
  ) {
    void announceGeminiCreditsEmpty();
    return tryOpenAiFallback(prompt, options);
  }
  if (!hasGeminiApiKey()) {
    return tryOpenAiFallback(prompt, options);
  }

  const tierInput: ResolveGeminiTierInput = {
    tier: options?.tier,
    forcePro: options?.forcePro,
    task: options?.task,
    stopCount: options?.stopCount,
    flashFailed: options?.flashFailed,
  };
  // Always Flash first; Pro list only if caller already escalated
  const flashFirst =
    options?.forcePro === true ||
    options?.flashFailed === true ||
    options?.tier === 'pro'
      ? resolveGeminiModels({ ...tierInput, tier: 'pro', forcePro: true })
      : resolveGeminiModels({ ...tierInput, tier: 'lite' });

  const primary = flashFirst[0] ?? GEMINI_MODEL;
  let lastError: unknown;
  let sawCreditsExhausted = false;
  let flashHardFailed = false;

  const sdk =
    options?.signal || env.useLlmProxy() ? null : await tryLoadSdkClient();

  const isAbortError = (err: unknown): boolean =>
    options?.signal?.aborted === true ||
    (err instanceof Error &&
      (err.name === 'AbortError' || /aborted|AbortError/i.test(err.message)));

  const tryModels = async (modelList: string[]): Promise<string> => {
    for (const model of modelList) {
      if (options?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      if (sdk) {
        try {
          const viaSdk = await generateViaSdk(model, prompt, options);
          if (viaSdk) {
            if (model !== primary) {
              console.warn(`[gemini] nutze Fallback-Modell ${model}`);
            }
            void clearGeminiCreditsExhausted();
            noteGeminiReachable();
            return viaSdk;
          }
        } catch (sdkErr) {
          lastError = sdkErr;
          if (isAbortError(sdkErr)) throw sdkErr;
          if (isGeminiCreditsExhaustedError(sdkErr)) {
            sawCreditsExhausted = true;
            void noteGeminiCreditsExhausted(sdkErr);
            void announceGeminiCreditsEmpty();
          }
          if (isModelNotFoundError(sdkErr)) {
            console.warn(`[gemini] ${model} nicht verfügbar, nächstes Modell…`);
            continue;
          }
        }
      }

      try {
        const viaRest = await generateViaRest(model, prompt, options);
        if (viaRest) {
          if (model !== primary) {
            console.warn(`[gemini] nutze Fallback-Modell ${model}`);
          }
          void clearGeminiCreditsExhausted();
          noteGeminiReachable();
          return viaRest;
        }
      } catch (err) {
        lastError = err;
        // Hard abort: kein Modell-Fallback, keine Pro-Eskalation (Kostenfalle)
        if (isAbortError(err)) throw err;
        if (isGeminiCreditsExhaustedError(err)) {
          sawCreditsExhausted = true;
          void noteGeminiCreditsExhausted(err);
          void announceGeminiCreditsEmpty();
          console.warn(`[gemini] Guthaben leer bei ${model}`);
          // No point cycling models — same billing account
          break;
        }
        if (isModelNotFoundError(err)) {
          console.warn(`[gemini] ${model} nicht verfügbar, nächstes Modell…`);
          continue;
        }
        if (isGeminiSoftRateLimitError(err)) {
          console.warn(`[gemini] Rate-Limit bei ${model}, nächstes Modell…`);
          flashHardFailed = true;
          continue;
        }
        console.warn(`[gemini] generate fehlgeschlagen (${model}):`, err);
        flashHardFailed = true;
      }
    }
    return '';
  };

  let text = await tryModels(flashFirst);
  if (!text.trim()) flashHardFailed = true;
  let usedPro = options?.forcePro === true || options?.tier === 'pro';
  const firstTier: 'lite' | 'pro' = usedPro ? 'pro' : 'lite';
  await noteGeminiUsage(prompt, text, options, firstTier);

  const thinFlash = shouldEscalateHistoryToPro(text, options?.task);
  const allowPro =
    options?.allowProEscalate !== false &&
    options?.task !== 'history_deep' &&
    options?.task !== 'teaser';

  // Flash thin/empty/failed → einmal Pro (nicht bei Stories/Teaser, Abort, Budget, Credits)
  if (
    allowPro &&
    (thinFlash || flashHardFailed) &&
    !sawCreditsExhausted &&
    !options?.signal?.aborted &&
    options?.flashFailed !== true &&
    options?.forcePro !== true &&
    options?.tier !== 'pro'
  ) {
    const { canAutoEscalateToPro, recordProEscalation } = await import(
      './llm/proEscalateBudget'
    );
    if (!(await canAutoEscalateToPro())) {
      try {
        const { noteFallback } = await import('./debug/fallbackLabel');
        noteFallback('Gemini-Pro', 'Tagesbudget erreicht — bleibe bei Flash');
      } catch {
        /* soft */
      }
      if (__DEV__) {
        console.warn('[gemini] Pro-Tagesbudget erreicht — bleibe bei Flash');
      }
    } else {
      try {
        const { noteFallback } = await import('./debug/fallbackLabel');
        noteFallback(
          'Gemini-Pro',
          `Flash überfordert (${options?.task ?? 'generic'})`,
        );
      } catch {
        /* soft */
      }
      if (__DEV__) {
        console.warn(
          `[gemini] Flash überfordert (${options?.task ?? 'generic'}) — Pro-Unterstützung`,
        );
      }
      await recordProEscalation();
      const proText = await tryModels(
        resolveGeminiModels({
          ...tierInput,
          flashFailed: true,
          forcePro: true,
          tier: 'pro',
        }),
      );
      if (proText.trim()) {
        text = proText;
        usedPro = true;
      }
      await noteGeminiUsage(prompt, proText, options, 'pro');
    }
  }

  if (!text.trim() && lastError) {
    console.warn('[gemini] alle Modelle fehlgeschlagen:', lastError);
    if (isGeminiCreditsExhaustedError(lastError) || sawCreditsExhausted) {
      void noteGeminiCreditsExhausted(lastError);
    }
  }

  try {
    const { recordLlmPrompt, recordLlmResponse } = await import(
      './feedback/telemetryBuffer'
    );
    recordLlmPrompt(prompt);
    if (text.trim()) recordLlmResponse(text);
  } catch {
    /* ignore */
  }

  if (!text.trim()) {
    const viaOpenAi = await tryOpenAiFallback(prompt, options);
    if (viaOpenAi.trim()) return viaOpenAi;
  }

  return text;
}

/**
 * Satz-Stream für TTS.
 * Preferiert streamGenerateContent (SSE), falls ReadableStream verfügbar und kein Proxy.
 * Fallback: generateContent → Sätze aus Volltext (RN/Hermes ohne Stream).
 */
export async function* streamGeminiSentences(
  prompt: string,
  options?: GeminiGenerateOptions,
): AsyncGenerator<string, void, unknown> {
  if (isGeminiCreditsExhaustedSync() || !hasGeminiApiKey()) {
    const text = await generateGeminiText(prompt, options);
    if (!text.trim()) return;
    yield* sentencesFromFullText(text);
    return;
  }

  try {
    if (!env.useLlmProxy() && resolveApiKey()) {
      const streamed = streamGenerateContentSse(prompt, options);
      let any = false;
      for await (const sentence of streamed) {
        any = true;
        yield sentence;
      }
      if (any) return;
    }

    const text = await generateGeminiText(prompt, options);
    if (!text.trim()) return;
    yield* sentencesFromFullText(text);
  } catch (err) {
    console.warn('[gemini] stream/generate fehlgeschlagen:', err);
  }
}

/**
 * SSE streamGenerateContent → vollständige Sätze yielden sobald erkennbar.
 */
async function* streamGenerateContentSse(
  prompt: string,
  options?: GeminiGenerateOptions,
): AsyncGenerator<string, void, unknown> {
  const apiKey = resolveApiKey();
  if (!apiKey || options?.signal?.aborted) return;

  const tierInput: ResolveGeminiTierInput = {
    tier: options?.tier ?? 'lite',
    forcePro: options?.forcePro,
    task: options?.task,
    stopCount: options?.stopCount,
    flashFailed: options?.flashFailed,
  };
  const models = resolveGeminiModels({ ...tierInput, tier: 'lite' });
  const model = models[0] ?? GEMINI_MODEL;

  const useSystem = options?.useFindusSystem !== false;
  const systemText = useSystem
    ? resolveFindusSystemInstruction(
        options?.systemInstruction,
        options?.masterContext,
      )
    : options?.systemInstruction;

  const generationConfig: Record<string, unknown> = {
    temperature: options?.temperature ?? GEMINI_TEMPERATURE,
    maxOutputTokens: options?.maxTokens ?? 1024,
  };
  if (options?.responseJson) {
    generationConfig.responseMimeType = 'application/json';
  }

  const history = Array.isArray(options?.chatHistory)
    ? options!.chatHistory!.filter(
        (t) =>
          (t.role === 'user' || t.role === 'model') &&
          typeof t.parts?.[0]?.text === 'string',
      )
    : [];
  const body: Record<string, unknown> = {
    contents: [
      ...history,
      { role: 'user', parts: [{ text: prompt }] },
    ],
    generationConfig,
  };
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const url = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new Error(`Gemini stream ${response.status}`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) return;

  const decoder = new TextDecoder();
  let sseBuf = '';
  let textAcc = '';
  let emittedCount = 0;
  let firstHookDone = Boolean(options?.responseJson);

  const flushSentences = function* (): Generator<string, void, unknown> {
    if (!firstHookDone) {
      const { chunks, rest } = extractStreamingChunks(textAcc, {
        isFirstChunk: true,
      });
      if (chunks.length === 0) return;
      firstHookDone = true;
      yield chunks[0]!;
      textAcc = [...chunks.slice(1), rest].filter(Boolean).join(' ');
      emittedCount = 0;
    }
    const sentences = splitIntoSentences(textAcc);
    if (sentences.length === 0) return;
    const trimmed = textAcc.trim();
    const lastComplete = /[.!?…]"?\s*$/u.test(trimmed);
    const ready = lastComplete ? sentences : sentences.slice(0, -1);
    for (let i = emittedCount; i < ready.length; i++) {
      const s = ready[i]!.trim();
      if (s) yield s;
    }
    emittedCount = ready.length;
  };

  while (true) {
    if (options?.signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* soft */
      }
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });
    const lines = sseBuf.split('\n');
    sseBuf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const delta = (json.candidates?.[0]?.content?.parts ?? [])
          .map((p) => p.text ?? '')
          .join('');
        if (delta) {
          textAcc += delta;
          yield* flushSentences();
        }
      } catch {
        /* partial json soft */
      }
    }
  }

  void noteGeminiUsage(prompt, textAcc, options, 'lite');

  const remaining = splitIntoSentences(textAcc).slice(emittedCount);
  for (const s of remaining) {
    const t = s.trim();
    if (t) yield t;
  }
}

/**
 * JSON-Stream (Call-1): SSE akkumulieren, onPartialJson bei jedem Delta.
 * Fallback: generateGeminiText ohne Stream.
 */
export async function generateGeminiJsonStream(
  prompt: string,
  options?: GeminiGenerateOptions & {
    onPartialJson?: (accumulated: string) => void;
  },
): Promise<string> {
  if (isGeminiCreditsExhaustedSync() || !hasGeminiApiKey()) {
    return generateGeminiText(prompt, {
      ...options,
      responseJson: true,
      jsonMimeOnly: true,
    });
  }
  // Hermes/RN: oft kein ReadableStream / kein body.getReader → sofort Voll-JSON (kein Throw-Noise).
  // Early Bridge in runConciergeTurn deckt die Hörlatenz; onPartialJson feuert dann nicht.
  const canStreamBody = typeof globalThis.ReadableStream !== 'undefined';
  try {
    if (canStreamBody && !env.useLlmProxy() && resolveApiKey()) {
      const apiKey = resolveApiKey();
      if (!apiKey || options?.signal?.aborted) {
        return '';
      }
      const tierInput: ResolveGeminiTierInput = {
        tier: options?.tier ?? 'lite',
        forcePro: options?.forcePro,
        task: options?.task,
        stopCount: options?.stopCount,
        flashFailed: options?.flashFailed,
      };
      const models = resolveGeminiModels({ ...tierInput, tier: 'lite' });
      const model = models[0] ?? GEMINI_MODEL;
      const useSystem = options?.useFindusSystem !== false;
      const systemText = useSystem
        ? resolveFindusSystemInstruction(
            options?.systemInstruction,
            options?.masterContext,
          )
        : options?.systemInstruction;
      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options?.temperature ?? GEMINI_TEMPERATURE,
          maxOutputTokens: options?.maxTokens ?? 1200,
          responseMimeType: 'application/json',
        },
      };
      if (systemText) {
        body.systemInstruction = { parts: [{ text: systemText }] };
      }
      const url = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new Error(`Gemini json stream ${response.status}`);
      }
      const reader = response.body?.getReader?.();
      if (!reader) {
        // RN fetch: body ohne Reader → still auf Voll-JSON (kein console.warn-Spam).
        return generateGeminiText(prompt, {
          ...options,
          responseJson: true,
          jsonMimeOnly: true,
        });
      }
      const decoder = new TextDecoder();
      let sseBuf = '';
      let textAcc = '';
      while (true) {
        if (options?.signal?.aborted) {
          try {
            await reader.cancel();
          } catch {
            /* soft */
          }
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
        const lines = sseBuf.split('\n');
        sseBuf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload) as {
              candidates?: Array<{
                content?: { parts?: Array<{ text?: string }> };
              }>;
            };
            const delta = (json.candidates?.[0]?.content?.parts ?? [])
              .map((p) => p.text ?? '')
              .join('');
            if (delta) {
              textAcc += delta;
              options?.onPartialJson?.(textAcc);
            }
          } catch {
            /* partial */
          }
        }
      }
      void noteGeminiUsage(prompt, textAcc, options, 'lite');
      if (textAcc.trim()) return textAcc.trim();
    }
  } catch (err) {
    console.warn('[gemini] json stream fehlgeschlagen:', err);
  }
  return generateGeminiText(prompt, {
    ...options,
    responseJson: true,
    jsonMimeOnly: true,
  });
}

/**
 * Chat-ähnlich: System + User-Turns als ein Prompt (Follow-ups).
 */
export async function* askGeminiSentenceStream(
  messages: Array<{ role: string; content: string }>,
  options?: { enableGoogleSearch?: boolean; maxTokens?: number },
): AsyncGenerator<string, void, unknown> {
  if (!hasGeminiApiKey()) {
    yield* sentencesFromFullText(
      'Für Online-Antworten hinterlege bitte deinen Gemini-API-Key (EXPO_PUBLIC_GEMINI_API_KEY).',
    );
    return;
  }

  const systemParts = messages
    .filter((m) => m.role === 'system' && m.content.trim())
    .map((m) => m.content.trim());
  const dialogue = messages
    .filter((m) => m.role !== 'system' && m.content.trim())
    .map((m) => {
      const who = m.role === 'assistant' ? 'Yorro' : 'Nutzer';
      return `${who}: ${m.content.trim()}`;
    })
    .join('\n\n');

  const systemInstruction = [
    resolveFindusSystemInstruction(),
    ...systemParts,
  ].join('\n\n');

  const prompt = `${dialogue}\n\nYorro:`;

  yield* streamGeminiSentences(prompt, {
    systemInstruction,
    maxTokens: options?.maxTokens ?? 550,
    temperature: GEMINI_TEMPERATURE,
    useFindusSystem: false,
    enableGoogleSearch: options?.enableGoogleSearch === true,
  });
}

/**
 * Follow-up als strukturierte Concierge-Antwort (speech + bullets + actions).
 */
export async function askGeminiConciergeResponse(
  messages: Array<{ role: string; content: string }>,
  options?: {
    maxTokens?: number;
    signal?: AbortSignal;
    /** Default 20s — hart aborten, keine weiterlaufenden Kosten. */
    timeoutMs?: number;
  },
): Promise<GeminiConciergeResponse> {
  if (!hasGeminiApiKey()) {
    return wrapPlainAsConcierge(
      'Für Online-Antworten hinterlege bitte deinen Gemini-API-Key.',
    );
  }

  const systemParts = messages
    .filter((m) => m.role === 'system' && m.content.trim())
    .map((m) => m.content.trim());
  const dialogue = messages
    .filter((m) => m.role !== 'system' && m.content.trim())
    .map((m) => {
      const who = m.role === 'assistant' ? 'Yorro' : 'Nutzer';
      return `${who}: ${m.content.trim()}`;
    })
    .join('\n\n');

  const systemInstruction = [
    resolveFindusSystemInstruction(),
    ...systemParts,
    CONCIERGE_JSON_INSTRUCTION,
  ].join('\n\n');

  const prompt = `${dialogue}\n\nYorro (nur JSON):`;

  const timeoutMs = options?.timeoutMs ?? 20_000;
  const abortCtrl = new AbortController();
  const onParentAbort = () => abortCtrl.abort();
  if (options?.signal) {
    if (options.signal.aborted) abortCtrl.abort();
    else options.signal.addEventListener('abort', onParentAbort, { once: true });
  }
  const timeoutId = setTimeout(() => abortCtrl.abort(), timeoutMs);

  let raw = '';
  try {
    raw = await generateGeminiText(prompt, {
      systemInstruction,
      maxTokens: options?.maxTokens ?? 700,
      temperature: GEMINI_TEMPERATURE,
      useFindusSystem: false,
      responseJson: true,
      task: 'concierge',
      signal: abortCtrl.signal,
    });
  } catch (err) {
    const aborted =
      abortCtrl.signal.aborted ||
      (err instanceof Error &&
        (err.name === 'AbortError' || /aborted|AbortError/i.test(err.message)));
    if (!aborted) throw err;
    raw = '';
  } finally {
    clearTimeout(timeoutId);
    options?.signal?.removeEventListener('abort', onParentAbort);
  }

  const parsed = parseConciergeResponse(raw);
  if (parsed && parsed.speechText.trim().length >= 12) return parsed;

  const plain = (parsed?.speechText ?? raw).trim();
  if (plain.length >= 12) return parsed ?? wrapPlainAsConcierge(plain);

  const { generateUniversalFallbackReply } = await import(
    '../runtime/approachVisualCue'
  );
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const fallback = await generateUniversalFallbackReply({
    userQuestion: lastUser?.content ?? '',
    placeName: useFinnusStore.getState().currentLocationName,
    intentKind: 'concierge',
  });
  if (fallback) return wrapPlainAsConcierge(fallback);

  // Last resort: still Gemini-parameterized, never a frozen template string
  try {
    const live = await generateGeminiText(
      [
        'Du bist Yorro. Die letzte Antwort war unbrauchbar.',
        `User wollte: „${(lastUser?.content ?? '').slice(0, 200)}“.`,
        'Formuliere GENAU EINEN kurzen deutschen Satz (du-Form): nachfragen, wobei du helfen sollst — natürlich, kein Template.',
      ].join('\n'),
      {
        task: 'generic',
        useFindusSystem: false,
        maxTokens: 80,
        temperature: 0.6,
        allowProEscalate: false,
      },
    );
    const t = live.trim();
    if (t.length >= 10) return wrapPlainAsConcierge(t);
  } catch {
    /* ignore */
  }

  return wrapPlainAsConcierge(
    plain ||
      'Ich hab dich nicht ganz mitbekommen — worum geht’s genau?',
  );
}
