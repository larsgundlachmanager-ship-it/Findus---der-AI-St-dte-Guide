/**
 * Meta-Tools — dünne Fassaden über bestehende Engines (kein Rewrite).
 * SSOT: docs/rfc/agent-harden-contract.md
 */

export type MetaFact = {
  key: string;
  value: string;
  evidenceUrl?: string | null;
  confidence?: number;
};

export type RankedOption = {
  id: string;
  title: string;
  score: number;
  reason?: string;
  url?: string | null;
};

/** webSearch — Addon zu deep_web / Research-Harvest (soft). */
export async function metaWebSearch(opts: {
  query: string;
  maxResults?: number;
}): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  const q = String(opts.query || '').trim();
  if (!q) return [];
  try {
    const { harvestWebSnippets } = require('../../services/research/webHarvest') as {
      harvestWebSnippets?: (o: {
        query: string;
        limit?: number;
      }) => Promise<Array<{ title?: string; url?: string; snippet?: string }>>;
    };
    if (typeof harvestWebSnippets === 'function') {
      const rows = await harvestWebSnippets({
        query: q,
        limit: Math.min(8, opts.maxResults ?? 5),
      });
      return (rows || [])
        .map((r) => ({
          title: String(r.title || '').slice(0, 120),
          url: String(r.url || ''),
          snippet: r.snippet ? String(r.snippet).slice(0, 240) : undefined,
        }))
        .filter((r) => r.url.startsWith('http'));
    }
  } catch {
    /* soft */
  }
  try {
    const { searchLiveWeb } = require('../../services/research/liveWebSearch') as {
      searchLiveWeb?: (q: string) => Promise<Array<{ title?: string; url?: string }>>;
    };
    if (typeof searchLiveWeb === 'function') {
      const rows = await searchLiveWeb(q);
      return (rows || [])
        .slice(0, opts.maxResults ?? 5)
        .map((r) => ({
          title: String(r.title || '').slice(0, 120),
          url: String(r.url || ''),
        }))
        .filter((r) => r.url.startsWith('http'));
    }
  } catch {
    /* soft */
  }
  return [];
}

/** extractFacts — Zahlen/Zeiten/Namen aus Snippets. */
export function metaExtractFacts(
  texts: string[],
  keys?: string[],
): MetaFact[] {
  const blob = texts.join('\n').slice(0, 12_000);
  const out: MetaFact[] = [];
  const price = blob.match(
    /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)/iu,
  );
  if (price) {
    out.push({
      key: 'price_eur',
      value: price[1]!.replace(',', '.'),
      confidence: 0.6,
    });
  }
  const time = blob.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (time) {
    out.push({
      key: 'clock',
      value: `${time[1]!.padStart(2, '0')}:${time[2]}`,
      confidence: 0.55,
    });
  }
  const open = blob.match(
    /\b(?:geöffnet|geoeffnet|offen|öffnet|oeffnet|bis)\s+(?:bis\s+)?(\d{1,2}[:.]\d{2}|\d{1,2}\s*uhr)/iu,
  );
  if (open) {
    out.push({ key: 'open_hint', value: open[0]!.slice(0, 48), confidence: 0.5 });
  }
  for (const k of keys || []) {
    const re = new RegExp(`${k}\\s*[:=]\\s*([^\\n.;]{2,60})`, 'iu');
    const m = blob.match(re);
    if (m) out.push({ key: k, value: m[1]!.trim(), confidence: 0.45 });
  }
  return out.slice(0, 12);
}

/** rankOptions — einfache Score-Sortierung (Tourist-Trap soft demote). */
export function metaRankOptions(
  options: Array<{
    id: string;
    title: string;
    rating?: number | null;
    reviewCount?: number | null;
    touristTrapHint?: boolean;
    url?: string | null;
    reason?: string;
  }>,
): RankedOption[] {
  return [...options]
    .map((o) => {
      let score = Number(o.rating ?? 3.5) * 10;
      const n = Number(o.reviewCount ?? 0);
      if (n > 50) score += 2;
      if (n > 200) score += 2;
      if (o.touristTrapHint) score -= 8;
      return {
        id: o.id,
        title: o.title,
        score,
        reason: o.reason,
        url: o.url ?? null,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** buildOpenUrl — hollow/provision SSOT (Kiwi etc. nur belegt). */
export function metaBuildOpenUrl(opts: {
  kind: 'kiwi' | 'maps' | 'menu' | 'generic';
  url?: string | null;
  label?: string;
}): { type: 'OPEN_URL'; label: string; payload: { url: string } } | null {
  const url = String(opts.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (opts.kind === 'kiwi' && !/kiwi\.|tpx\.li|travelpayouts|aviasales/i.test(url)) {
    return null;
  }
  const label =
    opts.label ||
    (opts.kind === 'kiwi'
      ? 'Auf Kiwi öffnen'
      : opts.kind === 'menu'
        ? 'Speisekarte'
        : opts.kind === 'maps'
          ? 'Maps öffnen'
          : 'Öffnen');
  return { type: 'OPEN_URL', label, payload: { url } };
}

/** verifyLink — HEAD/GET soft, nie crashen. */
export async function metaVerifyLink(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; finalUrl?: string; status?: number }> {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false };
  const ms = Math.min(8000, Math.max(800, opts?.timeoutMs ?? 3500));
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(u, {
        method: 'HEAD',
        redirect: 'follow',
        signal: ctrl.signal,
      });
      return {
        ok: res.ok || (res.status >= 200 && res.status < 400),
        finalUrl: res.url || u,
        status: res.status,
      };
    } finally {
      clearTimeout(t);
    }
  } catch {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      try {
        const res = await fetch(u, {
          method: 'GET',
          redirect: 'follow',
          signal: ctrl.signal,
          headers: { Range: 'bytes=0-0' },
        });
        return {
          ok: res.ok || (res.status >= 200 && res.status < 400),
          finalUrl: res.url || u,
          status: res.status,
        };
      } finally {
        clearTimeout(t);
      }
    } catch {
      return { ok: false };
    }
  }
}

/** weatherAt — bestehende Outfit/Wetter-Pipeline. */
export async function metaWeatherAt(opts: {
  placeLabel?: string | null;
  lat?: number | null;
  lng?: number | null;
  userText?: string | null;
}): Promise<{
  summary?: string;
  rainLikely?: boolean;
  outfitHint?: string;
} | null> {
  try {
    const {
      looksLikeRainAsk,
      isOutfitWeatherTurn,
    } = require('../../services/concierge/outfitWeatherPresent') as {
      looksLikeRainAsk: (s?: string | null) => boolean;
      isOutfitWeatherTurn: (s?: string | null) => boolean;
    };
    const text = opts.userText || opts.placeLabel || '';
    const rain = looksLikeRainAsk(text);
    const outfit = isOutfitWeatherTurn(text);
    try {
      const { fetchWeatherBrief } = require('../../services/weather/weatherBrief') as {
        fetchWeatherBrief?: (o: {
          lat?: number;
          lng?: number;
          place?: string;
        }) => Promise<{ summary?: string; rain?: boolean }>;
      };
      if (typeof fetchWeatherBrief === 'function') {
        const w = await fetchWeatherBrief({
          lat: opts.lat ?? undefined,
          lng: opts.lng ?? undefined,
          place: opts.placeLabel || undefined,
        });
        return {
          summary: w?.summary,
          rainLikely: w?.rain ?? rain,
          outfitHint: outfit ? 'outfit_lane' : undefined,
        };
      }
    } catch {
      /* soft */
    }
    return {
      summary: undefined,
      rainLikely: rain,
      outfitHint: outfit ? 'outfit_lane' : undefined,
    };
  } catch {
    return null;
  }
}

/** eta — wrap navigationService / route ETA soft. */
export async function metaEta(opts: {
  destLat: number;
  destLng: number;
  mode?: 'walk' | 'bike' | 'transit' | 'drive';
}): Promise<{ minutes?: number; label?: string } | null> {
  if (!Number.isFinite(opts.destLat) || !Number.isFinite(opts.destLng)) {
    return null;
  }
  try {
    const { estimateEtaMinutes } = require('../../services/navigation/navigationService') as {
      estimateEtaMinutes?: (o: {
        destLat: number;
        destLng: number;
        mode?: string;
      }) => Promise<number | null>;
    };
    if (typeof estimateEtaMinutes === 'function') {
      const m = await estimateEtaMinutes({
        destLat: opts.destLat,
        destLng: opts.destLng,
        mode: opts.mode,
      });
      if (m != null && Number.isFinite(m)) {
        return { minutes: Math.round(m), label: `ca. ${Math.round(m)} Min` };
      }
    }
  } catch {
    /* soft */
  }
  return null;
}
