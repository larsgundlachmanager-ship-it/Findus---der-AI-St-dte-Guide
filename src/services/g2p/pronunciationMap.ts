/**
 * 3-Tier Phonemisierung:
 * 1) Stadt-SQLite Map
 * 2) pronunciations.json Map
 * 3) natives espeak-ng (de) für Rest
 */
import { filterPhonemesToVocab } from '../../constants/kokoroVocab';
import { mapEspeakIpaToKokoro } from './nativeEspeakG2p';
import { isOrthoPronunciation } from './phoneticTransformer';
import {
  getGlobalPhraseKeys,
  getPronunciationCache,
  getPronunciationRecord,
  loadPronunciationDictionary,
  lookupPronunciationTier,
  PRONUNCIATION_DICTIONARY,
  PRONUNCIATION_MAP,
} from '../tts/pronunciationMap';

export type PronunciationSegment =
  | { kind: 'text'; value: string }
  | { kind: 'ipa'; value: string; tier?: 1 | 2 };

export {
  PRONUNCIATION_MAP,
  PRONUNCIATION_DICTIONARY,
  loadPronunciationDictionary,
  getPronunciationCache,
  lookupPronunciationTier,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseKeysFromCity(cityMap: Map<string, string>): string[] {
  return [...cityMap.keys()]
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);
}

/**
 * Performante Segmentierung:
 * - Multiword-Phrasen (Stadt zuerst, dann Global), längste zuerst
 * - Einzelwörter via Map.get (O(1)) — Stadt → JSON
 * - Rest bleibt Text → espeak (Stufe 3)
 */
export function applyPronunciationMap(
  text: string,
  overlay?: Record<string, string> | Map<string, string>,
): PronunciationSegment[] {
  const cityMap: Map<string, string> =
    overlay instanceof Map
      ? overlay
      : overlay
        ? new Map(
            Object.entries(overlay).map(([k, v]) => [k.toLowerCase(), v]),
          )
        : new Map();

  // Wenn overlay eine fusionierte Record war (Legacy), Stadt-only Map bevorzugen:
  // Caller soll city Map übergeben. Overlay-Record behandeln wir als Stufe-1-Kandidaten
  // plus Global bleibt Stufe 2 über getPronunciationCache().

  let working = text.normalize('NFKC');

  const preserved: string[] = [];
  working = working.replace(/⟦([^⟧]+)⟧/g, (_, ipa: string) => {
    const idx = preserved.length;
    preserved.push(String(ipa).trim());
    return `\uE000${idx}\uE001`;
  });

  // Phrasen: nur Kandidaten die im Text vorkommen (substring-Gate)
  const cityPhrases = phraseKeysFromCity(cityMap);
  const globalPhrases = getGlobalPhraseKeys().filter((p) => !cityMap.has(p));
  const lowerWorking = working.toLowerCase();
  for (const phrase of cityPhrases) {
    if (!lowerWorking.includes(phrase)) continue;
    const ipa = cityMap.get(phrase);
    if (!ipa) continue;
    const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
    if (isOrthoPronunciation(ipa)) {
      working = working.replace(re, ipa);
    } else {
      working = working.replace(re, `⟦${ipa}⟧`);
    }
  }
  for (const phrase of globalPhrases) {
    if (!lowerWorking.includes(phrase)) continue;
    const ipa = getPronunciationCache().get(phrase);
    if (!ipa) continue;
    const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
    if (isOrthoPronunciation(ipa)) {
      working = working.replace(re, ipa);
    } else {
      working = working.replace(re, `⟦${ipa}⟧`);
    }
  }

  // Einzelwörter: Token ersetzen wenn Tier 1/2 trifft
  working = working.replace(
    /[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß''-]*/g,
    (word) => {
      const hit = lookupPronunciationTier(word, cityMap);
      if (!hit) return word;
      // Ortho (Feerwäy/Hoff) bleibt Text → eSpeak; echtes IPA → Marker
      if (isOrthoPronunciation(hit.ipa)) {
        if (word[0] === word[0].toUpperCase()) {
          return hit.ipa.charAt(0).toUpperCase() + hit.ipa.slice(1);
        }
        return hit.ipa.charAt(0).toLowerCase() + hit.ipa.slice(1);
      }
      return `⟦${hit.ipa}⟧`;
    },
  );

  working = working.replace(/\uE000(\d+)\uE001/g, (_, n: string) => {
    return `⟦${preserved[Number(n)] ?? ''}⟧`;
  });

  const segments: PronunciationSegment[] = [];
  const tokenRe = /⟦([^⟧]+)⟧/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(working)) !== null) {
    if (m.index > last) {
      const slice = working.slice(last, m.index);
      if (slice) segments.push({ kind: 'text', value: slice });
    }
    segments.push({ kind: 'ipa', value: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < working.length) {
    const slice = working.slice(last);
    if (slice) segments.push({ kind: 'text', value: slice });
  }
  if (segments.length === 0) {
    segments.push({ kind: 'text', value: text });
  }
  return segments;
}

/**
 * 3-Tier: Map-IPA → espeak(de) für Rest → Join.
 * `cityMap` = Stufe 1; Global-JSON = Stufe 2 (intern); phonemizeDe = Stufe 3.
 */
export async function phonemizeWithPronunciationMap(
  text: string,
  phonemizeDe: (s: string) => Promise<string>,
  cityMap?: Record<string, string> | Map<string, string>,
): Promise<string> {
  await loadPronunciationDictionary();
  const segments = applyPronunciationMap(text, cityMap);
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === 'ipa') {
      parts.push(mapEspeakIpaToKokoro(seg.value));
    } else {
      const t = seg.value.trim();
      if (!t) {
        if (/\s/.test(seg.value)) parts.push(' ');
        continue;
      }
      // Stufe 3: natives deutsches G2P
      const ipa = await phonemizeDe(t);
      if (ipa) parts.push(ipa);
    }
  }
  return filterPhonemesToVocab(parts.join(' ').replace(/\s+/g, ' ').trim());
}

/** Debug-Hilfe: Record-Snapshot der JSON-Stufe. */
export function getGlobalPronunciationRecord(): Record<string, string> {
  return getPronunciationRecord();
}
