/**
 * LLM nur Pitch-Text — 180–200 Zeichen/Ort, motivierend.
 */

import { generateGeminiText } from '../../services/geminiService';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../../services/concierge/findusResponsePolicy';
import type { PitchCandidate, PitchRequest } from './types';

const PITCH_SYSTEM = `Du bist Findus Pitcher. Schreibe für genau zwei Orte je einen motivierenden Pitch.
Länge je speechPitch: 180–200 Zeichen. Warum hingehen — konkret, Du-Form, Deutsch.
Die beiden Pitches MÜSSEN sich inhaltlich unterscheiden (andere Fakten/Vorteile), nie denselben Text umschreiben.
Keine Adresse, kein Telefon, keine Meta („Option A“). Namen nicht am Satzanfang wiederholen.
NIE WiFi/WLAN, „gut zum Telefonieren/Callen/Meetings“ erwähnen — das ist Standard-Fluff.
Hotel: Preis/Nacht oder Sterne nennen wenn in den Daten; Nähe zum genannten Anker (z. B. Tennis) wenn Distanz da.
Food/Frühstück: Küche/Gerichte/Speisekarte andeuten wenn bekannt — keine Event-Location als Café verkaufen.
Empfehlung nur wenn einer klar besser ist (in summary), sonst neutral.
Stichpunkte: max 3 je Ort, je max 2 kurze Zeilen — Sterne/Distanz/Nutzen/Preis. Kein „perfekt vor dem Termin“ wenn der Termin zur gleichen Zeit ist.

${FINDUS_FEW_SHOT_DISCLAIMER}

JSON:
{
  "summary": "optional ein Satz",
  "cards": [
    { "name": "Ort", "speechPitch": "…", "bulletPoints": ["…","…","…"] }
  ]
}`;

function fallbackPitch(
  c: PitchCandidate,
  softFail: boolean,
): { speechPitch: string; bullets: string[] } {
  const dist =
    c.distFromAnchorM != null
      ? c.distFromAnchorM < 1000
        ? `${Math.round(c.distFromAnchorM)} m`
        : `${(c.distFromAnchorM / 1000).toFixed(1)} km`
      : null;
  const rating =
    c.rating != null ? `${c.rating.toFixed(1).replace('.', ',')}★` : null;
  const detour =
    c.detourMinApprox != null && c.detourMinApprox > 0.5
      ? `kleiner Abstecher ~${Math.round(c.detourMinApprox)} Min`
      : null;
  const speechPitch = [
    softFail
      ? 'Nicht der perfekte Match, aber eine solide Chance.'
      : 'Das könnte genau dein Spot sein.',
    rating ? `Mit ${rating} wirkt er stark.` : null,
    dist ? `Liegt etwa ${dist} entfernt.` : null,
    detour,
    'Wenn du Bock hast: rein und ausprobieren.',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 200);
  const bullets = [rating, dist, detour].filter(Boolean).slice(0, 3) as string[];
  return { speechPitch, bullets };
}

function parseJson(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type PitchedCard = {
  candidate: PitchCandidate;
  speechPitch: string;
  bullets: string[];
};

export async function generatePitchSpeech(opts: {
  req: PitchRequest;
  top: PitchCandidate[];
  softFail: boolean;
  softFailReason?: string;
  signal?: AbortSignal;
}): Promise<{ summary: string; cards: PitchedCard[]; spokenText: string }> {
  const top = opts.top.slice(0, 2);
  const catalog = top
    .map(
      (c, i) =>
        `${i + 1}. ${c.name} | rating=${c.rating ?? 'n/a'} | dist_m=${Math.round(
          c.distFromAnchorM ?? 0,
        )} | detour_min≈${(c.detourMinApprox ?? 0).toFixed(1)} | prio=${c.detourPrio ?? '?'}`,
    )
    .join('\n');

  let summary = opts.softFail
    ? opts.softFailReason ||
      'Nichts Perfektes — hier zwei Alternativen mit besseren Chancen.'
    : '';
  let cards: PitchedCard[] = top.map((c) => {
    const fb = fallbackPitch(c, opts.softFail);
    return { candidate: c, speechPitch: fb.speechPitch, bullets: fb.bullets };
  });

  try {
    const raw = await generateGeminiText(
      [
        `WUNSCH: ${opts.req.title}`,
        `KONTEXT: ${opts.req.context}`,
        `MODUS: ${opts.req.searchMode}`,
        opts.softFail ? `SOFT_FAIL: ${opts.softFailReason ?? 'yes'}` : '',
        `ORTE:\n${catalog}`,
      ]
        .filter(Boolean)
        .join('\n'),
      {
        systemInstruction: PITCH_SYSTEM,
        useFindusSystem: false,
        responseJson: true,
        jsonMimeOnly: true,
        temperature: 0.5,
        maxTokens: 1200,
        signal: opts.signal ?? opts.req.signal,
        task: 'itinerary',
      },
    );
    const parsed = parseJson(raw);
    if (parsed) {
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
        summary = parsed.summary.trim().slice(0, 160);
      }
      const arr = Array.isArray(parsed.cards) ? parsed.cards : [];
      const next: PitchedCard[] = [];
      for (const c of top) {
        const row = arr.find(
          (x) =>
            x &&
            typeof x === 'object' &&
            String((x as { name?: string }).name ?? '')
              .toLowerCase()
              .includes(c.name.toLowerCase().slice(0, 10)),
        ) as
          | { speechPitch?: string; bulletPoints?: unknown[] }
          | undefined;
        const fb = fallbackPitch(c, opts.softFail);
        let speech = String(row?.speechPitch ?? fb.speechPitch)
          .trim()
          .slice(0, 220);
        if (speech.length < 120) speech = fb.speechPitch;
        const bullets = (
          Array.isArray(row?.bulletPoints)
            ? row!.bulletPoints!.map((x) => String(x).trim()).filter(Boolean)
            : fb.bullets
        ).slice(0, 3);
        next.push({ candidate: c, speechPitch: speech, bullets });
      }
      if (next.length) cards = next;
    }
  } catch {
    /* fallback already set */
  }

  const parts: string[] = [];
  if (summary) parts.push(summary);
  if (cards[0]) {
    parts.push(`Erstens ${cards[0].candidate.name}: ${cards[0].speechPitch}`);
  }
  if (cards[1]) {
    parts.push(`Oder du gehst zu ${cards[1].candidate.name}: ${cards[1].speechPitch}`);
  }
  if (cards.length === 1) {
    parts.push('Eine klare Alternative habe ich gerade nicht.');
  }
  parts.push('Was ist dein Favorit?');

  return {
    summary,
    cards,
    spokenText: parts.join(' ').replace(/\s+/g, ' ').trim(),
  };
}
