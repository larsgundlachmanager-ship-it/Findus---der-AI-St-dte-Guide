/**
 * Shared Open-Meteo weather proxy with 3h location cache.
 *
 * Deploy:
 *   supabase functions deploy weather-forecast
 *
 * 100 users in Hamburg → 1 Open-Meteo call / 3h (cache_key = city:hamburg
 * or geo cell). Free Open-Meteo quota then covers thousands of users.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const TTL_MS = 3 * 60 * 60_000;
const OPEN_METEO_MS = 10_000;

type CacheRow = {
  cache_key: string;
  lat: number;
  lng: number;
  city_hint: string | null;
  open_meteo: unknown;
  fetched_at: string;
  expires_at: string;
};

function weatherCacheKey(opts: {
  lat: number;
  lng: number;
  cityId?: string | null;
  cacheKey?: string | null;
}): string {
  const explicit = (opts.cacheKey ?? '').toString().trim();
  if (explicit) return explicit;
  const city = (opts.cityId ?? '').toString().trim().toLowerCase();
  if (city) return `city:${city}`;
  const lat = Math.round(opts.lat * 10) / 10;
  const lng = Math.round(opts.lng * 10) / 10;
  return `geo:${lat.toFixed(1)}:${lng.toFixed(1)}`;
}

function cellCenter(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Math.round(lat * 10) / 10,
    lng: Math.round(lng * 10) / 10,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function fetchOpenMeteo(lat: number, lng: number): Promise<unknown> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current_weather=true` +
    `&minutely_15=precipitation_probability` +
    `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m` +
    `&forecast_days=1&timezone=auto`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPEN_METEO_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }
    return await res.json();
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
    let cityId = url.searchParams.get('cityId');
    let cityHint = url.searchParams.get('cityHint');
    let cacheKeyParam = url.searchParams.get('cacheKey');

    if (req.method === 'POST') {
      const body = (await req.json().catch(() => null)) as {
        lat?: number;
        lng?: number;
        cityId?: string;
        cityHint?: string;
        cacheKey?: string;
      } | null;
      if (body) {
        if (Number.isFinite(body.lat)) lat = Number(body.lat);
        if (Number.isFinite(body.lng)) lng = Number(body.lng);
        if (body.cityId) cityId = body.cityId;
        if (body.cityHint) cityHint = body.cityHint;
        if (body.cacheKey) cacheKeyParam = body.cacheKey;
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: 'lat/lng required' }, 400);
    }

    const cacheKey = weatherCacheKey({
      lat,
      lng,
      cityId,
      cacheKey: cacheKeyParam,
    });
    const center = cellCenter(lat, lng);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const now = Date.now();
    const { data: existing, error: readErr } = await admin
      .from('weather_cache')
      .select('*')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (readErr) {
      console.warn('[weather-forecast] read', readErr.message);
    }

    const row = existing as CacheRow | null;
    if (row?.open_meteo && row.expires_at) {
      const expiresAtMs = Date.parse(row.expires_at);
      if (Number.isFinite(expiresAtMs) && expiresAtMs > now) {
        return json({
          cacheKey,
          cacheHit: true,
          fetchedAtMs: Date.parse(row.fetched_at) || now,
          expiresAtMs,
          lat: row.lat,
          lng: row.lng,
          cityHint: row.city_hint,
          openMeteo: row.open_meteo,
        });
      }
    }

    const openMeteo = await fetchOpenMeteo(center.lat, center.lng);
    const fetchedAt = new Date(now);
    const expiresAt = new Date(now + TTL_MS);

    const { error: writeErr } = await admin.from('weather_cache').upsert(
      {
        cache_key: cacheKey,
        lat: center.lat,
        lng: center.lng,
        city_hint: cityHint ?? cityId ?? null,
        open_meteo: openMeteo,
        fetched_at: fetchedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'cache_key' },
    );
    if (writeErr) {
      console.warn('[weather-forecast] upsert', writeErr.message);
    }

    return json({
      cacheKey,
      cacheHit: false,
      fetchedAtMs: now,
      expiresAtMs: expiresAt.getTime(),
      lat: center.lat,
      lng: center.lng,
      cityHint: cityHint ?? cityId ?? null,
      openMeteo,
    });
  } catch (err) {
    console.error('[weather-forecast]', err);
    return json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
