/**
 * Unbekannte Zeiten/Puffer → Web-Recherche nach realistischen Werten.
 */

import { runWebResearch } from '../research/webResearchService';
import { roundUpTo5Min } from './bufferMath';

export type ResearchedTiming = {
  minutes: number | null;
  label: string;
  sourceNotes: string[];
  promptBlock: string;
};

const CLOCK_SPAN_RE =
  /(\d{1,2})[:.](\d{2})\s*(?:uhr)?\s*(?:–|-|bis)\s*(\d{1,2})[:.](\d{2})/iu;
const MIN_RE =
  /\b(\d{1,3})\s*(?:–|-|bis)\s*(\d{1,3})\s*min(?:uten)?\b|\b(\d{1,3})\s*min(?:uten)?\b/iu;

function parseUpperMinutes(text: string): number | null {
  const span = text.match(MIN_RE);
  if (!span) return null;
  if (span[1] && span[2]) {
    return roundUpTo5Min(Math.max(Number(span[1]), Number(span[2])));
  }
  if (span[3]) return roundUpTo5Min(Number(span[3]));
  return null;
}

/**
 * z.B. Hotel-Frühstück, Checkout, typische Verweildauer Museum.
 */
export async function researchRealisticTiming(opts: {
  subject: string;
  kind:
    | 'breakfast_hours'
    | 'checkout'
    | 'dwell'
    | 'buffer'
    | 'travel'
    | 'generic';
  cityHint?: string | null;
}): Promise<ResearchedTiming> {
  const where = opts.cityHint ? ` in ${opts.cityHint}` : '';
  const queries: Record<typeof opts.kind, string> = {
    breakfast_hours: `Frühstückszeiten ${opts.subject}${where} heute realistisch`,
    checkout: `Check-out Uhrzeit ${opts.subject}${where} Hotel`,
    dwell: `Wie lange bleiben Besucher typischerweise bei ${opts.subject}${where} Minuten`,
    buffer: `Empfohlener Ankunftspuffer ${opts.subject}${where} Minuten vorher`,
    travel: `Fahrzeit / Gehzeit ${opts.subject}${where} realistisch Minuten`,
    generic: `Realistische Zeitangabe ${opts.subject}${where}`,
  };

  const notes: string[] = [];
  let minutes: number | null = null;

  try {
    const web = await runWebResearch(queries[opts.kind]);
    const factsText = (web?.facts ?? [])
      .map((f) => `${f.label ?? ''}: ${f.value ?? ''}`)
      .join('\n');
    const blob = `${web?.researchNotes ?? ''}\n${web?.promptBlock ?? ''}\n${factsText}\n${web?.speechHint ?? ''}`;
    notes.push(blob.slice(0, 400));

    if (opts.kind === 'breakfast_hours') {
      const m = blob.match(CLOCK_SPAN_RE);
      if (m) {
        notes.push(`Frühstückfenster ${m[1]}:${m[2]}–${m[3]}:${m[4]}`);
      }
    }

    minutes = parseUpperMinutes(blob);

    // Fallbacks wenn Recherche nichts Zahlenmäßiges liefert
    if (minutes == null) {
      if (opts.kind === 'checkout') minutes = 10;
      else if (opts.kind === 'dwell') minutes = 90;
      else if (opts.kind === 'buffer') minutes = 10;
      else if (opts.kind === 'breakfast_hours') minutes = 40;
      notes.push('Fallback: Standardwert (Recherche ohne klare Minuten)');
    } else {
      notes.push(`Recherche → ${minutes} Min (oberes Ende / auf 5 gerundet)`);
    }
  } catch (err) {
    notes.push(`Recherche fehlgeschlagen: ${String(err)}`);
    minutes =
      opts.kind === 'checkout'
        ? 10
        : opts.kind === 'dwell'
          ? 90
          : opts.kind === 'buffer'
            ? 10
            : 40;
  }

  return {
    minutes,
    label: opts.subject,
    sourceNotes: notes,
    promptBlock: [
      `=== ZEIT-RECHERCHE: ${opts.subject} (${opts.kind}) ===`,
      minutes != null ? `Ergebnis: ${minutes} Min` : 'Keine Minuten',
      ...notes.slice(0, 3),
    ].join('\n'),
  };
}
