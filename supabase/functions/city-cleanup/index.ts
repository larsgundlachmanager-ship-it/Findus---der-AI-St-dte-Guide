/**
 * Monthly City Clean-Up (V7.0).
 *
 * Lightweight metadata check vs Google Street View / Places.
 * ONLY if Google returns a newer dataset than our last_known fingerprint,
 * mark the city for a package rebuild (client pulls via Wi-Fi/background).
 *
 * Deploy:
 *   supabase functions deploy city-cleanup
 *
 * Schedule (Dashboard → Edge Functions → Schedules, or SQL):
 *   select cron.schedule(
 *     'findus-city-cleanup-monthly',
 *     '0 4 1 * *',  -- 04:00 UTC on the 1st of each month
 *     $$ select net.http_post(
 *          url := current_setting('app.settings.supabase_url') || '/functions/v1/city-cleanup',
 *          headers := jsonb_build_object(
 *            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
 *            'Content-Type', 'application/json'
 *          ),
 *          body := '{}'::jsonb
 *        );
 *     $$
 *   );
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

type CityRow = {
  city_id: string;
  lat: number;
  lng: number;
  last_sv_pano_id: string | null;
  last_checked_at: string | null;
  needs_rebuild: boolean | null;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function fetchStreetViewPanoId(
  lat: number,
  lng: number,
  mapsKey: string,
): Promise<string | null> {
  const u = new URL(
    'https://maps.googleapis.com/maps/api/streetview/metadata',
  );
  u.searchParams.set('location', `${lat},${lng}`);
  u.searchParams.set('key', mapsKey);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      pano_id?: string;
      date?: string;
    };
    if (data.status !== 'OK') return null;
    // Fingerprint: pano_id + optional capture date (no image download)
    return [data.pano_id, data.date].filter(Boolean).join('|') || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const mapsKey =
    Deno.env.get('GOOGLE_MAPS_API_KEY') ??
    Deno.env.get('EXPO_PUBLIC_GOOGLE_API_KEY') ??
    '';

  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'missing supabase credentials' }, 500);
  }
  if (!mapsKey) {
    return json({ error: 'missing GOOGLE_MAPS_API_KEY' }, 500);
  }

  const sb = createClient(supabaseUrl, serviceKey);

  const { data: cities, error } = await sb
    .from('city_cleanup_registry')
    .select('city_id, lat, lng, last_sv_pano_id, last_checked_at, needs_rebuild')
    .eq('active', true)
    .limit(80);

  if (error) {
    // Table missing → soft ok (ops must apply schema)
    return json({
      ok: false,
      reason: error.message,
      hint: 'Apply city_cleanup_registry from supabase/schema.sql',
    });
  }

  const rows = (cities ?? []) as CityRow[];
  let checked = 0;
  let marked = 0;

  for (const city of rows) {
    checked += 1;
    const fingerprint = await fetchStreetViewPanoId(city.lat, city.lng, mapsKey);
    const nowIso = new Date().toISOString();

    if (!fingerprint) {
      await sb
        .from('city_cleanup_registry')
        .update({ last_checked_at: nowIso })
        .eq('city_id', city.city_id);
      continue;
    }

    const changed =
      !city.last_sv_pano_id || city.last_sv_pano_id !== fingerprint;

    if (changed) {
      marked += 1;
      await sb
        .from('city_cleanup_registry')
        .update({
          last_sv_pano_id: fingerprint,
          last_checked_at: nowIso,
          needs_rebuild: true,
          rebuild_reason: 'street_view_metadata_changed',
        })
        .eq('city_id', city.city_id);
    } else {
      await sb
        .from('city_cleanup_registry')
        .update({ last_checked_at: nowIso })
        .eq('city_id', city.city_id);
    }
  }

  return json({
    ok: true,
    checked,
    markedForRebuild: marked,
    note: 'Images/POIs are only re-downloaded when needs_rebuild=true (compile City Package offline).',
  });
});
