/**
 * Nav-Ziel Fuzzy / STT — nur Geocode-Kandidaten erweitern, nie den User-Satz fürs LLM umschreiben.
 * Multi-Signal: Brand-Fragment + Stadt/Kontext. Einzelnes „Fabrik“ allein → kein Rewrite.
 */

import { fuzzyResolveCityName } from './fuzzyCityResolve';

const FITNESSFABRIK_CITIES = [
  'Rellingen',
  'Tornesch',
  'Uetersen',
  'Wedel',
] as const;

function addUnique(out: string[], s: string): void {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (t.length < 2) return;
  if (out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  out.push(t);
}

/** STT-Nähe zu Rellingen — nur mit Fitness-/Adress-Kontext nutzen. */
const RELLINGEN_STT =
  /\b(rellingen|rellinger|breklinger|brekling)\b/iu;

function spokenCityFromBlob(blob: string): string | null {
  const t = (blob || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (RELLINGEN_STT.test(t)) {
    return fuzzyResolveCityName('Rellingen') || 'Rellingen';
  }
  for (const city of FITNESSFABRIK_CITIES) {
    if (new RegExp(`\\b${city}\\b`, 'iu').test(t)) {
      return fuzzyResolveCityName(city) || city;
    }
  }
  try {
    const { extractCityFromText } = require('../../module2/context/shortTermContext') as {
      extractCityFromText: (s: string) => string | null;
    };
    const hit = extractCityFromText(t);
    if (hit) return fuzzyResolveCityName(hit) || hit;
  } catch {
    /* soft */
  }
  return null;
}

/** Fitnessfabrik nur wenn Brand- und/oder Stadt-Kontext mitzieht — kein Blind-Replace. */
export function looksLikeFitnessFabrikUtterance(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\bfitness\s*fabrik\b/iu.test(t)) return true;
  const hasFabrik = /\bfabrik\b/iu.test(t);
  const hasFit =
    /\b(fitt?ing|fitnes+|fit-?ness|fitness)\b/iu.test(t) ||
    /\bfit\s+ness\b/iu.test(t);
  const hasCity =
    RELLINGEN_STT.test(t) ||
    FITNESSFABRIK_CITIES.some((c) => new RegExp(`\\b${c}\\b`, 'iu').test(t));
  const hasHaupt39 = /\bhauptstra(?:ss|ß)e\s*39\b/iu.test(t);
  // „fitting der Fabrik in …“ / „Fabrik … Rellingen“ / „Fitness … Hauptstraße 39“
  if (hasFabrik && (hasFit || hasCity)) return true;
  if (hasFit && (hasCity || hasHaupt39)) return true;
  return false;
}

/**
 * Geocode-Query-Liste: Original zuerst, dann kontextfeste Alternativen.
 * Live-OSM/Google — Pack-Miss ist egal.
 */
export function expandNavGeocodeQueries(
  raw: string,
  opts?: { userText?: string | null },
): string[] {
  const q = (raw || '').replace(/\s+/g, ' ').trim();
  const blob = `${opts?.userText || ''} ${q}`.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  if (!blob) {
    addUnique(out, q);
    return out;
  }

  if (looksLikeFitnessFabrikUtterance(blob)) {
    const city = spokenCityFromBlob(blob);
    // Treffer-Kandidaten ZUERST (Latenz) — Original danach als Fallback
    if (city) {
      addUnique(out, `Fitnessfabrik ${city}`);
      addUnique(out, `fitnessfabrik LIFESTYLE ${city}`);
      if (/rellingen/iu.test(city)) {
        addUnique(out, `Fitnessfabrik, Hauptstraße 39, Rellingen`);
        addUnique(out, `Hauptstraße 39, Rellingen`);
      }
    } else if (/\bhauptstra(?:ss|ß)e\s*39\b/iu.test(blob)) {
      addUnique(out, `Fitnessfabrik, Hauptstraße 39, Rellingen`);
      addUnique(out, `Hauptstraße 39, Rellingen`);
      addUnique(out, `Fitnessfabrik Rellingen`);
    } else {
      for (const c of FITNESSFABRIK_CITIES) {
        addUnique(out, `Fitnessfabrik ${c}`);
      }
    }
  }

  addUnique(out, q);
  return out;
}

/**
 * Anzeige-/Start-Label nur bei klarer Multi-Signal-Reparatur.
 * Sonst Original — Call-1/LLM-Text bleibt unangetastet.
 */
export function repairNavDestLabel(
  raw: string,
  opts?: { userText?: string | null },
): string {
  const q = (raw || '').replace(/\s+/g, ' ').trim();
  const blob = `${opts?.userText || ''} ${q}`.replace(/\s+/g, ' ').trim();
  if (!looksLikeFitnessFabrikUtterance(blob)) return q;
  const city = spokenCityFromBlob(blob);
  if (city) return `Fitnessfabrik ${city}`;
  // Ohne Stadt: behalte Original (Geocode-Expand sucht trotzdem)
  if (/\bfitness\s*fabrik\b/iu.test(q)) return q;
  return q;
}
