/**
 * Call-2 Tail JSON — parse + hybrid bullet clamp (RFC v2.1).
 */

import { clampVisualBullets } from '../../../services/concierge/visualBullets';

export type Call2TailV1 = {
  bullets: string[];
  memory_extract?: string[];
  shortAnswers?: string[];
  followUp?: {
    needed: boolean;
    reason?: string | null;
    delegateTo?: 'call3' | 'none';
    promptSeed?: string | null;
  };
  uiHints?: { cardTitle?: string; shortLabel?: string };
  background_tasks?: Array<{ type: string; [k: string]: unknown }>;
};

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw || '').trim();
  if (!t) return null;
  try {
    const p = JSON.parse(t);
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      return p as Record<string, unknown>;
    }
  } catch {
    /* fence */
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseCall2Tail(raw: string): Call2TailV1 | null {
  const p = parseJsonObject(raw);
  if (!p) return null;
  const bullets = Array.isArray(p.bullets)
    ? p.bullets.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const memory_extract = Array.isArray(p.memory_extract)
    ? p.memory_extract.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
    : undefined;
  const shortAnswers = Array.isArray(p.shortAnswers)
    ? p.shortAnswers.map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
    : undefined;
  const followUp =
    p.followUp && typeof p.followUp === 'object'
      ? (p.followUp as Call2TailV1['followUp'])
      : undefined;
  const uiHints =
    p.uiHints && typeof p.uiHints === 'object'
      ? (p.uiHints as Call2TailV1['uiHints'])
      : undefined;
  const background_tasks = Array.isArray(p.background_tasks)
    ? (p.background_tasks as Call2TailV1['background_tasks'])
    : undefined;
  return {
    bullets,
    memory_extract,
    shortAnswers,
    followUp,
    uiHints,
    background_tasks,
  };
}

export function mergeCall2Bullets(opts: {
  tailBullets: string[];
  agentBullets: string[];
  speechText: string;
  bulletMaxChars: number;
  allowAddress?: boolean;
}): string[] {
  const primary =
    opts.tailBullets.length > 0 ? opts.tailBullets : opts.agentBullets;
  return clampVisualBullets(primary, {
    speechText: opts.speechText,
    allowAddress: Boolean(opts.allowAddress),
    surface: 'default',
  }).slice(0, 3).map((b) =>
    b.length > opts.bulletMaxChars ? b.slice(0, opts.bulletMaxChars - 1) + '…' : b,
  );
}

export function buildCall2TailPrompt(opts: {
  userText: string;
  speechText: string;
  bulletMaxChars: number;
  agentBullets?: string[];
}): string {
  return [
    'Erzeuge NUR JSON (Call-2 Tail) nach dem gesprochenen Text.',
    'Felder: bullets[] (max 3, je max bulletMaxChars, nur Fakten aus Speech),',
    'optional memory_extract[], shortAnswers[] (Tap-Chips, echte Gabeln),',
    'optional followUp {needed,reason,delegateTo,promptSeed}, uiHints, background_tasks.',
    `bulletMaxChars=${opts.bulletMaxChars}`,
    `USER: ${opts.userText.slice(0, 400)}`,
    `SPEECH:\n${opts.speechText.slice(0, 2400)}`,
    opts.agentBullets?.length
      ? `AGENT_BULLETS_FALLBACK: ${JSON.stringify(opts.agentBullets.slice(0, 3))}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
