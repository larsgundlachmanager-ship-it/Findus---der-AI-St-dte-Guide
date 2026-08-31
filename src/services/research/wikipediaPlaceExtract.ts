/**
 * Leichte Wikipedia-Extrakte auf dem Gerät — nur belegte Sätze, nichts erfinden.
 */

export type WikipediaPlaceExtract = {
  title: string;
  extract: string;
  lang: string;
  url: string;
};

const TYPE_STOP = new Set([
  'museum',
  'park',
  'platz',
  'kirche',
  'church',
  'stadt',
  'city',
  'der',
  'die',
  'das',
  'und',
  'von',
]);

function wikiFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'FindusApp/1.0 (place-extract; travel guide)',
    },
  });
}

async function wikiSearch(
  query: string,
  lang: string,
): Promise<Array<{ title?: string }>> {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.searchParams.set('action', 'query');
  u.searchParams.set('list', 'search');
  u.searchParams.set('srsearch', query);
  u.searchParams.set('srlimit', '5');
  u.searchParams.set('format', 'json');
  u.searchParams.set('origin', '*');
  const res = await wikiFetch(u.toString());
  if (!res.ok) return [];
  const j = (await res.json()) as {
    query?: { search?: Array<{ title?: string }> };
  };
  return j.query?.search ?? [];
}

async function wikiExtract(
  title: string,
  lang: string,
): Promise<{ title: string; extract: string } | null> {
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.searchParams.set('action', 'query');
  u.searchParams.set('prop', 'extracts');
  u.searchParams.set('explaintext', '1');
  u.searchParams.set('exchars', '1800');
  u.searchParams.set('redirects', '1');
  u.searchParams.set('titles', title);
  u.searchParams.set('format', 'json');
  u.searchParams.set('origin', '*');
  const res = await wikiFetch(u.toString());
  if (!res.ok) return null;
  const j = (await res.json()) as {
    query?: { pages?: Record<string, { title?: string; extract?: string; missing?: unknown }> };
  };
  const page = Object.values(j.query?.pages || {})[0];
  if (!page || page.missing != null) return null;
  const extract = String(page.extract || '').trim();
  const pageTitle = String(page.title || title).trim();
  if (extract.length < 120) return null;
  return { title: pageTitle, extract };
}

function pickHit(
  hits: Array<{ title?: string }>,
  spotName: string,
  cityName: string | null,
): { title: string } | null {
  const key = spotName
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cityTok = String(cityName || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß ]/gi, ' ')
    .split(' ')
    .filter((t) => t.length >= 3);
  const STOP = new Set([...TYPE_STOP, ...cityTok]);
  const tokens = key.split(' ').filter((t) => t.length >= 3);
  const unique = tokens.filter((t) => !STOP.has(t));
  let best: { title: string; score: number } | null = null;
  for (const h of hits) {
    const title = String(h.title || '').trim();
    const t = title.toLowerCase().replace(/['’]/g, '');
    if (!t || /liste von|disambiguation|begriffsklärung|film\b|album\b/i.test(t)) {
      continue;
    }
    let score = 0;
    if (t === key || t.startsWith(`${key} `) || t.includes(`(${key})`)) score += 40;
    if (t.includes(key)) score += 24;
    const hitTok = unique.filter((tok) => t.includes(tok)).length;
    if (unique.length && hitTok < unique.length) continue;
    score += hitTok * 8;
    if (unique[0] && t.startsWith(unique[0])) score += 12;
    if (cityTok.some((c) => t.includes(c))) score += 1;
    if (!best || score > best.score) best = { title, score };
  }
  if (!best || best.score < 16) return null;
  return { title: best.title };
}

/**
 * Sucht eine Wikipedia-Seite zum Ort in der Stadt. null = kein belegter Treffer.
 */
export async function fetchWikipediaPlaceExtract(opts: {
  name: string;
  cityName?: string | null;
}): Promise<WikipediaPlaceExtract | null> {
  const name = opts.name.trim();
  if (name.length < 3 || /^unbekannt/i.test(name)) return null;
  const city = (opts.cityName || '').trim();
  const langs = ['de', 'en'] as const;

  for (const lang of langs) {
    try {
      const q = city ? `"${name}" ${city}` : name;
      const hit =
        pickHit(await wikiSearch(q, lang), name, city || null) ||
        pickHit(await wikiSearch(name, lang), name, city || null);
      if (!hit) continue;
      const page = await wikiExtract(hit.title, lang);
      if (!page) continue;
      return {
        title: page.title,
        extract: page.extract.slice(0, 1800),
        lang,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(
          page.title.replace(/ /g, '_'),
        )}`,
      };
    } catch {
      /* next lang */
    }
  }
  return null;
}
