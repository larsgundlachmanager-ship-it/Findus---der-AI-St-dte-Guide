/**
 * Gesetz 004/180: TTS-Chunks max 600 Zeichen.
 * Agent-Drafts dürfen länger sein (Wissen bis 3000).
 */

import { splitIntoSentences } from '../../services/ai/sentenceStream';
import { expandGermanAbbreviationsForSpeech } from '../../services/agi/speechGuardrails';

export const TTS_CHUNK_MAX = 600;

/**
 * Zerlegt Langtext in ≤600-Zeichen-Blöcke an Satzgrenzen.
 */
export function chunkTextForTts(raw: string, max = TTS_CHUNK_MAX): string[] {
  const expanded = expandGermanAbbreviationsForSpeech(raw || '').trim();
  if (!expanded) return [];

  const sentences = splitIntoSentences(expanded);
  if (sentences.length === 0) {
    return splitHard(expanded, max);
  }

  const chunks: string[] = [];
  let buf = '';

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    if (s.length > max) {
      if (buf) {
        chunks.push(buf.trim());
        buf = '';
      }
      chunks.push(...splitHard(s, max));
      continue;
    }
    const next = buf ? `${buf} ${s}` : s;
    if (next.length <= max) {
      buf = next;
    } else {
      if (buf) chunks.push(buf.trim());
      buf = s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function splitHard(text: string, max: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + max).trim());
    i += max;
  }
  return out.filter(Boolean);
}
