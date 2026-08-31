/**
 * Chat-first Allowlist — validiert Router-Output, rät keine Intents.
 */

export const CHAT_LANES = ['chat', 'nav', 'm1', 'plan', 'pitch'] as const;
export type ChatLane = (typeof CHAT_LANES)[number];

export const BLUEPRINT_IDS = [
  'cinema',
  'dining',
  'hotel',
  'live_events',
  'compound_evening_goal',
  'research_choice',
  'theater',
  'sky_phenomenon',
] as const;
export type AllowedBlueprintId = (typeof BLUEPRINT_IDS)[number];

export const RESEARCH_DEPTHS = ['quick', 'pack', 'deep'] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

export const PERSONA_VARIANTS = [
  'default',
  'family_kids',
  'party_nightlife',
  'solo_adult',
] as const;
export type PersonaVariant = (typeof PERSONA_VARIANTS)[number];

export type RouterIntentItem = {
  lane: ChatLane;
  blueprintId: AllowedBlueprintId | null;
  brief: string;
  dependsOn?: string | null;
  id?: string;
};

export type SanitizedRouterDecision = {
  lane: ChatLane;
  blueprintId: AllowedBlueprintId | null;
  nearestBlueprint: AllowedBlueprintId | null;
  needsResearch: ResearchDepth;
  personaVariant: PersonaVariant;
  intents: RouterIntentItem[];
};

function inList<T extends string>(v: unknown, list: readonly T[]): T | null {
  const s = String(v || '').toLowerCase().trim();
  return (list as readonly string[]).includes(s) ? (s as T) : null;
}

/** Map legacy ManagerRoute → ChatLane. */
export function laneFromLegacyRoute(route: string | null | undefined): ChatLane {
  switch (String(route || '')) {
    case 'm1_poi':
      return 'm1';
    case 'm3_nav_start':
    case 'm3_nav_query':
      return 'nav';
    case 'm5_plan':
      return 'plan';
    case 'memory':
    case 'blueprint':
    case 'smalltalk':
    default:
      return 'chat';
  }
}

export function sanitizeRouterDecision(raw: {
  lane?: unknown;
  route?: unknown;
  blueprintId?: unknown;
  nearestBlueprint?: unknown;
  needsResearch?: unknown;
  personaVariant?: unknown;
  intents?: unknown;
  bridge?: unknown;
}): SanitizedRouterDecision {
  let lane =
    inList(raw.lane, CHAT_LANES) ??
    laneFromLegacyRoute(typeof raw.route === 'string' ? raw.route : null);

  let blueprintId = inList(raw.blueprintId, BLUEPRINT_IDS);
  const nearestBlueprint = inList(raw.nearestBlueprint, BLUEPRINT_IDS);

  // Pitch only when dining/cinema choice or explicit
  if (lane === 'pitch' && !blueprintId) {
    blueprintId = nearestBlueprint ?? 'dining';
  }

  // Unknown blueprint → null (plain chat), never invent
  if (raw.blueprintId && !blueprintId) {
    blueprintId = nearestBlueprint;
  }

  // Chat-Default = pack (GPS/Kontext). `quick` nur wenn Router/Trivia es setzt.
  const needsResearch =
    inList(raw.needsResearch, RESEARCH_DEPTHS) ?? 'pack';

  const personaVariant =
    inList(raw.personaVariant, PERSONA_VARIANTS) ?? 'default';

  const intents: RouterIntentItem[] = [];
  if (Array.isArray(raw.intents)) {
    for (const item of raw.intents.slice(0, 6)) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const iLane = inList(o.lane, CHAT_LANES) ?? lane;
      const bp = inList(o.blueprintId, BLUEPRINT_IDS);
      const brief = String(o.brief || '').trim().slice(0, 200);
      if (!brief && iLane === 'chat' && !bp) continue;
      intents.push({
        id: String(o.id || `i${intents.length + 1}`).slice(0, 40),
        lane: iLane,
        blueprintId: bp,
        brief: brief || `${iLane} turn`,
        dependsOn:
          typeof o.dependsOn === 'string' ? o.dependsOn.slice(0, 40) : null,
      });
    }
  }

  if (!intents.length) {
    intents.push({
      id: 'primary',
      lane,
      blueprintId,
      brief: 'primary',
      dependsOn: null,
    });
  }

  // Primary lane follows first intent
  lane = intents[0]!.lane;
  if (!blueprintId) blueprintId = intents[0]!.blueprintId;

  return {
    lane,
    blueprintId,
    nearestBlueprint,
    needsResearch,
    personaVariant,
    intents,
  };
}
