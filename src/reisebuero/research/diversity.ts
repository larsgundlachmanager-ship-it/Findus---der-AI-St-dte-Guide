/**
 * Option-Diversität: 4 echte Alternativen, keine 2× dieselbe Stadt/Metro.
 * Soft-Wünsche (AI optional): Mix AI + Non-AI.
 */

import type { ReiseLedger, ReiseOption } from '../types';
import type { SeedPlace } from './candidates';

/** Metro-/Stadt-Schlüssel — Palma/Magaluf → palma, Timmendorfer Strand → timmendorfer */
export function metroKey(nameOrId: string): string {
  const raw = (nameOrId || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  // bekannte Cluster
  if (/palma|magaluf|alcudia|mallorca|calvia|playa de palma/.test(raw)) return 'mallorca';
  if (/ibiza|san antonio|platja d.?en bossa/.test(raw)) return 'ibiza';
  if (/timmendorf|scharbeutz|pelzerhaken|travemuende|travemunde/.test(raw)) return 'luebecker_bucht';
  if (/amsterdam|haarlem/.test(raw)) return 'amsterdam';
  if (/budapest|ofla|ófla/.test(raw)) return 'budapest';
  if (/prag|prague/.test(raw)) return 'prag';
  if (/barcelona/.test(raw)) return 'barcelona';
  if (/berlin/.test(raw)) return 'berlin';
  if (/koeln|cologne|köln/.test(raw)) return 'koeln';
  if (/krakow|krakau/.test(raw)) return 'krakow';
  if (/antalya|alanya|side|kemer/.test(raw)) return 'antalya';
  const cleaned = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  return cleaned.split(/\s+/)[0] || cleaned || 'x';
}

export function pickDiversePlaces(pool: SeedPlace[], target: number): SeedPlace[] {
  const out: SeedPlace[] = [];
  const used = new Set<string>();
  for (const p of pool) {
    const k = metroKey(p.name || p.id);
    if (used.has(k)) continue;
    used.add(k);
    out.push(p);
    if (out.length >= target) return out;
  }
  for (const p of pool) {
    if (out.length >= target) break;
    if (!out.some((x) => x.id === p.id)) out.push(p);
  }
  return out;
}

export function pickDiverseOptions(scored: ReiseOption[], n = 4): ReiseOption[] {
  const out: ReiseOption[] = [];
  const used = new Set<string>();
  for (const o of scored) {
    const k = metroKey(o.placeName || o.id);
    if (used.has(k)) continue;
    used.add(k);
    out.push(o);
    if (out.length >= n) return out;
  }
  for (const o of scored) {
    if (out.length >= n) break;
    if (!out.some((x) => x.id === o.id)) out.push(o);
  }
  return out;
}

function isAiOption(o: ReiseOption): boolean {
  if (o.softFacts?.some((f) => f.id === 'meals_ai' && f.met)) return true;
  if (o.stays?.some((s) => /all.?inclusive|all inclusive|pauschal/i.test(`${s.name} ${s.why}`))) {
    return true;
  }
  if (o.gaps.some((g) => /all.?inclusive belegt/i.test(g))) return true;
  return /all.?inclusive/i.test(o.whyBlurb || '');
}

function softAiWanted(ledger: ReiseLedger): boolean {
  return (
    ledger.meals?.value === 'all' &&
    (ledger.meals.hardness === 'optional' || ledger.meals.hardness === 'wish')
  );
}

function hardAiWanted(ledger: ReiseLedger): boolean {
  return ledger.meals?.value === 'all' && ledger.meals.hardness === 'must';
}

/**
 * Soft AI: bis 2 AI-Optionen + Rest ohne AI (diverse Städte).
 * Hard AI: AI zuerst, dann Fill.
 * Sonst: Diversität + Deal/Geheimtipp-Boost schon im Score.
 */
export function pickFinalOptions(
  scored: ReiseOption[],
  ledger: ReiseLedger,
  n = 4,
): ReiseOption[] {
  const boosted = [...scored].sort((a, b) => {
    const gemA = gemBoost(a);
    const gemB = gemBoost(b);
    if (gemB !== gemA) return gemB - gemA;
    return b.matchScore - a.matchScore || a.gaps.length - b.gaps.length;
  });
  if (!boosted.length) return [];
  if (softAiWanted(ledger)) {
    const ai = boosted.filter(isAiOption);
    const non = boosted.filter((o) => !isAiOption(o));
    const out: ReiseOption[] = [];
    out.push(...pickDiverseOptions(ai, Math.min(2, n)));
    out.push(...pickDiverseOptions(non, n - out.length));
    return pickDiverseOptions([...out, ...boosted], n);
  }
  if (hardAiWanted(ledger)) {
    const ai = boosted.filter(isAiOption);
    const rest = boosted.filter((o) => !isAiOption(o));
    return pickDiverseOptions([...ai, ...rest], n);
  }
  // Mind. 1 Gem/Deal in den Finalisten wenn vorhanden
  const gems = boosted.filter((o) => gemBoost(o) > 0);
  if (gems.length && n >= 2) {
    const first = pickDiverseOptions(gems, 1);
    const rest = pickDiverseOptions(
      boosted.filter((o) => !first.some((f) => f.id === o.id)),
      n - first.length,
    );
    return [...first, ...rest];
  }
  return pickDiverseOptions(boosted, n);
}

function gemBoost(o: ReiseOption): number {
  let n = 0;
  if (o.dealHit) n += 3;
  const blob = `${o.whyBlurb || ''} ${(o.decisionNotes ?? []).join(' ')} ${o.gaps.join(' ')}`.toLowerCase();
  if (/geheim|exklusiv|exclusive|schnäppchen|schnaeppchen|preisfehler/.test(blob)) n += 2;
  if (o.softFacts?.some((f) => /geheim|deal|exclusive/.test(f.id))) n += 1;
  return n;
}

export function isPartyLedger(ledger: ReiseLedger): boolean {
  const ids = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
  if (ids.includes('party')) return true;
  if (ledger.partyGrain || ledger.cheapDrinks?.value) return true;
  return /party|feier|männerwochenende|maennerwochenende|jungs/i.test(
    ledger.purpose?.value ?? '',
  );
}

export function isSpaLedger(ledger: ReiseLedger): boolean {
  const ids = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
  if (ids.some((id) => id === 'spa' || id === 'sauna' || id === 'massage')) return true;
  return /spa|wellness/i.test(ledger.purpose?.value ?? '');
}
