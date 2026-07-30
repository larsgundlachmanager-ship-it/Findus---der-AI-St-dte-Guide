/**
 * Dynamisches Regel-Routing: Pass-1-Intent → Kategorien → max 10 Kontext-Gesetze.
 * LLM sieht immer nur Verfassung (20) + Kontext — nie alle 190 auf einmal.
 */

import type { Pass1Analysis, Pass1ResearchTask } from '../concierge/conciergeTwoPass';
import type { ConciergeContext } from '../concierge/conciergeContext';
import {
  type LawCategory,
  type FindusLaw,
  formatLawsForPrompt,
  getJudgeLaws,
  getLawsByCategories,
  formatFastJudgePromptBlock,
  LAW_CATEGORIES,
  assertLawRegistryIntegrity,
} from './findusLawRegistry';

/** @deprecated Alias */
export type AgilawModule = LawCategory;

const MAX_CONTEXTUAL_LAWS = 10;
const MAX_JUDGE_CONTEXTUAL = 5;

function pushUnique(cats: LawCategory[], c: LawCategory): void {
  if (!cats.includes(c)) cats.push(c);
}

/** Pass-1 researchTasks → Kategorien */
function categoriesFromResearchType(t: Pass1ResearchTask['type']): LawCategory[] {
  switch (t) {
    case 'flight':
      return ['FLIGHT_LOGISTICS', 'LOGISTICS_TIME', 'LUGGAGE_GEAR'];
    case 'food':
      return ['FOOD_EXP', 'AFFILIATE', 'UI_ACTIONS'];
    case 'event':
      return ['EVENT_CULTURE', 'UI_ACTIONS', 'AFFILIATE'];
    case 'poi':
      return ['NAV_EXPLORE', 'RESEARCH_FACTS'];
    case 'web':
      return ['RESEARCH_FACTS', 'SYSTEM_GUARD'];
    case 'memory':
      return ['PERSONA_LEARN', 'LOGISTICS_TIME'];
    default:
      return ['RESEARCH_FACTS'];
  }
}

/** Heuristik aus User-Text (ergänzt Pass-1). */
function categoriesFromUserText(text: string): LawCategory[] {
  const cats: LawCategory[] = [];
  if (/\b(flug|flieger|fähre|faehre|bahnhof|gleis|abflug|leave.?by|umstieg)\b/iu.test(text)) {
    pushUnique(cats, 'FLIGHT_LOGISTICS');
    pushUnique(cats, 'LOGISTICS_TIME');
  }
  if (/\b(essen|restaurant|café|cafe|imbiss|to.?go|speisekarte|vegan|hunger|reservier|tisch)\b/iu.test(text)) {
    pushUnique(cats, 'FOOD_EXP');
  }
  if (/\b(hotel|übernacht|uebernacht|check.?out|check.?in|zimmer|unterkunft)\b/iu.test(text)) {
    pushUnique(cats, 'HOTEL_CHECKOUT');
  }
  if (/\b(koffer|gepäck|gepaeck|bounce|aufbewahr)\b/iu.test(text)) {
    pushUnique(cats, 'LUGGAGE_GEAR');
  }
  if (/\b(party|event|konzert|heute\s+abend|was\s+geht|eintritt|flyer|pdf)\b/iu.test(text)) {
    pushUnique(cats, 'EVENT_CULTURE');
  }
  if (/\b(wetter|regen|sonne|sturm|wind|sunset|sonnenuntergang)\b/iu.test(text)) {
    pushUnique(cats, 'WEATHER_ENV');
  }
  if (/\b(arzt|apotheke|toilette|notfall|krank|dlrg|qualle)\b/iu.test(text)) {
    pushUnique(cats, 'SAFETY_HEALTH');
  }
  if (/\b(tagesplan|plan\s+für|plan\s+fuer|morgen\s+früh|itinerar|multi.?stop)\b/iu.test(text)) {
    pushUnique(cats, 'DAY_PLAN');
  }
  if (/\b(navigier|bring\s+mich|route|führ\s+mich|fuehr\s+mich|wo\s+bin\s+ich|leuchtturm)\b/iu.test(text)) {
    pushUnique(cats, 'NAV_EXPLORE');
  }
  if (/\b(mietwagen|uber|taxi|tour|ticket|stay22|getyourguide)\b/iu.test(text)) {
    pushUnique(cats, 'AFFILIATE');
  }
  if (/\b(hallo|moin|danke|wie\s+geht|laber|quatsch|langeweile)\b/iu.test(text)) {
    pushUnique(cats, 'SMALLTALK');
  }
  return cats;
}

function categoriesFromConciergeKind(
  kind: ConciergeContext['kind'] | undefined,
): LawCategory[] {
  switch (kind) {
    case 'food':
    case 'reservation':
      return ['FOOD_EXP', 'UI_ACTIONS'];
    case 'accommodation':
      return ['HOTEL_CHECKOUT', 'AFFILIATE', 'LUGGAGE_GEAR'];
    case 'flight':
    case 'travel':
      return ['FLIGHT_LOGISTICS', 'LOGISTICS_TIME', 'LUGGAGE_GEAR'];
    case 'luggage':
      return ['LUGGAGE_GEAR', 'AFFILIATE'];
    case 'tours':
      return ['AFFILIATE', 'EVENT_CULTURE', 'UI_ACTIONS'];
    case 'weather':
      return ['WEATHER_ENV', 'SAFETY_HEALTH'];
    case 'infra':
      return ['SAFETY_HEALTH', 'NAV_EXPLORE', 'UI_ACTIONS'];
    default:
      return [];
  }
}

/**
 * Pass-1 userGoal / topic → zusätzliche Kategorien.
 */
function categoriesFromPass1Goal(pass1: Pass1Analysis | null | undefined): LawCategory[] {
  if (!pass1) return [];
  const blob = [
    pass1.userGoal,
    ...pass1.subQuestions.map((q) => q.text),
    ...pass1.sanityChecks,
  ]
    .join(' ')
    .toLowerCase();
  return categoriesFromUserText(blob);
}

export type RoutedLaws = {
  /** Gewählte Kategorien (Intent) */
  categories: LawCategory[];
  /** @deprecated Alias von categories */
  modules: LawCategory[];
  contextualLaws: FindusLaw[];
  judgeLaws: FindusLaw[];
  promptBlock: string;
  judgePromptBlock: string;
};

/**
 * Wählt Kategorien aus Pass-1 + User-Text + Concierge-Kontext.
 * Injiziert max. 10 Kontext-Gesetze (+ Verfassung kommt separat im System-Prompt).
 */
export function routeAgiLaws(opts: {
  userText: string;
  pass1?: Pass1Analysis | null;
  conciergeCtx?: ConciergeContext | null;
}): RoutedLaws {
  if (__DEV__) assertLawRegistryIntegrity();

  const cats: LawCategory[] = [];

  // Pass-1 Intent hat höchste Prio
  for (const c of categoriesFromPass1Goal(opts.pass1)) pushUnique(cats, c);
  for (const task of opts.pass1?.researchTasks ?? []) {
    for (const c of categoriesFromResearchType(task.type)) pushUnique(cats, c);
  }
  for (const c of categoriesFromUserText(opts.userText)) pushUnique(cats, c);
  for (const c of categoriesFromConciergeKind(opts.conciergeCtx?.kind)) {
    pushUnique(cats, c);
  }

  // Self-check immer leicht mitgeben (Judge braucht Anker)
  pushUnique(cats, 'SELF_CHECK');

  // Fallback: Smalltalk + Research — nie leerer Prompt
  if (cats.length <= 1) {
    pushUnique(cats, 'SMALLTALK');
    pushUnique(cats, 'RESEARCH_FACTS');
    pushUnique(cats, 'UI_ACTIONS');
  }

  // Nur bekannte Kategorien (Orphan-Schutz)
  const validCats = cats.filter((c): c is LawCategory =>
    (LAW_CATEGORIES as readonly string[]).includes(c),
  );

  const allForCats = getLawsByCategories(validCats);
  // Priorität: hardGuardrail → dann Rest; max 10
  const sorted = [
    ...allForCats.filter((l) => l.hardGuardrail),
    ...allForCats.filter((l) => !l.hardGuardrail),
  ];
  const contextualLaws = sorted.slice(0, MAX_CONTEXTUAL_LAWS);
  const judgeLaws = getJudgeLaws(validCats, MAX_JUDGE_CONTEXTUAL);
  const judgeContextualOnly = judgeLaws.filter((l) => !String(l.id).startsWith('C'));

  const promptBlock = formatLawsForPrompt(
    contextualLaws,
    `KONTEXT-GESETZE (${validCats.join('+')}, max ${MAX_CONTEXTUAL_LAWS})`,
  );
  const judgePromptBlock = formatFastJudgePromptBlock(
    judgeContextualOnly,
    MAX_JUDGE_CONTEXTUAL,
  );

  return {
    categories: validCats,
    modules: validCats,
    contextualLaws,
    judgeLaws,
    promptBlock,
    judgePromptBlock,
  };
}
