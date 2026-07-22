/**
 * Dynamischer Stadt-Pre-Parser (Stufe 1 der 3-Tier-Pipeline):
 * Scannt CityPack-Texte → Fremdwörter/Eigennamen → SQLite city_pronunciations.
 * IPA bevorzugt aus CITY_FOREIGN_LEXICON, sonst pronunciations.json.
 */
import type { CityPack } from '../cityPack';
import { getDatabase } from '../../db/database';
import {
  ensureCityPronunciationsTable,
  replaceCityPronunciations,
} from '../../db/cityPronunciations';
import { invalidateCityPronunciationCache } from '../g2p/fusedPronunciation';
import { lookupGlobalPronunciation } from './pronunciationMap';

/** Alias laut Spezifikation. */
export type CityPackage = CityPack;

/**
 * Tourismus-/Fremdwort-Lexikon (IPA mit Vocab-ɡ).
 * Wird gegen Pack-Texte gematcht und in SQLite pro Stadt gespeichert.
 */
export const CITY_FOREIGN_LEXICON: Record<string, string> = {
  dungeon: 'ˈdʌndʒən',
  dungeons: 'ˈdʌndʒənz',
  amphitheater: 'ˈæmfɪθɪətə',
  amphitheatre: 'ˈæmfɪθɪətə',
  piazza: 'ˈpjætsə',
  boulevard: 'ˈbuːləvɑːd',
  boulevards: 'ˈbuːləvɑːdz',
  'rooftop bar': 'ˈruːftɒp bɑː',
  rooftop: 'ˈruːftɒp',
  courtyard: 'ˈkɔːtjɑːd',
  skyline: 'ˈskaɪlaɪn',
  waterfront: 'ˈwɔːtəfrʌnt',
  boardwalk: 'ˈbɔːdwɔːk',
  promenade: 'prɒməˈnɑːd',
  plaza: 'ˈplɑːzə',
  cafe: 'ˈkæfeɪ',
  café: 'kaˈfeː',
  bistro: 'ˈbiːstroʊ',
  lounge: 'laʊndʒ',
  club: 'klʌb',
  pub: 'pʌb',
  gallery: 'ˈɡæləri',
  castle: 'ˈkɑːsl',
  palace: 'ˈpælɪs',
  cathedral: 'kəˈθiːdrəl',
  basilica: 'bəˈzɪlɪkə',
  marina: 'məˈriːnə',
  harbour: 'ˈhɑːbə',
  harbor: 'ˈhɑːbə',
  pier: 'pɪə',
  quay: 'kiː',
  streetfood: 'ˈstriːtfuːd',
  'street food': 'ˈstriːt fuːd',
  foodcourt: 'ˈfuːdkɔːt',
  'food court': 'ˈfuːd kɔːt',
  hotspot: 'ˈhɒtspɒt',
  hotspots: 'ˈhɒtspɒts',
  landmark: 'ˈlændmɑːk',
  landmarks: 'ˈlændmɑːks',
  sightseeing: 'ˈsaɪtsiːɪŋ',
  downtown: 'ˌdaʊnˈtaʊn',
  uptown: 'ˌʌpˈtaʊn',
  midtown: 'ˈmɪdtaʊn',
  oldtown: 'ˈəʊldtaʊn',
  'old town': 'ˈəʊld taʊn',
  'old city': 'ˈəʊld ˈsɪti',
  marketplace: 'ˈmɑːkɪtpleɪs',
  'market square': 'ˈmɑːkɪt skweə',
  patio: 'ˈpætiəʊ',
  terrace: 'ˈterəs',
  boutique: 'buːˈtiːk',
  spa: 'spɑː',
  wellness: 'ˈwelnes',
  coworking: 'ˈkəʊwɜːkɪŋ',
  'co-working': 'ˈkəʊwɜːkɪŋ',
  startup: 'ˈstɑːtʌp',
  'start-up': 'ˈstɑːtʌp',
  campus: 'ˈkæmpəs',
  arena: 'əˈriːnə',
  stadium: 'ˈsteɪdiəm',
  fountain: 'ˈfaʊntɪn',
  alley: 'ˈæli',
  lane: 'leɪn',
  square: 'skweə',
  tower: 'ˈtaʊə',
  ruins: 'ˈruːɪnz',
  fortress: 'ˈfɔːtrəs',
  memorial: 'məˈmɔːriəl',
  monument: 'ˈmɒnjʊmənt',
  sculpture: 'ˈskʌlptʃə',
  installation: 'ˌɪnstəˈleɪʃən',
  exhibition: 'ˌeksɪˈbɪʃən',
  festival: 'ˈfestɪvl',
  parade: 'pəˈreɪd',
  carnival: 'ˈkɑːnɪvl',
  nightlife: 'ˈnaɪtlaɪf',
  brunch: 'brʌntʃ',
  takeaway: 'ˈteɪkəweɪ',
  'take-away': 'ˈteɪkəweɪ',
  souvenir: 'ˌsuːvəˈnɪə',
  souvenirs: 'ˌsuːvəˈnɪəz',
  selfie: 'ˈselfi',
  selfies: 'ˈselfiz',
  'check-in': 'ˈtʃekɪn',
  checkin: 'ˈtʃekɪn',
  'check-out': 'ˈtʃekaʊt',
  checkout: 'ˈtʃekaʊt',
  via: 'ˈviːə',
  corso: 'ˈkɔːsoʊ',
  strada: 'ˈstrɑːdə',
  avenue: 'ˈævənjuː',
};

/** Deutsche Stoppwörter — nicht als Fremdwort speichern. */
const DE_STOP = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einer',
  'eines',
  'und',
  'oder',
  'aber',
  'mit',
  'von',
  'vom',
  'zum',
  'zur',
  'im',
  'am',
  'um',
  'an',
  'auf',
  'aus',
  'bei',
  'nach',
  'vor',
  'über',
  'unter',
  'für',
  'als',
  'auch',
  'noch',
  'nur',
  'schon',
  'sehr',
  'hier',
  'dort',
  'ist',
  'sind',
  'war',
  'wird',
  'werden',
  'hat',
  'haben',
  'kann',
  'man',
  'sich',
  'nicht',
  'mehr',
  'wie',
  'was',
  'wer',
  'wo',
  'wenn',
  'weil',
  'dass',
  'daß',
  'zu',
  'ja',
  'nein',
  'heute',
  'jahr',
  'jahre',
  'stadt',
  'ort',
  'platz',
  'kirche',
  'haus',
  'straße',
  'strasse',
  'weg',
  'brücke',
  'brucke',
  'markt',
  'rathaus',
  'bahnhof',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deepEntryText(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) return String(entry[0] ?? '');
  if (entry && typeof entry === 'object' && 'text' in entry) {
    return String((entry as { text?: string }).text ?? '');
  }
  return '';
}

/** Sammelt alle relevanten Rohtexte aus dem Stadt-Paket. */
export function collectCityPackTexts(pack: CityPack): string[] {
  const texts: string[] = [];
  const push = (s?: string | null) => {
    const t = (s ?? '').trim();
    if (t) texts.push(t);
  };

  push(pack.name);
  for (const d of pack.district_division ?? []) push(d);

  for (const spot of pack.spots ?? []) {
    push(spot.name);
    push(spot.district);
    for (const b of spot.bullets ?? []) push(b);
  }

  for (const tp of pack.trigger_points ?? []) {
    push(tp.name);
    push(tp.general_info);
    for (const entry of tp.deep_data_pool ?? []) {
      push(deepEntryText(entry));
    }
  }

  return texts;
}

/**
 * Findet Lexikon-Treffer in den Pack-Texten (längste Phrasen zuerst).
 */
export function extractCityPronunciationCandidates(
  texts: string[],
): Array<{ word: string; ipa: string }> {
  const corpus = texts.join('\n');
  const found = new Map<string, string>();

  const lexiconKeys = Object.keys(CITY_FOREIGN_LEXICON).sort(
    (a, b) => b.length - a.length,
  );
  for (const key of lexiconKeys) {
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, 'gi');
    if (re.test(corpus)) {
      const ipa =
        CITY_FOREIGN_LEXICON[key] ?? lookupGlobalPronunciation(key) ?? '';
      if (ipa) found.set(key.toLowerCase(), ipa);
    }
  }

  // Einzel-Tokens die exakt im Lexikon oder globalen JSON stehen
  const tokenRe = /[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß''-]{2,}/gu;
  for (const raw of corpus.match(tokenRe) ?? []) {
    const lower = raw.toLowerCase().replace(/['']/g, '');
    if (lower.length < 3 || DE_STOP.has(lower) || found.has(lower)) continue;
    const ipa =
      CITY_FOREIGN_LEXICON[lower] ?? lookupGlobalPronunciation(lower);
    // Nur Fremdwort-Lexikon + explizite Tourismus-Treffer in SQLite (Stufe 1)
    if (ipa && CITY_FOREIGN_LEXICON[lower]) found.set(lower, ipa);
  }

  return [...found.entries()].map(([word, ipa]) => ({ word, ipa }));
}

/**
 * Scannt ein Stadt-Paket und schreibt Fremdwort-IPA nach SQLite.
 * Aufruf nach Install / Sync, sobald das Pack geladen ist.
 */
export async function parseAndCacheCityPronunciations(
  cityPackage: CityPackage,
): Promise<void> {
  const cityId = (cityPackage.city_id ?? '').trim().toLowerCase();
  if (!cityId) {
    console.warn('[cityPronunciation] Pack ohne city_id — Skip');
    return;
  }

  const texts = collectCityPackTexts(cityPackage);
  const entries = extractCityPronunciationCandidates(texts);

  const db = await getDatabase();
  await ensureCityPronunciationsTable(db);
  await replaceCityPronunciations(db, cityId, entries);
  invalidateCityPronunciationCache(cityId);

  console.log(
    `[cityPronunciation] ${cityId}: ${entries.length} Einträge gecacht (${texts.length} Textquellen)`,
  );
}
