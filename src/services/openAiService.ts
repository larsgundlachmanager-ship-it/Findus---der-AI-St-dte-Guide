import type { ChatMessage } from '../db/types';
import { OPENAI_API_URL, OPENAI_MODEL } from '../constants/prompts';
import { env } from '../config/env';
import {
  extractCompletedSentences,
  sentencesFromFullText,
} from './ai/sentenceStream';

/**
 * Tier 2 – Online OpenAI Fallback für User-Rückfragen.
 */
export async function askOpenAi(
  chatHistory: ChatMessage[],
): Promise<string> {
  const parts: string[] = [];
  for await (const s of askOpenAiSentenceStream(chatHistory)) {
    parts.push(s);
  }
  return parts.join(' ').trim();
}

/**
 * OpenAI → Satz-Stream (erster Satz sofort an TTS).
 * React Native: XHR onprogress; Fallback: einmaliger Non-Stream-Call.
 */
export async function* askOpenAiSentenceStream(
  chatHistory: ChatMessage[],
): AsyncGenerator<string, void, unknown> {
  const apiKey = env.openAiApiKey();

  if (!apiKey || apiKey.includes('your-key-here')) {
    yield* sentencesFromFullText(buildDevFallbackAnswer(chatHistory));
    return;
  }

  const messages = chatHistory
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  try {
    yield* streamOpenAiViaXhr(apiKey, messages);
  } catch (err) {
    console.warn('[openai] Stream fehlgeschlagen, Non-Stream Fallback:', err);
    const full = await askOpenAiOnce(apiKey, messages);
    yield* sentencesFromFullText(full);
  }
}

async function askOpenAiOnce(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 400,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('OpenAI returned empty content');
  return content;
}

async function* streamOpenAiViaXhr(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
): AsyncGenerator<string, void, unknown> {
  const pending: string[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  let failed: Error | null = null;
  let buffer = '';
  let rawCarry = '';

  const notify = () => {
    wake?.();
    wake = null;
  };

  const xhr = new XMLHttpRequest();
  xhr.open('POST', OPENAI_API_URL);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
  xhr.responseType = 'text';

  let lastIndex = 0;
  xhr.onprogress = () => {
    const text = xhr.responseText ?? '';
    const chunk = text.slice(lastIndex);
    lastIndex = text.length;
    if (!chunk) return;
    rawCarry += chunk;
    const lines = rawCarry.split('\n');
    rawCarry = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content ?? '';
        if (!delta) continue;
        buffer += delta;
        const { sentences, rest } = extractCompletedSentences(buffer);
        buffer = rest;
        for (const s of sentences) {
          pending.push(s);
          notify();
        }
      } catch {
        // ignore
      }
    }
  };

  xhr.onerror = () => {
    failed = new Error('OpenAI XHR network error');
    done = true;
    notify();
  };

  xhr.onload = () => {
    if (xhr.status < 200 || xhr.status >= 300) {
      failed = new Error(`OpenAI error ${xhr.status}: ${xhr.responseText}`);
    } else {
      const tail = buffer.trim();
      if (tail) pending.push(tail);
    }
    done = true;
    notify();
  };

  xhr.send(
    JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 400,
      stream: true,
    }),
  );

  while (!done || pending.length > 0) {
    if (pending.length === 0) {
      await new Promise<void>((r) => {
        wake = r;
      });
      if (failed) throw failed;
      continue;
    }
    yield pending.shift()!;
  }

  if (failed) throw failed;
}

function buildDevFallbackAnswer(chatHistory: ChatMessage[]): string {
  const lastUser = [...chatHistory].reverse().find((m) => m.role === 'user');
  const locationHint =
    [...chatHistory]
      .reverse()
      .find((m) => m.role === 'system' && m.content.includes('Aktueller Ort'))
      ?.content.match(/Aktueller Ort:\s*(.+)/)?.[1] ?? 'diesem Ort';

  return (
    `Gute Frage${lastUser ? ` zu „${lastUser.content.slice(0, 60)}“` : ''}! ` +
    `Aus dem, was ich zu ${locationHint} weiß: Schau dir die Fakten in meiner letzten Erzählung an – ` +
    `für eine vollständige Online-Antwort hinterlege bitte deinen OpenAI-API-Key in .env ` +
    `(EXPO_PUBLIC_OPENAI_API_KEY).`
  );
}
