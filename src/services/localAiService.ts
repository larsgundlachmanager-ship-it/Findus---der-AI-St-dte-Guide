import type { PoiWithFacts } from '../db/types';
import { env } from '../config/env';
import {
  buildContextAwareOfflineNarration,
  buildPoiContextPrompt,
} from './ai/promptBuilder';
import { filterDeepStoryFacts } from './ai/deepStoryFilter';
import {
  extractCompletedSentences,
  sentencesFromFullText,
} from './ai/sentenceStream';
import { getCachedUserProfile } from './userProfileService';
import { createDefaultProfile } from '../types/userProfile';

/**
 * Tier 1 – Offline SLM via react-native-llama (llama.cpp Bindings).
 * Vor Kokoro: Context-Aware Prompt (Live-Zeit, Persona, Interessen, Filter).
 * Fallback: gefiltertes Offline-Template, wenn kein Native-Modell da ist.
 */
export async function generateLocalTourNarration(
  poi: PoiWithFacts,
): Promise<string> {
  const parts: string[] = [];
  for await (const s of generateLocalTourNarrationStream(poi)) {
    parts.push(s);
  }
  return parts.join(' ').trim();
}

/**
 * Satz-Stream für einen beliebigen Prompt (Deep Story).
 * Keine Personality-Polish-Mutation vor Kokoro.
 */
export async function* streamPromptSentences(
  prompt: string,
): AsyncGenerator<string, void, unknown> {
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
        return;
      }
    }
  } catch (error) {
    console.warn('[localAi] streamPromptSentences:', error);
  }
}

/**
 * Satz-Stream für Instant-TTS: erster Satz → Audio, Rest parallel.
 * Deep-Story-Filter entfernt Kontakt-Daten / Jahreszahlen nach Profil.
 */
export async function* generateLocalTourNarrationStream(
  poi: PoiWithFacts,
): AsyncGenerator<string, void, unknown> {
  const profile = getCachedUserProfile() ?? createDefaultProfile();
  const deep = filterDeepStoryFacts(poi, { profile });
  const filteredPoi: PoiWithFacts = {
    ...poi,
    facts: deep.facts.map((f) => ({
      id: f.id,
      poi_id: poi.id,
      fact_text: f.text,
    })),
  };
  const prompt = buildPoiContextPrompt(filteredPoi, profile);

  try {
    let yielded = false;
    for await (const sentence of streamPromptSentences(prompt)) {
      yielded = true;
      yield sentence;
    }
    if (yielded) return;
  } catch (error) {
    console.warn('[localAi] SLM unavailable, using offline template:', error);
  }

  const offline = buildContextAwareOfflineNarration(poi, profile);
  yield* sentencesFromFullText(offline);
}

type LlamaBridge = {
  generate: (prompt: string) => Promise<string>;
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
      try {
        mod = require('react-native-llama');
      } catch {
        mod = null;
      }
    }

    const modelPath = env.localModelPath();

    if (!mod || !modelPath) {
      llamaBridge = null;
      return null;
    }

    const initLlama =
      (mod.initLlama as
        | ((opts: object) => Promise<{
            completion: (
              opts: object,
              callback?: (data: { token?: string; text?: string }) => void,
            ) => Promise<{ text?: string }>;
          }>)
        | undefined) ??
      (
        mod.default as {
          initLlama?: (opts: object) => Promise<{
            completion: (
              opts: object,
              callback?: (data: { token?: string; text?: string }) => void,
            ) => Promise<{ text?: string }>;
          }>;
        }
      )?.initLlama;

    if (!initLlama) {
      llamaBridge = null;
      return null;
    }

    const context = await initLlama({ model: modelPath, n_ctx: 3072 });

    if (!context?.completion) {
      llamaBridge = null;
      return null;
    }

    llamaBridge = {
      generate: async (prompt: string) => {
        const result = await context.completion({
          prompt,
          n_predict: 220,
          temperature: 0.7,
          stop: ['</s>', 'User:', 'Mensch:', '```'],
        });
        return result?.text ?? '';
      },
      generateStream: async function* (prompt: string) {
        let buffer = '';
        let resolved = '';
        const pending: string[] = [];
        let wake: (() => void) | null = null;
        let done = false;

        const push = (s: string) => {
          pending.push(s);
          wake?.();
          wake = null;
        };

        const completionPromise = context
          .completion(
            {
              prompt,
              n_predict: 220,
              temperature: 0.7,
              stop: ['</s>', 'User:', 'Mensch:', '```'],
            },
            (data) => {
              const token = data.token ?? '';
              const partial = data.text ?? '';
              if (partial && partial.length >= resolved.length) {
                buffer = partial;
              } else if (token) {
                buffer += token;
              } else {
                return;
              }
              const { sentences, rest } = extractCompletedSentences(buffer);
              buffer = rest;
              for (const s of sentences) {
                resolved = resolved ? `${resolved} ${s}` : s;
                push(s.trim());
              }
            },
          )
          .then((result) => {
            const text = (result?.text ?? buffer).trim();
            if (text) {
              const remaining = text.startsWith(resolved)
                ? text.slice(resolved.length).trim()
                : text;
              if (remaining) {
                const { sentences, rest } =
                  extractCompletedSentences(remaining + ' ');
                for (const s of sentences) {
                  push(s.trim());
                }
                if (rest.trim()) {
                  push(rest.trim());
                }
              }
            }
          })
          .catch((err) => {
            console.warn('[localAi] stream completion:', err);
          })
          .finally(() => {
            done = true;
            wake?.();
            wake = null;
          });

        while (!done || pending.length > 0) {
          if (pending.length === 0) {
            await new Promise<void>((r) => {
              wake = r;
            });
            continue;
          }
          yield pending.shift()!;
        }

        await completionPromise;
      },
    };

    return llamaBridge;
  } catch {
    llamaBridge = null;
    return null;
  }
}
