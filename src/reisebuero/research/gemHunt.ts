/**
 * Gem-Hunt: Geheimtipps, Exklusives, Preisfehler/Schnäppchen.
 * Immer parallel zur Shortlist — nichts erfinden, nur belegt.
 */

import { FINDUS_FEW_SHOT_DISCLAIMER } from '../../services/concierge/findusResponsePolicy';
import {
  generateGeminiText,
  hasGeminiApiKey,
} from '../../services/geminiService';
import { buildRecapLines } from '../completeness';
import type { ReiseLedger } from '../types';
import {
  extractJsonObject,
  parseProDiscoverJson,
  type ProDestCandidate,
} from './proEnrichParse';
import { intentArcFromLedger, shortlistSearchBrief } from './shortlistFunnel';
import { dealHuntRatio } from './dealAnomaly';

export type GemHuntResult = {
  destinations: ProDestCandidate[];
  notes: string;
  dealHints: string[];
};

/**
 * Extra-Recherche: Geheimtipps + Exklusives + Schnäppchen-Korridore.
 * Soft immer; bei dealHunt=true etwas aggressiver / mehr Treffer.
 */
export async function runGemHuntDiscover(
  ledger: ReiseLedger,
  opts?: { usePro?: boolean },
): Promise<GemHuntResult> {
  const empty: GemHuntResult = { destinations: [], notes: '', dealHints: [] };
  if (!hasGeminiApiKey()) return empty;

  const usePro = opts?.usePro === true;
  const aggressive = ledger.dealHunt?.value === true;
  const board = buildRecapLines(ledger).join(' · ');
  const arc = intentArcFromLedger(ledger);
  const brief = shortlistSearchBrief(ledger);
  const budget = ledger.budgetEur?.value;
  const ratio = dealHuntRatio(ledger);
  let catalogBrief = '';
  try {
    const { buildInspirationResearchBrief } = await import('./inspirationPoolBrief');
    catalogBrief = buildInspirationResearchBrief(ledger, { maxLines: 6, maxChars: 480 });
  } catch {
    /* soft */
  }

  const prompt = [
    FINDUS_FEW_SHOT_DISCLAIMER,
    'Yorro Gem-Hunt: Geheimtipps, Exklusives, Schnäppchen — Google Search, nur belegt.',
    usePro ? 'Tiefe (Pro).' : 'Schnell (Lite).',
    `BOARD: ${board || '(leer)'}`,
    `ARC: ${arc} · BRIEF: ${brief}`,
    catalogBrief,
    catalogBrief
      ? 'Katalog nur als Spur: eigene Search-Hits priorisieren; Katalog-Orte nur wenn belegt und Board-Fit.'
      : '',
    budget != null ? `Budget-Rahmen ca. ${budget} € p.P. — utopische Luxus-Only weglassen.` : '',
    aggressive
      ? 'User will aktiv Preisfehler/Schnäppchen: priorisiere ungewöhnlich günstige Korridore und Last-Minute/Off-Season-Hits.'
      : 'Trotzdem immer 1–3 Geheimtipps + 1 Exklusiv-/Wow-Idee suchen (nicht nur Mainstream).',
    'Liefere 4–7 Destinationen/Ideen, möglichst NICHT die üblichen Top-Touristenfallen als einzige Antwort.',
    'Mix: (a) Geheimtipp/wenig bekannt, (b) exklusives Erlebnis/Kulisse, (c) Schnäppchen-Korridor wenn belegt.',
    'tags Pflicht wo passend: geheim | exclusive | deal | scenic | bargain',
    `whyFit: warum Board+Taste — bei deal grob warum günstig (Off-Season, Secondary-Airport, …). Deal-Ratio-Hint intern ~${ratio}.`,
    'JSON: {"destinations":[{"name":"","lat":0,"lng":0,"iata":null,"wiki":"","tags":["geheim"],"whyFit":""}],"dealHints":["1 kurzer belegter Schnäppchen-Hinweis"],"notes":"1 Satz"}',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      costModule: 'research',
      ...(usePro
        ? { tier: 'pro' as const, forcePro: true, allowProEscalate: false }
        : { tier: 'lite' as const, forcePro: false, allowProEscalate: false }),
      enableGoogleSearch: true,
      maxTokens: usePro ? 1800 : 1100,
      temperature: 0.35,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
    });
    const parsed = extractJsonObject(raw || '');
    const destinations = parseProDiscoverJson(raw || '').map((d) => {
      const tags = new Set(d.tags.map((t) => t.toLowerCase()));
      if (!tags.has('geheim') && !tags.has('exclusive') && !tags.has('deal') && !tags.has('bargain')) {
        tags.add('geheim');
      }
      return { ...d, tags: [...tags] };
    });
    const notes =
      typeof parsed?.notes === 'string' ? parsed.notes.trim().slice(0, 240) : '';
    const dealHints = Array.isArray(parsed?.dealHints)
      ? parsed.dealHints
          .filter((h: unknown): h is string => typeof h === 'string' && h.trim().length > 2)
          .map((h: string) => h.trim().slice(0, 100))
          .slice(0, 4)
      : [];
    return { destinations, notes, dealHints };
  } catch {
    return empty;
  }
}

export function isGemTagged(tags: string[] | undefined): boolean {
  return (tags || []).some((t) =>
    /geheim|exclusive|deal|bargain|scenic|low_tourist|lonely/i.test(t),
  );
}
