/**
 * Finale Reisebüro-Recherche: Gemini Pro + Google Search Grounding.
 * Collect-Phase bleibt Lite; erst der Funnel eskaliert auf Pro.
 */

import { FINDUS_FEW_SHOT_DISCLAIMER } from '../../services/concierge/findusResponsePolicy';
import {
  generateGeminiText,
  hasGeminiApiKey,
} from '../../services/geminiService';
import { buildRecapLines } from '../completeness';
import type { ReiseLedger, ReiseOption } from '../types';
import type { SeedPlace } from './candidates';
import { SEED_PLACES } from './candidates';
import {
  extractJsonObject,
  parseProDiscoverJson,
  proCandidateToSeed,
  slugId,
  type ProDestCandidate,
} from './proEnrichParse';

export type { ProDestCandidate } from './proEnrichParse';
export { parseProDiscoverJson, proCandidateToSeed, slugId } from './proEnrichParse';

export type ProEnrichResult = {
  destinations: ProDestCandidate[];
  researchNotes: string;
  usedPro: boolean;
};

/** Genanntes Ziel aus dem Ledger → Seed (Geocode), auch außerhalb SEED_PLACES. */
export async function resolveNamedDestinationSeed(
  ledger: ReiseLedger,
): Promise<SeedPlace | null> {
  const hint = (ledger.destinationHint?.value || '').trim();
  if (!hint || /^offen$/iu.test(hint)) return null;
  const inSeed = SEED_PLACES.find(
    (p) =>
      p.name.toLowerCase() === hint.toLowerCase() ||
      p.id === slugId(hint) ||
      p.wiki.toLowerCase().includes(hint.toLowerCase()),
  );
  if (inSeed) return { ...inSeed };
  try {
    const { geocodePlaceName } = await import(
      '../../services/navigation/googleMapsNav'
    );
    const geo = await geocodePlaceName(hint, { cityHint: hint });
    if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) {
      return null;
    }
    return {
      id: slugId(hint),
      name: hint,
      lat: geo.lat,
      lng: geo.lng,
      tags: ['city', 'fly', 'named'],
      wiki: hint,
    };
  } catch {
    return null;
  }
}

export async function runReisebueroProDiscover(
  ledger: ReiseLedger,
  opts?: { usePro?: boolean },
): Promise<ProEnrichResult> {
  const empty: ProEnrichResult = {
    destinations: [],
    researchNotes: '',
    usedPro: false,
  };
  if (!hasGeminiApiKey()) return empty;

  const usePro = opts?.usePro === true;
  const board = buildRecapLines(ledger).join(' · ');
  const named = (ledger.destinationHint?.value || '').trim();
  const corridor = (ledger.corridor?.value || '').trim();
  const open =
    !named || /^offen$/iu.test(named)
      ? 'Ziel offen — mehrere passende Orte vorschlagen.'
      : `Ziel genannt: ${named}. Vertiefe Alternativen in derselben Region nur wenn Fit besser.`;

  const prompt = [
    FINDUS_FEW_SHOT_DISCLAIMER,
    'Du bist die Destination-Recherche für Yorro Reisebüro.',
    'Nutze Google Search. Nur belegte Orte. Nichts erfinden.',
    usePro ? 'Tiefe erste Auswahl (Pro).' : 'Korrektur/Refine (Lite) — schnell, Board schon bekannt.',
    `BOARD: ${board || '(leer)'}`,
    open,
    corridor ? `Korridor: ${corridor}` : '',
    usePro
      ? 'Liefere 4–8 Destinationen die Hard Facts + Musts treffen (Budget, Anreise, Pool, Strand, Party, …).'
      : 'Liefere 3–6 Destinationen passend zum korrigierten Board.',
    'Koordinaten ungefähr (Stadtmitte) wenn bekannt. IATA nur wenn klar.',
    'JSON: {"destinations":[{"name":"","lat":0,"lng":0,"iata":null,"wiki":"","tags":["sea","city"],"whyFit":"kurz warum Board passt"}],"notes":"1 Satz Recherche"}',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      costModule: 'research',
      ...(usePro
        ? { tier: 'pro' as const, forcePro: true, allowProEscalate: false }
        : { tier: 'lite' as const, forcePro: false, allowProEscalate: false }),
      enableGoogleSearch: true,
      maxTokens: usePro ? 2200 : 1200,
      temperature: 0.25,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
    });
    const parsed = extractJsonObject(raw || '');
    const destinations = parseProDiscoverJson(raw || '');
    const notes =
      typeof parsed?.notes === 'string' ? parsed.notes.trim().slice(0, 240) : '';
    return {
      destinations,
      researchNotes: notes,
      usedPro: usePro,
    };
  } catch {
    return empty;
  }
}

export type ProRankPatch = {
  whyBlurb: string;
  whyMatch: [string, string] | [string];
  boost: number;
};

/** Fit-Bewertung über Live-Optionen — Pro nur bei erster Auswahl. */
export async function runReisebueroProRankOptions(opts: {
  ledger: ReiseLedger;
  options: ReiseOption[];
  usePro?: boolean;
}): Promise<Map<string, ProRankPatch>> {
  const map = new Map<string, ProRankPatch>();
  if (!hasGeminiApiKey() || opts.options.length === 0) return map;

  const usePro = opts.usePro === true;
  const board = buildRecapLines(opts.ledger).join(' · ');
  const compact = opts.options.map((o) => ({
    id: o.id,
    place: o.placeName,
    stay: o.stayName,
    priceEur: o.totalEur ?? o.stayPriceEur,
    flightEur: o.flightPriceEur ?? null,
    gaps: o.gaps.slice(0, 4),
    why: o.whyBlurb,
  }));

  const prompt = [
    FINDUS_FEW_SHOT_DISCLAIMER,
    'Fit-Bewertung Reisebüro. Live-Preise/Lücken stehen fest — nichts erfinden.',
    usePro ? 'Erste Auswahl (Pro).' : 'Korrektur (Lite).',
    `BOARD: ${board}`,
    `OPTIONS: ${JSON.stringify(compact)}`,
    'Pro Option: whyBlurb (1 Satz menschlich), whyMatch (1–2 kurze Gründe), boost (-2..+3 Score-Zusatz).',
    'JSON: {"ranks":[{"id":"","whyBlurb":"","whyMatch":["",""],"boost":0}]}',
  ].join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      costModule: 'research',
      ...(usePro
        ? { tier: 'pro' as const, forcePro: true, allowProEscalate: false }
        : { tier: 'lite' as const, forcePro: false, allowProEscalate: false }),
      enableGoogleSearch: true,
      maxTokens: usePro ? 1600 : 900,
      temperature: 0.3,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
    });
    const parsed = extractJsonObject(raw || '');
    const ranks = Array.isArray(parsed?.ranks) ? parsed!.ranks : [];
    for (const row of ranks) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : '';
      if (!id) continue;
      const whyBlurb =
        typeof r.whyBlurb === 'string' && r.whyBlurb.trim()
          ? r.whyBlurb.trim().slice(0, 200)
          : '';
      const wm = Array.isArray(r.whyMatch)
        ? r.whyMatch.map((x) => String(x).trim()).filter(Boolean).slice(0, 2)
        : [];
      const boost =
        typeof r.boost === 'number' && Number.isFinite(r.boost)
          ? Math.max(-2, Math.min(3, Math.round(r.boost)))
          : 0;
      if (!whyBlurb && !wm.length && !boost) continue;
      const whyMatch: [string, string] | [string] =
        wm.length >= 2 ? [wm[0]!, wm[1]!] : wm.length === 1 ? [wm[0]!] : [whyBlurb || 'passt'];
      map.set(id, {
        whyBlurb: whyBlurb || whyMatch[0]!,
        whyMatch,
        boost,
      });
    }
  } catch {
    /* soft */
  }
  return map;
}

/** Flugpreis-Stich — Pro nur erste Auswahl, sonst Lite. */
export async function proFlightPriceHint(opts: {
  fromIata: string;
  toIata: string;
  destName: string;
  dateKey: string;
  usePro?: boolean;
}): Promise<{ priceEur: number | null; note: string | null }> {
  if (!hasGeminiApiKey() || !opts.fromIata || !opts.toIata) {
    return { priceEur: null, note: null };
  }
  const usePro = opts.usePro === true;
  const prompt = [
    FINDUS_FEW_SHOT_DISCLAIMER,
    `Belegter günstiger Flugpreis ${opts.fromIata} → ${opts.toIata} (${opts.destName}) ab ${opts.dateKey}.`,
    'Google Search. Nichts erfinden. evidenced nur mit Quelle.',
    'JSON: {"priceEur":null,"note":"kurz oder null","evidenced":false}',
  ].join('\n');
  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      costModule: 'research',
      ...(usePro
        ? { tier: 'pro' as const, forcePro: true, allowProEscalate: false }
        : { tier: 'lite' as const, forcePro: false, allowProEscalate: false }),
      enableGoogleSearch: true,
      maxTokens: usePro ? 400 : 280,
      temperature: 0.15,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
    });
    const parsed = extractJsonObject(raw || '');
    const priceEur =
      typeof parsed?.priceEur === 'number' &&
      Number.isFinite(parsed.priceEur) &&
      parsed.priceEur > 0 &&
      parsed.priceEur < 50_000
        ? Math.round(parsed.priceEur)
        : null;
    const evidenced = parsed?.evidenced === true;
    const note =
      typeof parsed?.note === 'string' && parsed.note.trim()
        ? parsed.note.trim().slice(0, 120)
        : null;
    return {
      priceEur: evidenced ? priceEur : null,
      note: evidenced ? note : null,
    };
  } catch {
    return { priceEur: null, note: null };
  }
}
