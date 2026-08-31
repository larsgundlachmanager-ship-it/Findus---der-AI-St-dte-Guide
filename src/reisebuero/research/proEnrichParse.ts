/**
 * Pure JSON-Parser für Pro-Discover — ohne Gemini/RN-Imports (Smoke-fähig).
 */

import type { SeedPlace } from './candidates';

export type ProDestCandidate = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  iata: string | null;
  wiki: string | null;
  tags: string[];
  whyFit: string;
};

export function slugId(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseProDiscoverJson(raw: string): ProDestCandidate[] {
  const parsed = extractJsonObject(raw);
  const list = Array.isArray(parsed?.destinations) ? parsed!.destinations : [];
  const out: ProDestCandidate[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (name.length < 2) continue;
    const lat =
      typeof r.lat === 'number' && Number.isFinite(r.lat) ? r.lat : null;
    const lng =
      typeof r.lng === 'number' && Number.isFinite(r.lng) ? r.lng : null;
    const iata =
      typeof r.iata === 'string' && /^[A-Za-z]{3}$/.test(r.iata.trim())
        ? r.iata.trim().toUpperCase()
        : null;
    const wiki =
      typeof r.wiki === 'string' && r.wiki.trim() ? r.wiki.trim() : name;
    const tags = Array.isArray(r.tags)
      ? r.tags.map((x) => String(x).toLowerCase()).filter(Boolean).slice(0, 8)
      : [];
    const whyFit =
      typeof r.whyFit === 'string' && r.whyFit.trim()
        ? r.whyFit.trim().slice(0, 160)
        : '';
    out.push({
      id: slugId(name) || `pro-${out.length}`,
      name,
      lat,
      lng,
      iata,
      wiki,
      tags,
      whyFit,
    });
  }
  return out.slice(0, 10);
}

export function proCandidateToSeed(c: ProDestCandidate): SeedPlace | null {
  if (c.lat == null || c.lng == null) return null;
  return {
    id: c.id || slugId(c.name),
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    tags: c.tags.length ? c.tags : ['city', 'fly'],
    wiki: c.wiki || c.name,
    iata: c.iata || undefined,
  };
}

/**
 * Pro nur für die erste Funnel-Auswahl. Korrekturen/Refine = Lite.
 * Pure — Smoke ohne Netz.
 */
export function shouldUseReisebueroPro(trip: {
  initialProSearchDone?: boolean;
  refineCount?: number;
}): boolean {
  if (trip.initialProSearchDone === true) return false;
  if ((trip.refineCount ?? 0) > 0) return false;
  return true;
}
