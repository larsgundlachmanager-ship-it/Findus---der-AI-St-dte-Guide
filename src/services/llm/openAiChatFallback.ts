/**
 * OpenAI-Chat wenn Gemini-Guthaben leer ist.
 * Gleicher Aufrufer (generateGeminiText) — kein zweites Gehirn.
 */

import { env } from '../../config/env';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const FETCH_MS = 22_000;

export function hasOpenAiApiKey(): boolean {
  const key = env.openAiApiKey();
  return Boolean(key && !/your-key|YOUR_/i.test(key));
}

export async function generateOpenAiChatText(opts: {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const key = env.openAiApiKey();
  if (!key || /your-key|YOUR_/i.test(key)) return '';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (opts.system?.trim()) {
      messages.push({ role: 'system', content: opts.system.trim() });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: opts.temperature ?? 0.45,
        max_tokens: Math.min(Math.max(opts.maxTokens ?? 900, 64), 2500),
        messages,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[openai] ${res.status} ${body.slice(0, 180).replace(/\s+/g, ' ')}`,
      );
      return '';
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return String(data.choices?.[0]?.message?.content ?? '').trim();
  } catch (err) {
    if (__DEV__) console.warn('[openai] fallback failed', err);
    return '';
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
