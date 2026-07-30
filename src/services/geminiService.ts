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
import { sentencesFromFullText } from './ai/sentenceStream';
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
  isGeminiCreditsExhaustedError,
  isGeminiSoftRateLimitError,
  noteGeminiCreditsExhausted,
} from './llm/geminiBillingGuard';
import { NATURAL_SPEECH_RATE_RULE } from './ai/promptBuilder';

export { consumeGeminiCreditsWarning } from './llm/geminiBillingGuard';

/** Cartesia sonic-3.5: Emotion/Atem/Dynamik nur über natürlichen Text. */
const CARTESIA_EMOTION_ENGINE_RULE = `## Cartesia Emotion & Naturalness Engine
Deine Texte werden von Cartesia sonic-3.5 gesprochen — nicht von einem Vorleser.
Emotion, Flüstern, Begeisterung und Atempausen entstehen NUR durch Kontext und Interpunktion.
Schreibe menschlich: Kommas für Atem, Ausrufezeichen für Energie, „..." für Flüstern/Spannung, Gedankenstriche für Pausen.
Keine SSML, keine Regie-Anweisungen, keine phonetischen Umschreibungen.`;

/** Aktive Findus-System-Instruction = Master Engine + Cartesia Speech Rules. */
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
  return `${base}\n\n${CARTESIA_EMOTION_ENGINE_RULE}\n\n${NATURAL_SPEECH_RATE_RULE}`;
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
            },
          },
        },
        required: ['type', 'label'],
      },
    },
  },
  required: ['speechText', 'visualBullets', 'quickActions'],
} as const;

export type GeminiGenerateOptions = {
  maxTokens?: number;
  temperature?: number;
  systemInstruction?: string;
  /** Wenn false, keine Findus-System-Instruction (z. B. JSON-Extraktion). */
  useFindusSystem?: boolean;
  /** First-POI / Landmark-Kontext für den Master-Prompt. */
  masterContext?: MasterPromptContext;
  /** Google Search Grounding für Concierge-Live-Daten. */
  enableGoogleSearch?: boolean;
  /** Erzwingt application/json (+ optionales Schema). */
  responseJson?: boolean;
  /** Cost Control: lite (default) | pro (gated). */
  tier?: GeminiModelTier;
  forcePro?: boolean;
  task?: GeminiTaskKind;
  stopCount?: number;
  flashFailed?: boolean;
  /** Hard abort (z. B. Judge-Timeout) — bricht fetch ab, keine weiterlaufenden Kosten. */
  signal?: AbortSignal;
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
  const key = env.geminiApiKey();
  if (!key || key.includes('your-') || key.includes('YOUR_')) return '';
  return key;
}

export function hasGeminiApiKey(): boolean {
  return Boolean(resolveApiKey());
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
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
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
  const apiKey = resolveApiKey();
  if (!apiKey) return '';

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
    generationConfig.responseSchema = CONCIERGE_RESPONSE_SCHEMA;
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig,
  };
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }
  if (wantSearch) {
    body.tools = [{ google_search: {} }];
  }

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const signal = options?.signal;

  try {
    return extractTextFromRest(await postGenerate(url, body, signal));
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
      return extractTextFromRest(await postGenerate(url, body, signal));
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
        return extractTextFromRest(await postGenerate(url, body, signal));
      } catch {
        delete (body.generationConfig as Record<string, unknown>).responseMimeType;
        return extractTextFromRest(await postGenerate(url, body, signal));
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
      return extractTextFromRest(await postGenerate(url, body, signal));
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

/**
 * Einmalige Gemini-Antwort.
 * Primär Flash-Lite (~99%); Pro nur wenn Flash dünn/leer/überfordert ist.
 */
export async function generateGeminiText(
  prompt: string,
  options?: GeminiGenerateOptions,
): Promise<string> {
  if (!hasGeminiApiKey()) return '';

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

  const sdk = options?.signal ? null : await tryLoadSdkClient();

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
            return viaSdk;
          }
        } catch (sdkErr) {
          lastError = sdkErr;
          if (isAbortError(sdkErr)) throw sdkErr;
          if (isGeminiCreditsExhaustedError(sdkErr)) {
            sawCreditsExhausted = true;
            void noteGeminiCreditsExhausted(sdkErr);
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
          return viaRest;
        }
      } catch (err) {
        lastError = err;
        // Hard abort: kein Modell-Fallback, keine Pro-Eskalation (Kostenfalle)
        if (isAbortError(err)) throw err;
        if (isGeminiCreditsExhaustedError(err)) {
          sawCreditsExhausted = true;
          void noteGeminiCreditsExhausted(err);
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

  try {
    const { trackGeminiUsage } = await import('./llm/apiUsageTracker');
    trackGeminiUsage(prompt.length, text.length);
    const { recordLlmPrompt, recordLlmResponse } = await import(
      './feedback/telemetryBuffer'
    );
    recordLlmPrompt(prompt);
    if (text.trim()) recordLlmResponse(text);
  } catch {
    /* ignore */
  }

  const thinFlash = shouldEscalateHistoryToPro(text, options?.task);

  // Flash thin/empty/failed → einmal Pro als Unterstützung (nicht bei leerem Guthaben / Abort)
  if (
    (thinFlash || flashHardFailed) &&
    !sawCreditsExhausted &&
    !options?.signal?.aborted &&
    options?.flashFailed !== true &&
    options?.forcePro !== true &&
    options?.tier !== 'pro'
  ) {
    if (__DEV__) {
      console.warn(
        `[gemini] Flash überfordert (${options?.task ?? 'generic'}) — Pro-Unterstützung`,
      );
    }
    const proText = await tryModels(
      resolveGeminiModels({
        ...tierInput,
        flashFailed: true,
        forcePro: true,
        tier: 'pro',
      }),
    );
    if (proText.trim()) text = proText;
  }

  if (!text.trim() && lastError) {
    console.warn('[gemini] alle Modelle fehlgeschlagen:', lastError);
    if (isGeminiCreditsExhaustedError(lastError) || sawCreditsExhausted) {
      void noteGeminiCreditsExhausted(lastError);
    }
  }
  return text;
}

/**
 * Satz-Stream für TTS.
 * React Native/Hermes hat kein ReadableStream → kein SSE-body.getReader().
 * Stattdessen: generateContent (REST) und Sätze aus dem Volltext yielden.
 */
export async function* streamGeminiSentences(
  prompt: string,
  options?: GeminiGenerateOptions,
): AsyncGenerator<string, void, unknown> {
  if (!hasGeminiApiKey()) return;

  try {
    const text = await generateGeminiText(prompt, options);
    if (!text.trim()) return;
    yield* sentencesFromFullText(text);
  } catch (err) {
    console.warn('[gemini] stream/generate fehlgeschlagen:', err);
  }
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
      const who = m.role === 'assistant' ? 'Findus' : 'Nutzer';
      return `${who}: ${m.content.trim()}`;
    })
    .join('\n\n');

  const systemInstruction = [
    resolveFindusSystemInstruction(),
    ...systemParts,
  ].join('\n\n');

  const prompt = `${dialogue}\n\nFindus:`;

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
  options?: { maxTokens?: number },
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
      const who = m.role === 'assistant' ? 'Findus' : 'Nutzer';
      return `${who}: ${m.content.trim()}`;
    })
    .join('\n\n');

  const systemInstruction = [
    resolveFindusSystemInstruction(),
    ...systemParts,
    CONCIERGE_JSON_INSTRUCTION,
  ].join('\n\n');

  const prompt = `${dialogue}\n\nFindus (nur JSON):`;

  const raw = await generateGeminiText(prompt, {
    systemInstruction,
    maxTokens: options?.maxTokens ?? 700,
    temperature: GEMINI_TEMPERATURE,
    useFindusSystem: false,
    responseJson: true,
    task: 'concierge',
  });

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
        'Du bist Findus. Die letzte Antwort war unbrauchbar.',
        `User wollte: „${(lastUser?.content ?? '').slice(0, 200)}“.`,
        'Formuliere GENAU EINEN kurzen deutschen Satz (du-Form): nachfragen, wobei du helfen sollst — natürlich, kein Template.',
      ].join('\n'),
      {
        task: 'generic',
        useFindusSystem: false,
        maxTokens: 80,
        temperature: 0.6,
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
