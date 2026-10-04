/**
 * Node-/App-sicherer Grounded-JSON-Fetch (Gemini REST).
 * Kein react-native / expo-constants — für Batch-Scripts und Funnel-Fallback.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-flash-lite-latest';

function resolveKey(): string {
  const k =
    process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_API_KEY ||
    '';
  if (!k || /your-|YOUR_/.test(k)) return '';
  return k.trim();
}

export function hasGroundedJsonKey(): boolean {
  return Boolean(resolveKey());
}

/**
 * Ein JSON-Text aus Gemini (+ optional Google Search Grounding).
 * Liefert Rohstring (JSON) oder ''.
 */
export async function groundedJsonLite(opts: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  enableGoogleSearch?: boolean;
  model?: string;
}): Promise<string> {
  const apiKey = resolveKey();
  if (!apiKey) return '';

  const model = opts.model || process.env.EXPO_PUBLIC_GEMINI_MODEL || DEFAULT_MODEL;
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const callOnce = async (withSearch: boolean): Promise<string> => {
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.25,
        maxOutputTokens: opts.maxTokens ?? 1400,
        responseMimeType: 'application/json',
      },
    };
    if (withSearch) body.tools = [{ google_search: {} }];

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`gemini ${res.status}: ${errText.slice(0, 220)}`);
      (err as Error & { status?: number; body?: string }).status = res.status;
      (err as Error & { body?: string }).body = errText;
      throw err;
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (
      data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
      ''
    ).trim();
  };

  const wantSearch = opts.enableGoogleSearch !== false;
  if (!wantSearch) return callOnce(false);

  try {
    const text = await callOnce(true);
    if (text) return text;
  } catch (e) {
    const msg = String(e);
    if (!/google_search|tool|invalid argument|Unknown name|400/i.test(msg)) {
      throw e;
    }
  }
  // Fallback: ohne Grounding (Modell unterstützt Tool nicht / JSON+Search Clash)
  return callOnce(false);
}
