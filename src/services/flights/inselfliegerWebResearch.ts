/**
 * Inselflieger — reine Website-Recherche (kein /api/flights).
 * Lädt öffentliche Seiten + Gemini Search Grounding auf inselflieger.de / frisonaut.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { fetchPublicDocument } from '../research/webFetch';
import type { IslandDirection, IslandFlightSlot } from './inselfliegerAdvisor';

const INFO_URL = 'https://www.inselflieger.de/wangerooge';
const HOME_URL = 'https://www.inselflieger.de/';
const BOOK_ASSISTANT =
  'https://www.frisonaut.de/de/mobilitaet/assistent';

export type IslandWebTariffs = {
  basicAdultFrom: number | null;
  flexAdultFrom: number | null;
  plusAdultFrom: number | null;
  excessPerKg: number | null;
  notes: string[];
};

function extractJsonObject(raw: string): unknown | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Frisonaut-Assistent: destination=wangerooge = Harle→Insel.
 * Abflug von der Insel: destination=harle + Hinweis „Von der Insel“.
 */
function bookUrl(dateIso: string, direction: IslandDirection): string {
  const u = new URL(BOOK_ASSISTANT);
  u.searchParams.set('tripType', 'ONEWAY');
  u.searchParams.set('start', dateIso);
  if (direction === 'in') {
    // Wangerooge → Harle (Abreise)
    u.searchParams.set('destination', 'harle');
    u.searchParams.set('origin', 'wangerooge');
    u.searchParams.set('findus_dir', 'wangerooge-harle');
  } else {
    // Harle → Wangerooge (Anreise)
    u.searchParams.set('destination', 'wangerooge');
    u.searchParams.set('origin', 'harle');
    u.searchParams.set('findus_dir', 'harle-wangerooge');
  }
  return u.toString();
}

export { bookUrl as buildInselfliegerBookUrl };

/** Tarif-Preise von der öffentlichen Info-Seite. */
export async function scrapeInselfliegerTariffs(): Promise<IslandWebTariffs> {
  const doc = await fetchPublicDocument(INFO_URL);
  const text = doc.ok ? doc.text : '';
  const notes: string[] = [];
  if (!doc.ok) notes.push(`Info-Seite: ${doc.reason ?? 'fehlgeschlagen'}`);

  const pick = (re: RegExp): number | null => {
    const m = text.match(re);
    if (!m?.[1]) return null;
    const n = Number(String(m[1]).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  // „Basic … ab 55 €“ / „ab 55“
  const basic =
    pick(/Basic[\s\S]{0,120}?ab\s*(\d{2,3})\s*€/i) ??
    pick(/Basic[\s\S]{0,80}?(\d{2,3})\s*€\s*pro\s*Erwachs/i);
  const flex =
    pick(/Flex[\s\S]{0,120}?ab\s*(\d{2,3})\s*€/i) ??
    pick(/Flex[\s\S]{0,80}?(\d{2,3})\s*€\s*pro\s*Erwachs/i);
  const plus =
    pick(/Plus[\s\S]{0,120}?ab\s*(\d{2,3})\s*€/i) ??
    pick(/Plus[\s\S]{0,80}?(\d{2,3})\s*€\s*pro\s*Erwachs/i);
  const excess =
    pick(/Übergepäck[^\d]{0,40}(\d+[.,]\d+)\s*€/i) ??
    pick(/(\d+[.,]\d+)\s*€\s*\/\s*kg/i);

  if (basic == null && flex == null && plus == null && doc.ok) {
    notes.push('Tarife auf der Seite nicht klar parsebar');
  }

  return {
    basicAdultFrom: basic,
    flexAdultFrom: flex,
    plusAdultFrom: plus,
    excessPerKg: excess,
    notes,
  };
}

/**
 * Tages-Slots: Website-Text + Google Search (nur öffentliche Quellen).
 * Kein Aufruf von /api/flights.
 */
export async function researchIslandFlightsFromWebsite(opts: {
  dateIso: string;
  direction: IslandDirection;
  userText: string;
}): Promise<{
  slots: IslandFlightSlot[];
  tariffs: IslandWebTariffs;
  sourceNotes: string[];
  failures: string[];
}> {
  const failures: string[] = [];
  const sourceNotes: string[] = [];
  const tariffs = await scrapeInselfliegerTariffs();
  sourceNotes.push(...tariffs.notes);

  const infoDoc = await fetchPublicDocument(INFO_URL);
  const homeDoc = await fetchPublicDocument(HOME_URL);
  if (infoDoc.ok) sourceNotes.push('Info-Seite geladen');
  else failures.push(`Info-Seite: ${infoDoc.reason}`);
  if (homeDoc.ok) sourceNotes.push('Startseite geladen');
  else failures.push(`Startseite: ${homeDoc.reason}`);

  const dirLabel =
    opts.direction === 'in'
      ? 'Wangerooge nach Harle (Festland / zurück)'
      : 'Harle nach Wangerooge (zur Insel)';

  const pageBlob = [
    infoDoc.ok ? `=== ${INFO_URL} ===\n${infoDoc.text.slice(0, 10_000)}` : '',
    homeDoc.ok ? `=== ${HOME_URL} ===\n${homeDoc.text.slice(0, 8_000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (!hasGeminiApiKey()) {
    failures.push('Kein Gemini — nur Tarif-Seite, keine Tageszeiten');
    return {
      slots: [],
      tariffs,
      sourceNotes,
      failures,
    };
  }

  const prompt = [
    'Du recherchierst den Inselflieger Wangerooge ↔ Harle NUR über öffentliche Webseiten',
    '(inselflieger.de, frisonaut.de). Keine erfundenen Flüge.',
    `Datum: ${opts.dateIso}`,
    `Richtung: ${dirLabel}`,
    `User: „${opts.userText.slice(0, 200)}“`,
    '',
    'Nutze Google Search + den Seitenauszug unten.',
    'Finde konkrete Abflugzeiten und Preise (€) für DIESES Datum und DIESE Richtung.',
    'Wenn nur Tarif-ab-Preise (Basic/Flex/Plus) bekannt sind, aber keine Slot-Liste:',
    '  flights=[] und in notes ehrlich sagen — User muss Frisonaut öffnen.',
    'Wenn Slot-Zeiten öffentlich stehen: alle sinnvollen freien/genannten Flüge.',
    '',
    'JSON only:',
    '{',
    '  "notes": "string",',
    '  "failures": ["string"],',
    '  "flights": [',
    '    {',
    '      "departureLocal": "HH:MM",',
    '      "arrivalLocal": "HH:MM"|null,',
    '      "priceEur": number|null,',
    '      "freeSeats": number|null,',
    '      "availability": "good"|"few"|"sold"|"unknown",',
    '      "flightNumber": "string"|null,',
    '      "sourceUrl": "https://..."',
    '    }',
    '  ]',
    '}',
    '',
    pageBlob.slice(0, 18_000) || '(Seitenauszug leer — nur Search nutzen)',
  ].join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'generic',
      enableGoogleSearch: true,
      maxTokens: 1400,
      temperature: 0.15,
      useFindusSystem: false,
    });
    const parsed = extractJsonObject(raw) as Record<string, unknown> | null;
    if (typeof parsed?.notes === 'string' && parsed.notes.trim()) {
      sourceNotes.push(parsed.notes.trim().slice(0, 240));
    }
    if (Array.isArray(parsed?.failures)) {
      for (const f of parsed!.failures as unknown[]) {
        failures.push(String(f).slice(0, 160));
      }
    }

    const rows = Array.isArray(parsed?.flights) ? parsed!.flights : [];
    const slots: IslandFlightSlot[] = [];
    const defaultPrice =
      tariffs.basicAdultFrom ??
      tariffs.flexAdultFrom ??
      tariffs.plusAdultFrom ??
      null;

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const dep = String(r.departureLocal ?? '').trim();
      if (!/^\d{1,2}:\d{2}$/.test(dep)) continue;
      const price =
        typeof r.priceEur === 'number' && r.priceEur > 0
          ? r.priceEur
          : defaultPrice;
      const seats =
        typeof r.freeSeats === 'number' ? Math.max(0, r.freeSeats) : 1;
      const avail = String(r.availability ?? 'unknown');
      const deep =
        typeof r.sourceUrl === 'string' && /^https?:\/\//i.test(r.sourceUrl)
          ? r.sourceUrl
          : bookUrl(opts.dateIso, opts.direction);

      slots.push({
        id: `web-${opts.dateIso}-${dep}-${opts.direction}`,
        flightNumber:
          typeof r.flightNumber === 'string' && r.flightNumber.trim()
            ? r.flightNumber.trim()
            : `Web ${dep}`,
        direction: opts.direction,
        departureLocal: dep.length === 4 ? `0${dep}` : dep,
        arrivalLocal:
          typeof r.arrivalLocal === 'string' &&
          /^\d{1,2}:\d{2}$/.test(r.arrivalLocal)
            ? r.arrivalLocal
            : '',
        durationMin: 7,
        availability: avail,
        freeSeats: seats,
        priceEur: price,
        deepLink: deep,
        routeName:
          opts.direction === 'in'
            ? 'WANGEROOGE → HARLESIEL'
            : 'HARLESIEL → WANGEROOGE',
      });
    }

    // Sort by time
    slots.sort((a, b) => a.departureLocal.localeCompare(b.departureLocal));

    if (!slots.length) {
      failures.push(
        'Keine konkreten Abflugzeiten auf öffentlichen Seiten gefunden — Buchungsassistent nötig',
      );
    }

    return { slots, tariffs, sourceNotes, failures };
  } catch (err) {
    failures.push(
      `Website-Recherche fehlgeschlagen: ${
        err instanceof Error ? err.message : 'unbekannt'
      }`,
    );
    return { slots: [], tariffs, sourceNotes, failures };
  }
}
