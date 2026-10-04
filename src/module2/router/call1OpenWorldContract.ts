/**
 * Call-1 Open-World Vertrag — SSOT Ideal-Refresh.
 * Toolbox, kein Intent-Whitelist-Käfig. Novel → work[] + deep_web.
 */

import { peekBulletUiBudget } from '../reboot/pipeline/bulletUiBudget';
import { looksLikeAyceQuery, normalizeAyceStt } from '../pitch/ayceIntent';
import type { MissionChecklist } from '../mission/missionContract';
import { formatMissionChecklistForPrompt } from '../mission/missionContract';
import { buildMissionChecklist } from '../mission/buildMissionChecklist';

export type Call1SearchStage =
  | 'pack'
  | 'neighbor'
  | 'metro'
  | 'web'
  | 'verify'
  | 'learn';

export type Call1SearchPlan = {
  stages: Call1SearchStage[];
  /** Specialty lokal leer → Expand bis ~100 km */
  maxRadiusKm: number;
  preferDeepWebOnNovel: boolean;
};

export type Call1StopPolicy = {
  mode: 'until_evidence' | 'budget_only' | 'ask_back';
  budgetSec: number;
  /** Soft-Fill gegen hard musts verboten */
  forbidSoftFillOnMust: boolean;
};

export type Call1UiRequirements = {
  needMenuUrl: boolean;
  showPriceInBullets: boolean;
  needTicket: boolean;
  needMaps: boolean;
  needBookingLink: boolean;
  openCalendar: boolean;
  maxBullets: number;
  bulletMaxLines: 2;
  bulletMaxChars: number;
};

export type Call1OpenWorldContract = {
  authorIntent: string;
  answerSlot: string | null;
  bridgeIntentMirror: string | null;
  must: string[];
  avoid: string[];
  searchPlan: Call1SearchPlan;
  stopPolicy: Call1StopPolicy;
  verifyConstraints: string[];
  uiRequirements: Call1UiRequirements;
  /** Novel / unbekannte Absicht → deep_web Pflicht */
  novelRequiresDeepWeb: boolean;
  /** Phase-1 Mission-Board: factsToProve + Ask-Back nur bei Blockern */
  mission: MissionChecklist;
};

const DEFAULT_STAGES: Call1SearchStage[] = [
  'pack',
  'neighbor',
  'metro',
  'web',
  'verify',
  'learn',
];

export function defaultUiRequirements(
  overrides?: Partial<Call1UiRequirements>,
): Call1UiRequirements {
  const budget = peekBulletUiBudget();
  return {
    needMenuUrl: false,
    showPriceInBullets: false,
    needTicket: false,
    needMaps: true,
    needBookingLink: false,
    openCalendar: false,
    maxBullets: budget.bulletCount || 3,
    bulletMaxLines: 2,
    bulletMaxChars: budget.bulletMaxChars || 56,
    ...overrides,
  };
}

export function inferAnswerSlot(userText: string): string | null {
  const t = normalizeAyceStt(userText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  // Wetter + Aktivitäts-Absicht → Compound (nicht nur rain/temperature)
  try {
    const {
      classifyIntentForesight,
    } = require('./call1IntentForesight') as {
      classifyIntentForesight: (
        s: string,
      ) => 'closed_fact' | 'slot_weather' | 'activity_weather' | 'day_plan_outdoor' | null;
    };
    const fs = classifyIntentForesight(t);
    if (fs === 'activity_weather' || fs === 'day_plan_outdoor') {
      return 'activity_weather';
    }
    if (fs === 'closed_fact') return 'fact';
    if (fs === 'slot_weather') {
      if (/\b(temperatur|wie\s+warm|grad|wie\s+kalt)\b/iu.test(t)) {
        return 'temperature';
      }
      if (/\b(regen|regnet|niederschlag)\b/iu.test(t)) return 'rain';
      return 'weather';
    }
  } catch {
    /* soft */
  }
  if (/\b(regen|regnet|niederschlag)\b/iu.test(t)) return 'rain';
  if (/\b(temperatur|wie\s+warm|grad)\b/iu.test(t)) return 'temperature';
  try {
    const { classifyTouristInvent } = require('./call1TouristInvent') as {
      classifyTouristInvent: (
        s: string,
      ) =>
        | 'emergency'
        | 'safety_lost'
        | 'friction'
        | 'sim_data'
        | 'luggage'
        | 'fx_cash'
        | 'booking_reserve'
        | 'tickets'
        | 'nightlife'
        | 'sports_fixture'
        | null;
    };
    const ti = classifyTouristInvent(t);
    if (ti === 'sim_data') return 'sim_data';
    if (ti === 'luggage') return 'luggage';
    if (ti === 'fx_cash') return 'fx_cash';
    if (ti === 'tickets') return 'tickets';
    if (ti === 'booking_reserve') return 'booking';
    if (ti === 'nightlife') return 'nightlife';
    if (ti === 'sports_fixture') return 'tickets';
    if (ti === 'safety_lost' || ti === 'emergency') return 'venue_pitch';
    if (ti === 'friction') return 'venue_pitch';
  } catch {
    /* soft */
  }
  if (/\b(preis|kostet|eintritt|ticket)\b/iu.test(t)) return 'price';
  if (/\b(eta|wie\s+lange|fahrzeit|minuten)\b/iu.test(t)) return 'eta';
  if (looksLikeAyceQuery(t) || /\b(restaurant|essen|speisekarte|lust\s+auf|bock\s+auf|lecker)\b/iu.test(t))
    return 'venue_pitch';
  try {
    const { looksLikeSpecialtyFoodAsk } = require('../pitch/specializedFoodMatch') as {
      looksLikeSpecialtyFoodAsk: (s: string) => boolean;
    };
    if (
      looksLikeSpecialtyFoodAsk(t) ||
      /\b(spaghettieis|spaghetti[\s-]?eis|eisdiele|gelato|croque)\b/iu.test(t)
    ) {
      return 'venue_pitch';
    }
  } catch {
    if (/\b(spaghettieis|spaghetti[\s-]?eis|eisdiele|gelato)\b/iu.test(t)) {
      return 'venue_pitch';
    }
  }
  if (/\b(hotel|übernacht|uebernacht)\b/iu.test(t)) return 'hotel';
  if (/\b(taxi|uber|bolt)\b/iu.test(t)) return 'taxi';
  if (/\b(hop[\s-]?on|hop[\s-]?off|pauschal)\b/iu.test(t)) return 'tickets';
  if (/\b(flug|fliegen|kiwi)\b/iu.test(t)) return 'flight';
  if (/\b(wecker|timer|erinner)\b/iu.test(t)) return 'timer';
  if (/\b(wie\s+alt|wie\s+hoch|wie\s+gro[sß]s|wer\s+ist|was\s+ist)\b/iu.test(t)) {
    return 'fact';
  }
  try {
    const { isOpenNeedQuery, isOpenExperienceQuery } = require('../mission/openPlaceFind') as {
      isOpenNeedQuery: (s: string) => boolean;
      isOpenExperienceQuery: (s: string) => boolean;
    };
    if (isOpenExperienceQuery(t) || isOpenNeedQuery(t)) return 'venue_pitch';
  } catch {
    /* soft */
  }
  return null;
}

export function inferUiRequirements(userText: string): Call1UiRequirements {
  const t = normalizeAyceStt(userText || '')
    .replace(/\s+/g, ' ')
    .trim();
  let dining =
    looksLikeAyceQuery(t) ||
    /\b(essen|restaurant|speisekarte|menü|menu|dining|steak|döner|doener|lust\s+auf|bock\s+auf|lecker|bistro|café|cafe|bäckerei|baeckerei)\b/iu.test(
      t,
    );
  if (!dining) {
    try {
      const { looksLikeSpecialtyFoodAsk } = require('../pitch/specializedFoodMatch') as {
        looksLikeSpecialtyFoodAsk: (s: string) => boolean;
      };
      if (looksLikeSpecialtyFoodAsk(t)) dining = true;
    } catch {
      /* soft */
    }
  }
  const ticket =
    /\b(ticket|eintritt|hop[\s-]?on|hop[\s-]?off|buchen|buchung|tagesticket|tageskarte|museumsticket|eintrittskarte)\b/iu.test(
      t,
    );
  const price = /\b(preis|kostet|€|euro|wie\s+teuer)\b/iu.test(t) || dining;
  const hotel = /\b(hotel|übernacht|uebernacht|zimmer)\b/iu.test(t);
  const taxi = /\b(taxi|uber|bolt)\b/iu.test(t);
  const tourPlan =
    /\b(tagesplan|tour\s+planen|in\s+die\s+timeline|einplanen)\b/iu.test(t);
  const bookReserve =
    /\b(reservier|vorbestell|tisch\s+(?:für|fuer)|online\s+buchen)\b/iu.test(t);
  const esimOrLuggage =
    /\b(esim|e[\s-]?sim|roaming|sim[\s-]?karte|schließfach|schliessfach|gepäck|gepaeck|bounce)\b/iu.test(
      t,
    );
  let amenityPlace = false;
  try {
    const { isAmenityPlaceFindQuery } = require('../mission/amenityPlaceFind') as {
      isAmenityPlaceFindQuery: (s: string) => boolean;
    };
    amenityPlace = isAmenityPlaceFindQuery(t);
  } catch {
    amenityPlace = false;
  }

  return defaultUiRequirements({
    needMenuUrl: dining,
    showPriceInBullets: price || dining || ticket,
    needTicket: ticket,
    needMaps:
      dining ||
      hotel ||
      taxi ||
      amenityPlace ||
      bookReserve ||
      /\b(wo|hin|route|navigation|wechselstube)\b/iu.test(t),
    needBookingLink: hotel || ticket || taxi || bookReserve || esimOrLuggage,
    // Phase 8: Amenity single-place nie Calendar/Timeline erzwingen
    openCalendar: tourPlan && !amenityPlace,
  });
}

export function inferSearchPlan(userText: string): Call1SearchPlan {
  const t = normalizeAyceStt(userText || '');
  let specialtyFood = false;
  try {
    const { looksLikeSpecialtyFoodAsk } = require('../pitch/specializedFoodMatch') as {
      looksLikeSpecialtyFoodAsk: (s: string) => boolean;
    };
    specialtyFood =
      looksLikeSpecialtyFoodAsk(t) ||
      /\b(spaghettieis|spaghetti[\s-]?eis|eisdiele|gelato|croque)\b/iu.test(t);
  } catch {
    specialtyFood =
      /\b(spaghettieis|spaghetti[\s-]?eis|eisdiele|gelato|croque)\b/iu.test(t);
  }
  let openNeed = false;
  try {
    const { isOpenNeedQuery } = require('../mission/openPlaceFind') as {
      isOpenNeedQuery: (s: string) => boolean;
    };
    openNeed = isOpenNeedQuery(t);
  } catch {
    openNeed = false;
  }
  const specialty =
    looksLikeAyceQuery(t) ||
    specialtyFood ||
    openNeed ||
    /\b(döner|doener|museum|hop[\s-]?on|specialty|spezial|lust\s+auf|bock\s+auf|lecker)\b/iu.test(
      t,
    );
  // Open-World Default: jede echte Frage → Deep-Web wenn Pack dünn (kein Gold nötig)
  const trivialOnly =
    /\b(wetter|timer|wecker|navigation\s+stopp|stopp\s+nav|lautstärke|lautstaerke)\b/iu.test(
      t,
    ) && t.length < 80;
  const asksSomething =
    /\b(wo|wie|was|wer|wann|welch|gibt\s+es|finde|suche|zeig|brauch|möcht|moecht|will|kann|soll|überleg|ueberleg|geile|beste|nächste|naechste|flug|bahn|hotel|restaurant|kein\s+asiat)\b/iu.test(
      t,
    ) || t.length > 40;
  const novel =
    !trivialOnly &&
    (specialty ||
      openNeed ||
      asksSomething ||
      /\b(hop[\s-]?on|pauschal|unbekannt|noch\s+nie)\b/iu.test(t) ||
      t.length > 100);

  return {
    stages: [...DEFAULT_STAGES],
    maxRadiusKm: specialty || novel || openNeed ? 100 : 80,
    preferDeepWebOnNovel: novel || specialty || openNeed,
  };
}

export function inferStopPolicy(userText: string): Call1StopPolicy {
  const t = normalizeAyceStt(userText || '');
  let accessHard = false;
  try {
    const { looksLikeAccessibilityAsk } = require('./call1TouristConstraints') as {
      looksLikeAccessibilityAsk: (s: string) => boolean;
    };
    accessHard = looksLikeAccessibilityAsk(t);
  } catch {
    accessHard = /\b(barrierefrei|rollstuhl)\b/iu.test(t);
  }
  const hardMust =
    looksLikeAyceQuery(t) ||
    accessHard ||
    /\b(must|unbedingt|nur\s+mit|kein\s+asiatisch)\b/iu.test(t);
  return {
    mode: 'until_evidence',
    budgetSec: hardMust || t.length > 120 ? 60 : 45,
    forbidSoftFillOnMust: true,
  };
}

export function inferVerifyConstraints(userText: string): string[] {
  const t = (userText || '').replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  if (/\b(offen|jetzt|heute\s+abend|open\s*now)\b/iu.test(t)) out.push('openNow');
  if (/\b(zu\s+fuß|fuss|fußgänger|walk)\b/iu.test(t)) out.push('mode_walk');
  if (/\b(öpnv|bahn|bus|s-bahn|u-bahn)\b/iu.test(t)) out.push('mode_transit');
  if (/\b(fahrrad|rad|bike)\b/iu.test(t)) out.push('mode_bike');
  if (/\b(kein\s+asiatisch|nicht\s+asiatisch|ohne\s+asia)\b/iu.test(t))
    out.push('avoid_cuisine_asian');
  if (looksLikeAyceQuery(t)) out.push('must_ayce_evidence');
  if (/\b(barrierefrei|rollstuhl|wheelchair|stufenlos)\b/iu.test(t))
    out.push('barrier_free');
  if (/\b(wickelraum|wickeltisch|kinderwagen|stroller)\b/iu.test(t))
    out.push('family_access');
  if (/\b(reservier|vorbestell|ticket\s+buchen)\b/iu.test(t))
    out.push('booking_link');
  return out.slice(0, 8);
}

/** Follow-up: nur nötige Slots — kein Events-Leak / Chat-Dump. */
export function filterCuratedContextForWorkers(
  curated: string[],
  userText: string,
): string[] {
  const slot = inferAnswerSlot(userText);
  let dining =
    slot === 'venue_pitch' || looksLikeAyceQuery(userText || '');
  // Offenes Dining/AYCE-Inventar → auch kurzes Follow-up ohne Events-Leak
  if (!dining) {
    try {
      const { getLastLiveInventory } = require('../context/shortTermContext') as {
        getLastLiveInventory: () => { kind: string; query: string } | null;
      };
      const pending = getLastLiveInventory();
      if (
        pending?.kind === 'pitch_choice' &&
        (looksLikeAyceQuery(pending.query) ||
          /\b(essen|restaurant|speisekarte|ayce|buffet)\b/iu.test(pending.query))
      ) {
        dining = true;
      }
    } catch {
      /* soft */
    }
  }
  return (curated || [])
    .filter((line) => {
      const l = String(line || '');
      if (!l.trim()) return false;
      if (dining && /\b(event|party|konzert|nightlife|club)\b/iu.test(l)) {
        return false;
      }
      if (/\b(chat-dump|voller\s+thread|alte\s+historie)\b/iu.test(l)) {
        return false;
      }
      return true;
    })
    .slice(0, 6);
}

/**
 * Follow-up auf offenem Dining/AYCE-Pitch: Musts (all_you_can_eat, avoid Asia)
 * aus Live-Inventory erben — auch wenn der Folgesatz kurz ist („kein Asiatisch“).
 */
export function inheritDiningMustsFromLiveInventory(
  userText: string,
  mustIn: string[],
  avoidIn: string[],
): { must: string[]; avoid: string[] } {
  const must = [...mustIn];
  const avoid = [...avoidIn];
  try {
    const { getLastLiveInventory } = require('../context/shortTermContext') as {
      getLastLiveInventory: () => { kind: string; query: string } | null;
    };
    const pending = getLastLiveInventory();
    if (!pending || pending.kind !== 'pitch_choice') {
      return { must, avoid };
    }
    const q = normalizeAyceStt(pending.query || '');
    if (!q) return { must, avoid };
    const t = normalizeAyceStt(userText || '');
    // Nur erben wenn Follow-up / gleiches Dining-Thema (kein Topic-Cut zu Events/Flug)
    const topicCutAway =
      /\b(was\s+geht|konzert|party|flug|hotel\s+suchen|wetter)\b/iu.test(t) &&
      !looksLikeAyceQuery(t) &&
      !/\b(essen|restaurant|kein\s+asiat|buffet|ayce)\b/iu.test(t);
    if (topicCutAway) return { must, avoid };

    if (
      looksLikeAyceQuery(q) &&
      !must.some((m) => /ayce|all_you_can_eat|buffet/i.test(m))
    ) {
      must.unshift('all_you_can_eat');
    }
    if (
      /\b(kein\s+asiatisch|nicht\s+asiatisch|ohne\s+asia)\b/iu.test(q) &&
      !avoid.some((a) => /asian|asiatisch/i.test(a))
    ) {
      avoid.push('avoid_cuisine_asian');
    }
  } catch {
    /* soft */
  }
  return { must, avoid };
}

export function buildOpenWorldContract(opts: {
  userText: string;
  authorIntent?: string | null;
  bridge?: string | null;
  mustHaves?: string[] | null;
  avoid?: string[] | null;
  /** Call-1 Order-Ticket — schlägt Keyword-Inferenz */
  order?: {
    must?: string[];
    avoid?: string[];
    search?: {
      mode?: string;
      stages?: Array<'pack' | 'neighbor' | 'metro' | 'web' | 'verify'>;
      maxRadiusKm?: number;
      forbidSoftFill?: boolean;
    };
    need?: {
      menuUrl?: boolean;
      prices?: boolean;
      openHours?: boolean;
      eta?: boolean;
      maps?: boolean;
      ticket?: boolean;
      bookingLink?: boolean;
    };
    ui?: {
      openPitch?: boolean;
      startNav?: boolean;
      openTimeline?: boolean;
      openCalendar?: boolean;
    };
    bulletBudget?: { max?: number; maxLines?: number; maxChars?: number };
  } | null;
  researchCity?: string | null;
  stickyPlace?: string | null;
}): Call1OpenWorldContract {
  const text = normalizeAyceStt(opts.userText || '');
  let must = [
    ...(opts.order?.must ?? []),
    ...(opts.mustHaves ?? []),
  ]
    .map((m) => String(m).trim())
    .filter(Boolean);
  if (looksLikeAyceQuery(text) && !must.some((m) => /ayce|all_you_can_eat|buffet/i.test(m))) {
    must.unshift('all_you_can_eat');
  }
  try {
    const { extractTouristConstraintMusts } = require('./call1TouristConstraints') as {
      extractTouristConstraintMusts: (s: string) => string[];
    };
    for (const m of extractTouristConstraintMusts(text)) {
      if (!must.some((x) => x.toLowerCase() === m.toLowerCase())) must.push(m);
    }
  } catch {
    /* soft */
  }
  let avoid = [...(opts.order?.avoid ?? []), ...(opts.avoid ?? [])];
  if (/\b(kein\s+asiatisch|nicht\s+asiatisch|ohne\s+asia)\b/iu.test(text)) {
    if (!avoid.some((a) => /asian|asiatisch/i.test(a))) {
      avoid.push('avoid_cuisine_asian');
    }
  }
  ({ must, avoid } = inheritDiningMustsFromLiveInventory(text, must, avoid));

  try {
    const { strengthenCall2Musts } = require('../speech/call2MustFit') as {
      strengthenCall2Musts: (u: string, m: string[]) => string[];
    };
    must = strengthenCall2Musts(opts.userText || text, must);
  } catch {
    /* soft */
  }

  const authorIntent = (opts.authorIntent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);

  const mission = buildMissionChecklist({
    userText: opts.userText || text,
    order: opts.order
      ? {
          must,
          avoid,
          search: opts.order.search
            ? {
                mode:
                  String(opts.order.search.mode || '').toLowerCase() === 'hard'
                    ? 'hard'
                    : 'normal',
                stages: (opts.order.search.stages || [
                  'pack',
                  'neighbor',
                  'metro',
                  'web',
                ]) as Array<'pack' | 'neighbor' | 'metro' | 'web' | 'verify'>,
                maxRadiusKm: opts.order.search.maxRadiusKm ?? 40,
                forbidSoftFill: opts.order.search.forbidSoftFill === true,
              }
            : undefined,
          need: opts.order.need,
          ui: opts.order.ui,
          bulletBudget: opts.order.bulletBudget
            ? {
                max: opts.order.bulletBudget.max ?? 3,
                maxLines: opts.order.bulletBudget.maxLines ?? 2,
                maxChars: opts.order.bulletBudget.maxChars ?? 72,
              }
            : undefined,
        }
      : { must, avoid },
    mustHaves: must,
    avoid,
    researchCity: opts.researchCity ?? null,
    stickyPlace: opts.stickyPlace ?? null,
    authorIntent,
  });

  // Mission-Musts/Avoid mergen (Ambiguity-Rewrites / Family-Defaults)
  must = [...mission.must, ...must]
    .map((m) => String(m).trim())
    .filter(Boolean)
    .slice(0, 10);
  avoid = [...mission.avoid, ...avoid].slice(0, 8);
  // uniq-ish
  {
    const seen = new Set<string>();
    must = must.filter((m) => {
      const k = m.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  {
    const seen = new Set<string>();
    avoid = avoid.filter((a) => {
      const k = a.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const slotText =
    must.some((m) => /ayce|all_you_can_eat|buffet/i.test(m)) &&
    !looksLikeAyceQuery(text) &&
    text.length < 96
      ? `${text} all you can eat`
      : text;
  const inferredPlan = inferSearchPlan(slotText);
  const orderSearch = opts.order?.search;
  const searchPlan = {
    stages: (orderSearch?.stages?.length
      ? orderSearch.stages
      : inferredPlan.stages) as Call1SearchStage[],
    maxRadiusKm:
      typeof orderSearch?.maxRadiusKm === 'number'
        ? orderSearch.maxRadiusKm
        : inferredPlan.maxRadiusKm,
    preferDeepWebOnNovel: inferredPlan.preferDeepWebOnNovel,
  };
  const novelRequiresDeepWeb = searchPlan.preferDeepWebOnNovel;
  const stopPolicy = inferStopPolicy(slotText);
  if (
    orderSearch?.forbidSoftFill === true ||
    String(orderSearch?.mode || '').toLowerCase() === 'hard' ||
    must.length > 0 ||
    mission.forbidSoftFill
  ) {
    stopPolicy.forbidSoftFillOnMust = true;
  }
  const ui = inferUiRequirements(slotText);
  const need = opts.order?.need;
  if (need) {
    if (need.menuUrl != null) ui.needMenuUrl = need.menuUrl;
    if (need.prices != null) ui.showPriceInBullets = need.prices;
    if (need.ticket != null) ui.needTicket = need.ticket;
    if (need.maps != null) ui.needMaps = need.maps;
    if (need.bookingLink != null) ui.needBookingLink = need.bookingLink;
  }
  if (opts.order?.ui?.openCalendar || opts.order?.ui?.openTimeline) {
    try {
      const { isAmenityPlaceFindQuery } = require('../mission/amenityPlaceFind') as {
        isAmenityPlaceFindQuery: (s: string) => boolean;
      };
      // Phase 8: Single Amenity nie Timeline/Calendar aus Order erzwingen
      if (!isAmenityPlaceFindQuery(slotText)) {
        ui.openCalendar = true;
      }
    } catch {
      ui.openCalendar = true;
    }
  }
  if (opts.order?.bulletBudget?.max) {
    ui.maxBullets = opts.order.bulletBudget.max;
  }
  if (opts.order?.bulletBudget?.maxChars) {
    ui.bulletMaxChars = opts.order.bulletBudget.maxChars;
  }

  return {
    authorIntent,
    answerSlot: inferAnswerSlot(slotText),
    bridgeIntentMirror: (opts.bridge || '').trim()
      ? String(opts.bridge).trim().slice(0, 280)
      : null,
    must: must.slice(0, 8),
    avoid: avoid.slice(0, 8),
    searchPlan,
    stopPolicy,
    verifyConstraints: inferVerifyConstraints(slotText),
    uiRequirements: ui,
    novelRequiresDeepWeb,
    mission,
  };
}

/** Prompt-Geländer: Open-World, kein Käfig. */
export const FINDUS_CALL1_OPEN_WORLD_BLOCK = `
=== OPEN-WORLD VERTRAG (Ideal) ===
Kein Intent-Whitelist-Käfig. Unbekannte/komische/lange/umgangssprachliche Fragen = Auftrag erfinden.
1) Wunsch verstehen → bridgeIntentMirror (Mensch spiegelt Absicht, kein Fakten-Spoil).
2) MissionChecklist: family + anchor + factsToProve (must/avoid/need). Ambiguity still lösen (Gondel/Papst/Amsterdam) — nicht nachfragen.
3) Vertrag: must/avoid, searchPlan pack→neighbor→metro→web→verify, stopPolicy until_evidence (~60s), uiRequirements.
4) work[] aus Toolbox komponieren. Novel/Specialty/Open-Need/Erlebnis → deep_web oder pitch Pflicht wenn Pack dünn/schwach.
5) Soft-Fill gegen hard musts VERBOTEN (AYCE ≠ normales Restaurant; Theme ≠ Souvenir/Bild). Lokal leer/schwach → Expand bis ~100 km + Web, sonst ehrlich Empty.
6) Call-2 setzt nur Evidence + uiRequirements um (Stichpunkte max 3×2 Zeilen / Char-Budget) — Worker-Belege müssen ankommen.
7) Just-Do-It: Ask-Back NUR bei critical Blocker. Umgangssprache („Boah… X zu sehen“) = Need extrahieren, Pack nur mit Attraction-Beleg, sonst Live-Recherche.
Hop-on-Hop-off / Taxi / Hotel heute / nie getestet = verstehen + Worker, nicht „fehlende Kategorie“.
`.trim();

export function formatOpenWorldContractForPrompt(
  c: Call1OpenWorldContract,
): string {
  const ui = c.uiRequirements;
  return [
    'OPEN_WORLD_CONTRACT:',
    `answerSlot=${c.answerSlot ?? 'null'}`,
    `must=[${c.must.join(', ')}]`,
    `avoid=[${c.avoid.join(', ')}]`,
    `searchPlan=${c.searchPlan.stages.join('→')} maxRadiusKm=${c.searchPlan.maxRadiusKm} deepWeb=${c.novelRequiresDeepWeb}`,
    `stopPolicy=${c.stopPolicy.mode} budgetSec=${c.stopPolicy.budgetSec} forbidSoftFill=${c.stopPolicy.forbidSoftFillOnMust}`,
    `verify=[${c.verifyConstraints.join(', ')}]`,
    `uiReq menu=${ui.needMenuUrl} priceBullets=${ui.showPriceInBullets} ticket=${ui.needTicket} maps=${ui.needMaps} booking=${ui.needBookingLink} calendar=${ui.openCalendar} bullets=${ui.maxBullets}x${ui.bulletMaxLines}@${ui.bulletMaxChars}`,
    formatMissionChecklistForPrompt(c.mission),
  ].join('\n');
}
