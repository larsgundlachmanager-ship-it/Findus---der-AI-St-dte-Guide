/**
 * Gemini multi-intent parser — Zero Hardcoding.
 * Turns complex user speech into structured CompoundPlanParseResult.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import type { CompoundPlanParseResult } from '../../runtime/sessionPlanTypes';
import { clampBufferMinutes } from './timeBufferPolicy';

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((s) => s.length >= 1);
}

/**
 * Structural gate only — no product/place hardcodes.
 * Triggers when utterance looks multi-goal (time + need/clauses).
 */
export function shouldTryCompoundPlan(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 40) return false;
  const hasClock =
    /\b\d{1,2}[:.h]\d{2}\b/.test(t) ||
    /\bum\s+\d{1,2}\s*(?:uhr)?\b/iu.test(t);
  const clauses = t.split(/[.!?]+/).filter((s) => s.trim().length > 10).length;
  const multiGoal =
    /\b(außerdem|ausserdem|sowie|vorher|danach|zuerst|dann|und\s+noch|brauch|benötig|benoetig|muss|möchte|moechte)\b/iu.test(
      t,
    );
  return (hasClock && multiGoal) || (clauses >= 3 && multiGoal);
}

export async function parseCompoundPlanWithGemini(
  userText: string,
  opts?: { nowIso?: string; placeHint?: string | null },
): Promise<CompoundPlanParseResult | null> {
  if (!hasGeminiApiKey()) return null;

  const nowIso = opts?.nowIso ?? new Date().toISOString();
  const prompt = [
    'Du bist ein Intent-Parser für einen Reise-Begleiter.',
    `Jetzt (ISO): ${nowIso}.`,
    opts?.placeHint ? `Ort-Kontext: ${opts.placeHint}.` : '',
    'Zerlege die User-Nachricht in ein JSON-Objekt. Kein Markdown.',
    'Schema:',
    '{',
    '  "isCompound": boolean,',
    '  "freeRoam": boolean,',
    '  "bufferMinutes": number,',
    '  "confirmSpeech": string,',
    '  "stops": [',
    '    {',
    '      "kind": "fixed" | "dynamic" | "hotel",',
    '      "label": string,',
    '      "arriveByLocal": "HH:MM" | null,',
    '      "placeTypes": string[],',
    '      "items": string[]',
    '    }',
    '  ]',
    '}',
    'Regeln:',
    '- isCompound=true nur wenn MEHRERE Ziele/Bedürfnisse (Zeit + Einkauf + Hotel/Spaziergang o.ä.).',
    '- fixed: konkreter Ort/Termin (Restaurant, Tennisplatz, Strand).',
    '- hotel: Rückkehr zur Unterkunft.',
    '- dynamic: flexible Einkäufe — placeTypes als generische Kategorien (z.B. supermarket, convenience_store, drugstore, pharmacy), NIEMALS Markennamen erzwingen.',
    '- items: gewünschte Produkte/Bedürfnisse aus dem Text.',
    '- arriveByLocal: Ankunftszeit am fixed-Stop als HH:MM lokal, sonst null.',
    '- Timing rückwärts: „30 Min vorher da“ + Termin 18:00 → arriveByLocal 17:30; „2h vorher essen“ → Essen-Stop früher.',
    '- freeRoam=true wenn User noch spazieren/erkunden will und später Bescheid will.',
    '- bufferMinutes: IMMER ≥5. Normal 8–12; wichtig (Sport/Tisch/Termin) 10–15; Flug 15–20. Einschätzen, nicht raten.',
    '- confirmSpeech: 2–4 kurze Sätze Deutsch (du-Form), bestätigt Plan MIT Zeiten — keine Listen, kein JSON.',
    '- Stops in sinnvoller Reihenfolge (jetzt → später).',
    `User: „${userText.slice(0, 900)}“`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'intent',
      responseJson: true,
      useFindusSystem: false,
      maxTokens: 700,
      temperature: 0.2,
    });
    const data = extractJsonObject(raw);
    if (!data) return null;

    const stopsRaw = Array.isArray(data.stops) ? data.stops : [];
    const stops = stopsRaw
      .map((s) => {
        if (!s || typeof s !== 'object') return null;
        const o = s as Record<string, unknown>;
        const kindRaw = String(o.kind ?? '');
        const kind =
          kindRaw === 'hotel' || kindRaw === 'dynamic' || kindRaw === 'fixed'
            ? kindRaw
            : null;
        if (!kind) return null;
        const label = String(o.label ?? '').trim();
        if (!label && kind !== 'dynamic') return null;
        const arrive =
          o.arriveByLocal == null || o.arriveByLocal === ''
            ? null
            : String(o.arriveByLocal).trim();
        return {
          kind,
          label: label || 'Einkauf',
          arriveByLocal: arrive,
          placeTypes: asStringArray(o.placeTypes),
          items: asStringArray(o.items),
        };
      })
      .filter(Boolean) as CompoundPlanParseResult['stops'];

    const confirmSpeech = String(data.confirmSpeech ?? '').trim();
    const isCompound = data.isCompound === true && stops.length >= 2;

    return {
      isCompound,
      freeRoam: data.freeRoam === true,
      bufferMinutes: clampBufferMinutes(Number(data.bufferMinutes) || 15, {
        text: String(data.confirmSpeech ?? ''),
      }),
      confirmSpeech:
        confirmSpeech.length >= 12
          ? confirmSpeech
          : 'Alles klar — ich merke mir deine Stopps und passe auf die Zeit auf.',
      stops,
    };
  } catch (err) {
    if (__DEV__) console.warn('[compound-plan] parse failed:', err);
    return null;
  }
}
