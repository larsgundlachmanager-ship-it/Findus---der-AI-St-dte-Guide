/**
 * Findus Tour-Director — verbindlicher Ablauf bei JEDEM Trigger.
 *
 * 1   Wo sind wir?
 * 1.2 Schon da / Hauptfokus schon gesprochen → Stopp;
 *     kleinen Ort vergessen → zum Sub weiter
 * 2   Alle Fakten sammeln
 * 3   User-Interessen: uninteressant → nicht auslösen; sonst filtern
 * 4–11 Spannungsbogen (unsichtbar für den User) → bester Freund zeigt seine Stadt
 */

import type { Poi, PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  evaluateTriggerPolicy,
  parseTagsJson,
  themeTagToInterestIds,
  type TriggerPolicyContext,
} from '../geo/triggerPolicy';
import { getChildPois, haversineMeters } from '../../db/database';
import {
  filterDeepStoryFacts,
  type DeepStoryFact,
} from './deepStoryFilter';
import {
  resolveUserInterestIds,
  resolveYearsPreference,
} from './promptBuilder';
import type { SessionMemory } from './sessionMemory';
import { evaluatePoiForProfile } from '../poiFilterService';
import { isPoiTeaserLocked } from '../poi/poiTeaserLocks';
import { evaluatePoiRelevance } from '../../interests/relevanceBridge';
import { promptWeightForInterest, INTEREST_DIMENSIONS } from '../../interests/interestTaxonomy';
import { areSiblingApproachesSoftLocked } from '../interestPatternDetector';
import {
  extractPlaceOffers,
  formatPlaceOffersForPrompt,
} from '../poi/placeOffers';
import {
  formatLiveResearchForPrompt,
  getLiveResearchPrompts,
} from '../research/liveResearchRegistry';
import { isApproachFireLocked } from '../poi/approachFireTracker';
import {
  bakeryTimeAllows,
  findInterestOverrideHook,
  hotelProactiveOk,
  isAmenitySkipPoi,
  isMustHavePoi,
  nightSupplyAllows,
  resolvePlaceTiers,
  userWantsHiddenLocal,
  userWantsTouristic,
} from '../../interests/placeTiers';

export type FindusTriggerPlan =
  | { action: 'skip'; reason: string }
  | { action: 'soft_pitch'; reason: string; pitchText: string }
  | { action: 'approach_hook'; reason: string }
  | { action: 'redirect_sub'; reason: string; subPoiId: number }
  | { action: 'full_story'; reason: string }
  | {
      action: 'interest_override';
      reason: string;
      hookText: string;
      matched: string;
    };

export type FindusBeatFacts = {
  /** Was war damals / Anfang (Jahreszahl wenn erlaubt) */
  origin: string[];
  /** Wahre Geschichte: wieso, wer, was — interest-gewichtet */
  story: string[];
  /** Was ist es jetzt */
  now: string[];
  /** Fun / Kuriosität (noch nicht in origin/story/now) */
  fun: string[];
  /** Handlung / Quiz-Stoff (neu, schätzbar) */
  action: string[];
};

export type FindusStoryBrief = {
  poiId: number;
  poiName: string;
  interestMatch: string[];
  beats: FindusBeatFacts;
  promptBlock: string;
  yearsPreference: ReturnType<typeof resolveYearsPreference>;
};

const ORIGIN_RE =
  /(gebaut|entstand|gegründet|errichtet|früher|seit\s|im\s+jahr|jahrhundert|anfang|ursprung|erste[rn]?|eröffnet)/i;
const STORY_RE =
  /(weil|deshalb|baumeister|architekt|besitzer|familie|krieg|brand|skandal|legende|geschichte|veränder|handel|güter|schule|kirche|mensch|wer\s|wieso)/i;
const NOW_RE =
  /(heute|aktuell|derzeit|jetzt|gilt|dient|nutzen|geworden|seit\s+\d{4}|restauriert|umgebaut|genutzt)/i;
const FUN_RE =
  /(kurios|einzig|besonder|witzig|kaum|wenige|älteste|größte|meter|fußball|schüler|jahrgang|form|rauschen|name|benannt|wandmalerei|malerei|street.?art)/i;
const ACTION_RE =
  /(schau|blick|eingang|fassade|brücke|ufer|weg|allee|umrunden|entdeck|erleben|siehe|sichtbar|after\s*work|afterwork|karaoke|party|studenten|sommerfest|open\s*mic|reserv|buch|spiel|golf|tennis|hotel|tisch|event|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|als\s+gast|mitmachen|wasserski|wakeboard|cable|surfen|klettern|baden|schwimmen|eintritt|€|euro|pro\s*person|halbe\s*stunde|badehose|mitbringen)/i;

/**
 * Schritt 1–3: Trigger planen (Visit-Gates + Prefs + Sub-Redirect).
 */
export async function planFindusTrigger(input: {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  spokenAreaIds: Set<number>;
  spokenApproachIds: Set<number>;
  spokenSubIds: Set<number>;
  userLat?: number | null;
  userLng?: number | null;
  force?: boolean;
  /** Wegweiser zu diesem Spot schon gehört → Intro überspringen */
  approachAlreadyHeard?: boolean;
  policyCtx: TriggerPolicyContext;
}): Promise<FindusTriggerPlan> {
  const poi = input.poi;
  const kind = poi.kind ?? 'legacy';
  const spoken =
    kind === 'approach'
      ? input.spokenApproachIds
      : kind === 'sub'
        ? input.spokenSubIds
        : input.spokenAreaIds;

  // Simulation / Manual-Force: immer erzählen — Prefs, Locks, Spoken nur für Auto-Geofence
  if (input.force) {
    if (kind === 'approach') {
      return { action: 'approach_hook', reason: 'force' };
    }
    return { action: 'full_story', reason: 'force' };
  }

  // 1.2 Schon gesprochen?
  if (spoken.has(poi.id)) {
    // Area-Hauptfokus fertig → vergessenen Sub ansteuern
    if (
      (kind === 'area' || kind === 'legacy') &&
      input.userLat != null &&
      input.userLng != null
    ) {
      const subId = await findForgottenSubPoiId({
        areaPoiId: poi.id,
        spokenSubIds: input.spokenSubIds,
        userLat: input.userLat,
        userLng: input.userLng,
      });
      if (subId != null) {
        return {
          action: 'redirect_sub',
          reason: 'main_done_forgotten_sub',
          subPoiId: subId,
        };
      }
    }
    return { action: 'skip', reason: 'already_spoken' };
  }

  // Durable LOCK — never fire Wegweiser/teaser again after full story / visit
  if (
    kind === 'approach' &&
    isPoiTeaserLocked({ spotKey: poi.spot_key, poiId: poi.id })
  ) {
    return { action: 'skip', reason: 'teaser_locked' };
  }
  // Soft-lock: Geschwister-Wegweiser desselben Ortes ~10 Min
  if (
    kind === 'approach' &&
    (areSiblingApproachesSoftLocked(poi.parent_poi_id) ||
      areSiblingApproachesSoftLocked(poi.id))
  ) {
    return { action: 'skip', reason: 'sibling_approach_soft_lock' };
  }
  // Also lock approach if parent area is locked
  if (
    kind === 'approach' &&
    poi.parent_poi_id != null &&
    isPoiTeaserLocked({ poiId: poi.parent_poi_id })
  ) {
    return { action: 'skip', reason: 'parent_teaser_locked' };
  }
  // Haupt schon erzählt → alle Wegpunkte skip
  if (
    kind === 'approach' &&
    poi.parent_poi_id != null &&
    input.spokenAreaIds.has(poi.parent_poi_id)
  ) {
    return { action: 'skip', reason: 'main_already_spoken' };
  }
  // 2× Approach / ≥1 h / nie am Haupt → dauerhaft skip
  if (kind === 'approach') {
    const fireLocked = await isApproachFireLocked(poi.spot_key, poi.id);
    if (fireLocked) {
      return { action: 'skip', reason: 'approach_fire_locked_2x' };
    }
  }

  const mustHave = isMustHavePoi(poi);

  // Pref-Pyramide (must_have/yes immer · neutral ≥3 min · no skip)
  try {
    const { evaluateModule1PrefGate } = await import(
      '../../runtime/module1TriggerPolicy'
    );
    const prefGate = evaluateModule1PrefGate({
      poi,
      profile: input.profile,
      force: input.force,
    });
    if (!prefGate.ok) {
      if (prefGate.strength === 'no') {
        const hook = findInterestOverrideHook(
          poi,
          poi.facts ?? [],
          input.profile,
        );
        if (hook && !mustHave) {
          return {
            action: 'interest_override',
            reason: `pref_no_override:${prefGate.reason}`,
            hookText: hook.hookText,
            matched: hook.matched,
          };
        }
      }
      return { action: 'skip', reason: prefGate.reason };
    }
  } catch {
    /* soft — Pref-Gate optional */
  }

  // Place-Tiers (amenity / Zeit / Touri)
  if (!mustHave) {
    if (isAmenitySkipPoi(poi)) {
      const overrideAmenity = findInterestOverrideHook(
        poi,
        poi.facts ?? [],
        input.profile,
      );
      if (!overrideAmenity) {
        return { action: 'skip', reason: 'place_tier:amenity_skip' };
      }
    }
    if (!bakeryTimeAllows(poi)) {
      return { action: 'skip', reason: 'place_tier:bakery_off_hours' };
    }
    if (!hotelProactiveOk(poi, input.profile)) {
      return { action: 'skip', reason: 'place_tier:hotel_generic' };
    }
    if (!nightSupplyAllows(poi, input.profile)) {
      return { action: 'skip', reason: 'place_tier:night_supply_off' };
    }
    const tiers = resolvePlaceTiers(poi);
    if (tiers.includes('touristic') && !userWantsTouristic(input.profile)) {
      const hook = findInterestOverrideHook(
        poi,
        poi.facts ?? [],
        input.profile,
      );
      if (!hook) {
        return { action: 'skip', reason: 'place_tier:touristic_no_interest' };
      }
    }
    if (
      (tiers.includes('hidden') || tiers.includes('local')) &&
      !userWantsHiddenLocal(input.profile) &&
      !userWantsTouristic(input.profile)
    ) {
      // Hidden nur skippen wenn User weder Insider noch Touri — neutrale User dürfen lokale Orte
    }
  }

  const policy = evaluateTriggerPolicy(poi, input.policyCtx);
  if (policy.action === 'skip') {
    const hook = findInterestOverrideHook(poi, poi.facts ?? [], input.profile);
    if (hook && !mustHave) {
      return {
        action: 'interest_override',
        reason: `policy_override:${policy.reason}`,
        hookText: hook.hookText,
        matched: hook.matched,
      };
    }
    return { action: 'skip', reason: policy.reason };
  }
  if (policy.action === 'soft_pitch') {
    return {
      action: 'soft_pitch',
      reason: policy.reason,
      pitchText: policy.pitchText ?? '',
    };
  }

  // Relevance-Engine (Schema-Matching, keine Hardcoded-Kirchen/Steakhouse-If/Else)
  const relevance = evaluatePoiRelevance(poi, input.profile, {
    lastMealAtMs: input.policyCtx.lastMealHintAtMs ?? null,
  });
  if (relevance.verdict === 'skip' && !mustHave) {
    const hook = findInterestOverrideHook(poi, poi.facts ?? [], input.profile);
    if (hook) {
      return {
        action: 'interest_override',
        reason: `relevance_override:${relevance.reasonCode}`,
        hookText: hook.hookText,
        matched: hook.matched,
      };
    }
    return {
      action: 'skip',
      reason: `relevance:${relevance.reasonCode}`,
    };
  }

  // Persona-Engine: Barrierefreiheit, Ernährung, Distanz
  const profileFilter = evaluatePoiForProfile(poi, input.profile, {
    userLat: input.userLat,
    userLng: input.userLng,
  });
  if (!profileFilter.allowed && !mustHave) {
    const hook = findInterestOverrideHook(poi, poi.facts ?? [], input.profile);
    if (hook) {
      return {
        action: 'interest_override',
        reason: `persona_override:${profileFilter.reason}`,
        hookText: hook.hookText,
        matched: hook.matched,
      };
    }
    return { action: 'skip', reason: `persona_filter:${profileFilter.reason}` };
  }

  if (kind === 'approach') {
    return { action: 'approach_hook', reason: 'wegweiser' };
  }

  if (input.approachAlreadyHeard && (kind === 'area' || kind === 'legacy')) {
    return { action: 'full_story', reason: 'approach_already_heard' };
  }

  return { action: 'full_story', reason: mustHave ? 'must_have' : 'ok' };
}

/**
 * Unspoken Sub in Reichweite (User hat Hauptfokus schon gehört).
 */
export async function findForgottenSubPoiId(input: {
  areaPoiId: number;
  spokenSubIds: Set<number>;
  userLat: number;
  userLng: number;
}): Promise<number | null> {
  const children = await getChildPois(input.areaPoiId);
  const candidates = children
    .filter((c) => c.kind === 'sub' && !input.spokenSubIds.has(c.id))
    .map((c) => ({
      c,
      d: haversineMeters(input.userLat, input.userLng, c.lat, c.lng),
    }))
    .filter(({ c, d }) => d <= Math.max(c.radius_meters * 1.35, 50))
    .sort((a, b) => a.d - b.d);

  return candidates[0]?.c.id ?? null;
}

/**
 * Schritte 2–3 + Beat-Buckets für 6–11.
 */
export function buildFindusStoryBrief(input: {
  poi: PoiWithFacts;
  profile?: UserProfile | null;
  sessionMemory?: SessionMemory | null;
}): FindusStoryBrief {
  const profile = input.profile ?? getCachedUserProfile();
  const interestIds = resolveUserInterestIds(profile);
  const yearsPreference = resolveYearsPreference(profile);
  const deep = filterDeepStoryFacts(input.poi, {
    profile,
    sessionMemory: input.sessionMemory,
  });

  const ranked = rankFactsForUser(deep.facts, interestIds, input.poi);
  const used = new Set<string>();
  const take = (pred: (t: string) => boolean, max: number): string[] => {
    const out: string[] = [];
    for (const f of ranked) {
      if (used.has(f.text)) continue;
      if (!pred(f.text)) continue;
      used.add(f.text);
      out.push(f.text);
      if (out.length >= max) break;
    }
    return out;
  };

  const origin = take((t) => ORIGIN_RE.test(t), 2);
  const visual = take(
    (t) => /wandmalerei|malerei|fassade|street.?art|unterführung/i.test(t),
    2,
  );
  const storyCore = take((t) => STORY_RE.test(t) || ORIGIN_RE.test(t), 2);
  const story = [...visual, ...storyCore].slice(0, 4);
  const now = take((t) => NOW_RE.test(t), 2);
  const fun = take((t) => FUN_RE.test(t), 1);
  const action = take((t) => ACTION_RE.test(t) || FUN_RE.test(t), 3);

  // Generische Offers (Events/Buchung) aus Pack — profil-geboostet, jede Stadt
  const placeOffers = extractPlaceOffers(input.poi, profile);
  for (const o of placeOffers.slice(0, 3)) {
    if (used.has(o.text)) continue;
    used.add(o.text);
    action.push(o.text);
    if (action.length >= 4) break;
  }

  // Rest auffüllen nur wenn genug echte Fakten — sonst leere Beats = ehrlich kurz
  const thinPack =
    origin.length + story.length + now.length + fun.length < 2;
  if (!thinPack) {
    const fill = (bucket: string[], n: number) => {
      while (bucket.length < n) {
        const next = ranked.find((f) => !used.has(f.text));
        if (!next) break;
        used.add(next.text);
        bucket.push(next.text);
      }
    };
    fill(origin, 1);
    fill(story, 1);
    fill(now, 1);
  }

  const interestMatch = interestIds.filter((id) =>
    ranked.some((f) =>
      themeTagToInterestIds(
        parseTagsJson(input.poi.tags_json).join(' ') || id,
      ).includes(id),
    ),
  );

  const beats: FindusBeatFacts = { origin, story, now, fun, action };
  const liveBlock = formatLiveResearchForPrompt(getLiveResearchPrompts());
  const cityWeaveHints = ranked
    .filter((f) =>
      /stadtgeschichte|dorfgeschichte|ortschronik|entstehung der (stadt|ortschaft)|gründung|eisenbahn|güterbahn|gueterbahn|brücke|bruecke/i.test(
        f.text,
      ),
    )
    .slice(0, 2)
    .map((f) => f.text);
  const cityWeaveBlock =
    cityWeaveHints.length > 0
      ? `Stadt-/Dorfgeschichte (nur einweben wenn thematisch zum Ort passend und noch nicht gesagt):\n${cityWeaveHints.map((t) => `- ${t}`).join('\n')}`
      : 'Stadt-/Dorfgeschichte: nur einweben wenn im Datensatz ein klarer Link zum Ort steht — sonst weglassen.';
  const promptBlock = [
    formatBriefForPrompt(input.poi.name, beats, interestIds),
    formatPlaceOffersForPrompt(placeOffers),
    cityWeaveBlock,
    liveBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    poiId: input.poi.id,
    poiName: input.poi.name,
    interestMatch,
    beats,
    promptBlock,
    yearsPreference,
  };
}

function rankFactsForUser(
  facts: DeepStoryFact[],
  interestIds: string[],
  poi: Poi,
): DeepStoryFact[] {
  const tags = parseTagsJson(poi.tags_json);
  return [...facts]
    .map((f) => {
      let score = 1;
      const lower = f.text.toLowerCase();
      for (const id of interestIds) {
        const w = promptWeightForInterest(id);
        score += w;
        if (lower.includes(id.slice(0, 5))) score += w * 2;
        const dim = INTEREST_DIMENSIONS.find((d) => d.prefKey === id);
        if (dim?.tagMatchers.some((m) => lower.includes(m))) score += w * 2;
      }
      for (const tag of tags) {
        if (themeTagToInterestIds(tag).some((i) => interestIds.includes(i))) {
          score += 2;
        }
      }
      if (ORIGIN_RE.test(f.text)) score += 1;
      if (FUN_RE.test(f.text)) score += 1;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.f);
}

function formatBriefForPrompt(
  poiName: string,
  beats: FindusBeatFacts,
  interestIds: string[],
): string {
  const line = (title: string, items: string[]) =>
    items.length > 0
      ? `### ${title}\n${items.map((t) => `- ${t}`).join('\n')}`
      : `### ${title}\n- (keine Belege — diesen Beat kurz halten oder überspringen)`;

  return `## Findus Story-Brief für „${poiName}" (NUR diese Stoffe — unsichtbare Beats!)
User-Interessen-Keys: ${interestIds.slice(0, 10).join(', ') || 'keine speziellen'}

${line('ORIGIN — Anfang / Jahreszahl / Damals', beats.origin)}

${line('STORY — Wahre Geschichte (wieso, wer, was)', beats.story)}

${line('NOW — Was ist daraus geworden', beats.now)}

${line('FUN — Kuriosität (flüssig, kein Label)', beats.fun)}

${line('ACTION/QUIZ — Neu, schätzbar, noch nicht oben', beats.action)}

Regie: Daraus EINEN fließenden Audioguide-Text bauen — wie ein Freund neben dem User.
Keine Labels vorlesen. Keine Rubriken. Jeder Fakt nur einmal.
Struktur intern: sinnlicher Hook (ohne Nutzername) → visueller Anker (Besonderheit zuerst wenn belegt) → Geschichte/Heute → was man hier machen kann.
Wenn Ort-Angebote/Events belegt: gegen Ende natürlich erwähnen (Recurring-Abend, buchen, mitmachen) — NIE erfinden.
Aktivitäts-Orte (Sport, Wasserski, Freizeit…): Historie kurz — Schwerpunkt LEBEN JETZT: Aktivität, was besonders ist, Preise/Dauer/Tipps NUR wenn belegt, Abschluss = Charakter-angepasste Motivation zum Mitmachen (ohne Meta-„frag mich“).
Abschluss: kurze lebendige Einladung ok — NIE Meta „frag mich“ / „was macht besonders?“.
NIE Telefon/Adresse/GPS/Koordinaten/Öffnungszeiten-Liste vorlesen. NIE steifes „Willkommen bei …“.
NIE Mystik/Aura/„man munkelt“/Geheimnis erfinden, wenn ORIGIN/STORY/NOW leer oder nur LIVE-Platzhalter sind — dann kurz und ehrlich bleiben.`;
}

/**
 * Brief-Beats in CoreFacts der Chain mappen (ORIGIN+STORY → origin, …).
 * So steuert der Tour-Director auch Step1/3 offline und LLM.
 */
export function applyBriefToCoreFacts<
  T extends {
    intro: string;
    origin: string;
    now: string;
    highlight: string;
    explore: string;
  },
>(brief: FindusStoryBrief, base: T): T {
  const clean = (t: string) => t.replace(/\s+/g, ' ').trim();
  const uniqJoin = (xs: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of xs) {
      const t = clean(raw);
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out.join(' ');
  };

  const origin = uniqJoin([...brief.beats.origin, ...brief.beats.story]);
  const now = uniqJoin(brief.beats.now);
  const highlight = uniqJoin(brief.beats.fun);
  const explore = uniqJoin(brief.beats.action);

  // Kein Beat darf denselben Text wie ein anderer Beat tragen
  const used = new Set<string>();
  const pick = (preferred: string, fallback: string): string => {
    const cand = preferred || fallback;
    if (!cand) return '';
    const key = cand.toLowerCase();
    for (const u of used) {
      if (key === u || key.includes(u) || u.includes(key)) {
        if (Math.min(key.length, u.length) >= 24) return '';
      }
    }
    used.add(key);
    return cand;
  };

  return {
    ...base,
    origin: pick(origin, base.origin) || base.origin,
    now: pick(now, base.now),
    highlight: pick(highlight, base.highlight),
    explore: pick(explore, base.explore),
  };
}

/**
 * Unsichtbarer Spannungsbogen — Spiegel der CHARMING-Formel in promptBuilder.
 * Hier dokumentiert für den Tour-Director; Prompt-Quelle bleibt promptBuilder.
 */
export const FINDUS_BEST_FRIEND_PIPELINE = `Siehe CHARMING_4_STEP_STORY_FRAMEWORK / buildDeepStoryPrompt — Best-Friend-Beats A–G.`;
