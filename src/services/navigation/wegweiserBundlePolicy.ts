/**
 * 50-m Wegweiser-Bundling (SSOT).
 *
 * Max 2 Orte im Audio. Ranking: Relevanz > Berühmtheit > Distanz.
 * Blacklist: Praxen, Büros, Standard-Cafés (Whitelist per Kontext/Fame).
 */

import type { Poi } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { evaluatePoiRelevance } from '../../interests/relevanceBridge';
import { resolvePoiImportance } from '../personaEngine';
import { parseTagsJson } from '../geo/triggerPolicy';
import { WEGWEISER_BUNDLE_M } from './modulePriorityPolicy';

export const APPROACH_BUNDLE_MAX_AUDIO = 2;
export { WEGWEISER_BUNDLE_M };

export type BundleCandidate = {
  poi: Poi;
  distanceM: number;
};

export type ApproachBundleSelection = {
  /** Max 2 — gesprochen */
  spoken: BundleCandidate[];
  /** Weitere Treffer — nur UI/Karten, nicht gesprochen */
  silentUi: BundleCandidate[];
};

function blobOf(poi: Poi): string {
  const tags = parseTagsJson(poi.tags_json);
  return `${poi.name ?? ''} ${poi.category ?? ''} ${tags.join(' ')}`.toLowerCase();
}

function isFamousLandmarkCafe(poi: Poi): boolean {
  const b = blobOf(poi);
  return /elphi|speicherstadt|miniatur|wunderland|historisch|legendär|weltberühm|unesco|café\s*central|demel|sacher|riffraff|parisien/.test(
    b,
  );
}

function isMealWindow(now = new Date()): boolean {
  const h = now.getHours() + now.getMinutes() / 60;
  return (h >= 11.5 && h <= 14.5) || (h >= 17.5 && h <= 21.5);
}

function wantsFoodContext(profile?: UserProfile | null): boolean {
  if (!profile) return false;
  const prefs = profile.experiencePrefs ?? {};
  const yes = (k: keyof typeof prefs) => prefs[k] === 'yes';
  if (
    yes('fruehstueck') ||
    yes('kaffee') ||
    yes('abendessen') ||
    yes('streetfood')
  ) {
    return true;
  }
  const want = (profile.wantToExperience ?? '').toLowerCase();
  if (/essen|restaurant|café|cafe|mittag|abendessen|kaffee/.test(want)) {
    return true;
  }
  return (profile.learnedFacts ?? []).some((f) =>
    /essen|hunger|restaurant|café|cafe|mittag/i.test(f),
  );
}

/**
 * True = raus aus Audio-Bundling (Alltags-POI).
 * Café/Restaurant nur bei Kontext oder Fame.
 */
export function isBlacklistedForApproachBundle(
  poi: Poi,
  profile?: UserProfile | null,
): boolean {
  const b = blobOf(poi);

  if (
    /zahnarzt|zahnmedizin|arztpraxis|hausarzt|\bpraxis\b|fußpflege|fusspflege|physiotherap|orthopäd|radiolog|anwalt|notar|steuerberat|immobilienbüro|coworking|\bbüro\b|\boffice\b/.test(
      b,
    )
  ) {
    return true;
  }

  if (
    /\b(supermarkt|aldi|lidl|rewe|edeka|penny|netto|kiosk|drogerie|dm\b|rossmann)\b/.test(
      b,
    ) &&
    !/museum|denkmal|landmark/.test(b)
  ) {
    return true;
  }

  if (
    /\b(bäckerei|baeckerei|bäcker|baecker|backshop)\b/.test(b) &&
    !isFamousLandmarkCafe(poi)
  ) {
    return true;
  }

  const cafeOrRest =
    /\b(café|cafe|kaffee|coffee|rösterei|restaurant|imbiss|bistro)\b/.test(b);
  if (cafeOrRest) {
    if (isFamousLandmarkCafe(poi)) return false;
    if (wantsFoodContext(profile) || isMealWindow()) return false;
    // Generisches Café ohne Kontext
    if (
      /\b(café|cafe|kaffee|coffee|rösterei)\b/.test(b) &&
      !/museum|theater|denkmal|brücke|speicher|elphi|wunderland|dungeon|historisch/.test(
        b,
      )
    ) {
      return true;
    }
    // Generisches Restaurant ohne Kontext/Meal-Window
    if (/\b(restaurant|imbiss|bistro)\b/.test(b) && !isMealWindow()) {
      return true;
    }
  }

  return false;
}

function fameScore(poi: Poi): number {
  const imp = resolvePoiImportance(poi);
  if (imp === 'major') return 3;
  if (imp === 'standard') return 2;
  return 1;
}

function relevanceScore(poi: Poi, profile?: UserProfile | null): number {
  try {
    const r = evaluatePoiRelevance(poi, profile);
    if (r.verdict === 'skip') return -100;
    return r.score;
  } catch {
    return 0;
  }
}

/**
 * Sortiert: Relevanz ↓, Fame ↓, Distanz ↑ (nur Tie-Breaker).
 */
export function compareBundleCandidates(
  a: BundleCandidate,
  b: BundleCandidate,
  profile?: UserProfile | null,
): number {
  const ra = relevanceScore(a.poi, profile);
  const rb = relevanceScore(b.poi, profile);
  if (ra !== rb) return rb - ra;
  const fa = fameScore(a.poi);
  const fb = fameScore(b.poi);
  if (fa !== fb) return fb - fa;
  return a.distanceM - b.distanceM;
}

/**
 * Wählt max 2 Audio-Orte aus Hits im Bundle-Radius.
 * Primary (nächster Treffer) bleibt Anker, wenn nicht blacklisted.
 */
export function selectApproachBundle(
  candidates: BundleCandidate[],
  opts?: {
    profile?: UserProfile | null;
    /** Cluster-Zentrum (meist User oder Primary-POI) */
    bundleRadiusM?: number;
    primaryPoiId?: number;
  },
): ApproachBundleSelection {
  const radius = opts?.bundleRadiusM ?? WEGWEISER_BUNDLE_M;
  const profile = opts?.profile ?? null;

  const eligible = candidates
    .filter((c) => c.distanceM <= radius * 2) // caller usually already clustered
    .filter((c) => !isBlacklistedForApproachBundle(c.poi, profile));

  const ranked = [...eligible].sort((a, b) =>
    compareBundleCandidates(a, b, profile),
  );

  // Prefer keeping primary in spoken set if eligible
  const primaryId = opts?.primaryPoiId;
  let spoken: BundleCandidate[] = [];
  if (primaryId != null) {
    const primary = ranked.find((c) => c.poi.id === primaryId);
    if (primary) spoken.push(primary);
  }
  for (const c of ranked) {
    if (spoken.length >= APPROACH_BUNDLE_MAX_AUDIO) break;
    if (spoken.some((s) => s.poi.id === c.poi.id)) continue;
    spoken.push(c);
  }
  spoken = spoken.slice(0, APPROACH_BUNDLE_MAX_AUDIO);

  const spokenIds = new Set(spoken.map((s) => s.poi.id));
  const silentUi = ranked.filter((c) => !spokenIds.has(c.poi.id));

  return { spoken, silentUi };
}

/** Organischer Zweisatz für Audio (strikt ≤2 Namen). */
export function formatApproachBundleSpeech(opts: {
  names: string[];
  visualCue?: string | null;
}): string {
  const names = opts.names.map((n) => n.trim()).filter(Boolean).slice(0, 2);
  if (names.length === 0) return '';
  const cue = (opts.visualCue ?? '').trim();
  const prefix = cue ? `${cue} ` : '';
  if (names.length === 1) {
    return `${prefix}Hier in der Nähe: ${names[0]}.`.trim();
  }
  return (
    `${prefix}Hier rechts ist ${names[0]} und direkt gegenüber geht's ab zu ${names[1]}.`
  ).trim();
}
