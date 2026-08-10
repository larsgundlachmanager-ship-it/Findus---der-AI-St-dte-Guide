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
  askBeforeDeepResearch: true,
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
    askBeforeDeepResearch: true,
  };
}

export function getLiveChatTurnContext(): LiveChatTurnContext {
  return ctx;
}

export function isLiveChatTurnActive(): boolean {
  return ctx.active;
}
