/**
 * De Lijn (Belgien) — optional, nur mit API-Key + Stadt-Profil.
 * Ohne Key: null → Fallback Takt/HAFAS.
 */

import { env } from '../../../config/env';
import type { AdapterDeparture, TransitAdapter } from './types';

const FETCH_MS = 5_000;

export function createDelijnAdapter(opts: {
  baseUrl: string;
  label?: string;
}): TransitAdapter {
  return {
    kind: 'delijn',
    label: opts.label ?? 'De Lijn',
    async fetchDepartures({ stopId, limit = 6 }) {
      const key = env.get('EXPO_PUBLIC_DELIJN_API_KEY').trim();
      if (!key || key.includes('your-')) return null;
      const base = opts.baseUrl.replace(/\/$/, '');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
      try {
        // Offizielle De-Lijn GIC: halteplaats doorkomsten
        const u = `${base}/halteplaatsen/${encodeURIComponent(stopId)}/doorkomsten`;
        const res = await fetch(u, {
          signal: ctrl.signal,
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            Accept: 'application/json',
          },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          doorkomsten?: Array<{
            lijnnummer?: string | number;
            bestemming?: string;
            vertrekTijd?: string;
            realtimeTijd?: string;
            vertraging?: number;
            geschrapt?: boolean;
          }>;
        };
        const out: AdapterDeparture[] = [];
        for (const d of data.doorkomsten ?? []) {
          const whenRaw = d.realtimeTijd || d.vertrekTijd;
          if (!whenRaw) continue;
          const when = new Date(whenRaw);
          if (Number.isNaN(when.getTime())) continue;
          const planned = d.vertrekTijd ? new Date(d.vertrekTijd) : null;
          out.push({
            line: String(d.lijnnummer ?? 'Linie'),
            direction: d.bestemming?.trim() || '—',
            when,
            plannedWhen:
              planned && !Number.isNaN(planned.getTime()) ? planned : null,
            delaySec:
              typeof d.vertraging === 'number' ? d.vertraging : null,
            cancelled: d.geschrapt === true,
            planned: !d.realtimeTijd,
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
