/**
 * Cartesia TTS proxy — API key stays on the server.
 *
 * Deploy:
 *   supabase secrets set CARTESIA_API_KEY=...
 *   supabase functions deploy cartesia-proxy
 *
 * Client: EXPO_PUBLIC_USE_LLM_PROXY=1
 * Forwards JSON body to Cartesia bytes API; returns audio/wav (or upstream mime).
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, cartesia-version',
};

const CARTESIA_TTS_URL = 'https://api.cartesia.ai/tts/bytes';
const UPSTREAM_MS = 30_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST required' }, 405);
  }

  const apiKey = Deno.env.get('CARTESIA_API_KEY')?.trim();
  if (!apiKey) {
    return json({ error: 'CARTESIA_API_KEY not configured' }, 500);
  }

  const auth = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(auth)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const cartesiaVersion =
    req.headers.get('Cartesia-Version') ?? '2024-06-10';

  let bodyText: string;
  try {
    bodyText = await req.text();
    JSON.parse(bodyText);
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_MS);
  try {
    const upstream = await fetch(CARTESIA_TTS_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Cartesia-Version': cartesiaVersion,
        'Content-Type': 'application/json',
      },
      body: bodyText,
      signal: ctrl.signal,
    });
    const buf = await upstream.arrayBuffer();
    const contentType =
      upstream.headers.get('Content-Type') ?? 'audio/wav';
    return new Response(buf, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': contentType },
    });
  } catch (err) {
    const aborted = ctrl.signal.aborted;
    return json(
      {
        error: aborted ? 'upstream_timeout' : 'upstream_failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      aborted ? 504 : 502,
    );
  } finally {
    clearTimeout(timer);
  }
});
