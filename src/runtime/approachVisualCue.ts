/**
 * Flow A — visuelle Orientierung via Gemini-Parameter (Zero Templates).
 * Landmark + optional Street View → ein Satz live generiert.
 * Stets: Blickrichtung ZUERST (GPS-Vektor wenn bewegt, sonst Compass).
 */

import { GEMINI_API_BASE } from '../constants/gemini';
import { env } from '../config/env';
import { generateGeminiText, hasGeminiApiKey } from '../services/geminiService';
import { resolveGeminiModels } from '../services/llm/modelRouter';
import {
  fetchStreetViewImageBase64,
  streetViewAvailable,
} from '../services/navigation/googleMapsNav';
import { isDeviceOffline } from '../services/navigation/networkState';
import { buildVisualDirectionalPromptRule } from '../services/navigation/facingReference';
import type { FacingSource } from '../services/navigation/facingReference';
import { isDataSaverActive } from '../services/userProfileService';

export type ApproachVisualParams = {
  destName: string;
  landmarkName: string | null;
  landmarkRelation: string | null;
  userLat: number;
  userLng: number;
  targetLat: number;
  targetLng: number;
  headingDeg: number;
  /** left / right / vor dir — from facing reference. */
  lookSidePhrase?: string | null;
  facingSource?: FacingSource;
};

function buildApproachVisualPrompt(params: ApproachVisualParams): string {
  return [
    'Du bist Yorro — lockerer Fußgänger-Begleiter. GENAU EIN kurzer deutscher Satz für visuelle Orientierung.',
    buildVisualDirectionalPromptRule({
      lookSidePhrase: params.lookSidePhrase ?? params.landmarkRelation,
      facingSource: params.facingSource,
    }),
    `Ziel: ${params.destName}.`,
    params.landmarkName
      ? `Nahe Landmark: ${params.landmarkName}${params.landmarkRelation ? ` — ${params.landmarkRelation}` : ''}.`
      : 'Keine gespeicherte Landmark — beschreibe die Richtung natürlich.',
    'Regeln:',
    params.lookSidePhrase
      ? '- ERSTER Satzteil = Blickrichtung („Schau nach rechts/links/vorne“).'
      : '- Facing unsicher: KEIN links/rechts. Starte mit Landmarke oder „Richtung …“.',
    '- Dann 1–2 markante Merkmale, die JEDER erkennt: Farbe, Material, Form (Turm/Giebel/Schild), Größe.',
    '- Kein vages „das Gebäude“ — konkret genug für jemanden, der den Ort nicht kennt.',
    '- Du-Form, Alltagssprache, max. 28 Wörter.',
    '- Keine Himmelsrichtungen, kein Markdown.',
    '- Wenn nichts Brauchbares: antworte nur NEIN.',
  ].join('\n');
}

async function generateWithStreetViewImage(
  prompt: string,
  base64: string,
): Promise<string | null> {
  const apiKey = env.geminiApiKey();
  if (!apiKey) return null;
  try {
    const model = resolveGeminiModels({ task: 'nav_parse' })[0];
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/jpeg', data: base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0.35, maxOutputTokens: 90 },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join(' ')
        .trim() ?? '';
    if (!text || /^nein\b/i.test(text) || text.length < 12) return null;
    return text.replace(/^["„]|["“]$/g, '').trim();
  } catch {
    return null;
  }
}

export async function generateApproachVisualCue(
  params: ApproachVisualParams,
): Promise<string | null> {
  if (await isDeviceOffline()) return null;
  if (!hasGeminiApiKey()) return null;

  const prompt = buildApproachVisualPrompt(params);

  // Sparmodus: kein Street-View-Bild-Fetch — nur leichter Text-Cue
  let svB64: string | null = null;
  if (!isDataSaverActive()) {
    try {
      const ok = await streetViewAvailable(params.targetLat, params.targetLng);
      if (ok) {
        svB64 = await fetchStreetViewImageBase64(
          params.targetLat,
          params.targetLng,
          params.headingDeg,
        );
      }
    } catch {
      svB64 = null;
    }
  }

  if (svB64) {
    const fromImage = await generateWithStreetViewImage(prompt, svB64);
    if (fromImage) return fromImage;
  }

  try {
    const line = (await generateGeminiText(prompt, { task: 'generic' })).trim();
    if (!line || /^nein\b/i.test(line) || line.length < 12) return null;
    return line.replace(/^["„]|["“]$/g, '').trim();
  } catch {
    return null;
  }
}

/**
 * Universal no-dead-end fallback when concierge/story pipeline fails.
 */
export async function generateUniversalFallbackReply(opts: {
  userQuestion: string;
  placeName?: string | null;
  intentKind?: string | null;
}): Promise<string | null> {
  if (await isDeviceOffline() || !hasGeminiApiKey()) return null;

  const prompt = [
    'Du bist Yorro, Reise-Begleiter. Der Standard-Antwort-Pfad ist fehlgeschlagen.',
    opts.placeName ? `Ort/Kontext: ${opts.placeName}.` : '',
    opts.intentKind ? `Intent: ${opts.intentKind}.` : '',
    `User-Frage: „${opts.userQuestion.slice(0, 280)}“`,
    'Formuliere GENAU 1–2 kurze Sätze auf Deutsch (du-Form).',
    'Sei hilfreich, konkret, ohne Dead-End — wenn du etwas nicht weißt, sag was du offline/trotzdem kannst.',
    'Kein JSON, keine Listen, max. 40 Wörter.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const line = (await generateGeminiText(prompt, { task: 'generic' })).trim();
    if (line.length >= 8) return line;
  } catch {
    /* fall through */
  }
  return null;
}
