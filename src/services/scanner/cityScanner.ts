/**
 * Dynamischer City-Dataset-Scanner.
 *
 * Läuft nach Download/Install einer Stadt-Tour-DB:
 * 1) Text-Extraktion aus POI-Namen, Beschreibungen, Geschichten
 * 2) Anomalie- & Heuristik-Erkennung (ph/th, engl. Stämme, kurze Caps-Nomen)
 * 3) Mapping gegen Base-Wörterbuch + Auto-Fix → user_pronunciations.json
 */
import type { CityPack } from '../cityPack';
import {
  collectCityPackTexts,
} from '../tts/cityPronunciationParser';
import {
  applyHeuristicPhonetics,
  initDictionaryEngine,
  lookupPronunciation,
  persistMasterDictionary,
  upsertUserPronunciations,
  type PronunciationDict,
} from '../tts/dictionaryEngine';
import { suggestDictionaryEntries } from '../sync/dictionarySyncService';


/** Alias laut Spezifikation. */
export type CityPackage = CityPack;

export type ScanAnomaly = {
  word: string;
  reason: 'foreign_cluster' | 'short_caps' | 'english_stem' | 'unknown';
  pronunciation: string;
  fromDictionary: boolean;
};

const DE_STOP = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines',
  'und', 'oder', 'aber', 'mit', 'von', 'vom', 'zum', 'zur', 'im', 'am', 'um',
  'an', 'auf', 'aus', 'bei', 'nach', 'vor', 'über', 'unter', 'für', 'als',
  'auch', 'noch', 'nur', 'schon', 'sehr', 'hier', 'dort', 'ist', 'sind',
  'war', 'wird', 'werden', 'hat', 'haben', 'kann', 'man', 'sich', 'nicht',
  'mehr', 'wie', 'was', 'wer', 'wo', 'wenn', 'weil', 'dass', 'daß', 'zu',
  'ja', 'nein', 'heute', 'jahr', 'jahre', 'stadt', 'platz', 'kirche',
  'haus', 'straße', 'strasse', 'weg', 'brücke', 'brucke', 'markt',
]);

/** Englische Wortstämme / Digraphen, die eSpeak oft falsch liest. */
const FOREIGN_CLUSTER_RE =
  /(?:ph|th|ough|ight|tion|sion|ture|que|ough|ee|oo|ay|sh|wh|ck|ght)/i;

const ENGLISH_STEM_RE =
  /(?:ing|ment|tion|ness|able|ible|ous|ive|ward|town|walk|front|side|gate|port|view|spot|guide|tour|check)\b/i;

const TOKEN_RE = /[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß''-]{1,}/gu;

function normalizeToken(raw: string): string {
  return raw.normalize('NFKC').replace(/['']/g, '').trim();
}

function isShortCapsNoun(raw: string): boolean {
  if (raw.length < 3 || raw.length > 4) return false;
  return raw === raw.toUpperCase() && /^[A-ZÄÖÜ]+$/.test(raw);
}

function classifyAnomaly(raw: string): ScanAnomaly['reason'] | null {
  if (isShortCapsNoun(raw)) return 'short_caps';
  if (FOREIGN_CLUSTER_RE.test(raw)) return 'foreign_cluster';
  if (ENGLISH_STEM_RE.test(raw)) return 'english_stem';
  // Gemischte Großschreibung / Eigennamen mit untypischen Buchstaben
  if (/[A-ZÄÖÜ].*[A-ZÄÖÜ]/.test(raw) && raw.length >= 5) return 'unknown';
  if (/[qywx]/i.test(raw) && !/^(max|mix|wax|box|taxi)/i.test(raw)) {
    return 'foreign_cluster';
  }
  return null;
}

/**
 * Extrahiert anomale Tokens aus Rohtexten und löst Aussprache auf.
 */
export function detectPronunciationAnomalies(
  texts: string[],
): ScanAnomaly[] {
  const corpus = texts.join('\n');
  const found = new Map<string, ScanAnomaly>();

  for (const raw of corpus.match(TOKEN_RE) ?? []) {
    const token = normalizeToken(raw);
    if (token.length < 3) continue;
    const lower = token.toLowerCase();
    if (DE_STOP.has(lower) || found.has(lower)) continue;

    const reason = classifyAnomaly(token);
    if (!reason) continue;

    const known = lookupPronunciation(token);
    if (known) {
      found.set(lower, {
        word: lower,
        reason,
        pronunciation: known.pronunciation,
        fromDictionary: true,
      });
      continue;
    }

    const heuristic = applyHeuristicPhonetics(token);
    if (!heuristic) continue;
    found.set(lower, {
      word: lower,
      reason,
      pronunciation: heuristic,
      fromDictionary: false,
    });
  }

  return [...found.values()];
}

export type CityScanResult = {
  cityId: string;
  textSources: number;
  anomalies: number;
  newMappings: number;
  suggested: number;
};

/**
 * Scannt ein heruntergeladenes Stadt-Paket und schreibt fehlende
 * Aussprache-Mappings ins lokale User-Overlay.
 */
export async function scanCityDataset(
  cityPackage: CityPackage,
): Promise<CityScanResult> {
  await initDictionaryEngine();

  const cityId = (cityPackage.city_id ?? '').trim().toLowerCase() || 'unknown';
  const texts = collectCityPackTexts(cityPackage);
  const anomalies = detectPronunciationAnomalies(texts);

  const toPersist: PronunciationDict = {};
  for (const a of anomalies) {
    // Nur fehlende / heuristische Einträge ins User-Overlay
    if (!a.fromDictionary) {
      toPersist[a.word] = a.pronunciation;
    }
  }

  let newMappings = 0;
  if (Object.keys(toPersist).length > 0) {
    const result = await upsertUserPronunciations(toPersist);
    newMappings = result.added;
    // Master ist bereits in upsert persistiert — explizit nochmals absichern
    await persistMasterDictionary();
  }

  let suggested = 0;
  if (Object.keys(toPersist).length > 0) {
    try {
      // Nur Delta der neu entdeckten Scan-Wörter an die Cloud
      const upload = await suggestDictionaryEntries(toPersist);
      suggested = upload.accepted;
    } catch (err) {
      console.warn('[cityScanner] Suggest-Upload fehlgeschlagen (lokal gespeichert):', err);
    }
  }

  console.log(
    `[cityScanner] ${cityId}: ${anomalies.length} Anomalien, ${newMappings} neue Mappings → Master (${texts.length} Textquellen)`,
  );

  return {
    cityId,
    textSources: texts.length,
    anomalies: anomalies.length,
    newMappings,
    suggested,
  };
}

/**
 * Convenience: nach City-Pack-Install aufrufen (fire-and-forget ok).
 */
export async function scanCityDatasetSafe(
  cityPackage: CityPackage,
): Promise<CityScanResult | null> {
  try {
    return await scanCityDataset(cityPackage);
  } catch (err) {
    console.warn('[cityScanner] Scan fehlgeschlagen:', err);
    return null;
  }
}
