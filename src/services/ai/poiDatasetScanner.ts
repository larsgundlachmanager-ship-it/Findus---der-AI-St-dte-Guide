/**
 * Dynamischer POI-Dataset-Scanner (Säule 2).
 *
 * Läuft bei jedem Download/Laden eines Stadt-Datensatzes:
 * 1) Text-Extraktion (Namen, Beschreibungen, Adressen, Fakten)
 * 2) Erkennung nicht-deutscher Begriffe + Regel-Engine → deutsche Lautschrift
 * 3) Persistenz in SQLite user_custom_phonetics
 * 4) Merge in RAM-Map der multilingualPhoneticEngine
 */
import type { CityPack } from '../cityPack';
import { collectCityPackTexts } from '../tts/cityPronunciationParser';
import { getDatabase } from '../../db/database';
import { upsertUserCustomPhonetics } from '../../db/userCustomPhonetics';
import {
  initMultilingualPhoneticEngine,
  lookupMultilingualPhonetic,
  mergeRuntimePhonetics,
  normalizePhoneticKey,
  reloadUserCustomPhonetics,
  type PhoneticDict,
} from './multilingualPhoneticEngine';

export type CityPackage = CityPack;

export type PoiScanResult = {
  cityId: string;
  textSources: number;
  tokensScanned: number;
  foreignDetected: number;
  newLearned: number;
  updated: number;
};

const TOKEN_RE = /[\p{L}][\p{L}'\u2019-]{1,}/gu;

const DE_STOP = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines',
  'und', 'oder', 'aber', 'mit', 'von', 'vom', 'zum', 'zur', 'im', 'am', 'um',
  'an', 'auf', 'aus', 'bei', 'nach', 'vor', 'über', 'unter', 'für', 'als',
  'auch', 'noch', 'nur', 'schon', 'sehr', 'hier', 'dort', 'ist', 'sind',
  'war', 'wird', 'werden', 'hat', 'haben', 'kann', 'man', 'sich', 'nicht',
  'mehr', 'wie', 'was', 'wer', 'wo', 'wenn', 'weil', 'dass', 'zu', 'ja',
  'nein', 'heute', 'jahr', 'jahre', 'stadt', 'platz', 'kirche', 'haus',
  'straße', 'strasse', 'weg', 'brücke', 'brucke', 'markt', 'tour', 'guide',
  'museum', 'park', 'tor', 'wall', 'see', 'berg', 'tal', 'hof', 'bad',
]);

/** Französische Endungen / Cluster. */
const FR_RE = /(?:eau|eur|esque|ette|elle|oise|quai|château|chateau|notre|saint|sainte|musée|musee|église|eglise)/i;

/** Spanisch / Italienisch. */
const RO_RE = /(?:ción|sión|dad|plaza|calle|iglesia|piazza|via\b|duomo|castello|basilica|colosseo|palacio|real\b|sagrada|guadal|san\b|santa\b|santo\b|pueblo)/i;

/** Englisch / Gen-Z. */
const EN_RE = /(?:tion|sion|ture|ight|ough|ph|wh|ck\b|guide|street|bridge|castle|center|centre|terminal|blockbuster|vibe|safe|check|highlight|streaming|podcast|influencer|selfie|hashtag|chill|slay|cringe|ghosting|flex|drip|fomo|yolo|lit\b|bro\b|cool\b|hype\b)/i;

/** Antike / Latein. */
const LATIN_RE = /(?:amphitheat|aqu[aäe]duct|forum|colosseum|akropolis|parthenon|obelisk|mausoleum|triumph|agora|therm)/i;

function normalizeToken(raw: string): string {
  return raw.normalize('NFKC').replace(/[\u2019']/g, '').trim();
}

function isLikelyGermanWord(token: string): boolean {
  const lower = token.toLowerCase();
  if (DE_STOP.has(lower)) return true;
  // Typisch deutsch: Umlaute, ß, deutsche Endungen
  if (/[äöüß]/i.test(token)) return true;
  if (/(?:ung|heit|keit|schaft|chen|lein|isch|lich|bar|los|sam|haft)\b/i.test(token)) {
    return true;
  }
  // Reine ASCII-Kleinwörter ohne Fremd-Cluster
  if (
    token.length <= 4 &&
    token === token.toLowerCase() &&
    !FR_RE.test(token) &&
    !RO_RE.test(token) &&
    !EN_RE.test(token)
  ) {
    return true;
  }
  return false;
}

function classifyForeign(token: string): boolean {
  if (token.length < 3) return false;
  if (isLikelyGermanWord(token)) return false;
  if (FR_RE.test(token)) return true;
  if (RO_RE.test(token)) return true;
  if (EN_RE.test(token)) return true;
  if (LATIN_RE.test(token)) return true;
  // Akzente / diakritische Zeichen
  if (/[àâäéèêëîïôùûüœæçñ]/i.test(token)) return true;
  // Gemischte Großschreibung (Eigennamen)
  if (/[A-ZÄÖÜ][a-zäöüß]+[A-ZÄÖÜ]/.test(token)) return true;
  // Untypische Buchstaben für Deutsch
  if (/[qyxw]/i.test(token) && !/^(max|mix|box|taxi|text|next)/i.test(token)) {
    return true;
  }
  return false;
}

/** Regel-Engine: Fremdwort → deutsche Lautschrift für Piper. */
export function applyPhoneticRules(word: string): string | null {
  const w = word.normalize('NFKC').trim();
  if (w.length < 3) return null;

  const known = lookupMultilingualPhonetic(w);
  if (known) return known;

  let s = w;

  // Französisch
  if (FR_RE.test(w) || /[àâäéèêëîïôùûüœæç]/i.test(w)) {
    s = s.replace(/château|chateau/gi, 'Schatoo');
    s = s.replace(/eau/gi, 'oh');
    s = s.replace(/eaux/gi, 'oh');
    s = s.replace(/eur\b/gi, 'ör');
    s = s.replace(/esque\b/gi, 'esk');
    s = s.replace(/ette\b/gi, 'ett');
    s = s.replace(/[éèêë]/gi, 'eh');
    s = s.replace(/[àâä]/gi, 'ah');
    s = s.replace(/[ùûü]/gi, 'uh');
    s = s.replace(/[ôö]/gi, 'oh');
    s = s.replace(/ou/gi, 'u');
    s = s.replace(/oi/gi, 'wa');
    s = s.replace(/eu/gi, 'ö');
    s = s.replace(/gn/gi, 'nj');
    s = s.replace(/ch/gi, 'sch');
    s = s.replace(/qu/gi, 'k');
    s = s.replace(/^rue$/i, 'Rüh');
    s = s.replace(/^boulevard$/i, 'Bullewar');
  }

  // Spanisch
  if (RO_RE.test(w) || /ñ|ción|sión/i.test(w)) {
    s = s.replace(/ción\b/gi, 'schon');
    s = s.replace(/sión\b/gi, 'schon');
    s = s.replace(/ll/gi, 'j');
    s = s.replace(/ñ/gi, 'nj');
    s = s.replace(/^calle$/i, 'Kagje');
    s = s.replace(/^plaza$/i, 'Plassa');
    s = s.replace(/^casa$/i, 'Kasa');
    s = s.replace(/^real$/i, 'Re-ahl');
    s = s.replace(/^palacio$/i, 'Palassio');
  }

  // Italienisch
  if (/piazza|via\b|duomo|castello|basilica|colosseo|palazzo|galleria/i.test(w)) {
    s = s.replace(/^piazza$/i, 'Piatsa');
    s = s.replace(/^via$/i, 'Wia');
    s = s.replace(/^duomo$/i, 'Du-omo');
    s = s.replace(/^castello$/i, 'Kastello');
    s = s.replace(/^colosseo$/i, 'Kolosseo');
    s = s.replace(/zione\b/gi, 'tsione');
    s = s.replace(/gn/gi, 'nj');
    s = s.replace(/glio/gi, 'ljo');
  }

  // Englisch / Gen-Z
  if (EN_RE.test(w)) {
    s = s.replace(/tion\b/gi, 'schon');
    s = s.replace(/sion\b/gi, 'schon');
    s = s.replace(/ture\b/gi, 'tschä');
    s = s.replace(/ight\b/gi, 'ait');
    s = s.replace(/ph/gi, 'f');
    s = s.replace(/th/gi, 'd');
    s = s.replace(/ough/gi, 'o');
    s = s.replace(/ee/gi, 'ii');
    s = s.replace(/oo/gi, 'u');
    s = s.replace(/sh/gi, 'sch');
    s = s.replace(/^vibe$/i, 'Waib');
    s = s.replace(/^vibes$/i, 'Waibs');
    s = s.replace(/^safe$/i, 'Seif');
    s = s.replace(/^bro$/i, 'Broo');
    s = s.replace(/^guide$/i, 'Geid');
    s = s.replace(/^highlight$/i, 'Ailaght');
    s = s.replace(/^blockbuster$/i, 'Bloggbassder');
    s = s.replace(/^budget$/i, 'Büdschett');
    s = s.replace(/^budgets$/i, 'Büdschetts');
    s = s.replace(/^audioguide$/i, 'Oodiogaid');
    s = s.replace(/^checken$/i, 'Tscheggen');
  }

  // Antike / Latein
  if (LATIN_RE.test(w)) {
    s = s.replace(/amphitheater|amphitheatre/gi, 'Amfitheater');
    s = s.replace(/aquädukt|aquaeduct|aqueduct/gi, 'Akwädukt');
    s = s.replace(/colosseum|colosseo/gi, 'Kolosseo');
    s = s.replace(/akropolis|acropolis/gi, 'Akropolis');
  }

  // Generische Fallback-Regeln
  s = s.replace(/ph/gi, (m) => (m[0] === 'P' ? 'F' : 'f'));
  s = s.replace(/th/gi, (m) => (m[0] === 'T' ? 'D' : 'd'));

  if (normalizePhoneticKey(s) === normalizePhoneticKey(w)) return null;
  return matchWordCase(w, s);
}

function matchWordCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement.charAt(0).toLowerCase() + replacement.slice(1);
}

/**
 * Extrahiert fremdsprachige Tokens aus Rohtexten.
 */
export function extractForeignTokens(texts: string[]): Map<string, string> {
  const found = new Map<string, string>();
  const corpus = texts.join('\n');

  for (const raw of corpus.match(TOKEN_RE) ?? []) {
    const token = normalizeToken(raw);
    if (token.length < 3) continue;
    const lower = token.toLowerCase();
    if (found.has(lower)) continue;
    if (!classifyForeign(token)) continue;

    const known = lookupMultilingualPhonetic(token);
    if (known) {
      found.set(lower, known);
      continue;
    }

    const ruled = applyPhoneticRules(token);
    if (ruled) found.set(lower, ruled);
  }

  return found;
}

/**
 * Scannt ein Stadt-POI-Paket, lernt neue Phonetik-Einträge und persistiert sie.
 */
export async function scanPoiDataset(
  cityPackage: CityPackage,
): Promise<PoiScanResult> {
  await initMultilingualPhoneticEngine();

  const cityId =
    (cityPackage.city_id ?? '').trim().toLowerCase() || 'unknown';
  const texts = collectCityPackTexts(cityPackage);
  const foreign = extractForeignTokens(texts);

  const toPersist: PhoneticDict = {};
  for (const [word, phonetic] of foreign) {
    const existing = lookupMultilingualPhonetic(word);
    if (existing === phonetic) continue;
    toPersist[word] = phonetic;
  }

  let newLearned = 0;
  let updated = 0;

  if (Object.keys(toPersist).length > 0) {
    mergeRuntimePhonetics(toPersist);

    const db = await getDatabase();
    const result = await upsertUserCustomPhonetics(
      db,
      Object.entries(toPersist).map(([word, phonetic]) => ({
        word,
        phonetic,
        sourceCityId: cityId,
      })),
    );
    newLearned = result.added;
    updated = result.updated;
    await reloadUserCustomPhonetics();
  }

  console.log(
    `[poiDatasetScanner] ${cityId}: ${foreign.size} Fremdwörter, ${newLearned} neu, ${updated} aktualisiert (${texts.length} Textquellen)`,
  );

  return {
    cityId,
    textSources: texts.length,
    tokensScanned: (corpusTokenCount(texts)),
    foreignDetected: foreign.size,
    newLearned,
    updated,
  };
}

function corpusTokenCount(texts: string[]): number {
  const set = new Set<string>();
  for (const t of texts) {
    for (const raw of t.match(TOKEN_RE) ?? []) {
      set.add(normalizeToken(raw).toLowerCase());
    }
  }
  return set.size;
}

/** Fire-and-forget Wrapper für City-Pack-Hooks. */
export async function scanPoiDatasetSafe(
  cityPackage: CityPackage,
): Promise<PoiScanResult | null> {
  try {
    return await scanPoiDataset(cityPackage);
  } catch (err) {
    console.warn('[poiDatasetScanner] Scan fehlgeschlagen:', err);
    return null;
  }
}

/** Alias für Spezifikation. */
export const scanCityPoiPhonetics = scanPoiDataset;
export const scanCityPoiPhoneticsSafe = scanPoiDatasetSafe;
