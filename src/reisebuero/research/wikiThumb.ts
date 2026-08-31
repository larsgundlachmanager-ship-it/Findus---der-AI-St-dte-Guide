export async function fetchWikiThumb(title: string): Promise<string | null> {
  const t = (title || '').trim();
  if (!t) return null;
  try {
    const url = `https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`;
    const res = await fetch(url, {
      headers: { 'Api-User-Agent': 'FindusReisebuero/1.0 (travel companion)' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      originalimage?: { source?: string };
      thumbnail?: { source?: string };
    };
    return json.originalimage?.source || json.thumbnail?.source || null;
  } catch {
    return null;
  }
}
