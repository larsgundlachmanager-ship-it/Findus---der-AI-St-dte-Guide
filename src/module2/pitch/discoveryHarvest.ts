/**
 * Discovery Harvest — Gap-Lane wenn Pack+Places Perfect-Pool &lt; 2.
 * Places-first bleibt im candidatePool; hier: günstiges Flash + Google-Search
 * → Namen/Claims → Caller resolved via Places + Verify.
 * Stadt-agnostisch, keine Orts-Hardcodes.
 */

import type { PitchCandidate, PitchRequest } from './types';

export type HarvestClaim = {
  name: string;
  claims: string[];
  sourceUrl?: string | null;
  /** perfect | near_miss | rejected — aus Roh-Extrakt */
  constraintFit?: 'perfect' | 'near_miss' | 'rejected';
  rejectedReason?: string | null;
  ayceSchedule?: string | null;
  aycePrice?: string | null;
};

export type DiscoveryHarvestResult = {
  claims: HarvestClaim[];
  rawNames: string[];
};

function avoidBlob(req: PitchRequest): string {
  return (req.prefs.avoidCategories ?? []).join(', ');
}

function mustBlob(req: PitchRequest): string {
  return req.wishes
    .filter((w) => w.hardness === 'must')
    .map((w) => w.text)
    .join(', ');
}

function parseHarvestJson(raw: string): HarvestClaim[] {
  const t = raw.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const obj = JSON.parse(t.slice(start, end + 1)) as {
      venues?: Array<Record<string, unknown>>;
    };
    const rows = Array.isArray(obj.venues) ? obj.venues : [];
    const out: HarvestClaim[] = [];
    for (const row of rows) {
      const name = String(row.name ?? row.title ?? '').trim();
      if (name.length < 2) continue;
      const claims = Array.isArray(row.claims)
        ? row.claims.map((c) => String(c).trim()).filter(Boolean)
        : String(row.claim ?? row.note ?? '')
            .split(/[|;]/)
            .map((s) => s.trim())
            .filter(Boolean);
      const fitRaw = String(row.constraint_fit ?? row.fit ?? 'perfect')
        .toLowerCase()
        .trim();
      const constraintFit =
        fitRaw === 'near_miss' || fitRaw === 'rejected'
          ? fitRaw
          : ('perfect' as const);
      out.push({
        name: name.slice(0, 80),
        claims: claims.slice(0, 8),
        sourceUrl: String(row.source_url ?? row.url ?? '').trim() || null,
        constraintFit,
        rejectedReason:
          String(row.rejected_reason ?? row.reason ?? '').trim() || null,
        ayceSchedule: String(row.ayce_schedule ?? row.schedule ?? '').trim() || null,
        aycePrice: String(row.ayce_price ?? row.price ?? '').trim() || null,
      });
      if (out.length >= 20) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Guide-/Web-Harvest nur bei Gap. Max ~8 Quellen-Snippets via Grounding.
 * Kein Speak — nur strukturierte Namen für Resolve.
 */
export async function discoveryHarvest(
  req: PitchRequest,
  opts?: { signal?: AbortSignal },
): Promise<DiscoveryHarvestResult> {
  let generateGeminiText: (
    prompt: string,
    options?: Record<string, unknown>,
  ) => Promise<string>;
  let hasGeminiApiKey: () => boolean;
  try {
    const gem = require('../../services/geminiService') as {
      generateGeminiText: typeof generateGeminiText;
      hasGeminiApiKey: typeof hasGeminiApiKey;
    };
    generateGeminiText = gem.generateGeminiText;
    hasGeminiApiKey = gem.hasGeminiApiKey;
  } catch {
    return { claims: [], rawNames: [] };
  }
  if (!hasGeminiApiKey()) return { claims: [], rawNames: [] };
  const city = String(req.cityHint || '').trim() || 'der Stadt';
  const musts = mustBlob(req);
  const avoids = avoidBlob(req);
  const when = String(req.context || req.title || '').slice(0, 240);
  const gastro = req.kind === 'food' || req.kind === 'bar';
  const kindHint =
    req.kind === 'hotel'
      ? 'Hotels/Unterkünfte'
      : req.kind === 'sight'
        ? 'Orte/Aktivitäten/Aussichten/Amenities'
        : req.kind === 'generic'
          ? 'Orte/Plätze/Amenities (Sport, Trinkwasser, Grill, …)'
          : 'Restaurants/Venues';
  const prompt = `Extrahiere Ort-/Venue-Namen für eine Concierge-Suche (${kindHint}) in ${city}.
User-Wunsch/Kontext: ${when}
Hard-Musts: ${musts || '—'}
Avoids (rausfiltern): ${avoids || '—'}

Suche Stadtguides, Listen, Maps/OSM-Hinweise, Venue-Seiten (keine Fake-Orte).
Für jeden Treffer: Name, kurze Claims (Preis/Öffnung/Amenity wenn genannt), source_url wenn klar.
constraint_fit: perfect | near_miss | rejected
rejected_reason z. B. weekday_mismatch | cuisine_avoid | amenity_miss | no_evidence
${gastro ? 'ayce_schedule / ayce_price nur wenn belegt. Avoid asiatisch = KEINE Sushi-/Asia-/Mongol-/Hotpot-/Running-Sushi-Venues, auch wenn sie AYCE sind. Steak-Must = echte Speiselokale (Steakhouse/Grill), keine Metzgerei.' : 'Keine Gastro-Fakten erfinden.'}

Antwort NUR JSON:
{"venues":[{"name":"…","claims":["…"],"source_url":null,"constraint_fit":"perfect","rejected_reason":null,"ayce_schedule":null,"ayce_price":null}]}
Max 20 venues. Keine Orts-Hardcodes erfinden die nicht in den Suchtreffern stehen.`;

  try {
    const raw = await generateGeminiText(prompt, {
      enableGoogleSearch: true,
      tier: 'lite',
      temperature: 0.2,
      maxOutputTokens: 2048,
      signal: opts?.signal,
      costModule: 'research',
      jsonMimeOnly: true,
    });
    const claims = parseHarvestJson(raw);
    return {
      claims,
      rawNames: claims.map((c) => c.name),
    };
  } catch {
    return { claims: [], rawNames: [] };
  }
}

/** Harvest-Claims nach Must/Avoid härten — bevor sie in den Pitch-Pool. */
export function filterHarvestClaims(
  claims: HarvestClaim[],
  req?: PitchRequest | null,
): HarvestClaim[] {
  if (!req) return claims.filter((c) => c.constraintFit !== 'rejected');
  let avoidAsia = false;
  let ayceMust = false;
  let steakMust = false;
  try {
    const { prefsAvoidAsianCuisine, looksLikeAsianCuisineVenue, looksLikeButcherNotDining } =
      require('./specializedFoodMatch') as {
        prefsAvoidAsianCuisine: (a: string[] | null | undefined) => boolean;
        looksLikeAsianCuisineVenue: (b: string) => boolean;
        looksLikeButcherNotDining: (b: string) => boolean;
      };
    const { scoreAyceEvidence } = require('./hardMatchVerify') as {
      scoreAyceEvidence: (b: string) => number;
    };
    avoidAsia = prefsAvoidAsianCuisine(req.prefs?.avoidCategories);
    ayceMust = req.wishes.some((w) =>
      /all_you_can_eat|ayce|buffet|schlemmer/i.test(w.text),
    );
    steakMust = req.wishes.some((w) => /steak/i.test(w.text));
    return claims.filter((c) => {
      if (c.constraintFit === 'rejected') return false;
      const blob = `${c.name} ${(c.claims ?? []).join(' ')} ${c.rejectedReason ?? ''}`;
      if (avoidAsia && looksLikeAsianCuisineVenue(blob)) return false;
      if (steakMust && looksLikeButcherNotDining(blob)) return false;
      if (ayceMust && scoreAyceEvidence(blob) < 2 && c.constraintFit !== 'near_miss') {
        return false;
      }
      return true;
    });
  } catch {
    return claims.filter((c) => c.constraintFit !== 'rejected');
  }
}

/** Harvest-Namen → dünne PitchCandidate-Seeds (Caller resolved Places). */
export function harvestClaimsToSeedCandidates(
  claims: HarvestClaim[],
  anchor: { lat: number; lng: number },
  req?: PitchRequest | null,
): PitchCandidate[] {
  return filterHarvestClaims(claims, req)
    .slice(0, 12)
    .map((c, i) => {
      const tags = [
        'from_discovery_harvest',
        ...(c.constraintFit === 'near_miss' ? ['near_miss'] : []),
        ...(c.ayceSchedule ? [`ayce_schedule:${c.ayceSchedule}`] : []),
        ...(c.aycePrice ? [`ayce_price:${c.aycePrice}`] : []),
      ];
      const evidence = [
        ...c.claims,
        ...(c.rejectedReason ? [`rejected:${c.rejectedReason}`] : []),
      ].slice(0, 6);
      return {
        name: c.name,
        lat: anchor.lat + (i + 1) * 0.0001,
        lng: anchor.lng + (i + 1) * 0.0001,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.name)}`,
        softTags: tags,
        hardEvidence: evidence,
        hookNotes: c.sourceUrl ? [`source:${c.sourceUrl}`] : [],
        websiteUrl: c.sourceUrl?.startsWith('http') ? c.sourceUrl : null,
        source: 'places' as const,
      };
    });
}

export function shouldRunDiscoveryHarvest(opts: {
  kind: PitchRequest['kind'];
  topLen: number;
  softFail: boolean;
  checklist?: Array<{ status: string; key: string }>;
}): boolean {
  // Phase 2: alle Find-Kinds — nicht nur Gastro
  if (
    opts.kind !== 'food' &&
    opts.kind !== 'bar' &&
    opts.kind !== 'sight' &&
    opts.kind !== 'hotel' &&
    opts.kind !== 'generic'
  ) {
    return false;
  }
  if (opts.topLen >= 2 && !opts.softFail) {
    const hardMiss = (opts.checklist ?? []).some(
      (s) =>
        (s.status === 'soft_miss' || s.status === 'only_one') &&
        !/^(open_at_visit|rating_floor|budget)$/i.test(s.key),
    );
    return hardMiss;
  }
  return opts.topLen < 2 || opts.softFail;
}
