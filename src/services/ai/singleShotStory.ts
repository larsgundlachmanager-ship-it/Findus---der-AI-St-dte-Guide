/**
 * Single-Shot Findus Story Engine.
 * Ein Gemini-Call + Master-Prompt → Sätze für TTS.
 * Offline: nur vorgefertigte [Erzählung]/general_info — kein Template-Stitching.
 */

import type { PoiWithFacts } from '../../db/types';
import type { MasterPromptContext, UserProfile } from '../../types/userProfile';
import { createDefaultProfile } from '../../types/userProfile';
import { GEMINI_STORY_MAX_OUTPUT_TOKENS, GEMINI_TEMPERATURE } from '../../constants/gemini';
import {
  generateGeminiText,
  hasGeminiApiKey,
} from '../geminiService';
import {
  buildMasterSystemInstruction,
  resolveMasterPromptContext,
  resolvePersonaEngine,
} from '../personaEngine';
import { getCachedUserProfile } from '../userProfileService';
import { sentencesFromFullText } from './sentenceStream';
import type { SessionMemory } from './sessionMemory';
import {
  loadFeatureTipState,
  type FeatureTipPlan,
} from './featureTips';
import {
  prepareNarrationFeatureTips,
  formatNarrationFeatureTipsBlock,
  commitNarrationFeatureTips,
  getLastNarrationFeatureTipPlan,
} from '../../runtime/featureTipsModule';
import {
  findRelatedPlaceBridge,
  formatRelatedBridgeForPrompt,
} from './relatedPlaceBridge';
import { resolvePoiImportance } from '../personaEngine';
import { useFinnusStore } from '../../store/useFinnusStore';

export type FindusStoryMode = 'arrival' | 'approach';

export type StreamFindusStoryInput = {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
  mode?: FindusStoryMode;
  /** Approach wurde schon gehört → keine zweite Intro-Floskel. */
  approachAlreadyHeard?: boolean;
  /** Harte Obergrenze für den Gemini-Call (ms). */
  timeoutMs?: number;
  /** Sub/Punkt liegt in größerem Kontext (für Nav-Reminder). */
  parentIsMajor?: boolean;
  /**
   * Beat-Brief aus findusTourDirector (Historie/Heute/Fun).
   * Bei arrival: Pflicht-Dramaturgie erzwingen.
   */
  storyBriefBlock?: string | null;
};

/** Nur vorgefertigte Erzählung / general_info — kein Satz-Basteln. */
export function extractOfflineGeneralInfo(poi: PoiWithFacts): string {
  for (const f of poi.facts) {
    const raw = (f.fact_text ?? '').trim();
    if (!raw) continue;
    if (/^\[Erzählung\]/i.test(raw) || /^\[Narration\]/i.test(raw)) {
      const text = raw.replace(/^\[(Erzählung|Narration)\]\s*/i, '').trim();
      if (text.length >= 20) return text;
    }
  }
  return '';
}

function buildPoiPayload(poi: PoiWithFacts): Record<string, unknown> {
  const facts = poi.facts
    .map((f) => (f.fact_text ?? '').trim())
    .filter(Boolean)
    .slice(0, 40);

  return {
    id: poi.id,
    name: poi.name,
    category: poi.category ?? null,
    kind: poi.kind ?? null,
    tags: poi.tags_json ?? null,
    teaser_text: poi.teaser_text ?? null,
    facts,
  };
}

function buildUserPrompt(input: {
  poi: PoiWithFacts;
  mode: FindusStoryMode;
  approachAlreadyHeard: boolean;
  profile: UserProfile;
  storyBriefBlock?: string | null;
}): string {
  const payload = buildPoiPayload(input.poi);
  const engine = resolvePersonaEngine(input.profile);
  const modeLine =
    input.mode === 'approach'
      ? 'MODUS: Approach / Soft-Pitch (Annäherung). Kurz anteasern (1–3 Sätze), Interesse wecken, einladen näherzukommen. Noch nicht die volle Story.'
      : input.approachAlreadyHeard
        ? 'MODUS: Ankunft am Ort. Approach wurde schon gehört — KEINE zweite Begrüßungs-Intro. Direkt in die 3-Phasen-Dramaturgie.'
        : 'MODUS: Ankunft am Ort. Live-Story mit HARTER 3-Phasen-Dramaturgie.';

  const dramaturgyBlock =
    input.mode === 'arrival'
      ? `
=== PFLICHT-DRAMATURGIE (STRENG — Modul 1 Ortstrigger) ===
Schreibe GENAU in dieser Reihenfolge als fließendes Audio (OHNE die Wörter „Historie“, „Heute“, „Fun Fact“ als Labels auszusprechen):

1) HISTORIE — Wer/was war hier früher? Herkunft, Bau, Geschichte (nur belegte Fakten).
2) HEUTE — Was ist der Ort JETZT? Nutzen, Alltag, was der User sieht.
3) FUN FACT — Ein neugieriger, witziger oder überraschender Moment (kein Quiz-Label).

Weiche Übergänge zwischen den Phasen („Und heute?“, „Das Lustige daran:“).
Kein Single-Shot-Mischmasch ohne diese drei Bögen.
Keine Markdown-Überschriften, keine Aufzählungszeichen.
`
      : '';

  const brief =
    input.storyBriefBlock?.trim()
      ? `\nBeat-Fakten (Pflicht nutzen, nichts erfinden):\n${input.storyBriefBlock.trim()}\n`
      : '';

  return `${modeLine}
${dramaturgyBlock}${brief}
Erstelle das gesprochene Live-Audio-Skript für Findus aus diesen Ort-Daten.
LÄNGE: proportional zu den Fakten — kleine Orte (wenige Fakten): 3–5 Sätze. Highlights: bis ca. 8 Sätze. NIEMALS künstlich aufblasen.
Schluss: variieren oder weglassen — kein Standard-„ganz entspannt / weiterrollen“. Wenn ein verwandter Ort passt: Wahl anbieten (mehr Geschichte vs. hin).
Nur Fließtext zum Vorlesen. Kein Markdown, keine Labels, keine Aufzählungen, keine leeren Klammern.
Kein „Wenn du keine Fragen mehr hast…“. Keine Adressen/PLZ/Telefon.
HOOK-REGEL: Der erste Satz MUSS zum Ort passen (Funktion/Thema aus den Daten). Kein Essens-Humor (Franzbrötchen, Bäcker, Kaffee) an Geldautomaten, Apotheken, Behörden o.ä. Jeder Opener frisch aus den Ort-Daten — keine vorgefertigten Floskeln von anderen Städten.
Namen vollständig aussprechen (nie mitten im Wort abbrechen).

Nutzer-Kurzprofil (zusätzlich zur System-Instruction):
- Persona: ${engine.persona}, Ton: ${engine.toneStyle}
- Alter: ${engine.age ?? 'unbekannt'}
- Gelernt: ${engine.learnedFacts.slice(0, 8).join('; ') || '—'}

Ort-Daten:
${JSON.stringify(payload, null, 0)}`;
}

/** Tip-Plan der letzten Story — zum Abhaken nach dem Sprechen. */
let lastFeatureTipPlan: FeatureTipPlan | null = null;

/** Ob der letzte Single-Shot-Lauf von Gemini kam (sonst Offline-general_info). */
let lastStreamFromLlm = false;

export function lastSingleShotUsedLlm(): boolean {
  return lastStreamFromLlm;
}

export function getLastFeatureTipPlan(): FeatureTipPlan | null {
  return getLastNarrationFeatureTipPlan();
}

export async function commitFeatureTipsAfterStory(
  spokenText: string,
): Promise<void> {
  return commitNarrationFeatureTips(spokenText);
}

/**
 * Single-Shot: Master-Prompt + POI → Satz-Stream für TTS.
 *
 * Hinweis Hermes/RN: echtes Token-SSE braucht ReadableStream (fehlt).
 * Deshalb: ein generateContent-Call, danach Satz-für-Satz yielden —
 * TTS startet am ersten Satz, ohne 3-Step-Chain.
 */
export async function* streamFindusStorySentences(
  input: StreamFindusStoryInput,
): AsyncGenerator<string, void, unknown> {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const mode = input.mode ?? 'arrival';
  const approachAlreadyHeard = Boolean(input.approachAlreadyHeard);
  const sessionVisitedCount = input.sessionMemory?.entries?.length ?? 0;
  const isFirstPoi = sessionVisitedCount === 0;
  const importance = resolvePoiImportance(input.poi);

  await loadFeatureTipState();
  const planned = await prepareNarrationFeatureTips({
    poi: input.poi,
    importance,
    isFirstPoi,
    kind: input.poi.kind,
    parentIsMajor: Boolean(input.parentIsMajor),
  });
  const tipPlan: FeatureTipPlan = planned;
  lastFeatureTipPlan = tipPlan;

  const allPois = useFinnusStore.getState().pois ?? [];
  const relatedBridge = findRelatedPlaceBridge(input.poi, allPois);
  // Verwandter Ort → Wahl-Outro ersetzt separaten Surplus-CTA (sonst doppelt)
  const tipPlanForPrompt: FeatureTipPlan = relatedBridge
    ? { ...tipPlan, surplusExampleQuestion: null }
    : tipPlan;
  const relatedBridgeBlock = formatRelatedBridgeForPrompt(relatedBridge);

  const masterContext = resolveMasterPromptContext({
    sessionVisitedCount,
    poi: input.poi,
    featureTipId: tipPlanForPrompt.tip,
    surplusExampleQuestion: tipPlanForPrompt.surplusExampleQuestion,
    allowNavReminder: tipPlanForPrompt.allowNavReminder,
    featureTipsBlock: formatNarrationFeatureTipsBlock(tipPlanForPrompt),
    relatedBridgeBlock,
  });

  lastStreamFromLlm = false;

  if (!hasGeminiApiKey()) {
    const offline = extractOfflineGeneralInfo(input.poi);
    if (offline) {
      yield* sentencesFromFullText(offline);
    } else {
      yield 'Hier hab ich offline gerade keine fertige Story parat. Sobald du wieder Netz hast, erzähl ich dir richtig was.';
    }
    return;
  }

  const systemInstruction = buildMasterSystemInstruction(
    profile,
    masterContext,
  );
  const prompt = buildUserPrompt({
    poi: input.poi,
    mode,
    approachAlreadyHeard,
    profile,
    storyBriefBlock: input.storyBriefBlock,
  });

  if (__DEV__) {
    console.log(
      `[featureTips] tip=${tipPlan.tip ?? '—'} surplus=${tipPlan.surplusExampleQuestion ? 'yes' : 'no'} navReminder=${tipPlan.allowNavReminder} related=${relatedBridge?.relatedName ?? '—'}`,
    );
  }

  const timeoutMs = input.timeoutMs ?? 22000;
  let text = '';
  try {
    text = await Promise.race([
      generateGeminiText(prompt, {
        maxTokens: mode === 'approach' ? 1024 : GEMINI_STORY_MAX_OUTPUT_TOKENS,
        temperature: GEMINI_TEMPERATURE,
        useFindusSystem: false,
        systemInstruction,
        masterContext,
        task: mode === 'approach' ? 'teaser' : 'history_deep',
      }),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve(''), timeoutMs),
      ),
    ]);
  } catch (err) {
    console.warn('[singleShot] Gemini fehlgeschlagen:', err);
    text = '';
  }

  let clean = (text ?? '').replace(/\s+/g, ' ').trim();
  // Abgeschnittene Mid-Word-Enden verwerfen → Offline statt Stummbruch
  if (clean && /[a-zäöüß]$/i.test(clean) && !/[.!?…)]$/.test(clean)) {
    console.warn(
      `[singleShot] Text wirkt abgeschnitten (${clean.length}c): "${clean.slice(-40)}"`,
    );
  }
  if (clean) {
    lastStreamFromLlm = true;
    if (__DEV__) {
      console.log(
        `[singleShot] ok mode=${mode} chars=${clean.length} importance=${masterContext.poiImportance} first=${masterContext.isFirstPoi}`,
      );
    }
    // Kurze valide Stories (3–5 Sätze) sind ok — nur bei Extremkurz + Offline länger ersetzen
    if (mode === 'arrival' && clean.length < 80) {
      const offline = extractOfflineGeneralInfo(input.poi);
      if (offline.length > clean.length) {
        console.warn(
          `[singleShot] Gemini zu kurz (${clean.length}c) — nutze general_info (${offline.length}c)`,
        );
        lastStreamFromLlm = false;
        yield* sentencesFromFullText(offline);
        return;
      }
    }
    yield* sentencesFromFullText(clean);
    return;
  }

  const offline = extractOfflineGeneralInfo(input.poi);
  if (__DEV__) {
    console.warn(
      `[singleShot] offline-fallback general_info=${offline ? offline.length : 0} chars`,
    );
  }
  if (offline) {
    yield* sentencesFromFullText(offline);
  } else {
    yield 'Netz war gerade zu langsam — und offline liegt hier keine fertige Erzählung. Versuch’s gleich nochmal.';
  }
}

/**
 * Hook/Body-Split für speakTwoPhase.
 * Wartet auf den Gemini-Volltext (RN), yieldet dann Satz 1 sofort als Hook.
 */
export async function beginSingleShotStoryStream(
  input: StreamFindusStoryInput,
): Promise<{
  hook: string;
  bodySentenceStream: AsyncIterable<string>;
  usedLlm: boolean;
  pipeline: 'single-shot-v1';
  masterContext: MasterPromptContext;
}> {
  const masterContext = resolveMasterPromptContext({
    sessionVisitedCount: input.sessionMemory?.entries?.length ?? 1,
    poi: input.poi,
  });

  const iter = streamFindusStorySentences(input)[Symbol.asyncIterator]();
  const first = await iter.next();
  const hook = first.done ? '' : String(first.value ?? '').trim();
  const usedLlm = lastStreamFromLlm;

  async function* rest(): AsyncGenerator<string, void, unknown> {
    if (first.done) return;
    while (true) {
      const next = await iter.next();
      if (next.done) break;
      const t = String(next.value ?? '').trim();
      if (t) yield t;
    }
  }

  return {
    hook,
    bodySentenceStream: rest(),
    usedLlm,
    pipeline: 'single-shot-v1',
    masterContext,
  };
}
