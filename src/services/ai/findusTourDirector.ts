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

export type FindusTriggerPlan =
  | { action: 'skip'; reason: string }
  | { action: 'soft_pitch'; reason: string; pitchText: string }
  | { action: 'approach_hook'; reason: string }
  | { action: 'redirect_sub'; reason: string; subPoiId: number }
  | { action: 'full_story'; reason: string };

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
  /(kurios|einzig|besonder|witzig|kaum|wenige|älteste|größte|meter|fußball|schüler|jahrgang|form|rauschen|name|benannt)/i;
const ACTION_RE =
  /(schau|blick|eingang|fassade|brücke|ufer|weg|allee|umrunden|entdeck|erleben|siehe|sichtbar)/i;

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

  // 1.2 Schon gesprochen?
  if (!input.force && spoken.has(poi.id)) {
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

  // Pref / Tide / Food-Gates
  // Simulation/Manual-Force: immer erzählen — Prefs gelten nur für Auto-Geofence
  if (input.force) {
    if (kind === 'approach') {
      return { action: 'approach_hook', reason: 'force' };
    }
    return { action: 'full_story', reason: 'force' };
  }

  const policy = evaluateTriggerPolicy(poi, input.policyCtx);
  if (policy.action === 'skip') {
    return { action: 'skip', reason: policy.reason };
  }
  if (policy.action === 'soft_pitch') {
    return {
      action: 'soft_pitch',
      reason: policy.reason,
      pitchText: policy.pitchText ?? '',
    };
  }

  // Persona-Engine: Barrierefreiheit, Ernährung, Distanz, Kirchen
  const profileFilter = evaluatePoiForProfile(poi, input.profile, {
    userLat: input.userLat,
    userLng: input.userLng,
  });
  if (!profileFilter.allowed) {
    return { action: 'skip', reason: `persona_filter:${profileFilter.reason}` };
  }

  // Zusätzliches Interessen-Gate: spezialisierte Orte ohne Yes-Match
  const interestGate = evaluateInterestRelevance(poi, input.profile);
  if (interestGate === 'skip') {
    return { action: 'skip', reason: 'not_interesting_for_user' };
  }

  if (kind === 'approach') {
    return { action: 'approach_hook', reason: 'wegweiser' };
  }

  if (input.approachAlreadyHeard && (kind === 'area' || kind === 'legacy')) {
    return { action: 'full_story', reason: 'approach_already_heard' };
  }

  return { action: 'full_story', reason: 'ok' };
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
 * Spezial-POIs nur auslösen, wenn User sie mag oder keine klare Pref hat.
 * Explizites „no“ liegt schon in evaluateTriggerPolicy.
 */
function evaluateInterestRelevance(
  poi: Poi,
  profile?: UserProfile | null,
): 'ok' | 'skip' {
  const p = profile ?? getCachedUserProfile();
  const prefs = p?.experiencePrefs ?? {};
  const yesKeys = new Set(
    Object.entries(prefs)
      .filter(([, v]) => v === 'yes')
      .map(([k]) => k),
  );
  if (yesKeys.size === 0) return 'ok';

  const tags = parseTagsJson(poi.tags_json);
  const cat = (poi.category ?? '').toLowerCase();
  const specialized: Array<{ test: boolean; key: string }> = [
    {
      test:
        cat === 'kirche' ||
        tags.some((t) => /kirche|kapelle|dom|sakral/.test(t)),
      key: 'kirchen',
    },
    {
      test: cat === 'museum' || tags.some((t) => /museum|galerie/.test(t)),
      key: 'museen',
    },
    {
      test: tags.some((t) => /golf|fairway/.test(t)) || /golf/i.test(poi.name),
      key: 'sport',
    },
    {
      test: tags.some((t) => /streetart|graffiti/.test(t)),
      key: 'streetart',
    },
  ];

  for (const s of specialized) {
    if (!s.test) continue;
    if (prefs[s.key] === 'no') return 'skip';
    // Klare Likes gesetzt, aber dieses Spezialthema nie geliked → nicht auslösen
    if (
      yesKeys.size >= 2 &&
      !yesKeys.has(s.key) &&
      prefs[s.key] !== 'yes' &&
      prefs[s.key] !== 'neutral'
    ) {
      return 'skip';
    }
  }
  return 'ok';
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
  const story = take((t) => STORY_RE.test(t) || ORIGIN_RE.test(t), 2);
  const now = take((t) => NOW_RE.test(t), 2);
  const fun = take((t) => FUN_RE.test(t), 1);
  const action = take((t) => ACTION_RE.test(t) || FUN_RE.test(t), 1);

  // Rest auffüllen, damit Beats nicht leer sind
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

  const interestMatch = interestIds.filter((id) =>
    ranked.some((f) =>
      themeTagToInterestIds(
        parseTagsJson(input.poi.tags_json).join(' ') || id,
      ).includes(id),
    ),
  );

  const beats: FindusBeatFacts = { origin, story, now, fun, action };
  const promptBlock = formatBriefForPrompt(input.poi.name, beats, interestIds);

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
        if (lower.includes(id.slice(0, 5))) score += 2;
        if (
          (id === 'architektur' || id === 'museen') &&
          /(fassade|stil|backstein|portal|architekt)/i.test(lower)
        ) {
          score += 4;
        }
        if (
          id === 'geschichte' &&
          /(jahrhundert|krieg|früher|geschichte|gegründet)/i.test(lower)
        ) {
          score += 4;
        }
        if (
          id === 'personen' &&
          /(person|familie|geboren|berühm|baumeister)/i.test(lower)
        ) {
          score += 4;
        }
        if (
          (id === 'natur' || id === 'wandern') &&
          /(fluss|bach|natur|ufer|wiese|wald)/i.test(lower)
        ) {
          score += 4;
        }
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
Struktur intern: visueller Anker → Hook → Geschichte → Heute → sanfter Abschluss/Sub-Tipp.
Abschluss: offen weitergehen oder Sub-POI — NIE „später erzähl ich mehr“ wenn der User schon da ist.`;
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
