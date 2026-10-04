/**
 * Shared Regen-Radar Nowcast — Bright Sky DWD RV am ~1 km Zell-Zentrum.
 *
 * 1000 User in derselben Mikro-Zelle → 1 Upstream / TTL (~5 Min).
 * Blankenese ≠ Volksdorf (getrennte Keys).
 *
 * Deploy:
 *   supabase functions deploy rain-nowcast
 *   supabase db push   # migration rain_nowcast_cache
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const BRIGHT_SKY_MS = 10_000;
const TTL_MS = 5 * 60_000;
const RAIN_CACHE_DEG = 0.01;
const RADAR_DISTANCE_M = 1000;

type Sample = { atMs: number; precipMm: number };

type CacheRow = {
  cache_key: string;
  lat: number;
  lng: number;
  payload: {
    source: string;
    samples: Sample[];
    fetchedAtMs: number;
  };
  fetched_at: string;
  expires_at: string;
};

function rainCacheKey(lat: number, lng: number): string {
  const la = Math.round(lat / RAIN_CACHE_DEG) * RAIN_CACHE_DEG;
  const ln = Math.round(lng / RAIN_CACHE_DEG) * RAIN_CACHE_DEG;
  return 'rain:' + la.toFixed(2) + ':' + ln.toFixed(2);
}

function rainCellCenter(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Math.round(lat / RAIN_CACHE_DEG) * RAIN_CACHE_DEG,
    lng: Math.round(lng / RAIN_CACHE_DEG) * RAIN_CACHE_DEG,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function precipMmFromRadarUnits(units: number): number {
  return Math.max(0, units) * 0.01;
}

async function fetchBrightSkySamples(
  lat: number,
  lng: number,
): Promise<Sample[]> {
  const u = new URL('https://api.brightsky.dev/radar');
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lng));
  u.searchParams.set('distance', String(RADAR_DISTANCE_M));
  u.searchParams.set('format', 'plain');
  u.searchParams.set('tz', 'Europe/Berlin');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BRIGHT_SKY_MS);
  try {
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
      },
    });
    if (!res.ok) throw new Error('Bright Sky HTTP ' + res.status);
    const data = (await res.json()) as {
      radar?: Array<{ timestamp?: string; precipitation_5?: number[][] }>;
      latlon_position?: { x?: number; y?: number };
    };
    const frames = data.radar ?? [];
    const pos = data.latlon_position ?? { x: 0, y: 0 };
    const samples: Sample[] = [];
    for (const frame of frames) {
      const atMs = Date.parse(frame.timestamp ?? '');
      if (!Number.isFinite(atMs)) continue;
      const grid = frame.precipitation_5;
      if (!grid?.length) continue;
      const rows = grid.length;
      const cols = grid[0]?.length ?? 0;
      if (!cols) continue;
      const ix = Math.max(0, Math.min(cols - 1, Math.round(Number(pos.x) || 0)));
      const iy = Math.max(0, Math.min(rows - 1, Math.round(Number(pos.y) || 0)));
      const units = Number(grid[iy]?.[ix] ?? 0);
      samples.push({
        atMs,
        precipMm: precipMmFromRadarUnits(Number.isFinite(units) ? units : 0),
      });
    }
    return samples;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      return json({ error: 'server misconfigured' }, 500);
    }

    const url = new URL(req.url);
    let lat = Number(url.searchParams.get('lat'));
    let lng = Number(url.searchParams.get('lng'));
    let cacheKeyParam = url.searchParams.get('cacheKey');

    if (req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as {
        lat?: number;
        lng?: number;
        cacheKey?: string;
      } | null;
      if (body) {
        if (Number.isFinite(body.lat)) lat = Number(body.lat);
        if (Number.isFinite(body.lng)) lng = Number(body.lng);
        if (body.cacheKey) cacheKeyParam = body.cacheKey;
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: 'lat/lng required' }, 400);
    }

    const center = rainCellCenter(lat, lng);
    const cacheKey =
      (cacheKeyParam ?? '').toString().trim() ||
      rainCacheKey(center.lat, center.lng);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const now = Date.now();
    const { data: existing, error: readErr } = await admin
      .from('rain_nowcast_cache')
      .select('*')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (readErr) {
      console.warn('[rain-nowcast] read', readErr.message);
    }

    const row = existing as CacheRow | null;
    if (row?.payload?.samples && row.expires_at) {
      const expiresAtMs = Date.parse(row.expires_at);
      if (Number.isFinite(expiresAtMs) && expiresAtMs > now) {
        return json({
          cacheKey,
          cacheHit: true,
          fetchedAtMs: Date.parse(row.fetched_at) || now,
          expiresAtMs,
          lat: row.lat,
          lng: row.lng,
          source: row.payload.source ?? 'brightsky_rv',
          samples: row.payload.samples,
        });
      }
    }

    const samples = await fetchBrightSkySamples(center.lat, center.lng);
    if (!samples.length) {
      return json({ error: 'no radar samples' }, 502);
    }

    const fetchedAt = new Date(now);
    const expiresAt = new Date(now + TTL_MS);
    const payload = {
      source: 'brightsky_rv',
      samples,
      fetchedAtMs: now,
    };

    const { error: writeErr } = await admin.from('rain_nowcast_cache').upsert(
      {
        cache_key: cacheKey,
        lat: center.lat,
        lng: center.lng,
        payload,
        fetched_at: fetchedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'cache_key' },
    );
    if (writeErr) {
      console.warn('[rain-nowcast] upsert', writeErr.message);
    }

    return json({
      cacheKey,
      cacheHit: false,
      fetchedAtMs: now,
      expiresAtMs: expiresAt.getTime(),
      lat: center.lat,
      lng: center.lng,
      source: 'brightsky_rv',
      samples,
    });
  } catch (err) {
    console.error('[rain-nowcast]', err);
    return json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
