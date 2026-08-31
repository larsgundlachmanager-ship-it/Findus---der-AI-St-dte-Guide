/**
 * Öffentliche Instagram-Posts/Stories recherchieren (Gemini + Google Search).
 * Kein Scraping, keine erfundenen Captions — nur belegte URLs + Kurzbeschreibung.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../concierge/findusResponsePolicy';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import type { Module2ActionButton } from '../../module2/types';

export type InstagramPublicHit = {
  title: string;
  summary: string;
  url: string;
  kind: 'story' | 'post' | 'reel' | 'profile';
  venue?: string | null;
};

export type InstagramPublicResearchResult = {
  hits: InstagramPublicHit[];
  draftText: string;
  /** Kurze Vorlese-Zeile für TTS */
  spokenSpeech: string;
  buttons: Module2ActionButton[];
  empty: boolean;
};

function normalizeIgUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function classifyIgUrl(url: string): InstagramPublicHit['kind'] {
  if (/\/stories\//i.test(url)) return 'story';
  if (/\/reel\//i.test(url)) return 'reel';
  if (/\/p\//i.test(url)) return 'post';
  return 'profile';
}

function parseHitsFromModel(raw: string): InstagramPublicHit[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const arr = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: InstagramPublicHit[] = [];
    for (const row of arr.slice(0, 4)) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const url = normalizeIgUrl(String(r.url ?? r.link ?? ''));
      if (!url) continue;
      const summary = String(r.summary ?? r.text ?? r.caption ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
      const title = String(r.title ?? r.venue ?? r.place ?? 'Instagram')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      if (!summary && classifyIgUrl(url) === 'profile') {
        // Profil ohne Inhalt lohnt kaum
        continue;
      }
      out.push({
        title: title || 'Instagram',
        summary: summary || 'Öffentlicher Beitrag',
        url,
        kind: classifyIgUrl(url),
        venue: r.venue ? String(r.venue).slice(0, 80) : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function buildDraftAndButtons(
  hits: InstagramPublicHit[],
  city: string | null,
): Pick<
  InstagramPublicResearchResult,
  'draftText' | 'buttons' | 'empty' | 'spokenSpeech'
> {
  if (!hits.length) {
    return {
      empty: true,
      spokenSpeech: '',
      draftText:
        'INSTAGRAM: Keine belegten öffentlichen Posts/Stories gefunden. Nichts erfinden. Web-Lane bleibt Quelle.',
      buttons: [],
    };
  }
  const lines = hits.map((h, i) => {
    const where = h.venue || h.title;
    const kindDe =
      h.kind === 'story'
        ? 'Story'
        : h.kind === 'reel'
          ? 'Reel'
          : h.kind === 'post'
            ? 'Post'
            : 'Profil';
    return `${i + 1}) ${kindDe} · ${where}: ${h.summary} · URL ${h.url}`;
  });
  const spokenSpeech = hits
    .slice(0, 2)
    .map((h) => {
      const where = h.venue || h.title;
      const kindDe = h.kind === 'story' ? 'In der Story' : 'Auf Instagram';
      return `${kindDe} zu ${where}: ${h.summary}`;
    })
    .join(' ')
    .slice(0, 420);
  const draftText = [
    'FAKTEN Instagram öffentlich (nicht wörtlich vorlesen):',
    city ? `Stadt-Kontext: ${city}` : null,
    ...lines,
    `SPOKEN: ${spokenSpeech}`,
    'FLOW: Kurz sagen was läuft → Button öffnet Story/Post-Link.',
    'Nur Belegtes. Keine erfundenen Stories/Captions.',
  ]
    .filter(Boolean)
    .join('\n');

  const buttons: Module2ActionButton[] = hits.slice(0, 3).map((h, i) => {
    const kindDe =
      h.kind === 'story'
        ? 'Story'
        : h.kind === 'reel'
          ? 'Reel'
          : h.kind === 'post'
            ? 'Post'
            : 'IG';
    const label = shortenActionLabel(
      `📸 ${kindDe} ${(h.venue || h.title).slice(0, 16)}`,
    );
    return {
      id: `ig_${i}`,
      label,
      payload: {
        kind: 'deep_link',
        url: h.url,
        destName: h.venue || h.title,
      },
    };
  });

  return { draftText, buttons, empty: false, spokenSpeech };
}

/**
 * Öffentliche IG-Funde zu Ort/Event/Stadt.
 */
export async function researchPublicInstagram(opts: {
  userText: string;
  subject?: string | null;
  city?: string | null;
  signal?: AbortSignal;
}): Promise<InstagramPublicResearchResult> {
  const city = (opts.city ?? '').trim() || null;
  const subject = (opts.subject ?? '').trim() || null;
  const q = (opts.userText ?? '').replace(/\s+/g, ' ').trim();

  if (!hasGeminiApiKey()) {
    return {
      hits: [],
      ...buildDraftAndButtons([], city),
    };
  }

  try {
    const raw = await generateGeminiText(
      `${FINDUS_FEW_SHOT_DISCLAIMER}\n` +
        `Aufgabe: Finde ÖFFENTLICHE Instagram-Beiträge/Stories/Reels zu Ort oder Event.\n` +
        `Stadt: ${city ?? 'unbekannt'}\n` +
        `Thema/Ort: ${subject ?? 'aus User-Frage'}\n` +
        `User: ${q}\n\n` +
        `Regeln:\n` +
        `- Nur echte, öffentlich indexierte Instagram-URLs (instagram.com/…).\n` +
        `- Stories/Posts zu Locals/Venues (z. B. Bars, Außenposten, Events) wenn belegt.\n` +
        `- summary = kurze belegte Beschreibung was läuft (kein Erfinden).\n` +
        `- Wenn nichts belegt: leeres Array [].\n` +
        `- Antwort NUR JSON-Array: [{"title","summary","url","venue"}]\n`,
      {
        enableGoogleSearch: true,
        useFindusSystem: true,
        maxTokens: 700,
        temperature: 0.2,
        signal: opts.signal,
        allowProEscalate: false,
      },
    );
    const hits = parseHitsFromModel(raw || '');
    const built = buildDraftAndButtons(hits, city);
    return { hits, ...built };
  } catch {
    return {
      hits: [],
      ...buildDraftAndButtons([], city),
    };
  }
}
