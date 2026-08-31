/**
 * Günstige Flüge: Google-Suche (Grounding) mit Google Flights + Skyscanner als Ziel.
 * Danach Buchungs-Buttons (Kiwi vorgefüllt, optional Airline) — kein Google-Flights-Klick.
 */

import type { QuickAction } from '../../types/concierge';
import {
  generateGeminiText,
  hasGeminiApiKey,
  takeLastGeminiGroundingUrls,
} from '../geminiService';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../concierge/findusResponsePolicy';
import {
  buildGoogleFlightsSearchUrl,
  buildSkyscannerSearchUrl,
} from './googleTravelLinks';
import { preferredIataIdent } from './flightIdent';
import {
  buildCheapFlightBookActions,
  isAirlineBookUrl,
  parseResearchDateKey,
} from './cheapFlightBook';

export type CheapFlightResearch = {
  speech: string;
  bullets: string[];
  dateKey: string | null;
  priceEur: number | null;
  airline: string | null;
  ident: string | null;
  clockHm: string | null;
  airlineUrl: string | null;
  evidenced: boolean;
  actions: QuickAction[];
};

export { buildCheapFlightBookActions, parseResearchDateKey } from './cheapFlightBook';

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parsePriceEur(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw < 50_000) {
    return Math.round(raw);
  }
  if (typeof raw === 'string') {
    const n = parseFloat(raw.replace(',', '.').replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 50_000) return Math.round(n);
  }
  return null;
}

function parseIdent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.toUpperCase().replace(/\s+/g, '').match(/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/);
  return m ? preferredIataIdent(m[0]!) : null;
}

function parseClockHm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function pickAirlineUrl(
  fromJson: unknown,
  grounding: string[],
): string | null {
  const direct = typeof fromJson === 'string' ? fromJson.trim() : '';
  if (direct && isAirlineBookUrl(direct)) return direct;
  return grounding.find((u) => isAirlineBookUrl(u)) ?? null;
}

export async function researchCheapFlights(opts: {
  originIata: string;
  destIata: string;
  destCity?: string | null;
  dateKey?: string | null;
  monthHint?: string | null;
  userText?: string | null;
}): Promise<CheapFlightResearch | null> {
  if (!hasGeminiApiKey()) return null;
  const from = opts.originIata.trim().toUpperCase();
  const to = opts.destIata.trim().toUpperCase();
  const dest = (opts.destCity || to).trim();
  const when =
    opts.dateKey ||
    (opts.monthHint ? `im ${opts.monthHint}` : 'flexibler Zeitraum, günstigster Tag');
  const gUrl = buildGoogleFlightsSearchUrl({
    originIata: from,
    destIata: to,
    dateKey: opts.dateKey,
  });
  const sUrl = buildSkyscannerSearchUrl({
    originIata: from,
    destIata: to,
    dateKey: opts.dateKey,
  });

  const prompt = [
    FINDUS_FEW_SHOT_DISCLAIMER,
    `Recherche günstige Linienflüge ${from} → ${to} (${dest}), ${when}.`,
    'Ablauf (Struktur, Wortlaut frei): Google-Suche mit Ziel Google Flights und Skyscanner → günstigster belegter Tag/Preis/Airline → denselben Tag bei der Airline nur wenn eine Quelle das hergibt.',
    'Du klickst keine JavaScript-Kalender. Du nutzt Google-Suche/Grounding. Nichts erfinden. evidenced=true nur bei belegtem Preis oder Tag aus der Suche.',
    gUrl ? `Google-Flights-Suche: ${gUrl}` : '',
    sUrl ? `Skyscanner-Suche: ${sUrl}` : '',
    'JSON: {"speech":"Antwort zuerst: belegter Best-Preis für die Reisenden, ggf. vs. billigste und kürzeste Verbindung (Dauer+Preis nur belegt). Buchen über die Buttons, kein Google-Flights-Klick. Nie nur ein Ab-Teaser.","bullets":["max 3"],"cheapestDay":"YYYY-MM-DD"|null,"priceEur":null,"airline":null,"ident":null,"clockHm":null,"airlineUrl":null,"evidenced":false}',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await generateGeminiText(prompt, {
    task: 'generic',
    enableGoogleSearch: true,
    maxTokens: 800,
    temperature: 0.2,
    useFindusSystem: false,
  });
  const grounding = takeLastGeminiGroundingUrls();
  const parsed = extractJsonObject(raw);
  const speech =
    typeof parsed?.speech === 'string' ? parsed.speech.trim() : raw.trim();
  if (!speech || speech.length < 12) return null;

  const dateKey =
    parseResearchDateKey(parsed?.cheapestDay) || opts.dateKey || null;
  const priceEur = parsePriceEur(parsed?.priceEur);
  const airline =
    typeof parsed?.airline === 'string' && parsed.airline.trim().length >= 2
      ? parsed.airline.trim().slice(0, 40)
      : null;
  const ident = parseIdent(parsed?.ident);
  const clockHm = parseClockHm(parsed?.clockHm);
  const evidenced = Boolean(dateKey || priceEur || ident);
  const airlineUrl = pickAirlineUrl(parsed?.airlineUrl, grounding);
  const bullets = Array.isArray(parsed?.bullets)
    ? (parsed.bullets as unknown[])
        .map((b) => String(b).trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const actions = dateKey
    ? buildCheapFlightBookActions({
        originIata: from,
        destIata: to,
        dateKey,
        ident,
        clockHm,
        airlineUrl,
        airlineName: airline,
        userText: opts.userText,
      })
    : [];

  return {
    speech: speech.slice(0, 900),
    bullets,
    dateKey,
    priceEur,
    airline,
    ident,
    clockHm,
    airlineUrl,
    evidenced,
    actions,
  };
}
