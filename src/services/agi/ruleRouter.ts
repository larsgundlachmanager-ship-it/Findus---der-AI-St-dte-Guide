/**
 * Dynamisches Regel-Routing — ohne Two-Pass / Pass-1-Typen.
 * Modul-2 Greenfield nutzt zusätzlich `src/module2/laws/lawLayers.ts`.
 */

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

/** Heuristik aus User-Text. */
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
    pushUnique(cats, 'SAFETY_HEALTH');
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
  if (/\b(geschichte|historie|denkmal|erzähl)\b/iu.test(text)) {
    pushUnique(cats, 'RESEARCH_FACTS');
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

export type RoutedLaws = {
  categories: LawCategory[];
  /** @deprecated Alias von categories */
  modules: LawCategory[];
  contextualLaws: FindusLaw[];
  judgeLaws: FindusLaw[];
  promptBlock: string;
  judgePromptBlock: string;
};

/**
 * Wählt Kategorien aus User-Text + Concierge-Kontext.
 * Injiziert max. 10 Kontext-Gesetze (nie alle 190).
 */
export function routeAgiLaws(opts: {
  userText: string;
  /** @deprecated ignored — Two-Pass entfernt */
  pass1?: unknown;
  conciergeCtx?: ConciergeContext | null;
}): RoutedLaws {
  if (__DEV__) assertLawRegistryIntegrity();

  const cats: LawCategory[] = [];
  for (const c of categoriesFromUserText(opts.userText)) pushUnique(cats, c);
  for (const c of categoriesFromConciergeKind(opts.conciergeCtx?.kind)) {
    pushUnique(cats, c);
  }

  pushUnique(cats, 'SELF_CHECK');

  if (cats.length <= 1) {
    pushUnique(cats, 'SMALLTALK');
    pushUnique(cats, 'RESEARCH_FACTS');
    pushUnique(cats, 'UI_ACTIONS');
  }

  const validCats = cats.filter((c): c is LawCategory =>
    (LAW_CATEGORIES as readonly string[]).includes(c),
  );

  const allForCats = getLawsByCategories(validCats);
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
