/**
 * Menschliche Bridge — Flash-Lite, kontextuell, keine 0815-Floskeln.
 * Führt die spätere Antwort ein; Synthese bekommt denselben Text (Kontinuität).
 * Mic + Reboot teilen dieselbe In-Flight-Promise (kein Doppel-Speak).
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { getCachedUserProfile } from '../userProfileService';
import { getVoiceSettingsForTour } from '../ttsService';
import { speakRuntimeText } from '../../runtime/speechModule';
import { latencyMark } from '../debug/latencyTiming';
import { fallbackSpeech, noteFallback } from '../debug/fallbackLabel';
import { formatUserMemoryForPrompt } from '../../store/useUserMemoryStore';
import type { JobClassification } from '../../module2/jobs/types';

let lastBridgeLine = '';
let lastBridgeAtMs = 0;
let lastSpokenBridge = '';
let lastSpokenAtMs = 0;
let inFlight: Promise<string> | null = null;
let speakGate: Promise<void> | null = null;
const BRIDGE_GAP_MS = 1_800;
const SPOKEN_WINDOW_MS = 25_000;

export function getLastBridgeLine(): string | null {
  if (!lastBridgeLine) return null;
  if (Date.now() - lastBridgeAtMs > 120_000) return null;
  return lastBridgeLine;
}

export function clearLastBridgeLine(): void {
  lastBridgeLine = '';
  lastBridgeAtMs = 0;
}

export function isBridgeAlreadySpoken(line?: string | null): boolean {
  const t = (line ?? lastBridgeLine).replace(/\s+/g, ' ').trim();
  if (!t || !lastSpokenBridge) return false;
  if (Date.now() - lastSpokenAtMs > SPOKEN_WINDOW_MS) return false;
  return t === lastSpokenBridge;
}

function rememberBridge(line: string): void {
  lastBridgeLine = line.trim();
  lastBridgeAtMs = Date.now();
}

async function speakBridgeLineOnce(line: string): Promise<void> {
  const t = line.replace(/\s+/g, ' ').trim();
  if (!t) return;
  if (isBridgeAlreadySpoken(t)) return;
  if (speakGate) {
    await speakGate;
    return;
  }
  speakGate = (async () => {
    if (isBridgeAlreadySpoken(t)) return;
    lastSpokenBridge = t;
    lastSpokenAtMs = Date.now();
    rememberBridge(t);
    try {
      const cached = getCachedUserProfile();
      const voice = cached
        ? { voiceId: cached.voiceId, speechRate: 1 as const }
        : await getVoiceSettingsForTour();
      await speakRuntimeText(
        t,
        { voiceId: voice.voiceId, speechRate: voice.speechRate },
        { priority: 'system', deliveryKind: 'assistant' },
      );
    } catch {
      noteFallback('Bridge-TTS', 'speakRuntimeText fehlgeschlagen');
    }
  })();
  try {
    await speakGate;
  } finally {
    speakGate = null;
  }
}

/**
 * Flash-Lite: 1 kurzer menschlicher Satz — Bezug zum User, keine Meta-Recherche.
 */
export async function generateContextualBridge(opts: {
  userText: string;
  jobId?: string | null;
  jobHint?: string | null;
}): Promise<string | null> {
  const userText = opts.userText.replace(/\s+/g, ' ').trim();
  if (userText.length < 4) return null;
  if (!hasGeminiApiKey()) {
    noteFallback('Bridge-LLM', 'kein Gemini-Key');
    return null;
  }

  let memory = '';
  try {
    memory = formatUserMemoryForPrompt()?.slice(0, 500) ?? '';
  } catch {
    memory = '';
  }
  const profile = getCachedUserProfile();
  const name = profile?.firstName?.trim() || null;
  const city = profile?.cityName?.trim() || null;

  const prompt = [
    'Du bist Findus — warmer Reise-/Alltagsbegleiter auf Deutsch.',
    'Schreib GENAU EINEN kurzen Bridge-Satz (max. 22 Wörter, 1 Satz).',
    'Das ist das EINZIGE Vorgeplänkel vor der echten Antwort.',
    '',
    'PFLICHT:',
    '- Reagiere KONKRET auf das, was der User gesagt hat (Sieg, Hitze, Zoo, Plan, Emotion).',
    '- Wie ein Mensch: Glückwunsch, Zustimmung, Empathie, Witz — wenn passend.',
    '- Leite natürlich zur kommenden Hilfe über, ohne Fakten zu spoilern.',
    '- Wortlaut frei, organisch, an Persona/Kontext angepasst.',
    '',
    'VERBOTEN:',
    '- 0815-Floskeln („Ich schau mal“, „Gute Frage“, „Alles klar“, „Moment“, „Mega Plan“).',
    '- Meta über Recherche/API/„ich suche jetzt“.',
    '- Markdown, Emoji-Overkill, zweite Frage-Spirale.',
    '- Die eigentliche Lösung vorwegnehmen (keine Zahlen/Orte erfinden).',
    '',
    name ? `User-Vorname: ${name}` : '',
    city ? `Stadt: ${city}` : '',
    opts.jobId ? `Interner Job (nur Ton-Hinweis): ${opts.jobId}` : '',
    opts.jobHint ? `Job-Hinweis: ${opts.jobHint}` : '',
    memory ? `Kontext/Memory:\n${memory}` : '',
    '',
    `User gerade: „${userText.slice(0, 280)}“`,
    '',
    'Nur den einen Satz ausgeben, nichts sonst.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      tier: 'lite',
      maxTokens: 70,
      temperature: 0.85,
      useFindusSystem: false,
    });
    let line = (raw || '')
      .replace(/\s+/g, ' ')
      .replace(/^["„]|["“]$/g, '')
      .trim();
    const cut = line.search(/[.!?…](?=\s|$)/);
    if (cut > 8) line = line.slice(0, cut + 1).trim();
    if (line.length < 6 || line.length > 160) {
      noteFallback('Bridge-LLM', 'Antwort zu kurz/lang');
      return null;
    }
    if (
      /\b(ich schau|gute frage|alles klar|moment|ich recherch|lass mich)\b/iu.test(
        line,
      )
    ) {
      noteFallback('Bridge-LLM', 'Floskel-artig verworfen');
      return null;
    }
    return line;
  } catch (err) {
    noteFallback(
      'Bridge-LLM',
      err instanceof Error ? err.message.slice(0, 80) : 'Fehler',
    );
    return null;
  }
}

function heuristicBridgeFallback(userText: string): string {
  const t = userText.toLowerCase();
  if (/\b(gewonnen|gewinn|sieg|turnier|erste\s+runde)\b/u.test(t)) {
    return fallbackSpeech(
      'Bridge-Heuristik',
      'Krass, Glückwunsch — und jetzt schauen wir, was als Nächstes Sinn ergibt.',
    );
  }
  if (/\b(heiß|heiss|schwül|hitze|so\s+warm)\b/u.test(t)) {
    return fallbackSpeech(
      'Bridge-Heuristik',
      'Stimmt, heute ist richtig heiß — lass uns das sinnvoll angehen.',
    );
  }
  if (/\b(zoo|tierpark)\b/u.test(t)) {
    return fallbackSpeech(
      'Bridge-Heuristik',
      'Genau, Zoo geht in jedem Alter — ich pass dir das an.',
    );
  }
  return fallbackSpeech(
    'Bridge-Heuristik',
    'Verstehe dich — ich setz genau da an.',
  );
}

async function ensureBridgeLine(
  userText: string,
  job?: JobClassification | null,
): Promise<string> {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (inFlight) return inFlight;

  inFlight = (async () => {
    latencyMark('ack', job?.jobId ?? 'contextual');
    const line =
      (await generateContextualBridge({
        userText: t,
        jobId: job?.jobId ?? null,
        jobHint: job?.contract?.agentIntent ?? null,
      })) ?? heuristicBridgeFallback(t);
    rememberBridge(line);
    return line;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Fire-and-forget vom Mic — DEAKTIVIERT.
 * Bridge kommt ausschließlich aus dem Concierge-Manager (analyzeTurn / runConciergeTurn).
 * Doppel-Bridge / alte Floskeln vermeiden.
 */
export function speakContextualBridgeFireAndForget(
  _userText: string,
  _opts?: { job?: JobClassification | null },
): void {
  if (__DEV__) {
    console.log(
      '[bridge] speakContextualBridgeFireAndForget ignored — Manager owns bridge',
    );
  }
}

/**
 * Legacy Reboot-Pfad — DEAKTIVIERT (gleiche Zeile wie Mic).
 * Nutze Manager-Bridge in runConciergeTurn.
 */
export async function resolveContextualBridgeLine(
  _userText: string,
  _job?: JobClassification | null,
  _opts?: { speak?: boolean },
): Promise<string | null> {
  return getLastBridgeLine();
}
