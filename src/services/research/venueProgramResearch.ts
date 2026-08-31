/**
 * Modul-1 Live-Programm für Theater / Kino / Museum / Konzert / Aktivität.
 * Stadt-agnostisch: aktuelles Programm + Eintrittspreis nur aus Belegen.
 */

import type { Poi, PoiWithFacts } from '../../db/types';
import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { parseTagsJson } from '../geo/triggerPolicy';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../concierge/findusResponsePolicy';

export type VenueProgramKind =
  | 'theater'
  | 'cinema'
  | 'museum'
  | 'concert'
  | 'activity';

export type VenueProgramHit = {
  kind: VenueProgramKind;
  /** Kurzer Prompt-Block für die Hauptstory (nur belegte Fakten). */
  promptBlock: string;
  /** UI-/Speech-Stichpunkte */
  bullets: string[];
  /** Ticket-/Programm-URL wenn belegt */
  ticketUrl: string | null;
  websiteUrl: string | null;
};

function poiBlob(poi: Poi | PoiWithFacts): string {
  const tags = parseTagsJson(poi.tags_json).join(' ');
  const facts =
    'facts' in poi && Array.isArray(poi.facts)
      ? poi.facts.map((f) => f.fact_text ?? '').join(' ')
      : '';
  return `${poi.name} ${poi.category ?? ''} ${tags} ${facts}`.toLowerCase();
}

export function detectVenueProgramKind(
  poi: Poi | PoiWithFacts,
): VenueProgramKind | null {
  const blob = poiBlob(poi);
  if (/\b(kino|cinema|filmtheater)\b/i.test(blob)) return 'cinema';
  if (/\b(theater|schauspiel|kabarett|operette|bühne|buehne)\b/i.test(blob)) {
    return 'theater';
  }
  if (
    /\b(konzert|oper|musical|konzerthalle|philharmonie|musikhalle)\b/i.test(blob)
  ) {
    return 'concert';
  }
  if (/\b(museum|galerie|ausstellung|schloss|burg|amphitheater|amphitheatre)\b/i.test(blob)) {
    return 'museum';
  }
  if (
    /\b(minigolf|beach\s*volley|bowling|escape|klettern|wasserski|wakeboard|freizeitpark|tennis|sport)\b/i.test(
      blob,
    )
  ) {
    return 'activity';
  }
  return null;
}

function kindLabel(kind: VenueProgramKind): string {
  switch (kind) {
    case 'theater':
      return 'Theater/Spielplan';
    case 'cinema':
      return 'Kino/Programm';
    case 'museum':
      return 'Museum/Ausstellung + Eintritt';
    case 'concert':
      return 'Konzert/Musical-Programm';
    case 'activity':
      return 'Aktivität/Preise';
  }
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const t = (raw || '').trim();
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

function strField(v: unknown): string {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t || /^null$/i.test(t)) return '';
  return t;
}

/**
 * Frisches Programm/Preise für diesen konkreten Ort.
 * Timeout-freundlich — Caller sollte Promise.race nutzen.
 */
export async function researchVenueProgram(input: {
  poi: Poi | PoiWithFacts;
  cityHint?: string | null;
  timeoutMs?: number;
}): Promise<VenueProgramHit | null> {
  const kind = detectVenueProgramKind(input.poi);
  if (!kind) return null;
  if (!hasGeminiApiKey()) return null;

  const name = String(input.poi.name || '')
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .trim();
  if (!name) return null;
  const city = (input.cityHint || '').trim();
  const timeoutMs = input.timeoutMs ?? 7_000;
  const today = new Date().toISOString().slice(0, 10);

  const prompt = [
    `Du recherchierst LIVE für Yorro Modul-1 am Ort „${name}${city ? `, ${city}` : ''}“.`,
    `Heute: ${today}. Fokus: ${kindLabel(kind)}.`,
    'Nutze Google Search. Nur belegte Fakten — nichts erfinden.',
    'Priorisiere offizielle Website / Ticket-Shop / aktuelles Programm.',
    'Extrahiere: was läuft HEUTE oder maximal MORGEN (Titel + worum es geht, kurz), Uhrzeiten wenn belegt, Eintrittspreise (€) wenn belegt, Ticket- oder Programm-URL.',
    'VERBOTEN: Programm „nächste Woche / irgendwann / diese Saison unbestimmt“ als Hauptinhalt. Nur heute (+ morgen).',
    'Für Museum/Schloss: Öffnung heute (bis wann) + Eintritt + aktuelle Ausstellung oder ein konkret genanntes Highlight-Exponat, wenn die offizielle Seite das nennt.',
    'Wenn nichts Aktuelles heute/morgen: ehrlich sagen, keine Platzhalter-Shows.',
    FINDUS_FEW_SHOT_DISCLAIMER,
    '',
    'JSON only:',
    '{',
    '  "runningNow": "Titel oder null",',
    '  "whenLabel": "heute 19:30 / morgen 18:00 / null",',
    '  "priceLabel": "ab 18 € / Eintritt 8 € / null",',
    '  "openUntil": "heute bis 17 Uhr / null",',
    '  "highlightNow": "Ausstellung oder konkretes Exponat / null",',
    '  "bullets": ["max 3 kurze Fakten"],',
    '  "ticketUrl": "https://...|null",',
    '  "websiteUrl": "https://...|null",',
    '  "notes": "1 Satz intern"',
    '}',
  ].join('\n');

  try {
    const raw = await Promise.race([
      generateGeminiText(prompt, {
        task: 'research',
        enableGoogleSearch: true,
        maxTokens: 700,
        temperature: 0.15,
        useFindusSystem: false,
      }),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error('venue_program_timeout')), timeoutMs),
      ),
    ]);
    const parsed = extractJsonObject(raw);
    if (!parsed) return null;

    const running = strField(parsed.runningNow);
    const when = strField(parsed.whenLabel);
    const price = strField(parsed.priceLabel);
    const openUntil = strField(parsed.openUntil);
    const highlightNow = strField(parsed.highlightNow);
    const bullets = Array.isArray(parsed.bullets)
      ? (parsed.bullets as unknown[])
          .map((b) => String(b).replace(/\s+/g, ' ').trim())
          .filter((b) => b.length >= 4)
          .slice(0, 3)
      : [];
    const ticketUrl =
      typeof parsed.ticketUrl === 'string' &&
      /^https?:\/\//i.test(parsed.ticketUrl)
        ? parsed.ticketUrl.trim()
        : null;
    const websiteUrl =
      typeof parsed.websiteUrl === 'string' &&
      /^https?:\/\//i.test(parsed.websiteUrl)
        ? parsed.websiteUrl.trim()
        : null;

    if (!running && !price && !openUntil && !highlightNow && bullets.length === 0) {
      return null;
    }

    const lines: string[] = [
      `LIVE ${kindLabel(kind).toUpperCase()} (nur belegte Infos — nichts erfinden):`,
    ];
    if (running) lines.push(`- Läuft / Programm: ${running}`);
    if (when) lines.push(`- Wann: ${when}`);
    if (openUntil) lines.push(`- Offen: ${openUntil}`);
    if (price) lines.push(`- Preis/Eintritt: ${price}`);
    if (highlightNow) lines.push(`- Sehen/Anfassen: ${highlightNow}`);
    for (const b of bullets) lines.push(`- ${b}`);
    if (ticketUrl) lines.push(`- Ticket/Programm-URL: ${ticketUrl}`);
    else if (websiteUrl) lines.push(`- Website: ${websiteUrl}`);
    lines.push(
      'In der Hauptstory als PAYOFF der Historie einbauen: Öffnung/Preis/Programm/Exponat natürlich (Uhrzeit + Euro aussprechen). Kontrast früher↔heute nur mit Beleg. Keine Fake-Shows.',
    );

    const speechBullets = [
      ...(running ? [running + (when ? ` · ${when}` : '')] : []),
      ...(openUntil ? [openUntil] : []),
      ...(price ? [price] : []),
      ...(highlightNow ? [highlightNow] : []),
      ...bullets,
    ].slice(0, 3);

    return {
      kind,
      promptBlock: lines.join('\n'),
      bullets: speechBullets,
      ticketUrl,
      websiteUrl,
    };
  } catch (err) {
    if (__DEV__) {
      console.warn('[venueProgram]', err);
    }
    return null;
  }
}
