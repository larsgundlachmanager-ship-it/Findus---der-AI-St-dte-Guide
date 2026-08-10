/**
 * Findus AGI Runtime — Verfassung + Routing + Guardrails + Judge.
 */

export {
  LAW_CATEGORIES,
  FINDUS_CONSTITUTION,
  FINDUS_ROUTED_LAWS,
  FINDUS_ALL_LAWS,
  LAWS_BY_CATEGORY,
  CATEGORY_COVERAGE_OK,
  formatConstitutionBlock,
  formatLawsForPrompt,
  formatFastJudgePromptBlock,
  getJudgeLaws,
  getLawsByCategories,
  getLawsByModules,
  assertLawRegistryIntegrity,
  type LawCategory,
  type AgilawModule,
  type FindusLaw,
  type CategoryCoverageCheck,
} from './findusLawRegistry';

export { routeAgiLaws, type RoutedLaws } from './ruleRouter';

export {
  applyHardGuardrails,
  applyHardGuardrailsSync,
  scrubSpeechForTts,
  expandGermanAbbreviationsForSpeech,
  resolveSpeechMaxChars,
  SPEECH_MAX_CHARS,
  SPEECH_MAX_CHARS_HISTORY,
  GUARDRAILS_SYNC,
  type GuardrailReport,
} from './speechGuardrails';

export { runLawJudgePass, type JudgeResult } from './lawJudgePass';

export {
  applyActionButtonJudge,
  judgeActionButtons,
  ACTION_LABEL_MAX_CHARS,
  type ActionJudgeNote,
  type ActionButtonJudgeResult,
} from './actionButtonJudge';
