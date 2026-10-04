/**
 * Follow-up aus dem aktuellen Chat — Backup hinter Call-1 referents.
 * Kein klebriges lastEntity über den Tag.
 * Hunger/Steak gelten nur für DIESEN Satz. Weave nur denselben geplanten Tag.
 * Ausnahme: benanntes Gewässer + Aktivität (SUP) bleibt Sticky für Follow-ups.
 */

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

export type FollowupDecision = {
  thread: 'continue' | 'new' | 'weave';
  inherit: 'fork' | 'price' | 'flight' | 'water_activity' | 'none';
  /** Immer false — Steak/Hunger sind kein Tages-Lock. */
  stickyEntity: false;
};

const AFFIRM_RE = /^(ja|genau|ok|okay|passt|mach\s+das|nimm\s+das|das\s+erste|das\s+zweite)\.?$/iu;
const PRICE_RE = /\b(wie\s+teuer|preis|kostet|was\s+kostet)\b/iu;
const HUNGER_RE = /\b(hunger|ich\s+hab\s+hunger|was\s+essen|bin\s+hungrig)\b/iu;
const STEAK_RE = /\b(steak|lust\s+auf\s+steak)\b/iu;
const WEAVE_RE = /\b(vorher|davor|noch\s+(?:schnell\s+)?(?:sup|stand[\s-]?up)|weben|einplanen)\b/iu;
const FLIGHT_FOLLOW_RE = /\b(gate|terminal|boarding|check-?in)\b/iu;
const DEICTIC_RE = /\b(da\s+hin|dahin|dieses\s+ding|da\s+lang)\b/iu;
const WATER_BODY_RE =
  /\b(see|meer|teich|fluss|alster|außenalster|aussenalster|innenalster|elb[e]?|hafen|bucht|lagune|weiher)\b/iu;
const WATER_ACTIVITY_RE =
  /\b(sup\b|stand[\s-]?up|paddle|paddeln|kanu|kajak|rudern|schwimmen|baden|segeln|surfen|bootsverleih|verleih)\b/iu;
const WATER_SIZE_RE = /\b(wie\s+gro[ßs]|fl[äa]che|quadratkilometer|km\s*²|km2)\b/iu;

function lastAssistant(turns: ChatTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === 'assistant') return turns[i]!.text;
  }
  return '';
}

function lastUser(turns: ChatTurn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]?.role === 'user') return turns[i]!.text;
  }
  return '';
}

function priorMentionsWater(assistant: string, prevUser: string): boolean {
  return WATER_BODY_RE.test(`${assistant} ${prevUser}`);
}

export function resolveFollowupThread(
  userText: string,
  recent: ChatTurn[],
): FollowupDecision {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  const none = (): FollowupDecision => ({
    thread: 'new',
    inherit: 'none',
    stickyEntity: false,
  });
  if (!t) return none();

  if (HUNGER_RE.test(t) || STEAK_RE.test(t)) return none();

  const assistant = lastAssistant(recent);
  const prevUser = lastUser(recent);

  // Sticky: Gewässer-Fakt → Aktivität/SUP auf DEM Gewässer (nie lokale Gastro ersetzen)
  if (
    (WATER_ACTIVITY_RE.test(t) || /\b(geht\s+das|darf\s+ich|kann\s+man)\b/iu.test(t)) &&
    priorMentionsWater(assistant, prevUser)
  ) {
    return { thread: 'continue', inherit: 'water_activity', stickyEntity: false };
  }
  if (WATER_ACTIVITY_RE.test(t) && WATER_BODY_RE.test(t) && !HUNGER_RE.test(t)) {
    return { thread: 'continue', inherit: 'water_activity', stickyEntity: false };
  }
  if (
    WATER_SIZE_RE.test(prevUser) &&
    WATER_BODY_RE.test(prevUser) &&
    WATER_ACTIVITY_RE.test(t)
  ) {
    return { thread: 'continue', inherit: 'water_activity', stickyEntity: false };
  }

  if (AFFIRM_RE.test(t) && assistant) {
    return { thread: 'continue', inherit: 'fork', stickyEntity: false };
  }
  if (PRICE_RE.test(t) && assistant) {
    return { thread: 'continue', inherit: 'price', stickyEntity: false };
  }
  if (
    FLIGHT_FOLLOW_RE.test(t) &&
    /\b(flug|flughafen|gate|leave)\b/iu.test(`${assistant} ${prevUser}`)
  ) {
    return { thread: 'continue', inherit: 'flight', stickyEntity: false };
  }
  if (
    WEAVE_RE.test(t) &&
    /\b(plan|abends?|pannfisch|hamburg|tag|anker)/iu.test(`${assistant} ${prevUser}`)
  ) {
    return { thread: 'weave', inherit: 'none', stickyEntity: false };
  }
  if (DEICTIC_RE.test(t) && !assistant) {
    return none();
  }
  if (DEICTIC_RE.test(t) && assistant) {
    return { thread: 'continue', inherit: 'fork', stickyEntity: false };
  }
  return none();
}
