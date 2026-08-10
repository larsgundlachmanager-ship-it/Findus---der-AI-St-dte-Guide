/**
 * Place-Tiers für Modul-1-Relevanz — tag-getrieben, stadt-agnostisch.
 */

import { parseTagsJson } from '../services/geo/triggerPolicy';
import type { Poi } from '../db/types';
import type { UserProfile } from '../types/userProfile';

export type PlaceTier =
  | 'must_have'
  | 'touristic'
  | 'local'
  | 'hidden'
  | 'amenity_skip'
  | 'landmark'
  | 'neutral';

const AMENITY_SKIP_RE =
  /\b(zahnarzt|zahnmedizin|arztpraxis|hausarzt|\bpraxis\b|gemeinschaftspraxis|klinik|reinigung|textilreinigung|wäscherei|waescherei|dry\s*clean|parkplatz|parkhaus|tiefgarage|tankstelle|autohaus|versicher|notar|steuerberater)\b/i;

const BAKERY_RE = /\b(bäck|baeck|bäcker|baecker|bakery|konditor)\b/i;
const HOTEL_RE = /\b(hotel|pension|gasthof|hostel)\b/i;
const NIGHT_SUPPLY_RE = /\b(night_supply|nachtversorgung|späti|spaeti|tankstelle)\b/i;

export function poiTagBlob(poi: Poi): string {
  const tags = parseTagsJson(poi.tags_json);
  return `${poi.category ?? ''} ${poi.name} ${tags.join(' ')}`.toLowerCase();
}

export function resolvePlaceTiers(poi: Poi): PlaceTier[] {
  const tags = parseTagsJson(poi.tags_json);
  const blob = poiTagBlob(poi);
  const out = new Set<PlaceTier>();

  if (tags.includes('must_have') || tags.includes('must-see') || tags.includes('must_see')) {
    out.add('must_have');
  }
  if (
    tags.includes('touristic') ||
    tags.includes('touri') ||
    tags.includes('typisch_touri')
  ) {
    out.add('touristic');
  }
  if (tags.includes('local') || tags.includes('einheimisch')) {
    out.add('local');
  }
  if (
    tags.includes('hidden') ||
    tags.includes('geheim') ||
    tags.includes('insider') ||
    tags.includes('local_gem')
  ) {
    out.add('hidden');
  }
  if (
    tags.includes('landmark_bakery') ||
    tags.includes('landmark_hotel') ||
    tags.includes('landmark') ||
    tags.includes('wichtig')
  ) {
    out.add('landmark');
  }
  if (
    tags.includes('amenity_skip') ||
    tags.includes('directory') ||
    tags.includes('tier4') ||
    tags.includes('offline_lookup') ||
    tags.includes('tourist_info') ||
    /\b(tourist.?info|touristen.?information|gepäck|gepaeck|luggage|toilette|öpnv.?halte|bushaltestelle)\b/i.test(
      blob,
    ) ||
    AMENITY_SKIP_RE.test(blob)
  ) {
    // Landmark/must_have schlägt amenity_skip — Directory/Tier4/Tourist-Info nie proaktiv
    if (!out.has('must_have') && !out.has('landmark')) {
      out.add('amenity_skip');
    }
  }
  // Souvenirs: touristic Tier-2 — nur wenn User Touri/Souvenirs mag (Director + specialization)
  if (tags.includes('souvenir') || /\bsouvenir|andenken\b/i.test(blob)) {
    out.add('touristic');
  }
  if (out.size === 0) out.add('neutral');
  return [...out];
}

export function isMustHavePoi(poi: Poi): boolean {
  return resolvePlaceTiers(poi).includes('must_have');
}

export function isAmenitySkipPoi(poi: Poi): boolean {
  return resolvePlaceTiers(poi).includes('amenity_skip');
}

/** Bäcker: morgens ok; nachmittags nur Landmark/must_have. */
export function bakeryTimeAllows(poi: Poi, now = new Date()): boolean {
  const blob = poiTagBlob(poi);
  if (!BAKERY_RE.test(blob)) return true;
  const tiers = resolvePlaceTiers(poi);
  if (tiers.includes('must_have') || tiers.includes('landmark')) return true;
  const h = now.getHours();
  return h >= 6 && h < 12;
}

export function hotelProactiveOk(poi: Poi, profile?: UserProfile | null): boolean {
  const blob = poiTagBlob(poi);
  if (!HOTEL_RE.test(blob)) return true;
  const tiers = resolvePlaceTiers(poi);
  if (tiers.includes('must_have') || tiers.includes('landmark')) return true;
  if (tiers.includes('amenity_skip')) return false;
  const want =
    (profile?.wantToExperience ?? '').toLowerCase().includes('hotel') ||
    (profile?.learnedFacts ?? []).some((f) => /hotel|übernacht|uebernacht/i.test(f));
  return want;
}

export function nightSupplyAllows(poi: Poi, profile?: UserProfile | null, now = new Date()): boolean {
  const tags = parseTagsJson(poi.tags_json);
  const blob = poiTagBlob(poi);
  const isNight =
    tags.includes('night_supply') ||
    (NIGHT_SUPPLY_RE.test(blob) && tags.includes('nightlife_context'));
  if (!isNight && !tags.includes('night_supply')) return true;
  const h = now.getHours();
  const nightOk = h >= 21 || h < 4;
  const party =
    profile?.mustHaveStyles?.includes('nightlife') ||
    profile?.experiencePrefs?.nachtleben === 'yes' ||
    profile?.characters?.includes('party');
  return nightOk && Boolean(party);
}

/**
 * User-Hook in Facts/Prefs, obwohl Kategorie eigentlich skip wäre.
 * Liefert kurzen Hook-Satz für Override-Narration.
 */
export function findInterestOverrideHook(
  poi: Poi,
  facts: { fact_text: string }[],
  profile?: UserProfile | null,
): { hookText: string; matched: string } | null {
  if (!profile) return null;
  const seeds: string[] = [];
  const want = (profile.wantToExperience ?? '').trim();
  const avoid = (profile.avoidExperience ?? '').trim();
  const about = (profile.aboutMe ?? '').trim();
  if (want) seeds.push(...want.split(/[,;.!?]/g));
  if (about) seeds.push(...about.split(/[,;.!?]/g));
  for (const f of profile.learnedFacts ?? []) {
    if (/^skip-pattern:/i.test(f)) continue;
    seeds.push(f);
  }
  for (const [k, v] of Object.entries(profile.experiencePrefs ?? {})) {
    if (v === 'yes') seeds.push(k);
  }

  const tokens = seeds
    .flatMap((s) =>
      s
        .toLowerCase()
        .split(/[\s,/&+]+/)
        .map((t) => t.replace(/[^a-zäöüß0-9]/giu, ''))
        .filter((t) => t.length >= 4),
    )
    .filter((t) => !/^(keine|nicht|ohne|wenig|oder|und|dass|diese|dieser)$/i.test(t));

  if (!tokens.length) return null;

  const avoidTok = avoid
    .toLowerCase()
    .split(/[\s,/]+/)
    .filter((t) => t.length >= 4);

  for (const fact of facts) {
    const body = (fact.fact_text ?? '').replace(/^\[[^\]]+\]\s*/u, '').trim();
    if (body.length < 20) continue;
    const lower = body.toLowerCase();
    if (avoidTok.some((a) => lower.includes(a))) continue;
    for (const tok of tokens) {
      if (lower.includes(tok)) {
        const clip =
          body.length > 140
            ? `${body.slice(0, 137).replace(/\s+\S*$/, '')}…`
            : body;
        return { hookText: clip, matched: tok };
      }
    }
  }

  // Name/Tags
  const blob = poiTagBlob(poi);
  for (const tok of tokens) {
    if (blob.includes(tok)) {
      return {
        hookText: `Hier steckt etwas zu „${tok}“, das zu dir passt.`,
        matched: tok,
      };
    }
  }

  return null;
}

export function userWantsTouristic(profile?: UserProfile | null): boolean {
  if (!profile) return true;
  if (profile.mustHaveStyles?.includes('tourist')) return true;
  if (profile.touristMode === 'tourist') return true;
  if (profile.experiencePrefs?.typisch_touri === 'yes') return true;
  return false;
}

export function userWantsHiddenLocal(profile?: UserProfile | null): boolean {
  if (!profile) return true;
  if (profile.mustHaveStyles?.includes('local_gems')) return true;
  if (profile.mustHaveStyles?.includes('insider')) return true;
  if (profile.experiencePrefs?.geheimtipps === 'yes') return true;
  if (profile.experiencePrefs?.weg_vom_trubel === 'yes') return true;
  return false;
}
