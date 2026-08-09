/**
 * Synthese Phase A/B/C — Chunks, Bullets, Buttons.
 */

import type { LogicNodeOutput, SynthesisPayload } from '../types';
import { chunkTextForTts } from '../speech/ttsChunker';
import { clampButtonLabel } from './logicNode';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import { expandGermanAbbreviationsForSpeech } from '../../services/agi/speechGuardrails';
import { humanizeAgentDraft, humanizeBullets } from '../speech/draftToHumanSpeech';

const ADDRESSISH =
  /\b(\d{5}|\bDeutschland\b|Straße\s+\d+|Str\.\s*\d+|Hausnummer)\b/i;
const URLISH = /https?:\/\/|www\./i;

export function synthesizeOutput(logic: LogicNodeOutput): SynthesisPayload {
  // managerMode aus: sonst compressManagerLine am ersten „ca.“ abschneiden kann
  let spoken = expandGermanAbbreviationsForSpeech(
    humanizeAgentDraft(logic.spokenDraft, {
      maxChars: 1400,
      managerMode: false,
    }),
  );
  // Gesetz 001/012 — Adressen/URLs aus Audio
  if (ADDRESSISH.test(spoken)) {
    spoken = spoken
      .replace(/\b\d{5}\b/g, '')
      .replace(/\bDeutschland\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (URLISH.test(spoken)) {
    spoken = spoken.replace(/https?:\/\/\S+/gi, '').replace(/www\.\S+/gi, '');
    spoken = `${spoken.trim()} Details liegen auf den Buttons.`;
  }

  const spokenChunks = chunkTextForTts(spoken);
  const bullets = humanizeBullets(logic.bullets, 3);

  const buttons = logic.buttons
    .filter((b) => b.payload != null)
    .map((b) => ({
      ...b,
      label: ensureEmoji(clampButtonLabel(b.label)),
    }));

  return {
    spokenChunks,
    bullets,
    buttons,
    fullDraftForUi: spoken,
  };
}

function ensureEmoji(label: string): string {
  if (/[\u{1F300}-\u{1FAFF}]/u.test(label)) return label;
  return shortenActionLabel(`✨ ${label}`);
}
