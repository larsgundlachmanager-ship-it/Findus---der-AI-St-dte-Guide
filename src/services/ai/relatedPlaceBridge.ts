/**
 * Verwandte Orte aus Fakten → natürliche Story-Brücke
 * (z. B. Kindergarten ↔ Zur Schwalbe).
 */

import type { Poi, PoiWithFacts } from '../../db/types';

export type RelatedPlaceBridge = {
  relatedName: string;
  relatedPoiId: number;
  /** Kurz warum verbunden (für den Prompt). */
  linkHint: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s*[·•|]\s*wegweiser\s*$/i, '')
    .replace(/[^a-zäöüß0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayName(name: string): string {
  return name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
}

/** Signifikante Namens-Fragmente zum Matchen in Fakten. */
function nameKeys(name: string): string[] {
  const n = normalize(displayName(name));
  const keys = new Set<string>();
  if (n.length >= 5) keys.add(n);

  // „Kita-Geschichte Zur Schwalbe“ → schwalbe, zur schwalbe
  for (const part of n.split(/\s+/)) {
    if (part.length >= 5 && !/^(heute|früher|geschichte|kita|alte|neuer)$/.test(part)) {
      keys.add(part);
    }
  }
  // Mehrwort-Kerne
  const m = n.match(
    /\b(zur schwalbe|schwalbe|schnickenfeld|hudenbarg|peiner|bilsbek|ehrenmal|bahnhof)\b/,
  );
  if (m) keys.add(m[1]);

  return [...keys];
}

/**
 * Findet bis zu einem verwandten Ort, der in den Fakten des aktuellen POIs
 * namentlich vorkommt und als eigener POI existiert.
 */
export function findRelatedPlaceBridge(
  poi: PoiWithFacts,
  allPois: Poi[],
): RelatedPlaceBridge | null {
  const factBlob = normalize(
    [
      poi.name,
      poi.teaser_text ?? '',
      ...poi.facts.map((f) => f.fact_text ?? ''),
    ].join(' '),
  );

  const selfNorm = normalize(displayName(poi.name));
  const selfKeys = new Set(nameKeys(poi.name));

  type Cand = { poi: Poi; score: number; key: string };
  const cands: Cand[] = [];

  for (const other of allPois) {
    if (other.id === poi.id) continue;
    if (other.kind === 'approach') continue;

    const otherName = displayName(other.name);
    const otherNorm = normalize(otherName);
    if (otherNorm.length < 5) continue;
    // Nicht sich selbst / fast-gleich
    if (otherNorm === selfNorm || otherNorm.includes(selfNorm) || selfNorm.includes(otherNorm)) {
      continue;
    }

    for (const key of nameKeys(other.name)) {
      if (selfKeys.has(key)) continue;
      if (key.length < 5) continue;
      if (!factBlob.includes(key)) continue;

      let score = key.length;
      // Stärker, wenn der volle Name (ohne Füllwörter) vorkommt
      if (factBlob.includes(otherNorm)) score += 20;
      if (/schwalbe|schule|kindergarten|kirche|bahnhof|ehrenmal/.test(key)) {
        score += 8;
      }
      // Sub-POIs / Kinder des aktuellen Orts bevorzugen (keine Fern-Umwege)
      if (other.parent_poi_id === poi.id || other.kind === 'sub') {
        score += 40;
      } else if (
        poi.parent_poi_id != null &&
        other.parent_poi_id === poi.parent_poi_id
      ) {
        score += 25;
      } else {
        score -= 30;
      }
      cands.push({ poi: other, score, key });
      break;
    }
  }

  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  if (best.score < 10) return null;
  const relatedName = displayName(best.poi.name);

  return {
    relatedName,
    relatedPoiId: best.poi.id,
    linkHint: `Die Fakten verbinden diesen Ort mit „${relatedName}“ (Treffer: „${best.key}“).`,
  };
}

/** Prompt-Zeilen: Wahl-Outro statt Standard-Floskel. */
export function formatRelatedBridgeForPrompt(
  bridge: RelatedPlaceBridge | null,
): string {
  if (!bridge) {
    return `- Kein verwandter Ort erkannt → Outro optional und VARIIEREN, oder weglassen. Nie automatisch „ganz entspannt weiter“.`;
  }
  return [
    `- VERWANDTER ORT (nur Sub/Teil dieses Platzes): „${bridge.relatedName}“. ${bridge.linkHint}`,
    `- Am Ende höchstens EIN kurzer Hinweis auf diesen Sub-Spot — keine Umweg-Touren, kein „Soll ich…?“-Spam.`,
    `- Formuliere natürlich. Wenn der Nutzer frei laufen will: eher weglassen.`,
  ].join('\n');
}
