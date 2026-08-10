/** Open Web-Agent — öffentliche Einstiege. */
export {
  runOpenWebAgent,
  webAgentIsNeeded,
  webAgentToActions,
  scoreLink,
  type WebAgentStep,
} from './runOpenWebAgent';
export {
  FRICTION_KEYS,
  extractQueryIntentTokens,
  frictionDomainHint,
  NOTICE_PATTERNS,
  PDF_BROCHURE_RE,
} from './frictionCategories';
export {
  validateFactPlausibility,
  filterAndValidateFacts,
  frameFactForSpeech,
  buildConjunctiveSpeechHint,
  dateValidationPromptBlock,
  type ValidatedFact,
  type PlausibilityStatus,
} from './datePlausibility';