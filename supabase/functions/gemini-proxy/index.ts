/**
 * Gemini generateContent proxy — API key stays on the server.
 *
 * Deploy:
 *   supabase secrets set GEMINI_API_KEY=...
 *   supabase functions deploy gemini-proxy
 *
 * Client: EXPO_PUBLIC_USE_LLM_PROXY=1 (+ Supabase URL/anon).
 * Body: { model, body } where body is the Gemini REST generateContent payload.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const UPSTREAM_MS = 55_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function isSafeModelId(model: string): boolean {
  return /^[a-zA-Z0-9._-]{3,80}$/.test(model);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST required' }, 405);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY')?.trim();
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  // Require Supabase anon/user JWT (gateway already validates when verify_jwt=true)
  const auth = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(auth)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: { model?: string; body?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const model = (payload.model ?? '').toString().trim();
  if (!isSafeModelId(model) || !payload.body || typeof payload.body !== 'object') {
    return json({ error: 'model + body required' }, 400);
  }

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_MS);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.body),
      signal: ctrl.signal,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
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
