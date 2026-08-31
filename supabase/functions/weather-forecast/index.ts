/**
 * Shared weather proxy — Open-Meteo + optional OpenWeather One Call.
 *
 * 1000 User in Hamburg-Altona → 1 Upstream-Call / TTL, nicht 1000.
 * Cache-Key: city:{id}:{lat0.05}:{lng0.05} (~5 km Viertel) oder geo-Zelle.
 *
 * Deploy:
 *   supabase functions deploy weather-forecast
 * Secrets (optional, für minutely Regen):
 *   OPENWEATHER_API_KEY=…
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const OPEN_METEO_MS = 10_000;
const OWM_MS = 10_000;

type CacheRow = {
  cache_key: string;
  lat: number;
  lng: number;
  city_hint: string | null;
  open_meteo: unknown;
  owm: unknown | null;
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
  if (city) {
    const lat = Math.round(opts.lat * 20) / 20;
    const lng = Math.round(opts.lng * 20) / 20;
    return 'city:' + city + ':' + lat.toFixed(2) + ':' + lng.toFixed(2);
  }
  const lat = Math.round(opts.lat * 10) / 10;
  const lng = Math.round(opts.lng * 10) / 10;
  return 'geo:' + lat.toFixed(1) + ':' + lng.toFixed(1);
}

function cellCenter(
  lat: number,
  lng: number,
  cityId?: string | null,
): { lat: number; lng: number } {
  if ((cityId ?? '').toString().trim()) {
    return {
      lat: Math.round(lat * 20) / 20,
      lng: Math.round(lng * 20) / 20,
    };
  }
  return {
    lat: Math.round(lat * 10) / 10,
    lng: Math.round(lng * 10) / 10,
  };
}

function ttlMsFromPayload(opts: {
  owm: unknown | null;
  openMeteo: unknown;
}): number {
  const now = Date.now();
  const owm = opts.owm as {
    minutely?: Array<{ dt?: number; precipitation?: number }>;
    current?: { rain?: { '1h'?: number }; weather?: Array<{ id?: number }> };
    hourly?: Array<{ dt?: number; pop?: number; rain?: { '1h'?: number } }>;
  } | null;

  if (owm) {
    const precipNow = owm.current?.rain?.['1h'] ?? 0;
    const wid = owm.current?.weather?.[0]?.id;
    const weatherWet =
      typeof wid === 'number' && wid >= 200 && wid < 700;
    const minutelyNow = (owm.minutely ?? [])
      .slice(0, 2)
      .some((m) => (m.precipitation ?? 0) >= 0.1);
    if (precipNow >= 0.1 || weatherWet || minutelyNow) return 5 * 60_000;

    for (const m of owm.minutely ?? []) {
      if ((m.precipitation ?? 0) >= 0.1 && typeof m.dt === 'number') {
        const until = m.dt * 1000 - now;
        if (until <= 5 * 60_000) return 60_000;
        if (until <= 15 * 60_000) return 5 * 60_000;
        if (until <= 60 * 60_000) return 10 * 60_000;
        if (until <= 2 * 60 * 60_000) return 30 * 60_000;
        break;
      }
    }
    for (const h of (owm.hourly ?? []).slice(0, 12)) {
      const wet = (h.pop ?? 0) >= 0.4 || (h.rain?.['1h'] ?? 0) >= 0.1;
      if (wet && typeof h.dt === 'number') {
        const until = h.dt * 1000 - now;
        if (until <= 60 * 60_000) return 10 * 60_000;
        if (until <= 2 * 60 * 60_000) return 30 * 60_000;
        break;
      }
    }
  }

  const meteo = opts.openMeteo as {
    current?: { precipitation?: number; weather_code?: number };
  };
  const code = meteo.current?.weather_code;
  const precip = meteo.current?.precipitation ?? 0;
  if (
    precip >= 0.1 ||
    (typeof code === 'number' &&
      ((code >= 51 && code <= 67) ||
        (code >= 80 && code <= 82) ||
        (code >= 95 && code <= 99)))
  ) {
    return 5 * 60_000;
  }
  return 60 * 60_000;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function fetchOpenMeteo(lat: number, lng: number): Promise<unknown> {
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=' +
    lat +
    '&longitude=' +
    lng +
    '&current=temperature_2m,weather_code,precipitation,wind_speed_10m' +
    '&minutely_15=precipitation_probability,precipitation' +
    '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&forecast_days=3&timezone=auto';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPEN_METEO_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOwm(lat: number, lng: number): Promise<unknown | null> {
  const key = (
    Deno.env.get('OPENWEATHER_API_KEY') ||
    Deno.env.get('OPEN_WEATHER_API_KEY') ||
    ''
  ).trim();
  if (!key) return null;
  const u = new URL('https://api.openweathermap.org/data/3.0/onecall');
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lng));
  u.searchParams.set('appid', key);
  u.searchParams.set('units', 'metric');
  u.searchParams.set('lang', 'de');
  u.searchParams.set('exclude', 'alerts');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OWM_MS);
  try {
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) {
      console.warn('[weather-forecast] OWM HTTP', res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[weather-forecast] OWM fail', err);
    return null;
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
    const center = cellCenter(lat, lng, cityId);
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
          owm: row.owm ?? null,
        });
      }
    }

    const [openMeteo, owm] = await Promise.all([
      fetchOpenMeteo(center.lat, center.lng),
      fetchOwm(center.lat, center.lng),
    ]);
    const ttl = ttlMsFromPayload({ owm, openMeteo });
    const fetchedAt = new Date(now);
    const expiresAt = new Date(now + ttl);

    const { error: writeErr } = await admin.from('weather_cache').upsert(
      {
        cache_key: cacheKey,
        lat: center.lat,
        lng: center.lng,
        city_hint: cityHint ?? cityId ?? null,
        open_meteo: openMeteo,
        owm: owm,
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
      owm,
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
