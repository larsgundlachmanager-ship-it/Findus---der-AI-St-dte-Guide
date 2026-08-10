/**
 * Post-Speech Enrich — SSOT Entry.
 * Speech steht → Memory-Bullets + Hilfe-Buttons.
 */

export {
  deriveMemoryBullets,
  classifySpeechScene,
  type SpeechScene,
} from './speechMemoryBullets';
export {
  deriveHelpActionsFromSpeech,
  extractChoicePlaces,
} from './postSpeechActions';
