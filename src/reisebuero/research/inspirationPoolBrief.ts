/**
 * Inspiration-Katalog → Prompt-Brief für Discover / Gem-Hunt.
 * Assist only: Google Search bleibt Pflicht; Katalog ist Accelerator, nicht Gehirn.
 */

import type { ReiseLedger } from '../types';
import {
  ALL_INSPIRATION_VIBES,
  inspirationSeedsForLedgerTags,
  listInspirationSeeds,
  type InspirationSeed,
  type InspirationVibe,
} from './inspirationCatalog';
import { intentArcFromLedger } from './shortlistFunnel';

const ASSIST_HEADER =
  'KATALOG-SEEDS (Assist only — Google Search bleibt Pflicht; nicht einzige Antwort; belege oder verwirf):';

export function ledgerTagsForInspiration(ledger: ReiseLedger): string[] {
  const tags: string[] = [];
  for (const m of ledger.mustHaves?.value ?? []) tags.push(String(m));
  for (const n of ledger.niceToHaves?.value ?? []) tags.push(String(n));
  const party = String(ledger.partyStyle?.value || '').toLowerCase();
  if (party === 'no' || party === 'kein' || party === 'none') tags.push('anti_party', 'quiet');
  if (/party|club|festival/i.test(party)) tags.push('party');
  const mode = String(ledger.mode?.value || '').toLowerCase();
  if (/spa|wellness|thermal/i.test(mode)) tags.push('spa');
  if (/family|familie/i.test(mode)) tags.push('family');
  if (/adventure|wandern|hike/i.test(mode)) tags.push('adventure', 'hike');
  if (/date|paar|romantik/i.test(mode)) tags.push('date');
  if (/cheap|deal|budget|schnäpp/i.test(mode)) tags.push('deal');
  if (ledger.dealHunt?.value === true) tags.push('deal', 'bargain');
  const disc = String(ledger.discoverIntent?.value || '');
  if (disc) tags.push(disc);
  const arc = intentArcFromLedger(ledger);
  if (arc === 'spa') tags.push('spa');
  if (arc === 'scenic') tags.push('adventure', 'hike');
  if (arc === 'party') tags.push('party');
  if (arc === 'beach') tags.push('family', 'sea');
  if (arc === 'roadtrip') tags.push('adventure');
  return [...new Set(tags.map((t) => t.toLowerCase()).filter(Boolean))];
}

export function primaryVibesFromLedger(ledger: ReiseLedger): InspirationVibe[] {
  const tags = ledgerTagsForInspiration(ledger);
  const seeds = inspirationSeedsForLedgerTags(tags);
  const vibes = [...new Set(seeds.map((s) => s.vibe))];
  if (vibes.length) return vibes.slice(0, 4);
  return ['adventure', 'date'];
}

function scoreSeed(s: InspirationSeed, tags: string[]): number {
  const set = new Set(tags);
  let score = 0;
  for (const t of s.tags || []) {
    if (set.has(t.toLowerCase())) score += 3;
  }
  if (s.whyFit) score += 1;
  if (s.lat != null && s.lng != null) score += 1;
  if (s.source === 'grounded') score += 2;
  if (s.source === 'pack') score += 1;
  return score;
}

/**
 * 4–8 Katalog-Zeilen (~≤550 Zeichen) als Such-Hilfe.
 */
export function buildInspirationResearchBrief(
  ledger: ReiseLedger,
  opts?: { maxLines?: number; maxChars?: number },
): string {
  const maxLines = opts?.maxLines ?? 7;
  const maxChars = opts?.maxChars ?? 550;
  const tags = ledgerTagsForInspiration(ledger);
  const vibes = primaryVibesFromLedger(ledger);

  let pool = inspirationSeedsForLedgerTags(tags);
  if (pool.length < 4) {
    const extra: InspirationSeed[] = [];
    for (const v of vibes.length ? vibes : ALL_INSPIRATION_VIBES) {
      extra.push(...listInspirationSeeds(v).slice(0, 8));
    }
    const seen = new Set(pool.map((s) => `${s.vibe}:${s.destLabel.toLowerCase()}`));
    for (const s of extra) {
      const k = `${s.vibe}:${s.destLabel.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pool.push(s);
    }
  }

  const ranked = [...pool].sort((a, b) => scoreSeed(b, tags) - scoreSeed(a, tags));
  const lines: string[] = [];
  const seenDest = new Set<string>();
  for (const s of ranked) {
    const destKey = s.destLabel.toLowerCase();
    if (seenDest.has(destKey)) continue;
    seenDest.add(destKey);
    const bit = s.whyFit?.slice(0, 72) || s.tags.slice(0, 3).join(',');
    const iata = s.iata ? ` · ${s.iata}` : '';
    lines.push(`- ${s.destLabel} (${s.region}${iata}) [${s.vibe}] ${bit}`);
    if (lines.length >= maxLines) break;
  }
  if (!lines.length) return '';

  let body = `${ASSIST_HEADER}\n${lines.join('\n')}`;
  if (body.length > maxChars) {
    body = body.slice(0, maxChars - 1).replace(/\n[^\n]*$/, '') + '…';
  }
  return body;
}

/** Für Smoke / Debug: wie viele Seeds würden in den Brief wandern. */
export function inspirationBriefSeedCount(ledger: ReiseLedger): number {
  const brief = buildInspirationResearchBrief(ledger);
  if (!brief) return 0;
  return (brief.match(/^- /gm) || []).length;
}
