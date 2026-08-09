/**
 * Call-2 Synthese — schlank: Fakten + Persona + Reboot-Policy.
 * Kein 40-Block-Prompt-Ballast aus dem Alt-System.
 */

import {
  generateGeminiText,
  hasGeminiApiKey,
  resolveFindusSystemInstruction,
  resolveMasterPromptContext,
} from '../../services/geminiService';
import {
  FINDUS_ANSWER_FIRST_BLOCK,
  FINDUS_REBOOT_MANAGER_THINK_AHEAD_BLOCK,
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_BRIDGE_CONTINUITY_BLOCK,
  FINDUS_LIVE_CHAT_HUMAN_BLOCK,
} from '../../services/concierge/findusResponsePolicy';
import { chunkTextForTts } from '../speech/ttsChunker';
import { humanizeAgentDraft, humanizeBullets } from '../speech/draftToHumanSpeech';
import type { AgentResult, Module2ActionButton, SynthesisPayload } from '../types';
import { formatThreadContextForPrompt } from '../../services/memory/conversationThreads';
import { getLiveChatTurnContext } from '../../services/handsFree/liveChatTurnContext';

function buildSynthesisBlock(budget: number): string {
  const live = getLiveChatTurnContext();
  const liveBlock =
    live.active && live.humanTone ? `\n${FINDUS_LIVE_CHAT_HUMAN_BLOCK}\n` : '';
  const deepAsk =
    live.active && live.askBeforeDeepResearch
      ? '\n- Live-Chat: keine ungefragte Deep-Web-Recherche — erst kurze Antwort, bei Bedarf Rückfrage/Button „Tiefer recherchieren“.\n'
      : '';
  const maxChars = live.active && live.humanTone ? Math.min(budget, 420) : budget;
  return `=== REBOOT SYNTHESE (Call-2) ===
Du bekommst User-Frage + FAKTEN (stilfrei). Schreibe EINE natürliche Antwort zum Vorlesen.
${FINDUS_ANSWER_FIRST_BLOCK}
${FINDUS_BRIDGE_CONTINUITY_BLOCK}
${FINDUS_REBOOT_MANAGER_THINK_AHEAD_BLOCK}
${liveBlock}${deepAsk}- Nur belegte Fakten — nichts erfinden.
- Buttons/Stichpunkte aus den mitgelieferten Actions/Bullets übernehmen oder knapp spiegeln.
- Kein Meta (API/Agent/Pack/FAKTEN/FLOW/PACK-DATENSATZ). Keine zweite Bridge.
- Keine Permission-Fragen („Soll ich suchen?“).
- Max ~${maxChars} Zeichen Speech.
${FINDUS_FEW_SHOT_DISCLAIMER}
JSON only: {"speech":"...","bullets":[]}`;
}

/** Nach Call-2: Leak-Labels + Doppel-Bridge raus. */
export function scrubRebootSpeech(
  speech: string,
  opts: { bridgeOneLiner: string | null; budget: number },
): string {
  let s = (speech || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;

  s = s
    .replace(/\bPACK-DATENSATZ\b[^.!?]*/gi, '')
    .replace(
      /\b(MEHR HISTORIE|LÜCKE|LIVE-HINTS|TOPIC-LOCK|FAKTEN-DRAFT|Beantworte die|Erkläre was das ist —)\b[^.!?]*/gi,
      '',
    )
    .replace(/\bNichts erfinden\.?/gi, '')
    .replace(/\bMax\s*~\s*\d+\s*Zeichen[^.!?]*/gi, '')
    .replace(/\bOrt:\s*/gi, '')
    .replace(
      /\b(gute frage|interessante frage|ich schau(e)? (mal|kurz)|lass mich (kurz )?schauen|ich recherchier(e)?)\b[,!.\s]*/giu,
      '',
    );

  if (opts.bridgeOneLiner) {
    // Typische Ack-Opener nicht nochmal
    s = s.replace(
      /^(klar|alles klar|moment|guck|schau|kurz|okay|ok)[,!.\s]+/iu,
      '',
    );
  }

  s = s.replace(/\s{2,}/g, ' ').trim();
  return humanizeAgentDraft(s, { maxChars: opts.budget });
}

export async function synthesizeRebootTurn(opts: {
  userText: string;
  fact: AgentResult;
  bridgeOneLiner: string | null;
  jobId: string;
  speechBudgetChars?: number;
  signal?: AbortSignal;
}): Promise<SynthesisPayload> {
  const buttons: Module2ActionButton[] = opts.fact.buttons ?? [];
  const budget = opts.speechBudgetChars ?? 700;

  const finalize = (raw: string, bulletsIn: string[]): SynthesisPayload => {
    const speech = scrubRebootSpeech(raw, {
      bridgeOneLiner: opts.bridgeOneLiner,
      budget,
    });
    return {
      spokenChunks: chunkTextForTts(speech),
      bullets: humanizeBullets(bulletsIn, 3),
      buttons,
      fullDraftForUi: speech,
    };
  };

  if (!hasGeminiApiKey()) {
    return finalize(
      humanizeAgentDraft(opts.fact.draftText, { maxChars: budget + 200 }),
      opts.fact.bullets ?? [],
    );
  }

  let threadBlock = '';
  try {
    threadBlock = formatThreadContextForPrompt({ includeParkedIndex: false });
  } catch {
    threadBlock = '';
  }

  const deep = opts.fact.meta?.depth === 'deep';
  const userPrompt = [
    threadBlock ? `THREAD:\n${threadBlock}` : '',
    `USER: ${opts.userText}`,
    opts.bridgeOneLiner
      ? `BRIDGE (schon gesprochen, nicht wiederholen): ${opts.bridgeOneLiner}`
      : 'BRIDGE: keine',
    `JOB: ${opts.jobId}`,
    deep ? 'DEPTH: mehr Historie am selben Ort — schon Gesagtes nicht wiederholen.' : '',
    `FAKTEN-DRAFT:\n${opts.fact.draftText.slice(0, deep ? 4200 : 3200)}`,
    opts.fact.bullets?.length
      ? `BULLETS_IN: ${JSON.stringify(opts.fact.bullets.slice(0, 4))}`
      : '',
    `ACTIONS_IN: ${JSON.stringify(
      buttons.map((b) => ({ id: b.id, label: b.label })),
    )}`,
    `META: ${JSON.stringify({
      placeName: opts.fact.meta?.placeName,
      depth: opts.fact.meta?.depth,
      concrete_place: opts.fact.meta?.concrete_place,
      needsLiveResearch: opts.fact.meta?.needsLiveResearch,
    })}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const system = `${resolveFindusSystemInstruction(
      undefined,
      resolveMasterPromptContext({
        module1Narration: opts.jobId === 'poi_identify' && !deep,
        module1DeepDive: deep,
      }),
    )}\n\n${buildSynthesisBlock(budget)}`;
    const raw = await generateGeminiText(userPrompt, {
      systemInstruction: system,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
      maxTokens: deep ? 700 : 500,
      temperature: 0.55,
      signal: opts.signal,
      allowProEscalate: false,
    });
    const parsed = parseJson(raw);
    let speech = (parsed?.speech || '').trim();
    if (!speech) {
      speech = humanizeAgentDraft(opts.fact.draftText, { maxChars: budget + 200 });
    }
    const bullets = parsed?.bullets?.length
      ? parsed.bullets
      : (opts.fact.bullets ?? []);
    return finalize(speech, bullets);
  } catch {
    return finalize(
      humanizeAgentDraft(opts.fact.draftText, { maxChars: budget + 200 }),
      opts.fact.bullets ?? [],
    );
  }
}

function parseJson(raw: string): { speech?: string; bullets?: string[] } | null {
  const t = raw.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as {
      speech?: string;
      bullets?: string[];
    };
  } catch {
    return null;
  }
}
