/**
 * Owner-Gold Katalog für Call-1 Manager — wählbare Situations-Muster, keine Scripts.
 * Call-1 soll Absicht erkennen und Gold analog auf ungesehene Formulierungen übertragen.
 */

import type { SituationBlueprint } from '../../types/situationBlueprints';
import { getOwnerGoldBlueprints } from '../blueprints/ownerGold';

const CATALOG_SUMMARY_CHARS = 240;
const SELECTED_SUMMARY_CHARS = 240;
const CATALOG_MAX = 64;

/** Bundled Gold + remote active blueprints (ohne APK-Release). */
export function collectOwnerGoldCatalog(): SituationBlueprint[] {
  const bundled = getOwnerGoldBlueprints();
  const map = new Map<string, SituationBlueprint>();
  for (const b of bundled) {
    if (b?.situationKey) map.set(b.situationKey, b);
  }
  try {
    const { getCachedSituationBlueprintsSync } = require('../../services/memory/betaSituationQueue') as {
      getCachedSituationBlueprintsSync: () => SituationBlueprint[];
    };
    for (const b of getCachedSituationBlueprintsSync() || []) {
      if (b?.situationKey) map.set(b.situationKey, b);
    }
  } catch {
    /* soft — nur bundled */
  }
  return [...map.values()].slice(0, CATALOG_MAX);
}

/**
 * Weiche Family-Hints nur für Katalog-Reihenfolge — nie Execution erzwingen.
 * Call-1 entscheidet weiterhin selbst.
 */
export function inferOwnerGoldFamilyHints(userText: string): string[] {
  const t = String(userText || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const hints: string[] = [];
  const push = (f: string) => {
    if (!hints.includes(f)) hints.push(f);
  };
  try {
    const { looksLikeDateWindowWhatsOnAsk } = require('../../services/concierge/eventDateWindow') as {
      looksLikeDateWindowWhatsOnAsk: (s: string) => boolean;
    };
    if (looksLikeDateWindowWhatsOnAsk(t)) push('events');
  } catch {
    /* soft */
  }
  if (
    /\b(was\s+geht|was\s+(?:da\s+)?los|events?|veranstaltung|festival|konzert|kino|programm)\b/iu.test(
      t,
    )
  ) {
    push('events');
  }
  if (
    /\b(flug|fliegen|hotel|mietwagen|reisebüro|reisebuero|urlaub|kurztrip|wochenende\s+nach|plane\s+mir|inspiration)\b/iu.test(
      t,
    ) &&
    !hints.includes('events')
  ) {
    push('planning');
  }
  if (
    /\b(essen|restaurant|pizza|steak|café|cafe|frühstück|fruehstueck|ayce|buffet|speisekarte)\b/iu.test(
      t,
    )
  ) {
    push('dining');
  }
  if (/\b(nav|navigation|route|bring\s+mich|fahr\s+mich|zu\s+fu[ßs]|öpnv|opnv)\b/iu.test(t)) {
    push('navigation');
  }
  if (
    /\b(wer\s+ist|wie\s+alt|einwohner|wetter|sonnenuntergang|sonnenaufgang|rechnung|\d+\s*[+\-×x*\/]\s*\d+)\b/iu.test(
      t,
    )
  ) {
    push('knowledge');
  }
  if (/\b(wasserski|verleih|sup\b|surf|museum|zoo|aktivität|aktivitaet)\b/iu.test(t)) {
    push('activity_poi');
  }
  return hints.slice(0, 4);
}

function rankGoldForCall1(
  gold: SituationBlueprint[],
  preferredFamily?: string | null,
  familyHints?: string[] | null,
): SituationBlueprint[] {
  const fam = (preferredFamily || '').trim().toLowerCase();
  const hints = (familyHints || [])
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const score = (b: SituationBlueprint): number => {
    const f = String(b.intentFamily || '').toLowerCase();
    let s = 0;
    if (fam && f === fam) s += 100;
    const hi = hints.indexOf(f);
    if (hi >= 0) s += 50 - hi * 8;
    // Situation-Keys mit v1-Blaupausen (Founder-Feedback) leicht bevorzugen
    if (/_v\d+$/i.test(b.situationKey || '')) s += 2;
    return s;
  };
  return [...gold].sort((a, b) => score(b) - score(a));
}

export function formatSelectedGoldForCall2(
  selectedKeys: string[] | null | undefined,
  gold: SituationBlueprint[] = collectOwnerGoldCatalog(),
): string {
  const keys = (selectedKeys || []).map((k) => k.trim()).filter(Boolean);
  let picked = gold.filter((b) => keys.length && keys.includes(b.situationKey));
  // Autonomy Reboot: leere Keys → Family-Meta (erste Blaupause je Family), nie stumm.
  if (!picked.length) {
    picked = formatFamilyGoldFallback(gold);
  }
  if (!picked.length) return '';
  return [
    'OWNER_GOLD_GEWAEHLT (Struktur-Muster — Wortlaut frei; analog auf DIESE Frage übertragen):',
    ...picked.map((b) => {
      const exp = (b.expect || []).join(',');
      const av = (b.avoid || []).join(',');
      return `- ${b.intentFamily}/${b.situationKey}: expect=[${exp}] avoid=[${av}] — ${String(b.summary || '').slice(0, SELECTED_SUMMARY_CHARS)}`;
    }),
  ].join('\n');
}

/** Eine Meta-Karte pro intentFamily (max 8) wenn Call-1 keine Keys wählte. */
export function formatFamilyGoldFallback(
  gold: SituationBlueprint[] = collectOwnerGoldCatalog(),
): SituationBlueprint[] {
  const seen = new Set<string>();
  const out: SituationBlueprint[] = [];
  for (const b of gold) {
    const fam = String(b.intentFamily || '').trim() || 'general';
    if (seen.has(fam)) continue;
    seen.add(fam);
    out.push(b);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Voller Gold-Katalog für Call-1: Situations-Muster zum selbst Erschließen.
 * preferredFamily / familyHints = nur Sortierung, keine Pflichtwahl.
 */
export function formatOwnerGoldCatalogForCall1(
  gold: SituationBlueprint[] = collectOwnerGoldCatalog(),
  preferredFamily?: string | null,
  familyHints?: string[] | null,
): string {
  if (!gold.length) return '';
  const ranked = rankGoldForCall1(gold, preferredFamily, familyHints).slice(
    0,
    CATALOG_MAX,
  );
  const lines = ranked.map((b, i) => {
    const exp = (b.expect || []).slice(0, 6).join(',');
    const av = (b.avoid || []).slice(0, 6).join(',');
    const sum = String(b.summary || '').slice(0, CATALOG_SUMMARY_CHARS);
    return `${i + 1}. key=${b.situationKey} family=${b.intentFamily} expect=[${exp}] avoid=[${av}] — ${sum}`;
  });
  return [
    'OWNER_GOLD_KATALOG (Situations-Muster — keine Scripts, keine Test-Wortlaute):',
    'Nutze so: (1) Absicht DIESES Satzes erkennen (FRAGE-ART). (2) 0–N keys wählen deren Situation passt — auch wenn Wortlaut/Stadt/Datum anders sind als je getestet. (3) Daraus execution + call2Brief-Struktur ableiten. (4) Passt nichts → [] und analog selbst planen. Nie „fehlt in Gold → Laber“. Nie Orts-Hardcodes aus Summaries übernehmen.',
    ...lines,
  ].join('\n');
}
