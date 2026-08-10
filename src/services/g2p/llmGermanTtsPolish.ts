/**
 * Optionaler LLM-Polish für deutsche TTS-Prosodie.
 * Nur bei aktiviertem Feature-Flag — nicht im Hot-Path standardmäßig,
 * da jeder Satz sonst ~200–500 ms LLM-Latenz kostet.
 */

import { env } from '../../config/env';
import { buildGermanTtsProsodyPrompt } from './germanTtsProsodyPrompt';
import { applyGermanTtsProsodyRules } from './germanTtsProsodyRules';

const POLISH_TIMEOUT_MS = 2500;
const polishCache = new Map<string, string>();

function isLlmPolishEnabled(): boolean {
  return env.get('EXPO_PUBLIC_TTS_LLM_POLISH') === '1';
}

type QuickLlm = {
  generate: (prompt: string) => Promise<string>;
};

let quickLlm: QuickLlm | null | undefined;

async function loadQuickLlm(): Promise<QuickLlm | null> {
  if (quickLlm !== undefined) return quickLlm;

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
      quickLlm = null;
      return null;
    }

    const initLlama =
      (mod.initLlama as
        | ((opts: object) => Promise<{
            completion: (opts: object) => Promise<{ text?: string }>;
          }>)
        | undefined) ??
      (
        mod.default as {
          initLlama?: (opts: object) => Promise<{
            completion: (opts: object) => Promise<{ text?: string }>;
          }>;
        }
      )?.initLlama;

    if (!initLlama) {
      quickLlm = null;
      return null;
    }

    const context = await initLlama({ model: modelPath, n_ctx: 2048 });
    if (!context?.completion) {
      quickLlm = null;
      return null;
    }

    quickLlm = {
      generate: async (prompt: string) => {
        const result = await context.completion({
          prompt,
          n_predict: 180,
          temperature: 0.3,
          stop: ['</s>', 'User:', 'Mensch:', 'TEXT ZUM UMBAUEN:', '```'],
        });
        return result?.text ?? '';
      },
    };
    return quickLlm;
  } catch {
    quickLlm = null;
    return null;
  }
}

function cleanLlmOutput(raw: string, original: string): string {
  let s = raw.trim();
  // Nur erste Zeile/Absatz nehmen (kein Nachplappern)
  const firstLine = s.split(/\n{2,}/)[0]?.trim() ?? s;
  s = firstLine.replace(/^["„"']|["„"']$/g, '').trim();
  if (!s || s.length < 3) return original;
  return applyGermanTtsProsodyRules(s);
}

/**
 * Poliert Text per LLM für TTS-TTS.
 * Fallback: regelbasierte Prosodie. Cache verhindert Doppelaufrufe.
 */
export async function polishGermanTtsWithLlm(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  const ruleBased = applyGermanTtsProsodyRules(trimmed);

  if (!isLlmPolishEnabled()) {
    return ruleBased;
  }

  const cached = polishCache.get(trimmed);
  if (cached) return cached;

  const llm = await loadQuickLlm();
  if (!llm) return ruleBased;

  const prompt = buildGermanTtsProsodyPrompt(trimmed);

  try {
    const result = await Promise.race([
      llm.generate(prompt),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('TTS polish timeout')), POLISH_TIMEOUT_MS),
      ),
    ]);
    const polished = cleanLlmOutput(result, ruleBased);
    polishCache.set(trimmed, polished);
    if (polishCache.size > 200) {
      const first = polishCache.keys().next().value;
      if (first) polishCache.delete(first);
    }
    return polished;
  } catch {
    return ruleBased;
  }
}

/** Synchroner Pfad — immer regelbasiert (Hot-Path für speakChunkSource). */
export function polishGermanTtsSync(text: string): string {
  return applyGermanTtsProsodyRules(text);
}
