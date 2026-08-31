/**
 * Owner-Gold Situation-Blaupausen — Founder-Testfeedback → Produkt-Struktur.
 * Bundled (sofort nach JS-Reload) + optional Supabase-Publish für Live-APK.
 * Doctrine: nur Constraints, keine Scripts / Orts-Hardcodes.
 */

import type {
  LearnedRuleAvoid,
  LearnedRuleExpect,
  LearnedRuleIntentFamily,
} from '../../types/learnedRules';
import type { SituationBlueprint } from '../../types/situationBlueprints';
import pack from './ownerGold.pack.json';

const FAMILIES: LearnedRuleIntentFamily[] = [
  'activity_poi',
  'dining',
  'events',
  'hotel',
  'navigation',
  'knowledge',
  'planning',
  'booking',
  'general',
];

const EXPECT: LearnedRuleExpect[] = [
  'prices',
  'duration',
  'booking_url',
  'website',
  'life_now',
  'short_history',
  'answer_first',
  'concrete_place',
  'route_button',
  'alternatives',
  'times_hours',
  'menu',
  'tickets',
];

const AVOID: LearnedRuleAvoid[] = [
  'long_history',
  'address_unless_asked',
  'gps_coords',
  'fake_promises',
  'permission_questions',
  'meta_app_pitch',
  'vague_filler',
  'nav_auto_start',
];

export function situationKeyFromParts(b: {
  intentFamily: string;
  expect: string[];
  avoid: string[];
}): string {
  const exp = [...b.expect].map((x) => x.toLowerCase()).sort().join('+') || 'none';
  const av = [...b.avoid].map((x) => x.toLowerCase()).sort().join('+') || 'none';
  return `${b.intentFamily}::${exp}::${av}`.slice(0, 180);
}

function filterFamily(raw: unknown): LearnedRuleIntentFamily {
  const s = String(raw ?? 'general').trim() as LearnedRuleIntentFamily;
  return FAMILIES.includes(s) ? s : 'general';
}

function filterExpect(raw: unknown): LearnedRuleExpect[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x).trim() as LearnedRuleExpect)
    .filter((x) => EXPECT.includes(x));
}

function filterAvoid(raw: unknown): LearnedRuleAvoid[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x).trim() as LearnedRuleAvoid)
    .filter((x) => AVOID.includes(x));
}

export function validateOwnerGoldSummary(summary: string): boolean {
  const s = summary.replace(/\s+/g, ' ').trim();
  if (s.length < 12 || s.length > 200) return false;
  if (/^(sag genau|du musst sagen|wortlaut:)/i.test(s)) return false;
  if (/\b(prisdorf|wangerooge|laboe|lübeck|luebeck)\b/i.test(s)) return false;
  return true;
}

export function normalizeOwnerGoldBlueprint(
  raw: unknown,
): SituationBlueprint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const intentFamily = filterFamily(o.intentFamily);
  const expect = filterExpect(o.expect);
  const avoid = filterAvoid(o.avoid);
  const summary = String(o.summary ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!expect.length && !avoid.length && !summary) return null;
  if (summary && !validateOwnerGoldSummary(summary)) return null;
  const tags = Array.isArray(o.tags)
    ? o.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : [];
  const situationKey =
    String(o.situationKey ?? '').trim() ||
    situationKeyFromParts({ intentFamily, expect, avoid });
  return {
    situationKey: situationKey.slice(0, 180),
    intentFamily,
    tags,
    expect,
    avoid,
    summary: summary || 'Antwortstruktur aus Founder-Feedback',
    source: 'owner_gold',
    version: Math.max(1, Math.floor(Number(o.version) || 1)),
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
  };
}

export function getOwnerGoldBlueprints(): SituationBlueprint[] {
  const list = (pack as { blueprints?: unknown[] }).blueprints;
  if (!Array.isArray(list)) return [];
  const out: SituationBlueprint[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const b = normalizeOwnerGoldBlueprint(item);
    if (!b || seen.has(b.situationKey)) continue;
    seen.add(b.situationKey);
    out.push(b);
  }
  return out.slice(0, 40);
}

/** Downloaded pack + Owner-Gold. Gold gewinnt bei gleichem Key. */
export function mergeOwnerGoldIntoPack(
  downloaded: SituationBlueprint[],
  gold: SituationBlueprint[] = getOwnerGoldBlueprints(),
): SituationBlueprint[] {
  const map = new Map<string, SituationBlueprint>();
  for (const b of downloaded) {
    if (b?.situationKey) map.set(b.situationKey, b);
  }
  for (const g of gold) {
    map.set(g.situationKey, g);
  }
  return [...map.values()];
}
