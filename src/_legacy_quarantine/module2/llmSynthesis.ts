/**
 * LLM-Synthese — Agent-Fakten + User-Frage → eine menschliche Findus-Antwort.
 * Wortlaut frei; nur strukturelle Blaupausen (keine Scripts).
 */

import {
  generateGeminiText,
  hasGeminiApiKey,
} from '../../services/geminiService';
import type { LogicNodeOutput, Module2ActionButton } from '../types';
import { chunkTextForTts } from '../speech/ttsChunker';
import { clampButtonLabel } from './logicNode';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import { expandGermanAbbreviationsForSpeech } from '../../services/agi/speechGuardrails';
import type { SynthesisPayload } from '../types';
import {
  FINDUS_DYNAMIC_STRUCTURE_DOCTRINE,
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_ANSWER_FIRST_BLOCK,
  FINDUS_BRIDGE_CONTINUITY_BLOCK,
  FINDUS_THREAD_CONTINUITY_BLOCK,
  FINDUS_FACTUAL_ANSWER_BLOCK,
  FINDUS_MEAL_AWARE_DINING_BLOCK,
  FINDUS_REBOOT_MANAGER_THINK_AHEAD_BLOCK,
} from '../../services/concierge/findusResponsePolicy';
import {
  resolveFindusSystemInstruction,
  resolveMasterPromptContext,
} from '../../services/geminiService';
import { formatThreadContextForPrompt } from '../../services/memory/conversationThreads';
import {
  humanizeAgentDraft,
  humanizeBullets,
} from '../speech/draftToHumanSpeech';
import {
  formatLearnedRulesPromptBlock,
  matchLearnedRules,
  noteLearnedRulesMatched,
} from '../../services/memory/correctionLearning';

const SYNTHESIS_TASK_APPENDIX = `=== MODUL-2 SYNTHESE (Zusatz — gesprochene Antwort) ===
Dir werden User-Frage, optional Bridge-Ack und FAKTEN/Struktur-Hints eines Agenten gegeben.
Schreibe EINE natürliche Antwort zum Vorlesen — Wortlaut frei.

${FINDUS_DYNAMIC_STRUCTURE_DOCTRINE}
${FINDUS_BRIDGE_CONTINUITY_BLOCK}
${FINDUS_THREAD_CONTINUITY_BLOCK}
${FINDUS_ANSWER_FIRST_BLOCK}
${FINDUS_MEAL_AWARE_DINING_BLOCK}
${FINDUS_FACTUAL_ANSWER_BLOCK}
${FINDUS_REBOOT_MANAGER_THINK_AHEAD_BLOCK}

ABSTRAKTE FLOW-BLAUPAUSEN (nur Logik, nie Wortlaut):
- Empfehlung: klare 1.–Empfehlung vorne → Begründung → Alternative/Tipps hinten → Buttons.
- Gastro: 2 Optionen positiv, stärkste zuerst; Named-Venue → Einschätzung zuerst + Alternativen hinten. Speisekarte-Buttons wenn URL in Fakten.
- Wissen: Antwort-Lead (was/wofür der Ort) → visuell nur wenn SICHTBARKEIT=ja → Historie/heute → Highlight hinten.
- Fakten/Zahlen: direkte Lösung zuerst → kurze Einordnung → Bullets mit Lösung + Vorausdenken (nächste belegte Stufen).
- Outfit/Wetter: konkrete Kleidung zuerst → Abendwetter + Dresscode aus Plan (5★/Rooftop/Strand) wenn im Kontext — kein Plan-Essay.
- Hotel: gefilterte Optionen → User-Pick → Stay22 schon vorausgefüllt (Daten/Zimmer) wenn Meta da.
- Planung AUSWAHL: max 5 Sätze; BESTÄTIGUNG: max 3 Sätze.

${FINDUS_FEW_SHOT_DISCLAIMER}

HARTE GUARDRAILS:
- Kein Meta (Agent/API/Cache), keine URLs/PLZ vorlesen
- Max ca. 700 Zeichen (Geschichte etwas mehr) — Job-Budget im FAKTEN-JSON überschreibt wenn kleiner
- PLANUNG: max 5 Sätze / ~380 Zeichen
- bullets: bei Fakten-/Zahlenfragen 1–3 PFLICHT (Lösung + Vorausdenken); bei Hotel/Gastro mit genannten Optionen 1–3 PFLICHT (Name + Preis oder Must-Have) — nie leeres Array wenn bulletsIn gesetzt; sonst 0–3 Hard-Facts MIT Ziffern — nie „ausgeschrieben“, nie leere Labels („Höhe:“)
- Hotel/Gastro: nie „klick dich selbst durch“ — Ergebnis ist fertig, Buttons buchen
- commitment=committed → wenig Pitch, viel Logistik (Preis/Slot/Weg/Ticket)
- mustHaves → nur Optionen mit Beleg; fehlender Match ehrlich
- JSON only: {"speech":"...","bullets":[]}`;

function buildSynthesisSystemInstruction(
  learnedBlock: string,
): string {
  return `${resolveFindusSystemInstruction(undefined, resolveMasterPromptContext())}\n\n${SYNTHESIS_TASK_APPENDIX}${
    learnedBlock ? `\n\n${learnedBlock}` : ''
  }`;
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

function scrubMetaLight(s: string): string {
  return s
    .replace(/\b(Filter|open_now|min_rating|API|Cache|Pack-Stadt|Agent)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Fallback wenn LLM fehlt — interne Labels raus. */
function scrubMeta(s: string): string {
  return humanizeAgentDraft(s, { maxChars: 1400 });
}

function ensureEmoji(label: string): string {
  if (/[\u{1F300}-\u{1FAFF}]/u.test(label)) return label;
  return shortenActionLabel(`✨ ${label}`);
}

export async function synthesizeWithLlm(opts: {
  userText: string;
  logic: LogicNodeOutput;
  intent: string;
  subject?: string | null;
  city?: string | null;
  bridgingText?: string | null;
  signal?: AbortSignal;
  /** continue | new | resume | parallel — für Resume-Hinweis */
  topicMode?: string | null;
  /** Job-Contract Speech-Budget */
  speechBudgetChars?: number;
  jobId?: string | null;
  mustHaves?: string[];
  commitment?: 'exploring' | 'committed' | 'urgent' | null;
}): Promise<SynthesisPayload> {
  const buttons: Module2ActionButton[] = opts.logic.buttons
    .filter((b) => b.payload != null)
    .map((b) => ({
      ...b,
      label: ensureEmoji(clampButtonLabel(b.label)),
    }));

  let paceBlock: string | null = null;
  try {
    const { formatPaceForPrompt } = require('../../services/mobility/paceProfile') as {
      formatPaceForPrompt: () => string;
    };
    if (
      /mobility|knowledge|planning|gastro|booking/i.test(opts.intent) ||
      /\b(km|minut|stunde|unterwegs|route|gehzeit|radeln|wander|spazier)\b/i.test(
        opts.userText,
      )
    ) {
      paceBlock = formatPaceForPrompt();
    }
  } catch {
    /* soft */
  }

  let threadBlock = '';
  try {
    threadBlock = formatThreadContextForPrompt({ includeParkedIndex: true });
  } catch {
    threadBlock = '';
  }

  const matchedRules = matchLearnedRules({
    intent: opts.intent,
    jobId: opts.jobId,
    userText: opts.userText,
    limit: 4,
  });
  let productBlock = '';
  try {
    const {
      matchProductSituationBlueprints,
      formatProductBlueprintsPromptBlock,
    } = await import('../../services/memory/betaSituationSync');
    const productRules = await matchProductSituationBlueprints({
      intent: opts.intent,
      userText: opts.userText,
      limit: 3,
    });
    productBlock = formatProductBlueprintsPromptBlock(productRules);
  } catch {
    productBlock = '';
  }
  const learnedBlock = [
    formatLearnedRulesPromptBlock(matchedRules, {
      heading:
        '=== GELERNTE REGELN FÜR DIESE SITUATION (PFLICHT priorisieren) ===',
    }),
    productBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
  if (matchedRules.length) {
    void noteLearnedRulesMatched(matchedRules).catch(() => {});
  }

  const budget = Math.max(
    220,
    Math.min(900, opts.speechBudgetChars ?? 700),
  );

  const facts = {
    intent: opts.intent,
    jobId: opts.jobId ?? null,
    commitment: opts.commitment ?? null,
    mustHaves: opts.mustHaves ?? [],
    speechBudgetChars: budget,
    city: opts.city,
    subject: opts.subject,
    topicMode: opts.topicMode ?? null,
    bridgingAlreadySpoken: opts.bridgingText?.trim() || null,
    agentDraft: scrubMetaLight(opts.logic.spokenDraft).slice(0, 2200),
    bulletsIn: humanizeBullets(opts.logic.bullets, 3),
    moneyEur: opts.logic.moneyEur,
    warnings: opts.logic.warnings.filter((w) => w !== 'empty_merge'),
    personalPace: paceBlock,
    structureNote:
      'agentDraft = Fakten/Hints. Formuliere Speech neu — nie FAKTEN/FLOW/User-Kontext/Prio-Labels vorlesen. Bridge wurde schon gesprochen — nicht wiederholen, darauf aufbauen. personalPace = gelerntes User-Tempo für Zeitangaben nutzen. topicMode=resume → nahtlos im Thread; topicMode=new → kein Bezug auf geparkte Themen. speechBudgetChars = hartes Max für speech. mustHaves = harte Filter.',
  };

  let speech = scrubMeta(opts.logic.spokenDraft);
  let bullets = humanizeBullets(opts.logic.bullets, 3);

  if (hasGeminiApiKey() && facts.agentDraft) {
    try {
      const raw = await generateGeminiText(
        (threadBlock ? `${threadBlock}\n\n` : '') +
          `User-Frage: """${opts.userText.replace(/"""/g, '')}"""\n` +
          (facts.bridgingAlreadySpoken
            ? `Bridge (bereits gesprochen, NICHT wiederholen): """${facts.bridgingAlreadySpoken.replace(/"""/g, '')}"""\n`
            : '') +
          `FAKTEN:\n${JSON.stringify(facts)}`,
        {
          systemInstruction: buildSynthesisSystemInstruction(learnedBlock),
          useFindusSystem: false,
          responseJson: true,
          jsonMimeOnly: true,
          maxTokens: 500,
          temperature: 0.55,
          signal: opts.signal,
          allowProEscalate: false,
        },
      );
      const j = parseJson(raw);
      if (j?.speech?.trim()) {
        speech = scrubMetaLight(j.speech.trim());
      }
      if (Array.isArray(j?.bullets)) {
        const fromLlm = humanizeBullets(
          j.bullets.map((b) => String(b).trim()),
          3,
        );
        // Leeres LLM-Array darf Agent-Stichpunkte (Hotel/Gastro) nicht löschen
        if (fromLlm.length > 0) {
          bullets = fromLlm;
        }
      }
    } catch {
      /* Roh-Draft bereinigt behalten */
    }
  }

  speech = expandGermanAbbreviationsForSpeech(speech);
  speech = speech
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b\d{5}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Job-Speech-Budget hart kappen (echte Satzgrenze — nie an ca./Dr.)
  if (speech.length > budget) {
    const { isProtectedDot } = await import(
      '../../services/audio/punctuationChunker'
    );
    const cut = speech.slice(0, budget);
    let lastStop = -1;
    for (let i = cut.length - 1; i >= Math.floor(budget * 0.45); i--) {
      const ch = cut[i]!;
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;
      if (ch === '.' && isProtectedDot(cut, i)) continue;
      const next = cut[i + 1] ?? '';
      if (next && next !== ' ' && next !== '') continue;
      lastStop = i;
      break;
    }
    speech =
      lastStop >= 0
        ? cut.slice(0, lastStop + 1).trim()
        : `${cut.trim()}…`;
  }

  // Stichpunkte aus Speech nachziehen (Ziffern-Fakten) — LLM-Meta raus
  try {
    const { deriveMemoryBullets } = await import(
      '../../services/concierge/speechMemoryBullets'
    );
    const { clampVisualBullets } = await import(
      '../../services/concierge/parseConciergeResponse'
    );
    bullets = clampVisualBullets(
      deriveMemoryBullets(speech, bullets, { userText: opts.userText }),
      { userText: opts.userText },
    );
  } catch {
    /* soft */
  }

  // Letzter Notfall — kein Lehr-Script, nur knapper Status
  if (!speech) {
    speech =
      'Dazu fehlt mir gerade genug Greifbares — ich hole dir gleich eine konkrete Alternative.';
  }

  return {
    spokenChunks: chunkTextForTts(speech),
    bullets,
    buttons,
    fullDraftForUi: speech,
  };
}
