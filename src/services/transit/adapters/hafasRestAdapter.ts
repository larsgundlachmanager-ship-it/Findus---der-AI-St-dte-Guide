/**
 * HAFAS-ähnlich: öffentliche transport.rest Instanzen (DB, BVG, …).
 */

import type { AdapterDeparture, TransitAdapter } from './types';
import { directionMatchesHint } from '../directionMatch';

const FETCH_MS = 12_000;

function parseWhen(raw: unknown): Date | null {
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw);
  }
  return null;
}

export function createHafasRestAdapter(opts: {
  baseUrl: string;
  label?: string;
  kind?: 'db_rest' | 'hafas';
}): TransitAdapter {
  const base = opts.baseUrl.replace(/\/$/, '');
  return {
    kind: opts.kind ?? 'hafas',
    label: opts.label ?? `HAFAS ${base}`,
    async fetchDepartures({ stopId, directionHint, limit = 6 }) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
      try {
        const u = new URL(`${base}/stops/${encodeURIComponent(stopId)}/departures`);
        u.searchParams.set('results', String(Math.min(12, Math.max(limit, 4))));
        u.searchParams.set('duration', '60');
        const res = await fetch(u.toString(), { signal: ctrl.signal });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          departures?: Array<{
            direction?: string;
            when?: string | null;
            plannedWhen?: string | null;
            delay?: number | null;
            cancelled?: boolean;
            platform?: string | null;
            line?: { name?: string; productName?: string };
          }>;
        };
        const hint = (directionHint ?? '').toLowerCase().trim();
        let rows = data.departures ?? [];
        if (hint) {
          const filtered = rows.filter((d) =>
            directionMatchesHint(d.direction ?? '', hint),
          );
          if (filtered.length) rows = filtered;
        }
        const out: AdapterDeparture[] = [];
        for (const d of rows) {
          const when =
            parseWhen(d.when) ?? parseWhen(d.plannedWhen) ?? null;
          if (!when) continue;
          const plannedWhen = parseWhen(d.plannedWhen);
          const delaySec =
            typeof d.delay === 'number' && Number.isFinite(d.delay)
              ? d.delay
              : plannedWhen
                ? Math.round((when.getTime() - plannedWhen.getTime()) / 1000)
                : null;
          out.push({
            line: d.line?.name?.trim() || d.line?.productName?.trim() || 'Linie',
            direction: d.direction?.trim() || '—',
            when,
            plannedWhen,
            delaySec,
            cancelled: d.cancelled === true,
            planned: false,
            platform: d.platform ?? null,
          });
          if (out.length >= limit) break;
        }
        return out.length ? out : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
