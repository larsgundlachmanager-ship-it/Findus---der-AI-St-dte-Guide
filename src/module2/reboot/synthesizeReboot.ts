/**
 * Call-2 Synthese — schlank: Fakten + Persona + Reboot-Policy.
 * Kein 40-Block-Prompt-Ballast aus dem Alt-System.
 */

import {
  generateGeminiText,
  hasGeminiApiKey,
  resolveFindusSystemInstruction,
  resolveMasterPromptContext,
  streamGeminiSentences,
} from '../../services/geminiService';
import {
  FINDUS_ANSWER_FIRST_BLOCK,
  FINDUS_REBOOT_MANAGER_THINK_AHEAD_BLOCK,
  FINDUS_SYNTHESIS_RAIL_BLOCK,
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_BRIDGE_CONTINUITY_BLOCK,
  FINDUS_LIVE_CHAT_HUMAN_BLOCK,
  FINDUS_SPEECH_LENGTH_BLOCK,
  FINDUS_CORE_WOVEN_SPEECH_BLOCK,
  FINDUS_TYPICAL_SPEECH_MAX_CHARS,
  FINDUS_HELP_FIRST_MONETIZATION_BLOCK,
} from '../../services/concierge/findusResponsePolicy';
import type { HelpFirstMoment } from '../../services/affiliate/helpFirstMonetization';
import { chunkTextForTts } from '../speech/ttsChunker';
import { humanizeAgentDraft, humanizeBullets } from '../speech/draftToHumanSpeech';
import type { AgentResult, Module2ActionButton, SynthesisPayload } from '../types';
import { getLiveChatTurnContext } from '../../services/handsFree/liveChatTurnContext';
import {
  buildCall2TailPrompt,
  mergeCall2Bullets,
  parseCall2Tail,
} from './pipeline/call2Tail';
import { buildCall2HistoryBlock } from './pipeline/topicScopeHistory';
import type { TurnRucksackV1 } from './pipeline/turnRucksack';
import { upsertUserMemoryFacts } from '../../db/userMemoryFacts';
import { getCachedUserProfile } from '../../services/userProfileService';
import {
  buildPersonalityMatrixPromptBlock,
  resolveEffectivePersonalityMatrix,
} from '../../services/persona/personalityMatrixPrompt';

function resolveSynthesisPersonaBlock(rucksack?: TurnRucksackV1 | null): string {
  const profile = getCachedUserProfile();
  const matrixOverride = rucksack?.persona
    ? resolveEffectivePersonalityMatrix({
        coreRole: rucksack.persona.coreRole as never,
        vibeTone: rucksack.persona.vibeTone as never,
        knowledgeStyle: rucksack.persona.knowledgeStyle as never,
        spleens: rucksack.persona.spleens as never,
      } as import('../../types/userProfile').UserProfile)
    : undefined;
  return buildPersonalityMatrixPromptBlock(profile, {
    matrixOverride,
    activeSpleens: matrixOverride?.spleens,
  });
}

function buildSynthesisBlock(
  budget: number,
  opts?: { plainSpeech?: boolean; rucksack?: TurnRucksackV1 | null },
): string {
  const live = getLiveChatTurnContext();
  const liveBlock =
    live.active && live.humanTone ? `\n${FINDUS_LIVE_CHAT_HUMAN_BLOCK}\n` : '';
  const deepAsk =
    live.active && live.askBeforeDeepResearch
      ? '\n- Live-Chat: keine ungefragte Deep-Web-Recherche — erst kurze Antwort, bei Bedarf Rückfrage/Button „Tiefer recherchieren“.\n'
      : '';
  const bridgeBit = live.active
    ? '- LIVE-CHAT: kurze Bridge/Ack darf schon gesprochen sein — Haupt-Speech setzt nahtlos fort, wiederholt Bridge nicht. Erster Satz = Antwort.\n'
    : `${FINDUS_BRIDGE_CONTINUITY_BLOCK}\n`;
  const outFmt = opts?.plainSpeech
    ? 'Antworte NUR als Vorlese-Text (kein JSON, keine Meta-Labels).'
    : 'JSON only: {"speech":"...","bullets":[]}';
  return `=== REBOOT SYNTHESE (Call-2) ===
Du bekommst User-Frage + FAKTEN (stilfrei). Schreibe EINE natürliche Antwort zum Vorlesen.
Du darfst mitdenken: aus vorhandenen Fakten schließen, Lücken ehrlich benennen, Stichpunkte + Fließtext formen.
Backend-Fakten, die die Userfrage NICHT treffen (z. B. Restaurant statt Wetter) → NICHT vorlesen; sag knapp dass du neu suchst oder lass Tail Call-3 nachziehen.
${resolveSynthesisPersonaBlock(opts?.rucksack)}
${FINDUS_ANSWER_FIRST_BLOCK}
${FINDUS_SYNTHESIS_RAIL_BLOCK}
${FINDUS_CORE_WOVEN_SPEECH_BLOCK}
${bridgeBit}${FINDUS_REBOOT_MANAGER_THINK_AHEAD_BLOCK}
${liveBlock}${deepAsk}- Nur belegte Fakten — nichts erfinden.
- Buttons/Stichpunkte aus den mitgelieferten Actions/Bullets übernehmen oder knapp spiegeln.
- Kein Meta (API/Agent/Pack/FAKTEN/FLOW/PACK-DATENSATZ). Keine zweite Bridge.
- Keine Permission-Fragen („Soll ich suchen?“).
${FINDUS_SPEECH_LENGTH_BLOCK}
${FINDUS_HELP_FIRST_MONETIZATION_BLOCK}
- Partner-Hilfe: max 1–2 Hilfe-Buttons; Taxi/Uber nur wenn User Taxi/Uber will; Smalltalk/reine Fakten ohne Reise-Lücke → keine Partner. Code injiziert echte Links — keine erfundenen Partner-URLs in Speech.
${FINDUS_FEW_SHOT_DISCLAIMER}
${outFmt}`;
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
    .replace(/\bSICHTBARKEIT\b[^.!?]*/gi, '')
    .replace(
      /\bUser sieht den Ort\b[^.!?]*/gi,
      '',
    )
    .replace(
      /\b(Nutze diese Fakten als primäre Quelle|Erfinde nichts darüber hinaus|Allgemeine Beschreibung(?:\s*\/\s*Fakten)? ok)\b[^.!?]*/gi,
      '',
    )
    .replace(
      /\b(MEHR HISTORIE|LÜCKE|LIVE-HINTS|TOPIC-LOCK|FAKTEN-DRAFT|Beantworte die|Erkläre was das ist —|KEINE Formulierungen)\b[^.!?]*/gi,
      '',
    )
    .replace(/\bNichts erfinden\.?/gi, '')
    .replace(/\bMax\s*~\s*\d+\s*Zeichen[^.!?]*/gi, '')
    .replace(/\bOrt:\s*/gi, '')
    .replace(/\bFLOW:\s*[^.!?]*/gi, '')
    .replace(/\bLIVE-ANREICHERUNG:\s*/gi, '')
    .replace(/\bFAKTEN Knowledge\b[^.!?]*/gi, '')
    .replace(
      /\b(gute frage|interessante frage|ich schau(e)? (mal|kurz)|lass mich (kurz )?schauen|ich recherchier(e)?)\b[,!.\s]*/giu,
      '',
    )
    .replace(
      /\b(das\s+klingt\s+nach\s+(dem\s+)?(perfekten|guten|coolen)\s+plan|klingt\s+nach\s+einem?\s+perfekten\s+plan)\b[^.!?]*/giu,
      '',
    )
    .replace(/^(moin|hallo|hi|hey)\s+[A-ZÄÖÜ][\w\-äöüÄÖÜß]{1,20}[,!.\s]+/iu, '')
    .replace(/^(moin|hallo|hi|hey)[,!.\s]+/iu, '');

  if (opts.bridgeOneLiner) {
    // Typische Ack-Opener nicht nochmal
    s = s.replace(
      /^(klar|alles klar|moment|guck|schau|kurz|okay|ok)[,!.\s]+/iu,
      '',
    );
  }

  s = s.replace(/\s{2,}/g, ' ').trim();
  try {
    const { stripListLead } = require('../kernel/turnKernel') as {
      stripListLead: (s: string) => string;
    };
    s = stripListLead(s);
  } catch {
    /* soft */
  }
  return humanizeAgentDraft(s, { maxChars: opts.budget });
}

export async function synthesizeRebootTurn(opts: {
  userText: string;
  fact: AgentResult;
  bridgeOneLiner: string | null;
  jobId: string;
  speechBudgetChars?: number;
  signal?: AbortSignal;
  rucksack?: TurnRucksackV1 | null;
  topicScope?: {
    mode: 'new' | 'followup';
    turnsForCall2: number;
    inheritLiveInventory?: boolean;
  };
  cityKey?: string | null;
  turnId?: string;
  /**
   * Live-Chat: Sätze sofort melden (TTS starten), sobald vorhanden.
   * Bei SSE schon während der Generierung; sonst nach Volltext satzweise.
   */
  onSpeechSentence?: (sentence: string, index: number) => void;
  /** Call-1 / Code-Detect Partner-Momente (SSOT für Prompt + Inject). */
  partnerHints?: HelpFirstMoment[];
  /** Call-1 dateKey + clockHm — verbindlich für Call 2. */
  call1WhenBlock?: string | null;
  /** Call-1 criteria Gewichte — verbindlich für Call 2 (keine neuen Orte). */
  call1CriteriaBlock?: string | null;
  /** Call-1 Antwort-Struktur (kein Script). */
  call2Brief?: string | null;
  /** Von Call 1 gewählte Owner-Gold Constraints. */
  selectedGoldBlock?: string | null;
}): Promise<SynthesisPayload> {
  const buttons: Module2ActionButton[] = opts.fact.buttons ?? [];
  const budget = opts.speechBudgetChars ?? FINDUS_TYPICAL_SPEECH_MAX_CHARS;
  const streamLive = typeof opts.onSpeechSentence === 'function';

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
    const { fallbackSpeech } = await import('../../services/debug/fallbackLabel');
    const payload = finalize(
      fallbackSpeech(
        'Synthese-ohne-Key',
        humanizeAgentDraft(opts.fact.draftText, { maxChars: budget + 200 }),
      ),
      opts.fact.bullets ?? [],
    );
    if (streamLive) {
      payload.spokenChunks.forEach((c, i) => opts.onSpeechSentence?.(c, i));
    }
    return payload;
  }

  let skipStickyThread = opts.jobId === 'taxi_rideshare';
  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    if (wantsTaxiRide(opts.userText)) skipStickyThread = true;
  } catch {
    /* jobId flag bleibt */
  }
  let threadBlock = '';
  if (opts.topicScope) {
    threadBlock = buildCall2HistoryBlock({
      topicScope: opts.topicScope,
      cityKey: opts.cityKey ?? null,
    });
  } else if (!skipStickyThread) {
    // Kein topicScope ⇒ konservativ neu (kein Tennis→Wetter-Leak).
    threadBlock = buildCall2HistoryBlock({
      topicScope: { mode: 'new', turnsForCall2: 0, inheritLiveInventory: false },
      cityKey: opts.cityKey ?? null,
    });
  }

  const bulletMaxChars = opts.rucksack?.ui.bulletMaxChars ?? 72;

  const attachCall2Tail = async (
    speechText: string,
    agentBullets: string[],
  ): Promise<SynthesisPayload> => {
    let tail: ReturnType<typeof parseCall2Tail> = null;
    try {
      const tailRaw = await generateGeminiText(
        buildCall2TailPrompt({
          userText: opts.userText,
          speechText,
          bulletMaxChars,
          agentBullets,
        }),
        {
          responseJson: true,
          jsonMimeOnly: true,
          maxTokens: 420,
          temperature: 0.2,
          tier: 'lite',
          useFindusSystem: false,
          signal: opts.signal,
        },
      );
      tail = parseCall2Tail(tailRaw);
    } catch {
      tail = null;
    }
    const bullets = mergeCall2Bullets({
      tailBullets: tail?.bullets ?? [],
      agentBullets,
      speechText,
      bulletMaxChars,
    });
    if (tail?.memory_extract?.length) {
      void upsertUserMemoryFacts({
        subject: opts.cityKey || opts.userText.slice(0, 40) || 'general',
        facts: tail.memory_extract,
        sourceTurnId: opts.turnId ?? null,
      });
    }
    const base = finalize(speechText, bullets);
    return {
      ...base,
      shortAnswers: tail?.shortAnswers,
      call2Tail: tail ? (tail as unknown as Record<string, unknown>) : undefined,
    };
  };

  const deep = opts.fact.meta?.depth === 'deep';
  const userPrompt = [
    threadBlock ? `STADT-CHAT:\n${threadBlock}` : '',
    opts.rucksack
      ? `PERSONA_BRIDGE: ${opts.rucksack.persona.bridgeToneHint}`
      : '',
    opts.rucksack?.learnedRules?.length
      ? `LEARNED_RULES (Struktur, keine Scripts):\n${opts.rucksack.learnedRules
          .map((r) => `- ${r.intentFamily}: ${r.summary}`)
          .join('\n')}`
      : '',
    opts.selectedGoldBlock?.trim()
      ? opts.selectedGoldBlock.trim()
      : opts.rucksack?.ownerGoldHint
        ? `OWNER_GOLD_HINT: ${opts.rucksack.ownerGoldHint}`
        : '',
    opts.call2Brief?.trim()
      ? `CALL1_BRIEF (Struktur, Wortlaut frei): ${opts.call2Brief.trim()}`
      : '',
    opts.rucksack?.retrievedMemory?.length
      ? `USER-LTM:\n${opts.rucksack.retrievedMemory.map((l) => `- ${l}`).join('\n')}`
      : '',
    opts.rucksack
      ? `BULLET_BUDGET: 3 × max ${opts.rucksack.ui.bulletMaxChars} Zeichen`
      : '',
    `USER: ${opts.userText}`,
    opts.call1WhenBlock?.trim() || '',
    opts.call1CriteriaBlock?.trim() || '',
    (() => {
      try {
        const { formatSynthesisRailsForPrompt } = require('../speech/synthesisRails') as {
          formatSynthesisRailsForPrompt: (s: string) => string;
        };
        return formatSynthesisRailsForPrompt(opts.userText);
      } catch {
        return '';
      }
    })(),
    (() => {
      try {
        const {
          getCall1AnswerContract,
          formatCall1AnswerContractForPrompt,
        } = require('./pipeline/call1AnswerContract') as {
          getCall1AnswerContract: (t: string, o?: { correction?: boolean }) => unknown;
          formatCall1AnswerContractForPrompt: (c: unknown) => string;
        };
        const reject =
          /\b(mag\s+ich\s+nicht|gefällt\s+mir\s+nicht|gefaellt\s+mir\s+nicht|nee|nö|nein|was\s+noch|andere)\b/iu.test(
            opts.userText,
          );
        return formatCall1AnswerContractForPrompt(
          getCall1AnswerContract(opts.userText, { correction: reject }),
        );
      } catch {
        return '';
      }
    })(),
    opts.bridgeOneLiner
      ? `BRIDGE (schon gesprochen — Verstanden/Zusagen, nicht wiederholen): ${opts.bridgeOneLiner}\nBeat 2 = echte Antwort: Fakten/Optionen in die Sätze packen, umgangssprachlich, zackig. Kein zweites „tolle Idee“, kein Katalog.`
      : 'BRIDGE: keine',
    (() => {
      try {
        const { orchestrateUtterance } = require('./pipeline/orchestrateSlots') as {
          orchestrateUtterance: (s: string) => {
            jobs: string[];
            weaveDayPlan: boolean;
            thinkAhead: string[];
          };
        };
        const { formatCall2PacketForPrompt, buildCall2Packet } = require('./pipeline/call2Packet') as {
          buildCall2Packet: (o: unknown) => unknown;
          formatCall2PacketForPrompt: (p: unknown) => string;
        };
        const {
          detectHelpFirstMoments,
          formatAffiliateCatalogForCall2,
          helpFirstMonetizationPromptBlock,
        } = require('../../services/affiliate/helpFirstMonetization') as {
          detectHelpFirstMoments: (o: {
            userText?: string;
            jobHints?: string[];
          }) => HelpFirstMoment[];
          formatAffiliateCatalogForCall2: () => string;
          helpFirstMonetizationPromptBlock: (m: HelpFirstMoment[]) => string;
        };
        const orch = orchestrateUtterance(opts.userText);
        const moments =
          opts.partnerHints?.length
            ? opts.partnerHints.slice(0, 2)
            : detectHelpFirstMoments({
                userText: opts.userText,
                jobHints: orch.jobs,
              }).slice(0, 2);
        const facts = (orch.jobs.length ? orch.jobs : ['smalltalk_general']).map(
          (job, i) => ({
            job,
            why: i === 0 ? 'primary' : 'child',
            facts:
              i === 0
                ? {
                    draft: (opts.fact.draftText || '').slice(0, 600),
                    place:
                      typeof opts.fact.meta?.placeName === 'string'
                        ? opts.fact.meta.placeName
                        : null,
                  }
                : {},
          }),
        );
        const packetBlock = formatCall2PacketForPrompt(
          buildCall2Packet({
            userText: opts.userText,
            spokenBridge: opts.bridgeOneLiner,
            orch,
            facts,
            partnerHints: moments,
            partnerCatalogSnippet: formatAffiliateCatalogForCall2(),
          }),
        );
        const momentBlock = helpFirstMonetizationPromptBlock(moments);
        return [packetBlock, momentBlock].filter(Boolean).join('\n');
      } catch {
        return '';
      }
    })(),
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
    )}\n\n${buildSynthesisBlock(budget, { plainSpeech: streamLive, rucksack: opts.rucksack })}`;

    // Live: Plain-Text + Satz-Stream (SSE wenn möglich) → erster Satz früher hörbar
    if (streamLive) {
      const parts: string[] = [];
      let idx = 0;
      for await (const sentence of streamGeminiSentences(userPrompt, {
        systemInstruction: system,
        useFindusSystem: false,
        responseJson: false,
        maxTokens: deep ? 1200 : 900,
        temperature: 0.55,
        signal: opts.signal,
        allowProEscalate: false,
        tier: 'lite',
        chatHistory: opts.bridgeOneLiner
          ? [{ role: 'model', parts: [{ text: opts.bridgeOneLiner }] }]
          : undefined,
      })) {
        if (opts.signal?.aborted) break;
        const cleaned = scrubRebootSpeech(sentence, {
          bridgeOneLiner: opts.bridgeOneLiner,
          budget,
        });
        if (!cleaned) continue;
        parts.push(cleaned);
        opts.onSpeechSentence?.(cleaned, idx);
        idx += 1;
      }
      const joined = parts.join(' ').trim();
      if (!joined) {
        const { fallbackSpeech } = await import('../../services/debug/fallbackLabel');
        const payload = await attachCall2Tail(
          fallbackSpeech(
            'Synthese-leer',
            humanizeAgentDraft(opts.fact.draftText, { maxChars: budget + 200 }),
          ),
          opts.fact.bullets ?? [],
        );
        if (payload.spokenChunks.length && idx === 0) {
          payload.spokenChunks.forEach((c, i) => opts.onSpeechSentence?.(c, i));
        }
        return payload;
      }
      const tailed = await attachCall2Tail(joined, opts.fact.bullets ?? []);
      return { ...tailed, spokenChunks: parts };
    }

    const raw = await generateGeminiText(userPrompt, {
      systemInstruction: system,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
      maxTokens: deep ? 1200 : 900,
      temperature: 0.55,
      signal: opts.signal,
      allowProEscalate: false,
    });
    const parsed = parseJson(raw);
    let speech = (parsed?.speech || '').trim();
    if (!speech) {
      const { fallbackSpeech } = await import('../../services/debug/fallbackLabel');
      speech = fallbackSpeech(
        'Synthese-leer',
        humanizeAgentDraft(opts.fact.draftText, { maxChars: budget + 200 }),
      );
    }
    const bullets = parsed?.bullets?.length
      ? parsed.bullets
      : (opts.fact.bullets ?? []);
    return finalize(speech, bullets);
  } catch (err) {
    if (opts.signal?.aborted) {
      return finalize('', opts.fact.bullets ?? []);
    }
    const { fallbackSpeech } = await import('../../services/debug/fallbackLabel');
    return finalize(
      fallbackSpeech(
        'Synthese-Fehler',
        humanizeAgentDraft(opts.fact.draftText, { maxChars: budget + 200 }),
      ),
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
