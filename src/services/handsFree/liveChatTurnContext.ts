/**
 * Flag für laufenden Live-Chat-Turn (Synthese / Deep-Research-Gate).
 */

export type LiveChatTurnContext = {
  active: boolean;
  humanTone: boolean;
  askBeforeDeepResearch: boolean;
};

let ctx: LiveChatTurnContext = {
  active: false,
  humanTone: true,
  askBeforeDeepResearch: false,
};

export function setLiveChatTurnContext(
  next: Partial<LiveChatTurnContext> & { active: boolean },
): void {
  ctx = { ...ctx, ...next };
}

export function clearLiveChatTurnContext(): void {
  ctx = {
    active: false,
    humanTone: true,
    askBeforeDeepResearch: false,
  };
}

export function getLiveChatTurnContext(): LiveChatTurnContext {
  return ctx;
}

export function isLiveChatTurnActive(): boolean {
  return ctx.active;
}

/** User will Recherche ausdrücklich — Live-Chat darf dann deep gehen. */
const EXPLICIT_RESEARCH_RE =
  /\b(recherchier(?:e|en)?(?:\s+tiefer)?|tiefer\s+recherch|such(?:e)?\s+(?:das\s+)?(?:mal\s+)?online|online\s+nachschau|nachschau(?:en)?|guck(?:e)?\s+nach|schau(?:e)?\s+nach|check(?:e)?\s+(?:das\s+)?online|google(?:\s+mal)?|schlag\s+(?:das\s+)?nach|nachschlag)\b/iu;

export function wantsExplicitDeepResearch(text: string): boolean {
  return EXPLICIT_RESEARCH_RE.test((text || '').replace(/\s+/g, ' '));
}
