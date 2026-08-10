/**
 * Text-Engine: Single-Shot Gemini → Offline general_info.
 */

import type { PoiWithFacts } from '../db/types';
import { env } from '../config/env';
import { getCachedUserProfile } from './userProfileService';
import { createDefaultProfile } from '../types/userProfile';
import type { MasterPromptContext } from '../types/userProfile';
import {
  generateGeminiText,
  hasGeminiApiKey,
} from './geminiService';
import { GEMINI_TEMPERATURE } from '../constants/gemini';
import { sentencesFromFullText } from './ai/sentenceStream';

export async function generateLocalTourNarration(
  poi: PoiWithFacts,
): Promise<string> {
  const parts: string[] = [];
  for await (const s of generateLocalTourNarrationStream(poi)) {
    parts.push(s);
  }
  return parts.join(' ').trim();
}

export type GeneratePromptOptions = {
  maxTokens?: number;
  temperature?: number;
  useFindusSystem?: boolean;
  masterContext?: MasterPromptContext;
  systemInstruction?: string;
  tier?: 'lite' | 'pro';
  forcePro?: boolean;
  task?:
    | 'nav_parse'
    | 'weather'
    | 'local_qa'
    | 'intent'
    | 'teaser'
    | 'concierge'
    | 'story'
    | 'history_deep'
    | 'itinerary'
    | 'generic';
  stopCount?: number;
  flashFailed?: boolean;
};

export function hasTextEngine(): boolean {
  return hasGeminiApiKey() || hasLocalLlm();
}

export function hasLocalLlm(): boolean {
  return Boolean(env.localModelPath()?.trim());
}

export async function generatePromptText(
  prompt: string,
  options?: GeneratePromptOptions,
): Promise<string> {
  if (hasGeminiApiKey()) {
    try {
      const text = await generateGeminiText(prompt, {
        maxTokens: options?.maxTokens ?? 512,
        temperature: options?.temperature ?? GEMINI_TEMPERATURE,
        useFindusSystem: options?.useFindusSystem,
        masterContext: options?.masterContext,
        systemInstruction: options?.systemInstruction,
        tier: options?.tier,
        forcePro: options?.forcePro,
        task: options?.task,
        stopCount: options?.stopCount,
        flashFailed: options?.flashFailed,
      });
      if (text.trim()) return text.trim();
    } catch (error) {
      console.warn('[textEngine] Gemini generatePromptText:', error);
    }
  }

  try {
    const llama = await loadLlamaModule();
    if (!llama) return '';
    return (await llama.generate(prompt, options)).trim();
  } catch (error) {
    console.warn('[localAi] generatePromptText:', error);
    return '';
  }
}

export async function* streamPromptSentences(
  prompt: string,
  options?: GeneratePromptOptions,
): AsyncGenerator<string, void, unknown> {
  if (hasGeminiApiKey()) {
    try {
      let yielded = false;
      const text = await generateGeminiText(prompt, {
        maxTokens: options?.maxTokens ?? 512,
        temperature: options?.temperature ?? GEMINI_TEMPERATURE,
        useFindusSystem: options?.useFindusSystem,
        masterContext: options?.masterContext,
        systemInstruction: options?.systemInstruction,
        tier: options?.tier,
        forcePro: options?.forcePro,
        task: options?.task,
        stopCount: options?.stopCount,
        flashFailed: options?.flashFailed,
      });
      if (text.trim()) {
        for await (const sentence of sentencesFromFullText(text.trim())) {
          yielded = true;
          yield sentence;
        }
      }
      if (yielded) return;
    } catch (error) {
      console.warn('[textEngine] Gemini streamPromptSentences:', error);
    }
  }

  try {
    const llama = await loadLlamaModule();
    if (llama?.generateStream) {
      for await (const sentence of llama.generateStream(prompt)) {
        const t = sentence.trim();
        if (t) yield t;
      }
      return;
    }
    if (llama) {
      const text = await llama.generate(prompt);
      if (text?.trim()) {
        yield* sentencesFromFullText(text.trim());
      }
    }
  } catch (error) {
    console.warn('[localAi] streamPromptSentences:', error);
  }
}

export async function* generateLocalTourNarrationStream(
  poi: PoiWithFacts,
): AsyncGenerator<string, void, unknown> {
  const profile = getCachedUserProfile() ?? createDefaultProfile();
  // Reboot: nur noch Modul-1-POI-Chat
  const {
    streamModule1ChatSentences,
  } = require('./ai/module1PoiChat') as typeof import('./ai/module1PoiChat');
  const {
    extractOfflineGeneralInfo,
  } = require('./ai/singleShotStory') as typeof import('./ai/singleShotStory');
  try {
    let yielded = false;
    for await (const s of streamModule1ChatSentences({
      poi,
      profile,
      mode: 'arrival',
      timeoutMs: 22000,
    })) {
      yielded = true;
      yield s;
    }
    if (yielded) return;
  } catch (error) {
    console.warn('[textEngine] module1 chat failed:', error);
  }

  const offline = extractOfflineGeneralInfo(poi);
  if (offline) {
    yield* sentencesFromFullText(offline);
  } else {
    yield 'Offline liegt für diesen Ort keine fertige Erzählung vor.';
  }
}

type LlamaBridge = {
  generate: (
    prompt: string,
    options?: GeneratePromptOptions,
  ) => Promise<string>;
  generateStream?: (prompt: string) => AsyncGenerator<string, void, unknown>;
};

let llamaBridge: LlamaBridge | null | undefined;

async function loadLlamaModule(): Promise<LlamaBridge | null> {
  if (llamaBridge !== undefined) {
    return llamaBridge;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    let mod: Record<string, unknown> | null = null;
    try {
      mod = require('llama.rn');
    } catch {
      mod = null;
    }
    if (!mod) {
      llamaBridge = null;
      return null;
    }
    llamaBridge = null;
    return null;
  } catch {
    llamaBridge = null;
    return null;
  }
}
