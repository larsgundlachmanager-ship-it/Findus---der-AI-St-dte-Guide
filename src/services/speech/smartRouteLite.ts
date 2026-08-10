/**
 * Leichte Intent-Route für Floskeln / Latency-Acks.
 * (Ersatz für module2/smartRouter — ohne Fragen-Pipeline)
 */

export type SmartRouteMode = 'fast' | 'deep';
export type ContextProfile = 'slim' | 'location' | 'full';

export type SmartIntentKind =
  | 'weather'
  | 'park'
  | 'bar'
  | 'dining'
  | 'nav'
  | 'transit'
  | 'hotel'
  | 'events'
  | 'flight'
  | 'plan'
  | 'knowledge'
  | 'hours'
  | 'menu'
  | 'phone'
  | 'research';

export type SmartRouteDecision = {
  mode: SmartRouteMode;
  allowFastPath: boolean;
  contextProfile: ContextProfile;
  wordCount: number;
  intents: SmartIntentKind[];
  intentDensity: number;
  needsGps: boolean;
  needsWeather: boolean;
  reasons: string[];
};

const WORD_LIMIT_FAST = 15;

const INTENT_PATTERNS: Array<{ kind: SmartIntentKind; re: RegExp }> = [
  {
    kind: 'weather',
    re: /\b(wetter|regen|sonne|temperatur|schirm|gewitter|windig|hitze|kalt)\b/iu,
  },
  {
    kind: 'park',
    re: /\b(park|garten|grünanlage|gruenanlage|strand|düne|duene|aussicht|plattform|sonnenuntergang|sunset)\b/iu,
  },
  {
    kind: 'bar',
    re: /\b(bar|kneipe|pub|nachtleben|party|club|cocktail)\b/iu,
  },
  {
    kind: 'dining',
    re: /\b(essen|restaurant|café|cafe|hunger|imbiss|bistro|to\s*go|mitnehm|speise|frühstück|fruehstueck)\b/iu,
  },
  {
    kind: 'nav',
    re: /\b(navigier|führ\s+mich|fuehr\s+mich|bring\s+mich|route\s+zu|kompass|geh(?:en)?\s+(?:wir\s+)?zu)\b/iu,
  },
  {
    kind: 'transit',
    re: /\b(zug|bus|bahn|öpnv|oepnv|verbindung|verspät|fähre|faehre|inselbahn)\b/iu,
  },
  {
    kind: 'hotel',
    re: /\b(hotel|unterkunft|übernacht|uebernacht|check[- ]?in|check[- ]?out)\b/iu,
  },
  {
    kind: 'events',
    re: /\b(event|veranstaltung|was\s+geht|heute\s+abend|kino|film|konzert)\b/iu,
  },
  {
    kind: 'flight',
    re: /\b(flug|flieger|gate|abflug|flugplatz|flughafen)\b/iu,
  },
  {
    kind: 'plan',
    re: /\b(plan(e|en)|ablauf|tagesplan|leave.?by|erinner|termin)\b/iu,
  },
  {
    kind: 'hours',
    re: /\b(öffnungszeit|oeffnungszeit|geöffnet|geoeffnet|wann\s+auf|bis\s+wann|geschlossen)\b/iu,
  },
  {
    kind: 'menu',
    re: /\b(speisekarte|menü|menu|karte\s+vom|preise?|wie\s+teuer)\b/iu,
  },
  {
    kind: 'phone',
    re: /\b(telefon|nummer|anruf|anrufen)\b/iu,
  },
  {
    kind: 'knowledge',
    re: /\b(wer\s+hat|was\s+ist\s+findus|programmier|entwickelt|wie\s+funktioniert\s+du|über\s+dich|ueber\s+dich|wer\s+bist\s+du)\b/iu,
  },
  {
    kind: 'research',
    re: /\b(recherch|nachschau|webseite|website|pdf|flyer|ticket|eintritt)\b/iu,
  },
];

const LOCATION_INTENTS = new Set<SmartIntentKind>([
  'weather',
  'park',
  'bar',
  'dining',
  'nav',
  'transit',
  'hotel',
  'events',
  'flight',
  'hours',
  'menu',
  'phone',
]);

const WEATHER_INTENTS = new Set<SmartIntentKind>([
  'weather',
  'park',
  'dining',
  'nav',
  'plan',
  'events',
]);

export function countWords(text: string): number {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;
}

export function detectSmartIntents(userText: string): SmartIntentKind[] {
  const t = userText.replace(/\s+/g, ' ').trim();
  const found: SmartIntentKind[] = [];
  for (const { kind, re } of INTENT_PATTERNS) {
    if (re.test(t) && !found.includes(kind)) found.push(kind);
  }
  return found;
}

export function hasContradictionSignals(userText: string): boolean {
  const t = userText.replace(/\s+/g, ' ').trim();
  if (
    /\b(aber|jedoch|trotzdem|obwohl|nicht\s+doch|lieber\s+nicht)\b/iu.test(t) &&
    countWords(t) >= 6
  ) {
    return true;
  }
  if (
    /\b(zu\s+fuß|zufuss|laufen|gehen)\b/iu.test(t) &&
    /\b(auto|taxi|uber|fahrrad|rad)\b/iu.test(t)
  ) {
    return true;
  }
  if (
    /\b(to\s*go|mitnehm|essen|restaurant)\b/iu.test(t) &&
    /\b(sonnenuntergang|sunset|aussicht|park)\b/iu.test(t)
  ) {
    return true;
  }
  if (
    /\b(wetter)\b/iu.test(t) &&
    /\b(park|bar|restaurant|café|cafe|route|führ|fuehr)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

export function analyzeSmartRoute(userText: string): SmartRouteDecision {
  const trimmed = userText.replace(/\s+/g, ' ').trim();
  const wordCount = countWords(trimmed);
  const intents = detectSmartIntents(trimmed);
  const contradictions = hasContradictionSignals(trimmed);
  const reasons: string[] = [];

  const actionIntents = intents.filter((i) => i !== 'knowledge');
  const intentDensity = actionIntents.length;

  let forceDeep = false;
  if (wordCount > WORD_LIMIT_FAST) {
    forceDeep = true;
    reasons.push(`words>${WORD_LIMIT_FAST} (${wordCount})`);
  }
  if (intentDensity >= 2) {
    forceDeep = true;
    reasons.push(`multi_intent=${actionIntents.join('+')}`);
  }
  if (contradictions) {
    forceDeep = true;
    reasons.push('contradiction_or_compound');
  }

  const knowledgeOnly =
    intents.includes('knowledge') && actionIntents.length === 0;
  const pureKnowledge =
    knowledgeOnly || (intents.length === 1 && intents[0] === 'knowledge');

  const needsGps = actionIntents.some((i) => LOCATION_INTENTS.has(i));
  const needsWeather =
    actionIntents.some((i) => WEATHER_INTENTS.has(i)) ||
    intents.includes('weather');

  let contextProfile: ContextProfile;
  if (
    (pureKnowledge ||
      (!needsGps && !needsWeather && intents.includes('knowledge'))) &&
    !forceDeep
  ) {
    contextProfile = 'slim';
    reasons.push('context=slim_knowledge');
  } else if (needsGps || needsWeather) {
    contextProfile = forceDeep ? 'full' : 'location';
    reasons.push(
      needsWeather ? 'context=location+weather' : 'context=location+gps',
    );
  } else if (forceDeep) {
    contextProfile = 'full';
    reasons.push('context=full_deep');
  } else {
    contextProfile = 'slim';
    reasons.push('context=slim_default');
  }

  const mode: SmartRouteMode = forceDeep ? 'deep' : 'fast';
  const allowFastPath = mode === 'fast';
  if (allowFastPath) reasons.push('fast_path_eligible');
  else reasons.push('deep_pipeline_required');

  return {
    mode,
    allowFastPath,
    contextProfile,
    wordCount,
    intents,
    intentDensity,
    needsGps,
    needsWeather,
    reasons,
  };
}
