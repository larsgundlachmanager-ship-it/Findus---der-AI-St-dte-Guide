/**
 * Modul-2: lokale Pack-Fakten (SQLite) zu einem Subject / Ortsnamen.
 * Pack zuerst für stabile Fakten; Live-Hints markieren ephemeral Nachsuche.
 */

import { getAllPois, getFactsForPoi, haversineMeters } from '../../db/database';
import type { Fact, Poi } from '../../db/types';
import { parseTagsJson } from '../../services/geo/triggerPolicy';
import {
  formatOfflineQaForAgent,
  lookupOfflineQa,
} from '../../services/research/offlineQaRegistry';
import { isDeicticPoiQuestion } from '../../services/intent/poiInfoVsNav';

const PREFIX_RE =
  /^\[(Kurzfakt|Erzählung|Detail|FAQ|Teaser|Hook|Narration|CTA|Thema:[^\]]+)\]\s*/iu;

const CATEGORY_QUERY_RE: Array<{ re: RegExp; category: string }> = [
  { re: /\b(supermarkt|lidl|aldi|rewe|edeka|kaufland|einkaufen)\b/i, category: 'supermarket' },
  { re: /\b(apotheke|medikament)\b/i, category: 'apotheke' },
  { re: /\b(restaurant|essen|gastro|imbiss)\b/i, category: 'restaurant' },
  { re: /\b(café|cafe|kaffee|bäckerei|baeckerei)\b/i, category: 'cafe' },
  { re: /\b(hotel|pension|übernacht|uebernacht)\b/i, category: 'hotel' },
  { re: /\b(spielplatz)\b/i, category: 'spielplatz' },
  { re: /\b(golf)\b/i, category: 'golf' },
  { re: /\b(kino|theater|konzert)\b/i, category: 'kino' },
  { re: /\b(tankstelle|benzin)\b/i, category: 'tankstelle' },
  { re: /\b(wandern|wanderweg|wanderung|lehrpfad|uferweg|naturpfad|trail)\b/i, category: 'wanderung' },
  { re: /\b(fahrradweg|radweg|radroute|radtour|fernradweg|veloroute|radeln)\b/i, category: 'radweg' },
  { re: /\b(naturschutz|park|natur)\b/i, category: 'natur' },
  { re: /\b(klettern|boulder|sport|schwimmen|bad)\b/i, category: 'sport' },
];

export type PackFactHit = {
  poi: Poi;
  facts: string[];
  liveHints: string[];
  score: number;
  /** Distanz User→POI wenn GPS da (Deiktik / Nähe). */
  distanceM?: number;
  /** Mehrere Directory-Treffer (Kategorie-Frage). */
  directoryPeers?: Array<{ name: string; category: string | null }>;
  /** Ambige „was ist das?“ — Alternativen zum Einkreisen. */
  placeCandidates?: Array<{
    name: string;
    lat: number;
    lng: number;
    distanceM: number;
    score: number;
  }>;
  offlineQaBlock?: string;
};

/** Sicht-/Frage-Radius für „was ist das hier?“ (Pack, 0 € API). */
const DEICTIC_NEAR_M = 220;
const DEICTIC_MAX_CANDIDATES = 4;

function stripPrefix(text: string): string {
  return text
    .replace(PREFIX_RE, '')
    .replace(/<<[^>]*>>/g, ' ')
    .replace(/\[[ˈˌ][^\]\n]{0,80}\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLiveHint(raw: string): boolean {
  return (
    /\[Thema:live(_hint|_research)?\]/i.test(raw) ||
    /\bLIVE\s*:/i.test(raw) ||
    /\blive_hint\b/i.test(raw) ||
    /\b(speisekarte|menü|menu|event|konzert|tour|preis|öffnungszeit).{0,40}(suchen|aktuell|live|nachschauen|recherch)/i.test(
      raw,
    )
  );
}

function nameScore(poiName: string, subject: string): number {
  const a = poiName.trim().toLowerCase();
  const b = subject.trim().toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 70;
  const at = a.split(/[^a-zäöüß0-9]+/i).filter((t) => t.length > 2);
  const bt = b.split(/[^a-zäöüß0-9]+/i).filter((t) => t.length > 2);
  let hit = 0;
  for (const t of bt) if (at.some((x) => x.includes(t) || t.includes(x))) hit += 1;
  if (!bt.length) return 0;
  return Math.round((hit / bt.length) * 50);
}

async function factsForPoiId(
  poiId: number,
  limit: number,
): Promise<{ facts: string[]; liveHints: string[] }> {
  let factsRaw: Fact[] = [];
  try {
    factsRaw = await getFactsForPoi(poiId);
  } catch {
    return { facts: [], liveHints: [] };
  }
  const facts: string[] = [];
  const liveHints: string[] = [];
  for (const f of factsRaw) {
    const raw = (f.fact_text || '').trim();
    if (!raw) continue;
    if (isLiveHint(raw)) {
      liveHints.push(stripPrefix(raw));
      continue;
    }
    if (/^\[Teaser\]/i.test(raw)) continue;
    const clean = stripPrefix(raw);
    if (clean.length < 20) continue;
    facts.push(clean);
    if (facts.length >= limit) break;
  }
  return { facts, liveHints };
}

/**
 * Findet den besten Pack-POI zum Subject und liefert stabile Fakten + Live-Hints.
 * Zusätzlich: Kategorie-Directory und `_offline_qa`.
 */
export async function lookupPackFactsForSubject(opts: {
  subject: string;
  cityHint?: string | null;
  lat?: number | null;
  lng?: number | null;
  limitFacts?: number;
}): Promise<PackFactHit | null> {
  const subject = (opts.subject || '').trim();
  if (subject.length < 2) return null;

  const offlineQa = lookupOfflineQa(subject, 4);
  const offlineQaBlock = formatOfflineQaForAgent(offlineQa);

  let pois: Poi[] = [];
  try {
    pois = await getAllPois();
  } catch {
    if (offlineQaBlock) {
      return {
        poi: {
          id: 0,
          name: 'Offline-Q&A',
          lat: opts.lat ?? 0,
          lng: opts.lng ?? 0,
          radius_meters: 0,
        },
        facts: offlineQa.map((e) => `${e.q} → ${e.a}`),
        liveHints: [],
        score: 40,
        offlineQaBlock,
      };
    }
    return null;
  }
  if (!pois.length) {
    if (offlineQaBlock) {
      return {
        poi: {
          id: 0,
          name: 'Offline-Q&A',
          lat: opts.lat ?? 0,
          lng: opts.lng ?? 0,
          radius_meters: 0,
        },
        facts: offlineQa.map((e) => `${e.q} → ${e.a}`),
        liveHints: [],
        score: 40,
        offlineQaBlock,
      };
    }
    return null;
  }

  const limit = opts.limitFacts ?? 14;

  // „Was ist das?“ → nächste Pack-POIs (nicht Namenssuche, nicht Google)
  if (
    isDeicticPoiQuestion(subject) &&
    opts.lat != null &&
    opts.lng != null &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng)
  ) {
    const nearby = pois
      .filter((p) => p.kind !== 'approach')
      .map((p) => ({
        poi: p,
        d: haversineMeters(opts.lat!, opts.lng!, p.lat, p.lng),
      }))
      .filter((x) => x.d <= DEICTIC_NEAR_M)
      .sort((a, b) => a.d - b.d);
    const bestNear = nearby[0];
    if (bestNear) {
      const { facts, liveHints } = await factsForPoiId(bestNear.poi.id, limit);
      const placeCandidates = nearby.slice(0, DEICTIC_MAX_CANDIDATES).map((x) => ({
        name: x.poi.name,
        lat: x.poi.lat,
        lng: x.poi.lng,
        distanceM: Math.round(x.d),
        score: Math.max(40, 95 - Math.floor(x.d / 5)),
      }));
      const ambigNote =
        placeCandidates.length > 1
          ? `PACK-KANDIDATEN in ~${DEICTIC_NEAR_M} m (User kann meinen): ${placeCandidates
              .map((c) => `${c.name} (${c.distanceM} m)`)
              .join('; ')}. Primär nächster Treffer; bei Unsicherheit kurz die 2 nächsten nennen.`
          : null;
      return {
        poi: bestNear.poi,
        facts: ambigNote
          ? [ambigNote, ...facts].slice(0, limit)
          : facts,
        liveHints: liveHints.slice(0, 6),
        score: Math.max(60, 95 - Math.floor(bestNear.d / 5)),
        distanceM: Math.round(bestNear.d),
        placeCandidates,
        offlineQaBlock: offlineQaBlock || undefined,
      };
    }
  }

  const catHit = CATEGORY_QUERY_RE.find((c) => c.re.test(subject));
  if (catHit) {
    const peers = pois
      .filter((p) => p.kind !== 'approach' && p.kind !== 'sub')
      .filter((p) => {
        const cat = (p.category || '').toLowerCase();
        const tags = parseTagsJson(p.tags_json);
        return (
          cat === catHit.category ||
          tags.includes(catHit.category) ||
          catHit.re.test(`${p.name} ${cat}`)
        );
      })
      .slice(0, 10);
    if (peers.length) {
      const best = peers[0];
      const { facts, liveHints } = await factsForPoiId(best.id, limit);
      const listFact = `Im Offline-Katalog (${catHit.category}): ${peers
        .map((p) => p.name)
        .join('; ')}.`;
      return {
        poi: best,
        facts: [listFact, ...facts].slice(0, limit),
        liveHints: liveHints.slice(0, 6),
        score: 75,
        directoryPeers: peers.map((p) => ({
          name: p.name,
          category: p.category ?? null,
        })),
        offlineQaBlock: offlineQaBlock || undefined,
      };
    }
  }

  const ranked: Array<{ poi: Poi; score: number }> = [];
  for (const poi of pois) {
    if (poi.kind === 'approach') continue;
    let score = nameScore(poi.name, subject);
    if (score < 25) continue;
    if (opts.lat != null && opts.lng != null) {
      const d = haversineMeters(opts.lat, opts.lng, poi.lat, poi.lng);
      score += Math.max(0, 15 - Math.min(15, Math.floor(d / 400)));
    }
    ranked.push({ poi, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if ((!best || best.score < 30) && offlineQaBlock) {
    return {
      poi: {
        id: 0,
        name: 'Offline-Q&A',
        lat: opts.lat ?? 0,
        lng: opts.lng ?? 0,
        radius_meters: 0,
      },
      facts: offlineQa.map((e) => `${e.q} → ${e.a}`),
      liveHints: [],
      score: 40,
      offlineQaBlock,
    };
  }
  if (!best || best.score < 30) return null;

  const { facts, liveHints } = await factsForPoiId(best.poi.id, limit);

  return {
    poi: best.poi,
    facts,
    liveHints: liveHints.slice(0, 6),
    score: best.score,
    offlineQaBlock: offlineQaBlock || undefined,
  };
}

export function formatPackFactsForAgent(hit: PackFactHit): string {
  const dist =
    hit.distanceM != null ? ` · ~${hit.distanceM} m vom User` : '';
  const lines = [
    `PACK-DATENSATZ (stabil, offline) — Ort: ${hit.poi.name}${dist}`,
    'Nutze diese Fakten als primäre Quelle. Erfinde nichts darüber hinaus.',
    'TOPIC-LOCK: Folgefragen beziehen sich auf DIESEN Ort — nicht auf einen älteren Thread.',
    ...hit.facts.slice(0, 12).map((t, i) => `${i + 1}. ${t}`),
  ];
  if (hit.placeCandidates && hit.placeCandidates.length > 1) {
    lines.push(
      'NÄHE-KANDIDATEN (Pack, kostenlos):',
      ...hit.placeCandidates.map(
        (c) => `- ${c.name} · ${c.distanceM} m`,
      ),
    );
  }
  if (hit.directoryPeers?.length) {
    lines.push(
      'DIRECTORY-PEERS (weitere Offline-Katalog-Treffer zur Kategorie):',
      ...hit.directoryPeers.slice(0, 8).map((p) => `- ${p.name}`),
    );
  }
  if (hit.offlineQaBlock) {
    lines.push(hit.offlineQaBlock);
  }
  if (hit.liveHints.length) {
    lines.push(
      'LIVE-HINTS aus Pack (ephemeral — jetzt frisch suchen, keine alten Preise/Termine vorlesen):',
    );
    for (const h of hit.liveHints) lines.push(`- ${h}`);
  } else {
    lines.push(
      'LIVE: Preise, heutige Events, Öffnungszeiten nur frisch recherchieren wenn der User danach fragt — keine ungefragten Restaurant-Vorschläge an reine Faktenfragen hängen.',
    );
  }
  return lines.join('\n');
}
