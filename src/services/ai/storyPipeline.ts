/**
 * 3-Stufen Prompt-Chaining für Story-Generierung.
 *
 * STEP 1 Fact-Extractor  → INTRO / ORIGIN / NOW / HIGHLIGHT / EXPLORE
 * STEP 2 Hook-Garant     → hook + Einführung (Was ist das?)
 * STEP 3 Story-Writer    → Historie → Heute → Fun/Quiz → konkreter Abschluss
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { createDefaultProfile } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import { generatePromptText, streamPromptSentences, hasTextEngine } from '../localAiService';
import { resolveMasterPromptContext } from '../personaEngine';
import { GEMINI_TEMPERATURE } from '../../constants/gemini';
import {
  filterDeepStoryFacts,
  isTransitTrashFact,
  isFabricatedSuperlativeFact,
  hasUngroundedHeightClaim,
  isAddressDumpFact,
} from './deepStoryFilter';
import { buildFastHook, classifyPoiHookKind } from './fastHook';
import {
  buildFactExtractionPrompt,
  buildHookResolutionPrompt,
  buildNarrativeAssemblyPrompt,
  humanizePoiTitleForSpeech,
  resolvePromptStyleSettings,
  resolvePoiUserContext,
  resolveStorytellingControls,
  resolveTransportMode,
  resolveYearsPreference,
  yearToHumanEra,
} from './promptBuilder';
import { sentencesFromFullText } from './sentenceStream';
import type { SessionMemory } from './sessionMemory';
import { scrubInventedVoiceNames } from './spokenNameGuard';
import {
  applyBriefToCoreFacts,
  type FindusStoryBrief,
} from './findusTourDirector';
import {
  composeColloquialStory,
  buildColloquialSingleShotPrompt,
} from './colloquialStoryComposer';

/** Längere Timeouts wenn Gemini oder lokales Modell verfügbar. */
function textEngineTimeoutMs(fallbackMs: number): number {
  return hasTextEngine() ? fallbackMs : Math.min(fallbackMs, 400);
}

export type CoreFacts = {
  intro: string;
  origin: string;
  now: string;
  highlight: string;
  explore: string;
  poiName: string;
  fromLlm: boolean;
};

export type HookBundle = {
  hookSentence: string;
  firstBodySentence: string;
  fromLlm: boolean;
};

export type ChainedStoryStart = {
  hook: string;
  firstBodySentence: string;
  coreFacts: CoreFacts;
  bodySentenceStream: AsyncIterable<string>;
  usedLlmHook: boolean;
  pipeline: 'chain-v1';
};

const YEAR_RE = /\b(1[0-9]{3}|20[0-9]{2})\b/g;
const LABEL_PREFIX_RE =
  /^(highlight|fun\s*facts?|funfakt|historie|heute|abschluss|quiz|intro|origin|now|explore|einführung)\s*:\s*/i;
const GENERIC_OVERLOOK_RE =
  /voller details[^.!?]*übersieht|im vorbeigehen übersieht|viel zu entdecken|schau dich (ruhig )?um|steckt voller details/i;
const FAKE_NAME_RE =
  /\b(thorsten|martin|eva|karl|thorsten_emotional|kerstin|ramona|aishel)\b/gi;

function scrubYears(text: string, preferRelative: boolean): string {
  if (!preferRelative) return text;
  return text
    .replace(YEAR_RE, (raw) => {
      const y = Number(raw);
      return Number.isFinite(y) ? yearToHumanEra(y) : '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanBullet(text: string): string {
  return text
    .replace(/^[-*•\d.)\]]+\s*/u, '')
    .replace(LABEL_PREFIX_RE, '')
    .replace(/^["„“]|["„“]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFakeNames(text: string): string {
  return scrubInventedVoiceNames(
    text.replace(FAKE_NAME_RE, '').replace(/\s{2,}/g, ' ').trim(),
  );
}

function isJunkFact(text: string): boolean {
  return (
    !text ||
    text.length < 12 ||
    isTransitTrashFact(text) ||
    isFabricatedSuperlativeFact(text) ||
    isAddressDumpFact(text) ||
    /(gehört zum alltag|zum dorfleben|teil des alltags)/i.test(text) ||
    GENERIC_OVERLOOK_RE.test(text)
  );
}

function sourceBlobFromFacts(facts: CoreFacts): string[] {
  return [
    facts.intro,
    facts.origin,
    facts.now,
    facts.highlight,
    facts.explore,
    facts.poiName,
  ];
}

function rejectUngroundedClaims(
  text: string,
  facts: CoreFacts,
): string | null {
  let clean = stripFakeNames(cleanBullet(text.replace(/\s+/g, ' ').trim()));
  if (!clean) return null;
  if (isTransitTrashFact(clean) || isFabricatedSuperlativeFact(clean)) {
    return null;
  }
  if (GENERIC_OVERLOOK_RE.test(clean)) return null;
  if (hasUngroundedHeightClaim(clean, sourceBlobFromFacts(facts))) {
    if (__DEV__) {
      console.warn(
        `[storyPipeline] Dropped ungrounded height/spire: "${clean.slice(0, 60)}…"`,
      );
    }
    return null;
  }
  return clean;
}

export async function extractRelevantFacts(input: {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
  llmTimeoutMs?: number;
  tourBrief?: FindusStoryBrief | null;
}): Promise<CoreFacts> {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const offline = extractRelevantFactsOffline({
    poi: input.poi,
    profile,
    sessionMemory: input.sessionMemory,
  });
  const seeded = input.tourBrief
    ? applyBriefToCoreFacts(input.tourBrief, offline)
    : offline;

  const timeoutMs = textEngineTimeoutMs(input.llmTimeoutMs ?? 5000);
  const prompt = buildFactExtractionPrompt({
    poi: input.poi,
    profile,
    seedFacts: seeded,
  });

  try {
    const raw = await Promise.race([
      generatePromptText(prompt, {
        maxTokens: 200,
        temperature: 0.2,
        useFindusSystem: false,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
    if (!raw?.trim()) return seeded;
    const parsed = parseCoreFactsJson(raw, seeded);
    if (!parsed) return seeded;
    const sources = input.poi.facts.map((f) => f.fact_text);
    const fields = [
      parsed.intro,
      parsed.origin,
      parsed.now,
      parsed.highlight,
      parsed.explore,
    ];
    if (fields.some((f) => hasUngroundedHeightClaim(f, sources))) {
      return seeded;
    }
    if (fields.some((f) => GENERIC_OVERLOOK_RE.test(f))) {
      return seeded;
    }
    const withLlm = { ...parsed, fromLlm: true };
    return input.tourBrief
      ? applyBriefToCoreFacts(input.tourBrief, withLlm)
      : withLlm;
  } catch (err) {
    console.warn('[storyPipeline] Step1 LLM failed, offline:', err);
    return seeded;
  }
}

export function extractRelevantFactsOffline(input: {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
}): CoreFacts {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const yearsPref = resolveYearsPreference(profile);
  const deep = filterDeepStoryFacts(input.poi, {
    profile,
    sessionMemory: input.sessionMemory,
  });
  const spokenTitle = humanizePoiTitleForSpeech(input.poi.name);
  const texts = deep.facts
    .map((f) => scrubYears(f.text, yearsPref === 'wenig'))
    .map(cleanBullet)
    .filter((t) => !isJunkFact(t));

  const used = new Set<string>();
  const takeUnique = (
    pred: (t: string) => boolean,
    fallback?: string,
  ): string => {
    const hit = texts.find((t) => !used.has(t) && pred(t));
    if (hit) {
      used.add(hit);
      return hit;
    }
    if (fallback && !used.has(fallback)) {
      used.add(fallback);
      return fallback;
    }
    return '';
  };

  const intro =
    takeUnique((t) =>
      /(liegt|ist|bekannt als|haltepunkt|bahnhof|platz|anlage|gebäude|haus|museum|park|schule|ehrenmal|denkmal|jagd|feld)/i.test(
        t,
      ),
    ) ||
    takeUnique(() => true) ||
    `Vor dir liegt ${spokenTitle} — ein Ort mit mehr Hintergrund, als man denkt.`;

  const origin =
    takeUnique((t) =>
      /(gebaut|entstand|gegründet|errichtet|früher|seit|jahrhundert|handel|güter|gueter|fracht|lade|gemeinde|verbind|stillgelegt|eingestellt|abgerissen|restauriert|weltkrieg|namen)/i.test(
        t,
      ),
    ) ||
    takeUnique(() => true) ||
    '';

  // Nie denselben Fakt in NOW/HIGHLIGHT/EXPLORE wiederverwenden.
  // Lieber leer lassen als hohle „ganz anders erleben“-Floskeln.
  const now = takeUnique(
    (t) =>
      /(heute|aktuell|derzeit|jetzt|gilt|dient|nutzen|bekannt|restaurant|clubhaus|verbindet|erreicht|weg|nicht mehr|erinner)/i.test(
        t,
      ) && !/(gehört zum alltag|zum dorfleben)/i.test(t),
  );

  const highlight = takeUnique((t) =>
    /(älteste|einzige|besonder|beliebt|ideal|wenige|meter|allee|biergarten|barrierefrei|loch|par\b|wozu|diente|veränder|stillgelegt|güter|gueter|schüler|jahrgang|fußball|kurios|pflanzen|baum)/i.test(
      t,
    ),
  );

  const explore = takeUnique((t) =>
    /(allee|bahnsteig|zugang|gleis|clubhaus|biergarten|restaurant|hotel|teich|knick|eingang|fassade|weg|schau|blick)/i.test(
      t,
    ),
  );

  return {
    intro: cleanBullet(intro),
    origin: cleanBullet(origin),
    now: cleanBullet(now),
    highlight: cleanBullet(highlight),
    explore: cleanBullet(explore),
    poiName: spokenTitle,
    fromLlm: false,
  };
}

function parseCoreFactsJson(
  raw: string,
  fallback: CoreFacts,
): Omit<CoreFacts, 'fromLlm'> | null {
  const jsonMatch = raw.match(/\{[\s\S]{0,8000}?\}/);
  if (!jsonMatch) return null;
  try {
    const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const intro = cleanBullet(
      String(obj.INTRO ?? obj.intro ?? fallback.intro),
    );
    const origin = cleanBullet(
      String(obj.ORIGIN ?? obj.origin ?? fallback.origin),
    );
    const now = cleanBullet(String(obj.NOW ?? obj.now ?? fallback.now));
    const highlight = cleanBullet(
      String(obj.HIGHLIGHT ?? obj.highlight ?? fallback.highlight),
    );
    const explore = cleanBullet(
      String(obj.EXPLORE ?? obj.explore ?? fallback.explore),
    );
    if (
      [intro, origin, now, highlight, explore].some(
        (t) => isJunkFact(t) && t.length < 12,
      )
    ) {
      return null;
    }
    if (
      [intro, origin, now, highlight, explore].some((t) =>
        isTransitTrashFact(t),
      )
    ) {
      return null;
    }
    return {
      intro: intro || fallback.intro,
      origin: origin || fallback.origin,
      now: now || fallback.now,
      highlight: highlight || fallback.highlight,
      explore: explore || fallback.explore,
      poiName:
        cleanBullet(String(obj.poiName ?? fallback.poiName)) ||
        fallback.poiName,
    };
  } catch {
    return null;
  }
}

export async function generateHookAndResolution(input: {
  facts: CoreFacts;
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
  llmTimeoutMs?: number;
}): Promise<HookBundle> {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const offline = generateHookAndResolutionOffline(input);
  const timeoutMs = textEngineTimeoutMs(input.llmTimeoutMs ?? 5000);
  const style = resolvePromptStyleSettings(profile);
  const firstName = profile.firstName?.trim() || null;
  const prompt = buildHookResolutionPrompt({
    facts: input.facts,
    voiceId: style.voiceId,
    personalityLabel: style.personalityLabel,
    userFirstName: firstName,
    profile,
  });

  try {
    const raw = await Promise.race([
      generatePromptText(prompt, {
        maxTokens: 140,
        temperature: 0.35,
        useFindusSystem: false,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
    if (!raw?.trim()) return offline;
    const parsed = parseHookBundle(raw);
    if (!parsed) return offline;
    const groundedFirst = rejectUngroundedClaims(
      parsed.firstBodySentence,
      input.facts,
    );
    const groundedHook = rejectUngroundedClaims(
      parsed.hookSentence,
      input.facts,
    );
    if (!groundedFirst || !groundedHook) return offline;
    return {
      hookSentence: groundedHook,
      firstBodySentence: groundedFirst,
      fromLlm: true,
    };
  } catch (err) {
    console.warn('[storyPipeline] Step2 LLM failed, offline:', err);
    return offline;
  }
}

export function generateHookAndResolutionOffline(input: {
  facts: CoreFacts;
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
}): HookBundle {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const kind = classifyPoiHookKind(input.poi);
  let hook = buildFastHook(input.poi, profile, input.sessionMemory);

  // Fallback nur wenn Hook leer — sonst Kontext aus buildFastHook belassen
  if (!hook?.trim()) {
    hook =
      kind === 'golf'
        ? 'Bist du bereit für deinen nächsten Abschlag?'
        : kind === 'station'
          ? `Tüt-tüt, Einsteigen bitte! Wir stehen am ${input.facts.poiName}.`
          : kind === 'water'
            ? 'Ich hoffe, du hast deine Badehose eingepackt — jetzt wird’s erfrischend!'
            : `Pass auf — ${input.facts.poiName} hat mehr zu erzählen, als der erste Blick verrät.`;
  }

  const firstBodySentence = buildIntroResolvingHook(
    hook,
    input.facts.intro,
    input.facts.poiName,
  );

  return {
    hookSentence: hook.replace(/\s+/g, ' ').trim(),
    firstBodySentence: firstBodySentence.replace(/\s+/g, ' ').trim(),
    fromLlm: false,
  };
}

/** Erster Body-Satz greift Hook-Steilvorlage auf und löst mit INTRO ein. */
function buildIntroResolvingHook(
  hook: string,
  intro: string,
  poiName: string,
): string {
  const h = hook.toLowerCase();
  const body = intro.replace(/\s+/g, ' ').trim();
  const blob = `${hook} ${poiName} ${body}`.toLowerCase();

  // Gedenkort: nie Badehose-/Wasser-Humor, auch wenn „Bilsbek“ vorkommt
  if (/(ehrenmal|krieger|gedenk|denkmal)/i.test(blob)) {
    if (body) return body;
    return 'Schau dir den Stein und die Namen ruhig einmal genau an — hinter jedem steht eine echte Geschichte.';
  }

  if (/abschlag|handicap|green/i.test(h)) {
    return `Dann bist du hier genau richtig: ${body}`;
  }
  if (/aperol|drink|kaffee|lust auf/i.test(h)) {
    return `Passt — wir sind genau am richtigen Spot: ${body}`;
  }
  if (/einsteigen|tüt|bahnhof|gleis/i.test(h)) {
    return `Genau, wir sind am ${poiName}: ${body}`;
  }
  // Badehose nur bei echtem Wasser-Hook, nie bei Denkmal
  if (
    /badehose|erfrisch/i.test(h) &&
    /(wasser|ufer|see|fluss|strand|baden)/i.test(h) &&
    !/(ehrenmal|denkmal|gedenk)/i.test(blob)
  ) {
    return `Keine Sorge, wir bleiben erstmal trocken am Ufer — ${body}`;
  }
  if (/pollen|allergie/i.test(h)) {
    return `Ob Allergie oder nicht: hier vor dir wächst’s ordentlich — ${body}`;
  }
  if (/baumschule|gärtnerei|gaertnerei|feldflur|jagd/i.test(h)) {
    return body
      ? `Genau, wir stehen mitten in der Landschaft: ${body}`
      : `Genau, wir stehen mitten in der Landschaft rund um ${poiName}.`;
  }
  if (/mauern|pst|skandal|sprechen könnten/i.test(h)) {
    return `Und genau davon erzählt dieser Ort: ${body}`;
  }
  if (/warum|wieso|weshalb/i.test(h)) {
    return `Die Antwort steckt direkt hier: ${body}`;
  }
  if (body.toLowerCase().startsWith('das hier')) return body;
  if (body.toLowerCase().startsWith('vor dir')) return body;
  if (body.toLowerCase().startsWith('du ')) return body;
  // Kein plumpes „Das hier ist NAME, genau der Spot“
  if (body) return body;
  return `Schau genau hin — ${poiName} hat mehr zu erzählen, als der erste Blick verrät.`;
}

function parseHookBundle(
  raw: string,
): Omit<HookBundle, 'fromLlm'> | null {
  const jsonMatch = raw.match(/\{[\s\S]{0,4000}?\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const hook = cleanBullet(
        String(obj.hookSentence ?? obj.hook ?? obj.HOOK ?? ''),
      );
      const first = cleanBullet(
        String(
          obj.firstBodySentence ??
            obj.resolution ??
            obj.firstBody ??
            obj.FIRST_BODY ??
            '',
        ),
      );
      if (hook.length >= 8 && first.length >= 12 && !isTransitTrashFact(first)) {
        return { hookSentence: hook, firstBodySentence: first };
      }
    } catch {
      /* line parse */
    }
  }

  const lines = raw
    .split(/\n+/)
    .map((l) => cleanBullet(l.replace(/^(HOOK|BODY|1\.|2\.)\s*:?\s*/i, '')))
    .filter((l) => l.length >= 8);
  if (lines.length >= 2) {
    return { hookSentence: lines[0], firstBodySentence: lines[1] };
  }

  const sentences = raw
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map(cleanBullet)
    .filter((s) => s.length >= 8);
  if (sentences.length >= 2) {
    return {
      hookSentence: sentences[0],
      firstBodySentence: sentences[1],
    };
  }
  return null;
}

export async function* assembleFinalStory(input: {
  facts: CoreFacts;
  hookSentence: string;
  firstBodySentence: string;
  profile?: UserProfile | null;
  tourBrief?: FindusStoryBrief | null;
  sessionMemory?: SessionMemory | null;
  poi?: PoiWithFacts | null;
}): AsyncGenerator<string, void, unknown> {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const style = resolvePromptStyleSettings(profile);
  const user = resolvePoiUserContext(profile);
  const controls = resolveStorytellingControls(profile);
  const masterContext = resolveMasterPromptContext({
    sessionVisitedCount: input.sessionMemory?.entries?.length ?? 1,
    poi: input.poi ?? { name: input.facts.poiName },
  });

  // Prefer single-shot colloquial prompt (local LLM) when available
  const singleShotTimeout = textEngineTimeoutMs(7000);
  const singleShot = buildColloquialSingleShotPrompt({
    facts: input.facts,
    hookSentence: input.hookSentence,
    firstBodySentence: input.firstBodySentence,
    profile,
    tourBrief: input.tourBrief,
  });

  try {
    const raw = await Promise.race([
      generatePromptText(singleShot, {
        maxTokens: 320,
        temperature: GEMINI_TEMPERATURE,
        useFindusSystem: true,
        masterContext,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), singleShotTimeout),
      ),
    ]);
    if (raw?.trim()) {
      const spokenSoFar = [
        input.hookSentence,
        input.firstBodySentence,
        input.facts.intro,
      ].filter(Boolean);
      let yielded = false;
      for (const sentence of raw
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        const clean = sanitizeBodySentence(sentence, {
          hookSentence: input.hookSentence,
          firstBodySentence: input.firstBodySentence,
          facts: input.facts,
          spokenSoFar,
        });
        if (!clean) continue;
        spokenSoFar.push(clean);
        yielded = true;
        yield clean;
      }
      if (yielded) return;
    }
  } catch (err) {
    console.warn('[storyPipeline] Single-shot LLM failed:', err);
  }

  // Legacy narrative assembly prompt (kürzerer Versuch)
  const prompt = buildNarrativeAssemblyPrompt({
    facts: input.facts,
    hookSentence: input.hookSentence,
    firstBodySentence: input.firstBodySentence,
    personalityLabel: style.personalityLabel,
    voiceId: style.voiceId,
    quizEnabled: controls.quizMode,
    funFactsEnabled: controls.funFactsEnabled,
    userFirstName: profile.firstName?.trim() || null,
    interests: user.interests,
    profile,
    storyBrief: input.tourBrief?.promptBlock ?? null,
  });

  try {
    let yielded = false;
    const spokenSoFar = [
      input.hookSentence,
      input.firstBodySentence,
      input.facts.intro,
      input.facts.origin,
    ].filter(Boolean);
    for await (const sentence of streamPromptSentences(prompt, {
      masterContext,
      temperature: GEMINI_TEMPERATURE,
    })) {
      const clean = sanitizeBodySentence(sentence, {
        hookSentence: input.hookSentence,
        firstBodySentence: input.firstBodySentence,
        facts: input.facts,
        spokenSoFar,
      });
      if (!clean) continue;
      spokenSoFar.push(clean);
      yielded = true;
      yield clean;
    }
    if (yielded) return;
  } catch (err) {
    console.warn('[storyPipeline] Step3 LLM failed, offline:', err);
  }

  yield* sentencesFromFullText(
    assembleFinalStoryOffline({
      ...input,
      profile,
    }).join(' '),
  );
}

export function assembleFinalStoryOffline(input: {
  facts: CoreFacts;
  hookSentence: string;
  firstBodySentence: string;
  profile?: UserProfile | null;
  tourBrief?: FindusStoryBrief | null;
}): string[] {
  return composeColloquialStory({
    facts: input.facts,
    hookSentence: input.hookSentence,
    firstBodySentence: input.firstBodySentence,
    profile: input.profile,
    tourBrief: input.tourBrief,
  });
}

/** Hohle Floskel ohne Auflösung — nie aussprechen. */
function isHollowExperienceFluff(text: string): boolean {
  return /(ganz anders erleben|anders erleben als|ganz erleben als|erleben als (früher|vorher)|kann man es .*erleben)/i.test(
    text,
  );
}

function normalizeFactBlob(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textEchoesAny(candidate: string, spoken: string[]): boolean {
  const c = normalizeFactBlob(candidate);
  if (c.length < 12) return false;
  for (const s of spoken) {
    const n = normalizeFactBlob(s);
    if (!n) continue;
    if (c === n) return true;
    // Kernüberlappung: gleiche 6+ Wörter in Folge
    const cWords = c.split(' ').filter((w) => w.length > 3);
    const nWords = n.split(' ').filter((w) => w.length > 3);
    if (cWords.length >= 5 && nWords.length >= 5) {
      const window = 5;
      const nJoined = ` ${nWords.join(' ')} `;
      for (let i = 0; i <= cWords.length - window; i++) {
        const slice = ` ${cWords.slice(i, i + window).join(' ')} `;
        if (nJoined.includes(slice)) return true;
      }
    }
    if (n.includes(c) || c.includes(n)) {
      const shorter = Math.min(c.length, n.length);
      const longer = Math.max(c.length, n.length);
      if (shorter >= 16 && shorter / longer >= 0.45) return true;
    }
  }
  return false;
}

function sanitizeBodySentence(
  sentence: string,
  input: {
    hookSentence: string;
    firstBodySentence: string;
    facts: CoreFacts;
    spokenSoFar?: string[];
  },
): string | null {
  let s = rejectUngroundedClaims(sentence, input.facts);
  if (!s) return null;
  if (isHollowExperienceFluff(s)) return null;

  // Offene Warum-Frage ohne Antwort im selben Satz → droppen (keine Leerschleife)
  if (
    /\b(warum|wieso|weshalb)\b/i.test(s) &&
    /\?/.test(s) &&
    !/[—.–:].{12,}/.test(s) &&
    s.split(/[.!?]/).filter((p) => p.trim().length > 20).length < 2
  ) {
    return null;
  }

  const hookHead = input.hookSentence.slice(0, 18).toLowerCase();
  const firstHead = input.firstBodySentence.slice(0, 18).toLowerCase();
  const lower = s.toLowerCase();
  if (hookHead && lower.startsWith(hookHead)) return null;
  if (firstHead && lower.startsWith(firstHead)) return null;
  if (/^(tüt-tüt|tadaa|pst\b|moin moin)/i.test(s)) return null;

  const spoken = input.spokenSoFar ?? [
    input.hookSentence,
    input.firstBodySentence,
  ];
  if (textEchoesAny(s, spoken)) return null;

  return s;
}

/**
 * @deprecated chain-v1 — nutze beginHookResolvingStream / singleShotStory.
 * Re-export für alte Imports.
 */
export { beginHookResolvingStream as beginChainedStoryStream } from './storyService';

