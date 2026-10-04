/** Wikipedia-Thumb — DE zuerst, EN Fallback, Stadtname normalisieren. */

import { isUnappealingDestPhotoUrl, scenicWikiAlts } from './destPhotoPick';

async function fetchWikiThumbOnce(title: string, lang: 'de' | 'en'): Promise<string | null> {
  const t = (title || '').trim();
  if (!t) return null;
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`;
    const res = await fetch(url, {
      headers: {
        'Api-User-Agent': 'YorroReisebuero/1.0 (travel companion; contact@yorro.de)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      originalimage?: { source?: string };
      thumbnail?: { source?: string };
      type?: string;
      title?: string;
      description?: string;
    };
    if (json.type === 'disambiguation') return null;
    // Thumbnail zuerst — kleinere JPGs laden zuverlässiger in RN/Android
    const src = json.thumbnail?.source || json.originalimage?.source || null;
    if (!src) return null;
    const blob = `${src} ${json.title || ''} ${json.description || ''} ${t}`;
    if (isUnappealingDestPhotoUrl(blob)) return null;
    return src;
  } catch {
    return null;
  }
}

/** „Antalya, Türkei“ / „Budapest (Stadt)“ → brauchbare Wiki-Titel. */
export function wikiTitleCandidates(name: string, alts?: string[]): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    const t = (v || '').trim();
    if (!t) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  // Scenic-Landmarken zuerst (Prag → Karlsbrücke, nicht Fernsehturm)
  for (const scenic of scenicWikiAlts(name)) push(scenic);
  for (const raw of [name, ...(alts ?? [])]) {
    const cleaned = (raw || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    push(cleaned);
    push(cleaned.replace(/\s*\([^)]*\)\s*/g, ' ').trim());
    const beforeComma = cleaned.split(',')[0]?.trim();
    push(beforeComma);
    if (beforeComma) {
      push(beforeComma.replace(/\s*\([^)]*\)\s*/g, ' ').trim());
      const words = beforeComma.split(/\s+/).filter(Boolean);
      if (words.length >= 2) push(words[0]!);
    }
  }
  return out.slice(0, 12);
}

export async function fetchWikiThumb(title: string, alts?: string[]): Promise<string | null> {
  const titles = wikiTitleCandidates(title, alts);
  for (const t of titles) {
    const de = await fetchWikiThumbOnce(t, 'de');
    if (de) return de;
    const en = await fetchWikiThumbOnce(t, 'en');
    if (en) return en;
  }
  return null;
}
