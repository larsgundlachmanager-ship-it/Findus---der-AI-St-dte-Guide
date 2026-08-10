/**
 * Intent-Engine: Hotel-Resolver, History-Recall, Memory-Navigation,
 * Live-Präferenz-Lernen (Vegetarier, Abneigungen, …).
 * Läuft vor Gemini — deterministische Flows für Navigation/Bestätigung.
 */

import { getAllPois, haversineMeters } from '../db/database';
import type { Poi } from '../db/types';
import {
  startNavigation,
  startNavigationToCoords,
} from './navigation';
import {
  useUserMemoryStore,
  type UserEntity,
  type UserEntityType,
} from '../store/useUserMemoryStore';
import { useUserProfileStore } from '../store/useUserProfileStore';
import { parseTagsJson } from './geo/triggerPolicy';
import { isNavAffirmation } from './navigation/pendingOffer';
import {
  detectMultiStopIntent,
  planMultiStopTour,
  startMultiStopTour,
  clearMultiStopTour,
  CIRCUIT_PROMPT,
} from './navigation/multiStopTour';
import {
  detectDiscoveryIntent,
  presentDiscoveryAsConcierge,
  runContextualDiscovery,
} from './navigation/contextualDiscovery';
import {
  detectChainedNavIntent,
  planAndStartChainedNav,
  takePendingChainedNav,
} from './navigation/chainedNavIntent';
import {
  detectHardNavOverride,
  hardOverrideNavigationTo,
  isClearRouteIntent,
  clearNavigationHard,
} from './navigation/hardNavOverride';
import {
  isPoiInfoQuestion,
  isExplicitNavIntent,
  isNavCorrectionIntent,
  extractCorrectedQuestion,
} from './intent/poiInfoVsNav';
import {
  detectTravelModeVoiceOverride,
  setPreferredTravelMode,
} from './navigation/travelModeContext';
import {
  detectFollowUpBuyIntent,
  detectHotelTaskIntent,
  detectShoppingTaskDoneIntent,
  detectShoppingTaskIntent,
} from './shopping/shoppingTaskIntent';
import { useShoppingTaskStore } from '../store/useShoppingTaskStore';
import {
  getDeviceHeadingDeg,
  getMovementBearingDeg,
} from './navigation/navigationService';
import { useFinnusStore } from '../store/useFinnusStore';
import {
  parseCompoundPlanWithGemini,
} from './planning/compoundPlanParser';
import { activateCompoundSessionPlan } from './planning/activateSessionPlan';
import { routeUserUtteranceWithLlm } from './planning/llmIntentRouter';
import { hasGeminiApiKey } from './geminiService';
import { isDeviceOffline } from './navigation/networkState';
import type { GeminiConciergeResponse } from '../types/concierge';
import {
  detectEmergencyIntent,
  handleEmergencyConcierge,
} from './concierge/emergencyConcierge';
import {
  detectMenuTranslateIntent,
  handleMenuTranslateIntent,
} from './research/menuTranslateService';
import {
  detectTouristFrictionKind,
  handleTouristFrictionIntent,
} from './intent/touristFrictionIntent';

export type IntentResult = {
  handled: boolean;
  reply?: string;
  startedNav?: boolean;
  /** Profil wurde live aktualisiert */
  profileUpdated?: boolean;
  /** Rich card: speech + bullets + live action buttons */
  concierge?: GeminiConciergeResponse;
};

/** Structural multi-goal gate (no product hardcodes) — used when LLM parse fails. */
function looksLikeMultiGoalSpeech(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 35) return false;
  const hasTime =
    /\b\d{1,2}[:.h]\d{2}\b/.test(t) ||
    /\b(?:um\s+)?\d{1,2}\s*uhr\b/iu.test(t) ||
    /\b(?:achtzehn|siebzehn|neunzehn|zwanzig|sechzehn)\b/iu.test(t) ||
    /\b(?:pünktlich|puenktlich|verabredung|termin)\b/iu.test(t);
  const multi =
    /\b(außerdem|ausserdem|sowie|vorher|danach|zuerst|dann|und\s+noch|brauch|benötig|benoetig|möchte|moechte|spazier|herum|rumlauf|einkauf|hotel)\b/iu.test(
      t,
    );
  const clauses = t.split(/[.!?]+/).filter((s) => s.trim().length > 10).length;
  return (hasTime && multi) || (clauses >= 3 && multi);
}

const HOTEL_NAV =
  /\b(zum\s+hotel|ins\s+hotel|mein(em)?\s+hotel|zurück\s+zum\s+hotel|zurueck\s+zum\s+hotel|bring\s+mich\s+(zum\s+)?hotel|führ\s+mich\s+(zum\s+)?hotel|fuehr\s+mich\s+(zum\s+)?hotel|navigier(e|en)?\s+(mich\s+)?(zum\s+)?hotel|hotel\s+navig)/iu;

const HOTEL_IAM =
  /\b(ich\s+(bin|wohne|schlafe|übernachte|uebernachte)\s+(im|in|beim|bei)\s+(hotel\s+)?|mein\s+hotel\s+(heißt|heisst|ist)|hotel\s+heißt|hotel\s+heisst)\b/iu;

const HISTORY_NAV =
  /\b(noch\s*mal|nochmal|wieder\s+(zum|zur|zu)|gestern|vorgestern|damals|früher|frueher|zurück\s+zu|zurueck\s+zu|bring\s+mich\s+(noch|wieder)|führ\s+mich\s+(noch|wieder)|fuehr\s+mich\s+(noch|wieder)|burgerladen\s+von|restaurant\s+von)\b/iu;

const DAY_RECALL =
  /\b(wo\s+waren\s+wir|welche\s+orte|was\s+haben\s+wir\s+(gesehen|gemacht)|am\s+(ersten|zweiten|dritten)\s+tag|tour\s*(rückblick|rueckblick|zusammenfassung)|erinnerst\s+du\s+dich)\b/iu;

/** „Wo ist der Bahnhof?“ / „Bring mich zur Kirche“ → echte Navigation. */
const CITY_POI_NAV =
  /\b(wo\s+(ist|liegt|find(?:e|et)\s+ich)|wohin|zeig\s+mir\s+(den\s+weg|wo)|bring\s+mich|führ\s+mich|fuehr\s+mich|navigier|wie\s+komm(?:e|)\s+ich|weg\s+zu(?:m|r)?)\b/iu;

const NEGATION =
  /^(nein|nö|noe|ne|nee|falsch|nicht|kein|andere?s?|doch\s+nicht)\b/iu;

/** Häufige Kurzformen → Match-Tokens gegen POI-Namen. */
const NAV_QUERY_ALIASES: Array<{ keys: RegExp; tokens: string[] }> = [
  { keys: /\bbahnhof\b/i, tokens: ['bahnhof', 'bahnwarte', 'station'] },
  { keys: /\bschwalbe\b/i, tokens: ['schwalbe'] },
  {
    keys: /\b(kindergarten|kita|lütte|luette)\b/i,
    tokens: ['kindergarten', 'kita', 'lütte', 'luette', 'schule'],
  },
  { keys: /\bkirche\b/i, tokens: ['kirche', 'kapelle'] },
  { keys: /\bfeuerwehr\b/i, tokens: ['feuerwehr', 'feuerwache'] },
  { keys: /\bfriseur|coiffeur|salon\b/i, tokens: ['friseur', 'coiffeur', 'salon'] },
];

function extractCityNavQuery(text: string): string | null {
  const patterns = [
    /\bwo\s+(?:ist|liegt)\s+(?:denn\s+)?(?:hier\s+)?(?:der|die|das|dem|den)?\s*(.+?)(?:\?|$)/iu,
    /\bwo\s+find(?:e|et)\s+ich\s+(?:denn\s+)?(?:den|die|das)?\s*(.+?)(?:\?|$)/iu,
    /\b(?:bring|führ|fuehr|navigier(?:e)?)(?:\s+mich)?\s+(?:bitte\s+)?(?:zum|zur|zu\s+dem|zu\s+der|nach)\s+(.+?)(?:\?|$)/iu,
    /\bzeig\s+mir\s+(?:bitte\s+)?(?:den\s+weg\s+)?(?:zum|zur|zu)\s+(.+?)(?:\?|$)/iu,
    /\bwie\s+komm(?:e|)\s+ich\s+(?:denn\s+)?(?:zum|zur|nach)\s+(.+?)(?:\?|$)/iu,
    /\bweg\s+zu(?:m|r)?\s+(.+?)(?:\?|$)/iu,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let q = m[1]
      .replace(/\s+/g, ' ')
      .replace(
        /\s+(bitte|jetzt|mal|denn|hier|in\s+der\s+nähe|in\s+prisdorf).*$/iu,
        '',
      )
      .trim();
    q = q.replace(/^(der|die|das|dem|den|ein|eine)\s+/iu, '').trim();
    if (q.length >= 3) return q.slice(0, 60);
  }
  // „Bahnhof!“ / „Zum Bahnhof“ ohne Fragewort
  if (/\b(zum|zur|nach)\s+([a-zäöüß][\wäöüß\- ]{2,40})$/iu.test(text)) {
    const m = text.match(/\b(?:zum|zur|nach)\s+(.+)$/iu);
    if (m?.[1]) {
      return m[1]
        .replace(/^(der|die|das|dem|den)\s+/iu, '')
        .trim()
        .slice(0, 60);
    }
  }
  return null;
}

function scorePoiForNavQuery(poi: Poi, query: string): number {
  if (poi.kind === 'approach') return -1;
  const name = poi.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .toLowerCase();
  const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
  const cat = (poi.category ?? '').toLowerCase();
  const blob = `${name} ${cat} ${tags}`;
  const q = query.toLowerCase().trim();
  if (q.length < 2) return -1;

  let score = 0;
  if (name.includes(q)) score += 40;
  if (blob.includes(q)) score += 15;

  for (const alias of NAV_QUERY_ALIASES) {
    if (!alias.keys.test(q) && !alias.keys.test(query)) continue;
    for (const tok of alias.tokens) {
      if (blob.includes(tok)) score += 25;
    }
  }

  // Einzel-Tokens aus der Query
  for (const part of q.split(/\s+/)) {
    if (part.length < 4) continue;
    if (name.includes(part)) score += 12;
    else if (blob.includes(part)) score += 6;
  }

  if (poi.kind === 'area' || poi.kind === 'legacy') score += 5;
  if (poi.kind === 'sub') score += 2;
  return score;
}

async function findCityPoiForNavQuery(query: string): Promise<Poi | null> {
  const pois = await getAllPois();
  let best: Poi | null = null;
  let bestScore = 0;
  for (const poi of pois) {
    const s = scorePoiForNavQuery(poi, query);
    if (s > bestScore) {
      bestScore = s;
      best = poi;
    }
  }
  // Mindesttreffer — sonst Gemini antworten lassen
  if (!best || bestScore < 20) return null;
  return best;
}

async function handleCityPoiNavigation(
  text: string,
): Promise<IntentResult | null> {
  // Fact questions about a place must never become city-POI navigation
  if (isPoiInfoQuestion(text)) return null;
  if (!CITY_POI_NAV.test(text) && !/\b(zum|zur|nach)\s+\w{3,}/iu.test(text)) {
    return null;
  }
  // History/Hotel-Nav haben eigene Handler — hier nur Stadt-POIs
  if (HISTORY_NAV.test(text) || HOTEL_NAV.test(text)) return null;

  const query = extractCityNavQuery(text);
  if (!query) return null;

  const poi = await findCityPoiForNavQuery(query);
  if (!poi) return null;

  const shortName = poi.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .trim();
  const ok = await startNavigation(poi.id);
  return {
    handled: true,
    startedNav: ok,
    reply: ok
      ? `Klar — ich führ dich zu ${shortName}. Du musst nicht aufs Display schauen: ich sag dir an sichtbaren Punkten, wo du abbiegen musst.`
      : `Den Ort ${shortName} kenn ich, aber die Navigation startet gerade nicht. Versuch’s gleich nochmal.`,
  };
}

function extractHotelName(text: string): string | null {
  const patterns = [
    /\b(?:hotel|pension|hostel)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,3})/u,
    /\b(?:im|in|beim|bei)\s+(?:hotel\s+)?([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,3})/u,
    /\b(?:heißt|heisst|ist)\s+([A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+(?:\s+[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß\-']+){0,3})/u,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let name = m[1].replace(/\s+/g, ' ').trim();
    // Trailing filler words abschneiden
    name = name
      .replace(
        /\s+(kannst|könntest|koenntest|bitte|navigier|bring|führ|fuehr|oder|und).*$/iu,
        '',
      )
      .trim();
    if (name.length < 2) continue;
    if (/^(hotel|pension|hostel)$/i.test(name)) continue;
    if (!/^hotel\b/i.test(name) && !/^pension\b/i.test(name)) {
      name = `Hotel ${name}`;
    }
    return name;
  }
  return null;
}

function extractPlaceQuery(text: string): string | null {
  const m =
    text.match(
      /\b(?:zum|zur|zu\s+dem|zu\s+der|noch\s*mal\s+(?:zum|zur)|wieder\s+(?:zum|zur))\s+(.+?)(?:\s+navig|$|\?)/iu,
    ) ||
    text.match(
      /\b(?:burgerladen|café|cafe|restaurant|pizzeria|bäckerei|baeckerei|imbiss|spot|laden)\b[^.]{0,40}/iu,
    );
  if (!m) return null;
  return (m[1] ?? m[0]).replace(/\s+/g, ' ').trim().slice(0, 60);
}

async function resolvePoiCoords(
  entity: UserEntity,
): Promise<{ lat: number; lng: number; poiId?: number } | null> {
  if (entity.lat != null && entity.lng != null) {
    return { lat: entity.lat, lng: entity.lng, poiId: entity.poiId };
  }
  if (entity.poiId != null) {
    const pois = await getAllPois();
    const poi = pois.find((p) => p.id === entity.poiId);
    if (poi) return { lat: poi.lat, lng: poi.lng, poiId: poi.id };
  }
  const pois = await getAllPois();
  const q = entity.name.toLowerCase().replace(/^hotel\s+/i, '');
  const hit = pois.find((p) => {
    const n = p.name.toLowerCase();
    return n.includes(q) || q.includes(n.replace(/^hotel\s+/i, ''));
  });
  if (hit) return { lat: hit.lat, lng: hit.lng, poiId: hit.id };
  return null;
}

async function navigateToEntity(entity: UserEntity): Promise<boolean> {
  if (entity.poiId != null) {
    const ok = await startNavigation(entity.poiId);
    if (ok) return true;
  }
  const coords = await resolvePoiCoords(entity);
  if (!coords) return false;
  return startNavigationToCoords({
    name: entity.name,
    lat: coords.lat,
    lng: coords.lng,
    poiId: coords.poiId,
  });
}

async function findHotelPoiByName(name: string): Promise<Poi | null> {
  const pois = await getAllPois();
  const q = name.toLowerCase().replace(/^hotel\s+/i, '').trim();
  let best: Poi | null = null;
  for (const poi of pois) {
    const tags = parseTagsJson(poi.tags_json).join(' ').toLowerCase();
    const blob = `${poi.name} ${poi.category ?? ''} ${tags}`.toLowerCase();
    const isHotel = /(hotel|pension|unterkunft|hostel)/i.test(blob);
    if (!isHotel && !poi.name.toLowerCase().includes('hotel')) continue;
    const n = poi.name.toLowerCase().replace(/^hotel\s+/i, '');
    if (n.includes(q) || q.includes(n) || blob.includes(q)) {
      best = poi;
      break;
    }
  }
  return best;
}

function formatDaySummary(entities: UserEntity[]): string {
  if (!entities.length) {
    return 'Dazu hab ich noch keine Stops im Gedächtnis — sobald wir irgendwo länger stehen bleiben, merk ich mir das.';
  }
  const parts = entities.slice(0, 8).map((e) => {
    const when = e.visitedAt
      ? e.visitedAt.slice(11, 16)
      : '';
    const dwell =
      e.dwellTimeMinutes != null ? ` (${e.dwellTimeMinutes} Min.)` : '';
    return when ? `${e.name} gegen ${when}${dwell}` : `${e.name}${dwell}`;
  });
  if (parts.length === 1) {
    return `Aus dem Gedächtnis: Wir waren bei ${parts[0]}.`;
  }
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).join(', ');
  return `Schau mal, das hab ich mir gemerkt: ${head} und ${last}.`;
}

type LearnedPreferenceHit = {
  learnedFact: string;
  reply: string;
  dietaryRestriction?: string;
  dislike?: string;
  toneStyle?: 'ernst' | 'kumpelhaft' | 'sarkastisch' | 'maerchen';
  experiencePref?: { key: string; value: 'yes' | 'no' | 'neutral' };
  storyDepth?: 'short' | 'normal' | 'long';
};

/**
 * Erkennt spontane Präferenz-Aussagen und speichert sie im Profil.
 */
export function detectLearnedPreference(
  text: string,
): LearnedPreferenceHit | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 6) return null;

  if (
    /\b(ich\s+bin\s+(übrigens\s+)?(ein\s+)?vegetarier|bin\s+vegetarier|esse\s+kein\s+fleisch|kein\s+fleisch\s+bitte|nur\s+noch\s+vegetarisch)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Ist Vegetarier',
      dietaryRestriction: 'vegetarisch',
      experiencePref: { key: 'vegetarisch', value: 'yes' },
      reply:
        'Oh, alles klar! Hab ich mir gemerkt — ab jetzt nur noch vegetarische Spots.',
    };
  }

  if (
    /\b(ich\s+bin\s+(übrigens\s+)?(ein\s+)?veganer|bin\s+vegan|esse\s+vegan|nur\s+vegan)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Ist Veganer',
      dietaryRestriction: 'vegan',
      experiencePref: { key: 'vegan', value: 'yes' },
      reply:
        'Super, notiert — ab jetzt halte ich mich an vegane Empfehlungen.',
    };
  }

  if (
    /\b(ich\s+mag\s+(gar\s+)?keinen?\s+fisch|esse\s+keinen?\s+fisch|kein\s+fisch\s+bitte|ohne\s+fisch)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Mag keinen Fisch',
      dietaryRestriction: 'kein Fisch',
      experiencePref: { key: 'fisch', value: 'no' },
      reply:
        'Alles klar — Fisch-Spots lasse ich ab jetzt weg.',
    };
  }

  if (
    /\b(ich\s+mag\s+(gar\s+)?keine\s+kirchen|keine\s+kirchen\s+bitte|kirche[n]?\s+(interessiert|interessieren)\s+mich\s+nicht|skip\s+kirchen)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Mag keine Kirchen',
      dislike: 'keine Kirchen',
      experiencePref: { key: 'kirchen', value: 'no' },
      reply:
        'Verstehe — Kirchen halte ich ab jetzt kurz oder lasse sie aus.',
    };
  }

  if (
    /\b(ich\s+(sitze\s+)?im\s+rollstuhl|bin\s+im\s+rollstuhl|brauche\s+barrierefrei|nur\s+stufenfrei)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Rollstuhl / braucht stufenfreie Wege',
      reply:
        'Alles klar — ich bleibe bei stufenfreien Wegen und zugänglichen Orten.',
    };
  }

  if (
    /\b(ich\s+bin\s+schwanger|wir\s+sind\s+schwanger|kurze\s+wege\s+bitte|keine\s+langen\s+(fuß|fuss)?wege)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Braucht kurze Wege / Pausen',
      dislike: 'keine langen Fußwege',
      reply:
        'Notiert — ich halte die Wege kurz und plane Pausen mit ein.',
    };
  }

  if (
    /\b(weniger\s+geschichte|kürzer\s+erzähl|kuerzer\s+erzähl|weniger\s+details|kürzere\s+stories|mach\s+es\s+kürzer|story\s+kürzer)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Will kürzere Geschichten',
      experiencePref: { key: 'geschichte_kurz', value: 'yes' },
      storyDepth: 'short',
      reply:
        'Alles klar — ab jetzt halte ich die Stories kurz und knackig.',
    };
  }

  if (
    /\b(mehr\s+geschichte|ausführlicher|ausfuehrlicher|mehr\s+details|längere\s+stories|laengere\s+stories|erzähl\s+mehr|erzaehl\s+mehr|mehr\s+history)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Will längere Geschichten',
      experiencePref: { key: 'geschichte_lang', value: 'yes' },
      storyDepth: 'long',
      reply:
        'Passt — ich packe ab jetzt mehr Geschichte und Kontext rein.',
    };
  }

  if (
    /\b(keine\s+jahreszahlen|ohne\s+jahreszahlen|jahreszahlen\s+(nerv|langweilig)|weniger\s+geschichte)\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact: 'Will keine Jahreszahlen',
      dislike: 'keine Jahreszahlen',
      experiencePref: { key: 'jahreszahlen', value: 'no' },
      reply:
        'Alles klar — ich erzähl die Geschichten ohne Zahlenwüste.',
    };
  }

  // Soft: „nicht Kumpel/Bro“ → Middleware (kein harter toneStyle='ernst')
  // Hier nur Fallback wenn Middleware noch nicht lief — ohne steife Verbote
  if (
    /\b(nenn\s+mich\s+nicht\s+(so\s+)?(?:kumpel|bro)|nicht\s+(mehr\s+)?(?:kumpel|bro)|kein\s+(?:kumpel|bro)|ohne\s+(?:kumpel|bro))\b/iu.test(
      t,
    )
  ) {
    return {
      learnedFact:
        'Anrede: Slang (Bro/Kumpel) nur extrem sparsam und nur wenn 100% natürlich — Kumpel-Tonality behalten. Wenn unsicher: „Hey, wie soll ich dich eigentlich am liebsten nennen?“',
      reply:
        'Alles klar — ich bleib locker, halte mich mit Bro/Kumpel zurück und frag nach, wenn ich unsicher bin.',
    };
  }

  const merkDir = t.match(
    /\b(?:merk\s+dir|bitte\s+merken|nicht\s+vergessen)[,:]?\s+(.{4,120})$/iu,
  );
  if (merkDir?.[1]) {
    const fact = merkDir[1]
      .replace(/\s*(bitte|danke|ok)\s*$/iu, '')
      .trim();
    if (fact.length >= 4 && fact.length <= 120) {
      return {
        learnedFact: fact.charAt(0).toUpperCase() + fact.slice(1),
        reply: `Hab ich mir gemerkt: ${fact}.`,
      };
    }
  }

  if (
    /\b(ich\s+mag\s+nicht|ich\s+will\s+nicht|bitte\s+nicht)\s+wenn\s+du\b/iu.test(
      t,
    )
  ) {
    const cleaned = t
      .replace(/^.*?\b(wenn\s+du)\s+/iu, '')
      .replace(/\s*(bitte|danke)\s*$/iu, '')
      .trim();
    if (cleaned.length >= 4) {
      const fact =
        cleaned.charAt(0).toUpperCase() + cleaned.slice(1).slice(0, 100);
      return {
        learnedFact: `Mag nicht: ${fact}`,
        reply: `Verstanden — ${fact.charAt(0).toLowerCase() + fact.slice(1)}.`,
      };
    }
  }

  return null;
}

/**
 * Hotel-Bestätigung / Namensnennung / History / Präferenz-Lernen — vor dem LLM.
 */
export async function handleMemoryIntent(
  rawText: string,
): Promise<IntentResult> {
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) return { handled: false };

  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;

  // ── Preference Middleware + Multi-Intent Fan-out (Prefs zuerst) ──
  {
    const { runMultiIntentPreferenceFanout } = await import(
      './planning/multiIntentFanout'
    );
    const fan = await runMultiIntentPreferenceFanout(text);
    if (fan.onlyPreferences) {
      return {
        handled: true,
        profileUpdated: true,
        reply:
          fan.replyHint ??
          'Alles klar — hab ich mir gemerkt.',
      };
    }
    // Prefs gemerkt, aber weiterer Intent im Satz → mit Rest weiter
    if (fan.prefs.length && fan.remainingText && fan.remainingText !== text) {
      return handleMemoryIntent(fan.remainingText);
    }
  }

  // Explicit travel mode: „Ich bin mit dem Fahrrad unterwegs“ → sticky + 10-min recheck
  const modeOverride = detectTravelModeVoiceOverride(text);
  if (modeOverride) {
    setPreferredTravelMode(modeOverride);
    const label = modeOverride === 'bike' ? 'Fahrrad' : 'zu Fuß';
    // If the utterance is ONLY a mode claim, acknowledge; otherwise continue intents
    if (
      /^\s*(hey\s+)?(findus[,.]?\s+)?(ich\s+bin\s+)?(mit\s+dem\s+)?(fahrrad|rad|bike|e-?bike|e-?scooter|zu\s+fu[sß]|zu\s*fuss)\s*(unterwegs|unter\s*wegs)?[.!]?\s*$/iu.test(
        text,
      )
    ) {
      return {
        handled: true,
        reply:
          modeOverride === 'bike'
            ? 'Alles klar — ich navigiere dich per Rad. Nach zehn Minuten check ich kurz per GPS, ob du noch rollst.'
            : 'Alles klar — wir gehen zu Fuß weiter.',
      };
    }
    // Combined utterance (mode + destination): keep going with sticky mode set
    void label;
  }

  // ── Early: Notfall / Speisekarte / Planungsmodus / Tourist-Friction ──
  {
    const origin =
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : null;

    if (detectEmergencyIntent(text)) {
      const em = await handleEmergencyConcierge(text, origin);
      if (em.handled) {
        return {
          handled: true,
          reply: em.reply,
          startedNav: em.startedNav,
          concierge: em.concierge,
        };
      }
    }

    if (detectMenuTranslateIntent(text)) {
      const menu = await handleMenuTranslateIntent(text);
      if (menu.handled) {
        return { handled: true, reply: menu.reply };
      }
    }

    const frictionKind = detectTouristFrictionKind(text);
    if (
      frictionKind === 'right_way' ||
      frictionKind === 'wifi' ||
      frictionKind === 'water'
    ) {
      const friction = await handleTouristFrictionIntent(text, origin);
      if (friction.handled) {
        return { handled: true, reply: friction.reply };
      }
    }
  }

  // Clear / delete route (voice)
  if (isClearRouteIntent(text)) {
    await clearNavigationHard({ silent: true });
    return {
      handled: true,
      reply: 'Alles klar — Route ist gelöscht. Navigation idle.',
    };
  }

  // Nav-correction: „Nein, ich meinte wann das Frühstück ist“ — abort nav, fall through to answer
  if (
    isNavCorrectionIntent(text) &&
    (store.navActive || store.multiStopTour)
  ) {
    await clearNavigationHard({ silent: true });
    store.setPendingNavOffer(null);
    store.setPendingNavAlternatives([]);
    (globalThis as { __findusCorrectedQ?: string }).__findusCorrectedQ =
      extractCorrectedQuestion(text);
    return {
      handled: false,
      reply: undefined,
    };
  }

  // Pending hotel Yes/No must stay deterministic (before LLM)
  {
    const memEarly = useUserMemoryStore.getState();
    if (memEarly.pendingHotelConfirmId) {
      const id = memEarly.pendingHotelConfirmId;
      const candidate = memEarly.entities.find((e) => e.id === id);
      if (NEGATION.test(text)) {
        memEarly.setPendingHotelConfirm(null);
        memEarly.setAwaitingHotelName(true);
        takePendingChainedNav();
        return {
          handled: true,
          reply:
            'Alles gut — wie heißt dein Hotel? Dann merke ich mir das.',
        };
      }
      if (
        isNavAffirmation(text) ||
        /^(ja|jo|jap|genau|stimmt|richtig)\b/iu.test(text)
      ) {
        if (candidate) {
          memEarly.confirmEntity(id);
          memEarly.setPendingHotelConfirm(null);
          return {
            handled: true,
            reply: `Super — ${candidate.name} ist gespeichert.`,
          };
        }
      }
    }
  }

  // ── LLM ROUTER — übersprungen für Manager-Blaupausen (Kino/Grill/Essen/POI) ──
  {
    try {
      const { shouldSkipLegacyIntentSteal } = require('../module2/router/hotPathGuard') as {
        shouldSkipLegacyIntentSteal: (t: string) => boolean;
      };
      if (shouldSkipLegacyIntentSteal(text)) {
        return { handled: false };
      }
    } catch {
      /* soft */
    }
    let online = true;
    try {
      online = !(await isDeviceOffline());
    } catch {
      online = true;
    }
    if (online && hasGeminiApiKey() && text.length >= 4) {
      const routed = await routeUserUtteranceWithLlm(text);
      if (routed?.handled && routed.reply) {
        return {
          handled: true,
          reply: routed.reply,
          startedNav: routed.startedNav,
          concierge: routed.concierge,
        };
      }
      // question / clarify → Concierge (named go-to gets confirm + Route starten there)
      if (routed?.fallThroughQuestion) {
        return { handled: false };
      } else if (routed == null && looksLikeMultiGoalSpeech(text)) {
        // Retry compound parser directly once
        const parsed = await parseCompoundPlanWithGemini(text, {
          placeHint: store.currentLocationName ?? null,
        });
        if (parsed?.isCompound) {
          const activated = activateCompoundSessionPlan(parsed);
          if (activated) {
            return { handled: true, reply: activated.reply };
          }
        }
        // Do NOT fall into restaurant-keyword discovery
        return { handled: false };
      }
    }
  }

  // POI_INFO: never start multi-stop / hard-nav / discovery-as-nav from fact questions
  const infoOnly = isPoiInfoQuestion(text);

  // Hotel-Errand: „Erinner mich, wenn ich im Hotel bin, Powerbank zu laden“
  {
    const mem = useUserMemoryStore.getState();
    const hotel =
      mem.getConfirmedHotel() ??
      mem.getHotelCandidate() ??
      mem.entities.find((e) => e.type === 'hotel');
    const hasCoords =
      hotel != null &&
      typeof hotel.lat === 'number' &&
      typeof hotel.lng === 'number' &&
      Number.isFinite(hotel.lat) &&
      Number.isFinite(hotel.lng);
    const hotelIntent = detectHotelTaskIntent(text, {
      hasHotelWithCoords: hasCoords,
      hotelName: hotel?.name ?? null,
    });
    if (hotelIntent) {
      const first = useShoppingTaskStore.getState().addTask({
        itemLabel: hotelIntent.itemLabel,
        placeTypes: hotelIntent.placeTypes,
        anchor: 'hotel',
        dueAtMs: hotelIntent.dueAtMs,
      });
      if (hotelIntent.needsHotel && !hotel) {
        mem.setAwaitingHotelName(true);
      }
      const follow = detectFollowUpBuyIntent(text);
      let reply = hotelIntent.reply;
      if (follow) {
        useShoppingTaskStore.getState().addTask({
          itemLabel: follow.itemLabel,
          placeTypes: follow.placeTypes,
          anchor: 'store',
          dueAtMs: follow.dueAtMs,
          dependsOnTaskId: first.id,
        });
        reply += ` Danach ${follow.itemLabel} — aber erst wenn ${hotelIntent.itemLabel} erledigt ist.`;
      }
      return { handled: true, reply };
    }
  }

  // Shopping / Errand: „Ich muss noch eine Zahnbürste kaufen“
  const shopIntent = detectShoppingTaskIntent(text);
  if (shopIntent) {
    useShoppingTaskStore.getState().addTask({
      itemLabel: shopIntent.itemLabel,
      placeTypes: shopIntent.placeTypes,
      anchor: shopIntent.anchor,
      dueAtMs: shopIntent.dueAtMs,
    });
    return { handled: true, reply: shopIntent.reply };
  }

  // Shopping done: „Hab die Zahnbürste gekauft“ / „erledigt“
  const shopDone = detectShoppingTaskDoneIntent(text);
  if (shopDone) {
    const open = useShoppingTaskStore.getState().getOpenTasks();
    if (open.length > 0) {
      let match = open[0];
      if (shopDone.itemHint) {
        const hint = shopDone.itemHint.toLowerCase();
        match =
          open.find((t) => t.itemLabel.toLowerCase().includes(hint)) ??
          open.find((t) => hint.includes(t.itemLabel.toLowerCase())) ??
          match;
      }
      if (match) {
        useShoppingTaskStore.getState().completeTask(match.id);
        useFinnusStore.getState().setActiveConciergeCard(null);
        return {
          handled: true,
          reply: `Super — ${match.itemLabel} ist erledigt, Erinnerung weg.`,
        };
      }
    }
  }

  // Hard override: explicit new destination wipes queue
  const hardDest = infoOnly ? null : detectHardNavOverride(text);
  if (hardDest && (store.navActive || store.multiStopTour)) {
    const result = await hardOverrideNavigationTo(hardDest);
    return {
      handled: true,
      startedNav: result.ok,
      reply: result.reply,
    };
  }
  // Hard override even without active nav (= direct start)
  // Exception: named gastro → Concierge (confirm + Route starten + Tisch/Speisekarte)
  if (hardDest && !detectChainedNavIntent(text)) {
    const gastroNamed =
      /\b(restaurant|café|cafe|bistro|imbiss)\b/iu.test(text) ||
      /\b(tisch|reservier|speisekarte)\b/iu.test(text);
    if (!gastroNamed) {
      const result = await hardOverrideNavigationTo(hardDest);
      return {
        handled: true,
        startedNav: result.ok,
        reply: result.reply,
      };
    }
    // fall through → Concierge path in voice input
  }

  // Multi-Stop-Kette: „zurück zum Hotel, vorher noch zu Aldi“
  const chained = infoOnly ? null : detectChainedNavIntent(text);
  if (chained) {
    const result = await planAndStartChainedNav(chained);
    return {
      handled: true,
      startedNav: result.ok,
      reply: result.reply,
    };
  }

  // Contextual POI discovery (free-roam or on-the-way with active route)
  const discovery = infoOnly ? null : detectDiscoveryIntent(text);
  if (discovery) {
    if (lat == null || lng == null) {
      return {
        handled: true,
        reply:
          'Ich brauche kurz deinen Standort — GPS an, dann suche ich voraus.',
      };
    }
    const result = await runContextualDiscovery({
      placeType: discovery.type,
      label: discovery.label,
      origin: { lat, lng },
      headingDeg: getDeviceHeadingDeg(),
      movementBearingDeg: getMovementBearingDeg(),
      emergency: discovery.emergency,
    });
    presentDiscoveryAsConcierge(result);
    return {
      handled: true,
      reply: result.speech,
      startedNav: result.autoInserted,
    };
  }

  // Multistopp: Joggen / Erkunden / Frühstück-Route
  const multiIntent = infoOnly ? null : detectMultiStopIntent(text);
  if (multiIntent) {
    if (lat == null || lng == null) {
      return {
        handled: true,
        reply:
          'Ich brauche kurz deinen Standort — GPS an, dann plane ich die Route.',
      };
    }
    if (multiIntent.needsParams) {
      return {
        handled: true,
        reply: CIRCUIT_PROMPT,
      };
    }
    const tour = await planMultiStopTour(multiIntent, { lat, lng });
    if (!tour) {
      return {
        handled: true,
        reply:
          'Ich finde gerade zu wenig passende Orte für so eine Tour. Versuch’s mit „Ort erkunden“ oder einem konkreten Ziel.',
      };
    }
    const started = await startMultiStopTour(tour);
    return {
      handled: true,
      startedNav: started.ok,
      reply: started.reply,
    };
  }

  // Tour abbrechen
  if (
    /\b(tour\s+(abbrechen|stopp|beenden)|stopp\s+die\s+tour|keine\s+tour\s+mehr)\b/iu.test(
      text,
    )
  ) {
    clearMultiStopTour();
    return {
      handled: true,
      reply: 'Alles klar — Multistopp-Tour ist beendet.',
    };
  }

  // 0) Live-Präferenzen („Ich bin Vegetarier“ …)
  const learned = detectLearnedPreference(text);
  if (learned) {
    const profileStore = useUserProfileStore.getState();
    const base = profileStore.profile;
    const tonalities = [...(base?.tonalities ?? [])];
    if (learned.toneStyle === 'ernst') {
      const idx = tonalities.indexOf('kumpelhaft');
      if (idx >= 0) tonalities[idx] = 'ernst';
      else if (!tonalities.includes('ernst')) tonalities.push('ernst');
    }

    await profileStore.applyPreferencePatch({
      learnedFact: learned.learnedFact,
      dietaryRestriction: learned.dietaryRestriction,
      dislike: learned.dislike,
      experiencePref: learned.experiencePref,
      toneStyle: learned.toneStyle,
      tonalities: learned.toneStyle ? tonalities : undefined,
      storyDepth: learned.storyDepth,
    });
    // Rollstuhl / Schwanger auch in accessibility-Array spiegeln
    if (/rollstuhl/i.test(learned.learnedFact)) {
      const p = useUserProfileStore.getState().profile;
      if (p && !p.accessibility.includes('rollstuhl')) {
        await useUserProfileStore.getState().patchProfile({
          accessibility: [...p.accessibility, 'rollstuhl'],
        });
      }
    }
    if (/schwanger|kurze wege/i.test(learned.learnedFact)) {
      const p = useUserProfileStore.getState().profile;
      if (p && !p.accessibility.includes('schwanger') && /schwanger/i.test(text)) {
        await useUserProfileStore.getState().patchProfile({
          accessibility: [...p.accessibility, 'schwanger'],
        });
      }
    }
    return {
      handled: true,
      profileUpdated: true,
      reply: learned.reply,
    };
  }

  const mem = useUserMemoryStore.getState();

  // 1) Warte auf Hotel-Namen nach "Nein"
  if (mem.awaitingHotelName) {
    // Never trap shopping / multi-goal / fact questions as hotel names
    const skipNameTrap =
      (isPoiInfoQuestion(text) && !extractHotelName(text)) ||
      looksLikeMultiGoalSpeech(text) ||
      /\b(?:zahnbürste|zahnbuerste|cola|bier|wasser|einkauf|kaufen|supermarkt|brauch)\b/iu.test(
        text,
      );
    if (!skipNameTrap) {
      const named = extractHotelName(text);
      // Only accept explicit hotel naming — never raw shopping fragments
      if (!named) {
        // Don't block — let LLM / Gemini answer
        return { handled: false };
      }
      const poi = await findHotelPoiByName(named);
      const entity = mem.addOrUpdateEntity({
        type: 'hotel',
        name: named,
        isConfirmed: true,
        poiId: poi?.id,
        lat: poi?.lat,
        lng: poi?.lng,
        visitedAt: new Date().toISOString(),
      });
      mem.setAwaitingHotelName(false);
      mem.setPendingHotelConfirm(null);
      const pendingChain = takePendingChainedNav();
      if (pendingChain && !isPoiInfoQuestion(text)) {
        const chained = await planAndStartChainedNav({
          ...pendingChain,
          finalIsHotel: true,
          finalLabel: 'Hotel',
        });
        return {
          handled: true,
          startedNav: chained.ok,
          reply: chained.ok
            ? chained.reply
            : `Alles klar, ${entity.name} ist gespeichert. ${chained.reply}`,
        };
      }
      // Fact question while naming hotel → save only, do NOT navigate
      if (isPoiInfoQuestion(text) || !isExplicitNavIntent(text)) {
        return {
          handled: false,
        };
      }
      const ok = await navigateToEntity(entity);
      return {
        handled: true,
        startedNav: ok,
        reply: ok
          ? `Alles klar, ${entity.name} ist gespeichert — ich führ dich hin.`
          : `Ich merk mir ${entity.name}. Die genaue Position hab ich noch nicht — sobald wir dort sind, fixiere ich sie.`,
      };
    }
  }

  // 2) Ja/Nein auf Hotel-Kandidaten-Frage
  if (mem.pendingHotelConfirmId) {
    const id = mem.pendingHotelConfirmId;
    const candidate = mem.entities.find((e) => e.id === id);
    if (NEGATION.test(text)) {
      mem.setPendingHotelConfirm(null);
      mem.setAwaitingHotelName(true);
      takePendingChainedNav(); // drop chain — user will restate
      return {
        handled: true,
        reply: 'Alles gut. Wie heißt dein Hotel? Dann merke ich mir das direkt!',
      };
    }
    if (isNavAffirmation(text) || /^(ja|jo|jap|genau|stimmt|richtig)\b/iu.test(text)) {
      if (candidate) {
        mem.confirmEntity(id);
        const pendingChain = takePendingChainedNav();
        if (pendingChain) {
          const chained = await planAndStartChainedNav({
            ...pendingChain,
            finalIsHotel: true,
            finalLabel: 'Hotel',
          });
          return {
            handled: true,
            startedNav: chained.ok,
            reply: chained.ok
              ? chained.reply
              : `Super — ${candidate.name} ist dein Hotel. ${chained.reply}`,
          };
        }
        const wantsNav =
          /\b(navigier|bring|führ|fuehr|zurück|zurueck|hin|los)\b/iu.test(text);
        if (wantsNav) {
          const ok = await navigateToEntity(candidate);
          return {
            handled: true,
            startedNav: ok,
            reply: ok
              ? `Super — ${candidate.name} ist dein Hotel. Ich führ dich hin.`
              : `${candidate.name} ist gespeichert. Route krieg ich gerade nicht hin.`,
          };
        }
        return {
          handled: true,
          reply: `Super — ${candidate.name} ist jetzt dein Hotel. Merk ich mir.`,
        };
      }
    }
  }

  // 3) Explizite Hotel-Nennung ("Ich bin im Hotel Bluezeit…")
  const mentionedHotel = extractHotelName(text);
  const isHotelIam = HOTEL_IAM.test(text) || (mentionedHotel && HOTEL_NAV.test(text));
  if (mentionedHotel && (isHotelIam || HOTEL_NAV.test(text) || HOTEL_IAM.test(text))) {
    const poi = await findHotelPoiByName(mentionedHotel);
    const entity = mem.addOrUpdateEntity({
      type: 'hotel',
      name: mentionedHotel,
      isConfirmed: true,
      poiId: poi?.id,
      lat: poi?.lat,
      lng: poi?.lng,
      visitedAt: new Date().toISOString(),
    });
    mem.setPendingHotelConfirm(null);
    mem.setAwaitingHotelName(false);

    const wantsNav =
      HOTEL_NAV.test(text) ||
      /\b(navigier|bring|führ|fuehr|zeig|hin)\b/iu.test(text);
    if (wantsNav) {
      const ok = await navigateToEntity(entity);
      return {
        handled: true,
        startedNav: ok,
        reply: ok
          ? `Alles klar — ${entity.name} ist gespeichert. Ich führ dich hin.`
          : `${entity.name} hab ich mir gemerkt. Die Navigation klappt noch nicht, weil mir die Koordinaten fehlen.`,
      };
    }
    return {
      handled: true,
      reply: `Notiert — ${entity.name} ist jetzt dein Hotel.`,
    };
  }

  // 4) Generisches "Bring mich zum Hotel"
  if (HOTEL_NAV.test(text) && !looksLikeMultiGoalSpeech(text)) {
    const confirmed = mem.getConfirmedHotel();
    if (confirmed) {
      const ok = await navigateToEntity(confirmed);
      return {
        handled: true,
        startedNav: ok,
        reply: ok
          ? `Alles klar, ich führe dich zurück zum ${confirmed.name}.`
          : `${confirmed.name} hab ich — die Route baut gerade nicht. Wir versuchen’s gleich nochmal oder du nennst mir die Adresse.`,
      };
    }

    const candidate =
      mem.getHotelCandidate() ||
      mem.entities.filter((e) => e.type === 'hotel').slice(-1)[0];
    if (candidate) {
      mem.setPendingHotelConfirm(candidate.id);
      return {
        handled: true,
        reply: `Ich habe noch ${candidate.name} gespeichert — ist das dein Hotel?`,
      };
    }

    mem.setAwaitingHotelName(true);
    return {
      handled: true,
      reply:
        'Welches Hotel meinst du? Sag mir den Namen — dann merke ich ihn mir und führ dich hin.',
    };
  }

  // 5) Tages-Rückblick
  if (DAY_RECALL.test(text)) {
    let sinceIso: string | undefined;
    if (/ersten\s+tag|erster\s+tag/i.test(text)) {
      // grob: letzte 36h rückwärts vom ältesten Cluster — einfach alle Entities
      const all = mem.findEntities({});
      if (all.length) {
        const oldest = [...all]
          .filter((e) => e.visitedAt)
          .sort(
            (a, b) =>
              Date.parse(a.visitedAt!) - Date.parse(b.visitedAt!),
          )[0];
        if (oldest?.visitedAt) {
          const dayStart = new Date(oldest.visitedAt);
          dayStart.setHours(0, 0, 0, 0);
          sinceIso = dayStart.toISOString();
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          const dayEntities = all.filter((e) => {
            if (!e.visitedAt) return false;
            const t = Date.parse(e.visitedAt);
            return t >= dayStart.getTime() && t < dayEnd.getTime();
          });
          return {
            handled: true,
            reply: formatDaySummary(dayEntities),
          };
        }
      }
    }
    if (/gestern/i.test(text)) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      sinceIso = d.toISOString();
    }
    const list = mem.findEntities({ sinceIso });
    return { handled: true, reply: formatDaySummary(list) };
  }

  // 6) Zurück zu Restaurant / Spot von gestern
  if (HISTORY_NAV.test(text)) {
    const q = extractPlaceQuery(text);
    const typeHint: UserEntityType | undefined = /burger|restaurant|café|cafe|pizzeria|imbiss|essen/i.test(
      text,
    )
      ? 'restaurant'
      : undefined;

    let matches = mem.findEntities({
      type: typeHint,
      nameQuery: q ?? undefined,
      sinceIso: /gestern/i.test(text)
        ? (() => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            d.setHours(0, 0, 0, 0);
            return d.toISOString();
          })()
        : undefined,
    });

    if (!matches.length && (q || typeHint)) {
      matches = mem.findEntities({
        type: typeHint,
        nameQuery: q ?? (typeHint === 'restaurant' ? 'burger' : undefined),
      });
    }

    // Fallback: recent restaurants
    if (!matches.length && /burger|restaurant|café|cafe|essen/i.test(text)) {
      matches = mem.findEntities({ type: 'restaurant' });
    }

    const target = matches[0];
    if (!target) return { handled: false };

    const ok = await navigateToEntity(target);
    return {
      handled: true,
      startedNav: ok,
      reply: ok
        ? `Klar — ich bring dich nochmal zum ${target.name}.`
        : `${target.name} kenn ich aus dem Gedächtnis, aber die Koordinaten fehlen mir noch.`,
    };
  }

  // 7) Stadt-POI: „Wo ist der Bahnhof?“ → Navigation starten
  const cityNav = await handleCityPoiNavigation(text);
  if (cityNav) return cityNav;

  return { handled: false };
}

/** Debug / Tests */
export function __testExtractHotelName(text: string): string | null {
  return extractHotelName(text);
}

export function distanceToEntityMeters(
  lat: number,
  lng: number,
  entity: UserEntity,
): number | null {
  if (entity.lat == null || entity.lng == null) return null;
  return haversineMeters(lat, lng, entity.lat, entity.lng);
}
