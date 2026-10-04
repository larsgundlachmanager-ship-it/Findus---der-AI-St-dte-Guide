/**
 * Instant local slot parser — Board tickt ohne LLM.
 */

import { parseTripStayUtterance } from '../services/trip/parseTripStay';
import { nextWeekdayDateKey, offsetDateKey, todayDateKey } from '../utils/dateKeys';
import type {
  BudgetVibe,
  EnergyKind,
  HopStop,
  LocationBias,
  LodgingKind,
  MustHaveId,
  PartyGrain,
  ReiseLedger,
  ReiseMode,
  SlotHardness,
  SurfacePref,
} from './types';
import { entry } from './slotLedger';
import { looksLikeTripTypePurpose, looksLikeWishDumpPurpose, splitWishPhrases } from './tripPurpose';
import { isJunkPlaceName } from './placeNameSanity';
import { mergeWhenFlex, parseWhenFlexFromText } from './whenFlex';
import { SEED_PLACES } from './research/candidates';

const DAY_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
};

const MONTH_NUM: Record<string, string> = {
  januar: '01',
  februar: '02',
  märz: '03',
  maerz: '03',
  april: '04',
  mai: '05',
  juni: '06',
  juli: '07',
  august: '08',
  september: '09',
  oktober: '10',
  november: '11',
  dezember: '12',
};

const HUNDRED_WORDS: Record<string, number> = {
  hundert: 100,
  zweihundert: 200,
  dreihundert: 300,
  vierhundert: 400,
  fünfhundert: 500,
  fuenfhundert: 500,
  sechshundert: 600,
  siebenhundert: 700,
  achthundert: 800,
  neunhundert: 900,
  tausend: 1000,
};

function numWord(raw: string): number | null {
  if (/^\d{1,2}$/.test(raw)) return Number(raw);
  return DAY_WORDS[raw.toLowerCase()] ?? null;
}

function monthKey(raw: string): string | null {
  const k = raw.toLowerCase().replace('ä', 'ae');
  return MONTH_NUM[k] ?? MONTH_NUM[raw.toLowerCase()] ?? null;
}

function yearForMonth(mm: string, nowMs: number): number {
  const y = new Date(nowMs).getFullYear();
  const monthNum = Number(mm);
  return new Date(nowMs).getMonth() + 1 > monthNum ? y + 1 : y;
}

function detectModePref(t: string): {
  mode: ReiseMode;
  fallback: ReiseMode | null;
  hardness: SlotHardness;
} | null {
  if (/\b(tagestrip|tagesausflug|nur\s+(einen|1)\s+tag|abends\s+wieder)\b/iu.test(t)) {
    return { mode: 'daytrip', fallback: null, hardness: 'must' };
  }
  if (/\bst[aä]dtetrip\b/iu.test(t) && !/\b(bahn|zug|auto|flug|fliegen)\b/iu.test(t)) {
    return null;
  }
  if (/\b(fahrrad|radtour|radeln|e-?bike|rucksackrad)\b/iu.test(t)) {
    return { mode: 'bike', fallback: null, hardness: isOptionalTalk(t) ? 'wish' : 'must' };
  }
  if (/\b(wandertrip|wanderurlaub|anreise.{0,16}wandern|zu\s+fuß\s+(?:anreisen|hin))\b/iu.test(t)) {
    return { mode: 'hike', fallback: null, hardness: isOptionalTalk(t) ? 'wish' : 'must' };
  }
  if (/\b(camping|wohnmobil|stellplatz)\b/iu.test(t) && !/\bhotel|wohnung|haus|apartment\b/iu.test(t)) {
    if (amenityDenied(t, /\b(camping|zelt|zelten)\b/iu) || /\bnicht\s+(?:campen|zelten)\b/iu.test(t)) {
      /* Zelt-Absage ist kein Camping-Modus */
    } else {
      return { mode: 'camping', fallback: null, hardness: isOptionalTalk(t) ? 'wish' : 'must' };
    }
  }

  const train = /\b(bahn|zug|ice)\b/iu.test(t);
  const drive = /\b(auto|autofahrt|sprits?|mit\s+dem\s+wagen)\b/iu.test(t);
  const fly = /\b(flug|fliegen|hinfliegen|flieger|airport|flughafen)\b/iu.test(t);
  const preferTrain =
    /\b(bahn|zug).{0,40}(lieber|eher|bevorzug|entspannter|schöner|schoener)|lieber.{0,20}(bahn|zug)|bahn\s+schön/iu.test(
      t,
    );
  const preferDrive = /\bauto.{0,40}(lieber|eher)|lieber.{0,20}auto/iu.test(t);
  const preferFly = /\b(hinfliegen|fliegen|flug).{0,48}(lieber|eher|nice|cool)|lieber.{0,16}flieg/iu.test(t);
  const flySoft =
    fly &&
    (isOptionalTalk(t) ||
      /\b(wahrscheinlich.{0,24}teuer|eh\s+zu\s+teuer|wenn\s+es\s+passt|mal\s+schauen)\b/iu.test(t));
  const sonstDrive =
    /\bsonst.{0,16}auto|auto.{0,28}(auch|völlig|voellig|voll|okay|ok|geht|passt|egal|fine)|egal.{0,20}auto/iu.test(
      t,
    );
  const sonstTrain =
    /\bsonst.{0,16}(bahn|zug)|bahn.{0,40}(auch|okay|ok|geht|möglich|moeglich)|(?:mit\s+der\s+)?(?:bahn|zug).{0,28}(?:auch\s+)?möglich/iu.test(
      t,
    );
  const sonstFly = /\bsonst.{0,16}flug/iu.test(t);

  const noFly = /\b(nicht\s+fliegen|kein(?:en)?\s+flug|kein(?:en)?\s+flieger|ohne\s+flug|möchte.{0,16}nicht\s+fliegen|will.{0,16}nicht\s+fliegen)\b/iu.test(
    t,
  );
  const landCount = Number(train) + Number(drive);
  const modeCount = landCount + Number(fly);
  const egalTalk =
    /\b(egal|ist\s+uns\s+egal|ist\s+egal|wie\s+es\s+besser\s+passt|hauptsache|ob\s+.{0,40}\s+oder)\b/iu.test(
      t,
    ) && !/\begal\s+wann\s+(?:wir\s+)?(?:wieder|zurück|zurueck|heim)/iu.test(t);
  const egal = egalTalk && modeCount >= 1;

  if (noFly && landCount >= 2) {
    return { mode: 'mix', fallback: null, hardness: 'wish' };
  }
  if (noFly && train) {
    return { mode: 'train', fallback: drive ? 'drive' : null, hardness: 'wish' };
  }
  if (noFly && drive) {
    return { mode: 'drive', fallback: train ? 'train' : null, hardness: 'wish' };
  }
  if (egal && train && drive) {
    if (preferTrain || /\bentspannter\b/iu.test(t)) {
      return { mode: 'train', fallback: 'drive', hardness: 'wish' };
    }
    return { mode: 'mix', fallback: null, hardness: 'wish' };
  }
  if (egal && modeCount >= 2) {
    return { mode: 'mix', fallback: null, hardness: 'wish' };
  }
  if (modeCount >= 3) {
    return { mode: 'mix', fallback: null, hardness: 'wish' };
  }

  if (preferTrain && (drive || sonstDrive)) {
    return { mode: 'train', fallback: 'drive', hardness: 'wish' };
  }
  if (preferDrive && (train || sonstTrain)) {
    return { mode: 'drive', fallback: 'train', hardness: 'wish' };
  }
  if (preferFly && train) return { mode: 'fly', fallback: 'train', hardness: 'wish' };
  if (preferFly && drive) return { mode: 'fly', fallback: 'drive', hardness: 'wish' };
  if (flySoft) {
    return {
      mode: 'fly',
      fallback: train ? 'train' : drive ? 'drive' : null,
      hardness: 'wish',
    };
  }
  // Flieger + Bahn (auch möglich) → Flug bevorzugt, Bahn Fallback
  if (fly && train && !drive) {
    return {
      mode: 'fly',
      fallback: 'train',
      hardness: isOptionalTalk(t) || sonstTrain ? 'wish' : 'must',
    };
  }
  if (train && drive && !fly) {
    if (sonstDrive) return { mode: 'train', fallback: 'drive', hardness: 'wish' };
    if (sonstTrain) return { mode: 'drive', fallback: 'train', hardness: 'wish' };
    return { mode: 'train', fallback: 'drive', hardness: 'wish' };
  }
  if (drive && !fly && !train) {
    return { mode: 'drive', fallback: null, hardness: isOptionalTalk(t) ? 'wish' : 'must' };
  }
  if (train && !fly) {
    return { mode: 'train', fallback: sonstDrive ? 'drive' : null, hardness: isOptionalTalk(t) ? 'wish' : 'must' };
  }
  if (fly && !train && !drive) {
    return {
      mode: 'fly',
      fallback: sonstTrain ? 'train' : sonstDrive ? 'drive' : null,
      hardness: isOptionalTalk(t) || flySoft ? 'wish' : 'must',
    };
  }
  return null;
}

function detectEnergy(t: string): EnergyKind {
  const chill = /\b(chill|pool\s*liegen|entspann|ruhe|faul|liegen\s+am\s+pool|quatsch)\b/iu.test(t);
  const active =
    /\b(aktiv|stadt\s*erkund|draußen|draussen|action|sport|padel|spikeball|wandern|party|feiern|shoppen|männerwochenende|maennerwochenende|jungswochenende)\b/iu.test(
      t,
    );
  if (chill && active) return 'mixed';
  if (chill) return 'chill_pool';
  if (active) return 'active_out';
  return null;
}

function detectBias(t: string): LocationBias {
  if (/\b(ruhig|außerhalb|ausserhalb|abseits|abgeschieden|nicht\s+in\s+der\s+stadt|ländlich|laendlich|am\s+rand)\b/iu.test(t)) {
    return 'quiet_outskirts';
  }
  if (/\b(zentral|innenstadt|mitte|nah\s+am\s+zentrum|city|stadtnah|mitte\s+der\s+stadt)\b/iu.test(t)) {
    return 'cheap_central';
  }
  if (
    /\b(nah\s+an\s+der\s+aktivität|direkt\s+am\s+(strand|padel|meer)|fußläufig|fusslaeufig|restaurants?\s+in\s+(?:der\s+nähe|gehweite)|gehweite|um\s+die\s+ecke|alles\s+zu\s+fu[sß]|läden?\s+in\s+der\s+nähe)\b/iu.test(
      t,
    )
  ) {
    return 'near_activity';
  }
  return null;
}

function detectLodging(t: string): LodgingKind {
  if (/\bhostel\b/iu.test(t)) return 'hostel';
  if (/\bairbnb\b/iu.test(t)) return 'airbnb';
  if (/\b(ferienhaus|villa|eigenes\s+haus|ein\s+haus)\b/iu.test(t)) return 'ferienhaus';
  if (/\b(apartment|ferienwohnung|wohnung)\b/iu.test(t)) return 'apartment';
  if (/\bhotel\b/iu.test(t)) return 'hotel';
  return null;
}

function isOptionalTalk(t: string): boolean {
  return /\b(optional|wenn\s+(?:es\s+)?passt|falls\s+(?:es\s+)?passt|wenn\s+(?:es\s+)?geht|wenn\s+(?:es\s+)?nicht\s+zu\s+(?:teuer|lang)|kein\s+muss|nicht\s+unbedingt|nicht\s+zwingend|brauchen\s+wir\s+(?:aber\s+)?(?:auch\s+)?nicht\s+zwingend|muss\s+(?:aber\s+)?(?:auch\s+)?nicht|soll\s+(?:cool|nice|schön|schoen)\s+sein|wäre\s+(?:schon\s+)?(?:cool|nice|schön)|waere\s+(?:schon\s+)?(?:cool|nice)|wahrscheinlich.{0,20}teuer|eh\s+zu\s+teuer|wenn\s+es\s+nicht\s+klappt|nicht\s+schlimm|nice\s+to\s+have|bonus|easy|wäre\s+cool|waere\s+cool|kann\s+auch|optional\s+geht|notfalls\s+geht|nicht\s+pflicht|wunschdenken|optimalfall|wenn\s+(?:das\s+)?im\s+budget|je\s+nach(?:dem)?\s+(?:ob\s+)?(?:das\s+)?budget|wenn\s+(?:es\s+)?(?:noch\s+)?drin\s*(?:wäre|waere|ist)|nice\s+cool|wäre\s+nice|waere\s+nice|wenn\s+(?:es\s+)?klappen|extrem\s+teuer|nicht\s+so\s+wichtig|nicht\s+wichtig|nebensache|gerne\s+mal|kann(?:nen)?\s+gerne)\b/iu.test(
    t,
  );
}

/** Freitext-Wünsche kurz + strukturiert (Flipchart). */
export function summarizeWishText(t: string): string {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  const bits: string[] = [];
  if (/\bgünstig(?:es)?\s+bier|guenstig(?:es)?\s+bier|cheap\s+beer|billig\s+und\s+reichlich|reichlich(?:es)?\s+(?:bier|trinken)\b/iu.test(s)) {
    bits.push(/\bbillig\s+und\s+reichlich|reichlich/iu.test(s) ? 'billig & reichlich' : 'günstiges Bier');
  }
  if (/\bpool\b/iu.test(s)) bits.push('Pool');
  if (/\ball[\s-]?inclusive|alles\s+inklusive\b/iu.test(s)) bits.push('All Inclusive');
  if (/\beasy\b.{0,12}\b(eat|essen|food)\b|\beasy\s*eat\b/iu.test(s)) {
    bits.push('easy Essen');
  }
  if (/\beasy\b.{0,12}\b(close|nah|zentral)\b|\beasy\s*close\b|\beinfach\s+nah\b|\bnah\s+dran\b/iu.test(s)) {
    bits.push('nah / easy');
  }
  if (/\b(zentral|Innenstadt|city\s*center)\b/iu.test(s) && !bits.some((b) => /nah/i.test(b))) {
    bits.push('zentral');
  }
  if (bits.length) return bits.slice(0, 3).join(', ');
  if (s.length <= 32) return s;
  const cut = s.slice(0, 31);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 10 ? cut.slice(0, sp) : cut).trim()}…`;
}

function nightsBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00`);
  const b = Date.parse(`${end}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

function detectBudgetVibe(t: string): BudgetVibe {
  if (
    /\b(günstig|guenstig|kostengünstig|kostenguenstig|billig|budget|nicht\s+teuer|preiswert|was\s+halt\s+günstig|eher\s+günstig|lieber\s+günstig)\b/iu.test(
      t,
    )
  ) {
    return 'cheap';
  }
  if (/\b(flexibel|mal\s+schauen|kein\s+limit)\b/iu.test(t)) return 'flex';
  if (/\b(ordentlich|vernünftig|nicht\s+das\s+billigste|midrange)\b/iu.test(t)) return 'mid';
  return null;
}

const FAKE_CITIES = /^(machen|wissen|irgendwo|nicht|wollen|einfach|mal|jetzt|gerne|party|urlaub|hin|wohin|davon|dahin)$/iu;

function titleCity(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Seed-Stadt/Region als Ziel — nie Heimat, nie reine Abflug-Erwähnung, nie Vergangenheit. */
function detectSeedDestination(t: string): string | null {
  const pastCities = new Set(
    [...t.matchAll(/\b(?:waren|war|waren\s+schon)\s+in\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß'-]{2,40})\b/giu)].map((m) =>
      (m[1] || '').toLowerCase(),
    ),
  );
  const names = [...SEED_PLACES]
    .filter((p) => !p.tags.includes('home'))
    .map((p) => p.name)
    .sort((a, b) => b.length - a.length);

  for (const name of names) {
    const low = name.toLowerCase();
    if (pastCities.has(low)) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\b${esc}\\b`, 'iu').test(t)) continue;

    const asAb = new RegExp(`\\bab\\s+${esc}\\b`, 'iu').test(t);
    const asDestCue = new RegExp(
      `(?:\\bnach\\s+|\\brichtung\\s+|\\bin\\s+|\\bauf\\s+|\\bzu\\s+)${esc}\\b|` +
        `\\b${esc}\\b.{0,32}(?:wochenende|wochenend|\\bwe\\b|urlaub|fliegen|fahren|apartment|hotel)|` +
        `(?:wochenende|urlaub|fliegen|fahren).{0,32}\\b${esc}\\b`,
      'iu',
    ).test(t);
    const leading = new RegExp(`^${esc}\\b`, 'iu').test(t.trim());

    // Nur „ab Berlin/Hamburg…“ → Abflug, kein Ziel
    if (asAb && !asDestCue && !leading) continue;
    if (!asDestCue && !leading) {
      if (!/\b(wochenende|urlaub|flug|hotel|apartment|reise|fahren|fliegen|städtetrip|staedtetrip)\b/iu.test(t)) {
        continue;
      }
    }
    return name;
  }
  return null;
}

const FIRST_NAME_ORIGIN =
  /^(kristof|christoph|christopher|andreas|michael|thomas|martin|christian|stefan|peter|lars|jan|tim|max|luca|nico|paul|david|daniel|klaus|hans|leon|finn|jonas)$/iu;

const MULTI_ORIGIN_CITIES = [
  'Hamburg',
  'Bremen',
  'Berlin',
  'Hannover',
  'Köln',
  'Düsseldorf',
  'Frankfurt',
  'München',
  'Stuttgart',
  'Dortmund',
];

function canonOrigin(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s || s.length < 3) return null;
  if (isJunkPlaceName(s)) return null;
  const low = s.toLowerCase();
  // STT: Pristina/Priesdorf/… → Prisdorf (Heimatort), nie Kosovo-Hauptstadt als Ziel
  if (/apriesdorf|priesdorf|prisdorf|briesdorf|chrisdorf|pristina|prishtina/.test(low)) {
    return 'Prisdorf';
  }
  // Tornesch / STT-Varianten (Nachbarort)
  if (/tornesch|tornes[cs]h|tornde|torneschh|tornish/.test(low)) {
    return 'Tornesch';
  }
  if (FIRST_NAME_ORIGIN.test(s)) return null;
  if (/^(uhr|los|hier|da|dort)$/iu.test(s)) return null;
  if (FAKE_CITIES.test(s)) return null;
  return titleCity(s);
}

function isMultiOriginCity(name: string): boolean {
  const n = (name || '').trim().toLowerCase();
  if (!n) return false;
  return MULTI_ORIGIN_CITIES.some((c) => c.toLowerCase() === n);
}

/** Hamburg/Berlin/Bremen als Abflug-Optionen — nicht als Reiseziel. */
function looksLikeDepartureAirportTalk(t: string, cities: string[]): boolean {
  if (cities.length >= 2 && /\b(flug|fliegen|losfliegen|abfliegen|abflug|flughafen|airport|starten|los)\b/iu.test(t)) {
    return true;
  }
  if (
    cities.length >= 1 &&
    /\b(losfliegen|abfliegen|abflug|flughafen|airport|fliegen\s+(?:von|ab)|von\s+(?:hamburg|berlin|bremen|hannover|köln|koeln|münchen|muenchen).{0,48}(?:oder|,))\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

const PAST_TRIP =
  /\b(waren|war|letzten\s+urlaub|letztes?\s+mal|damals|haben\s+wir.{0,24}gehabt)\b/iu;

function amenityDenied(t: string, word: RegExp): boolean {
  word.lastIndex = 0;
  const m = t.match(word);
  if (!m || m.index == null) return false;
  const before = t.slice(Math.max(0, m.index - 28), m.index);
  if (/\b(kein(?:e|en)?|ohne|nie|nicht)\s*$/iu.test(before)) return true;
  const rest = t.slice(m.index + m[0].length, m.index + m[0].length + 80);
  const neg = rest.search(
    /\b(brauch(?:e)?\s+(?:ich\s+)?nicht|will\s+ich\s+(?:gar\s+)?nicht|mag\s+ich\s+nicht|kein\s+muss|nicht\s+(?:nötig|noetig|brauchen)|auf\s+jeden\s+fall\s+nicht|wollen\s+wir\s+nicht|möchte(?:n)?\s+(?:ich|wir)\s+nicht)\b/iu,
  );
  if (neg < 0) return false;
  const between = rest.slice(0, neg);
  if (/\b(wäre|waere|cool|nice|schön|schoen|mega)\b/iu.test(between)) return false;
  const stripped = between
    .replace(/\b(spa|wellness|sauna|massagen?|pool)\b/giu, ' ')
    .replace(/\b(und|oder|aber|wollen|wir|ich|möchte(?:n)?|dann|auch|auf|jeden|fall|,)\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length > 12) return false;
  return true;
}

function isShrug(t: string): boolean {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  if (!s) return true;
  if (s.length < 4) return true;
  if (/\b(bahn|zug|auto|flug|hotel|apartment|pool|euro|budget)\b/iu.test(s) && s.length > 28) {
    return false;
  }
  if (/^(boah\s+)?(keine\s+ahnung|keine\s+idee|egal|weiß\s+nicht|weiss\s+nicht|weiß\s+nich|weiss\s+nich)\b/iu.test(s)) {
    return true;
  }
  return s.length < 48 && /\b(keine\s+ahnung|keine\s+idee|weiß\s+nicht|weiss\s+nicht)\b/iu.test(s);
}

export function looksLikeGarbageFact(t: string): boolean {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  if (s.length < 6) return true;
  if (isShrug(s)) return true;
  if (looksLikeGroupSizeOnly(s)) return true;
  if (looksLikeBudgetRestate(s)) return true;
  if (/^(möchte|will|ist|und|immer|ah|äh|aeh)\b/iu.test(s) && s.split(/\s+/).length <= 8) {
    return true;
  }
  if (/möchte und ist immer/iu.test(s)) return true;
  if (/\b(nicht mehr im hotel|dann auc)\b/iu.test(s)) return true;
  // STT-Müll: „Hauptsache warum warm Hauptsache warum h“
  if (/\bhauptsache\s+warum\b/iu.test(s)) return true;
  if (/(?:\bhauptsache\b.*){2,}/iu.test(s) && s.split(/\s+/).length <= 14) return true;
  // Abgebrochenes Endwort (… warum h) — auch bei längeren Phrasen
  if (/\s[a-zäöü]{1,2}$/iu.test(s)) return true;
  if (/\s[a-zäöü]{1,3}$/iu.test(s) && s.split(/\s+/).length <= 8) return true;
  // Bestätigungs-Gequatsche / abgebrochene STT-Sätze
  if (/\b(ja\s+stimmt|wäre\s+auch\s+okay|waere\s+auch\s+okay|oder\s+sechs\s+tage)\b/iu.test(s)) {
    return true;
  }
  if (s.split(/\s+/).length >= 14 && !/\b(€|euro|nacht|hotel|flug|budget|pool|apartment)\b/iu.test(s)) {
    return true;
  }
  return false;
}

/** „Budget 400“ / „wie unterwegs Budget…“ — kein zweiter Sticker neben €-Chip. */
export function looksLikeBudgetRestate(t: string): boolean {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (!/\b(budget|€|euro|p\.?\s*p\.?|pro\s+person|pro\s+nase|ausgeben)\b/iu.test(s)) return false;
  // Enthält echtes Highlight neben Budget → behalten
  if (/\b(bier|party|pool|club|warm|strand|highlight|all.?inclusive|apartment|hotel)\b/iu.test(s)) {
    return false;
  }
  const cleaned = s
    .replace(
      /\b(\d{2,4}|budget|euro|€|p\.?p\.?|pro|person|nase|unterwegs|sein|wie|und|mit|das|den|die|der|für|fuer|auch|noch|mal)\b/giu,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length < 10;
}

/** „vier Leute“ / „zu viert“ — kein Ortsname. */
export function looksLikeGroupSizeOnly(t: string): boolean {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  if (/^(zu\s+)?(zweit|dritt|viert|fünft|fuenft)\b/iu.test(s)) return true;
  if (/^(wir\s+(sind\s+)?)?(nur\s+)?(ein|eine|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|\d{1,2})\s*(leute|personen|mann|jungs|mädels|maedels|freunde|stück|stueck)?\.?$/iu.test(
    s,
  )) {
    return true;
  }
  if (
    /\b(?:zu\s+)?(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\s+(leute|personen|mann|jungs|mädels|maedels|freunde|stück|stueck)\b/iu.test(
      s,
    ) &&
    s.split(/\s+/).length <= 6
  ) {
    return true;
  }
  return false;
}

function looksLikeQuestionEcho(t: string): boolean {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  if (/\?\s*$/.test(s)) return true;
  return /^(was |wie |wo |wann |möchtest|wollt ihr|apartment oder|hotel oder|auto oder|bahn oder)/iu.test(
    s,
  );
}

function amenityHardness(t: string, word: RegExp): 'must' | 'wish' | 'optional' {
  const m = t.match(word);
  if (!m || m.index == null) return 'wish';
  const window = t.slice(Math.max(0, m.index - 56), m.index + (m[0]?.length ?? 4) + 56);
  if (
    /\b(bonus|wäre\s+(?:schon\s+)?(?:cool|nice|schön)|waere|wenn\s+geht|nice\s+to\s+have|kein\s+muss|muss\s+(?:aber\s+)?(?:auch\s+)?nicht|nicht\s+unbedingt|nicht\s+so\s+wichtig|nicht\s+wichtig|nebensache|gerne\s+mal|kann(?:nen)?\s+gerne|optional|wenn\s+es\s+klappt|wäre\s+cool|je\s+nach(?:dem)?\s+budget)\b/iu.test(
      window,
    )
  ) {
    return 'optional';
  }
  if (/\b(unbedingt|muss|müssen|pflicht|auf\s+jeden\s+fall|ohne\s+geht\s+nicht)\b/iu.test(window)) {
    return 'must';
  }
  return 'wish';
}

function detectAmenities(t: string): {
  must: MustHaveId[];
  wish: MustHaveId[];
  optional: MustHaveId[];
  denied: MustHaveId[];
} {
  const hits: Array<{ id: MustHaveId; re: RegExp }> = [
    { id: 'pool', re: /\b(pool|whirlpool|jacuzzi|whirl\s*pool|whirl)\b/iu },
    { id: 'sand', re: /\b(sandstrand|fein(er|en)?\s+sand|\bsand\b)/iu },
    { id: 'padel', re: /\bpadel\b/iu },
    { id: 'spikeball', re: /\bspikeball\b/iu },
    { id: 'sea', re: /\b(meer|ostsee|nordsee|am\s+wasser)\b/iu },
    { id: 'view', re: /\b(elbblick|meerblick|seeblick|ausblick\s+aufs\s+meer|blick\s+aufs\s+meer)\b/iu },
    { id: 'no_carpet', re: /\b(kein(en)?\s+teppich|ohne\s+teppich)\b/iu },
    { id: 'ferienhaus', re: /\b(ferienhaus|villa)\b/iu },
    { id: 'apartment', re: /\b(apartment|ferienwohnung|whg|wohnung)\b/iu },
    { id: 'hotel', re: /\bhotel\b/iu },
    { id: 'camping', re: /\b(camping|campen|zelt|zelten)\b/iu },
    // "trinken" / günstiges Bier allein ≠ Kneipen-Must — siehe cheapDrinks / partyGrain
    { id: 'party', re: /\b(party|feiern|nightlife|nachtleben|club\s*nacht|kneipe|kneipen)\b/iu },
    { id: 'vegan', re: /\bvegan\b/iu },
    { id: 'grill', re: /\b(grill|grillen|bbq)\b/iu },
    { id: 'boat', re: /\b(boot|bootsausflug|boot\s*mieten)\b/iu },
    { id: 'rental_car', re: /\b(mietwagen|leihwagen|auto\s*mieten)\b/iu },
    { id: 'paddle', re: /\b(paddel(?:n|boot)|kajak|kanu)\b/iu },
    { id: 'warm', re: /\b(warm|sonne|süd|sued)\b/iu },
    // Spaß ≠ Spa (ASCII-\b matched „Spa“ in „Spaß“)
    { id: 'spa', re: /(?<![\p{L}\p{N}_])(?:spa|wellness|entspannungswochenende|wellnessurlaub)(?![\p{L}\p{N}_])/iu },
    { id: 'sauna', re: /\bsauna\b/iu },
    { id: 'massage', re: /\bmassagen?\b/iu },
    { id: 'tennis', re: /\btennis\b/iu },
    { id: 'wine', re: /\b(wein|weinfest|winzer)\b/iu },
    { id: 'cruise', re: /\bkreuzfahrt|familienkreuzfahrt|flusskreuzfahrt\b/iu },
    { id: 'ferry', re: /\b(fähre|faehre|ferry|inselfähre|autofähre)\b/iu },
    { id: 'river_cruise', re: /\b(flusskreuzfahrt|fluss\s*kreuzfahrt|donau\s*kreuzfahrt|rhein\s*kreuzfahrt)\b/iu },
    { id: 'water_slide', re: /\b(wasserrutsche|rutsche|water\s*park|wasserpark)\b/iu },
    { id: 'paddle_board', re: /\b(paddelanlage|surfsimulator|flowrider|paddle\s*board)\b/iu },
    { id: 'culinary', re: /\b(kulinarisch|gourmet|spezialitäten\s*restaurant|specialty\s*dining)\b/iu },
    {
      id: 'kids_club',
      re: /\b(kinderclub|kids\s*club|animation|für\s+kinder|mit\s+(?:den\s+)?kids|mit\s+kindern|familienkreuzfahrt|kinderfreundlich)\b/iu,
    },
    {
      id: 'teens_club',
      re: /\b(teens?(?:\s*club)?|jugend(?:liche|club|programm)|für\s+teens|teen\s*area)\b/iu,
    },
    {
      id: 'running_track',
      re: /\b(laufbahn|joggen|jogging(?:strecke|track)?|running\s*track|laufstrecke\s+an\s+bord)\b/iu,
    },
    {
      id: 'seniors',
      re: /\b(rentner|senior(?:en)?|ruhestand|best[\s-]?ager|für\s+(?:ältere|aeltere)|generation\s*60)\b/iu,
    },
    { id: 'adult_only', re: /\b(adult\s*only|erwachsenenhotel|nur\s+erwachsen|ohne\s+kinder\s+im\s+hotel)\b/iu },
    { id: 'riding', re: /\b(reiterurlaub|reiten|pferde)\b/iu },
    { id: 'parking', re: /\b(parkplatz|eigener\s+parkplatz|parken\s+am\s+haus)\b/iu },
    { id: 'baby_bed', re: /\b(babybett|baby\s*bett|kinderbett)\b/iu },
    { id: 'breakfast', re: /\bfrühstück|fruehstueck\b/iu },
    { id: 'half_board', re: /\bhalbpension\b/iu },
    { id: 'quiet', re: /\b(ruhe|leise|keine\s+partymeile|abgeschieden|privatsphäre|privatsphaere)\b/iu },
    { id: 'short_transfer', re: /\b(kurzer\s+transfer|nicht\s+zu\s+weit\s+vom\s+flughafen|keine\s+lange(?:n)?\s+transfer)\b/iu },
    { id: 'small_hotel', re: /\b(kleineres\s+hotel|kein(?:e|en)?\s+(riesigen?\s+)?kasten|keine\s+bettenburg)\b/iu },
  ];
  const must: MustHaveId[] = [];
  const wish: MustHaveId[] = [];
  const optional: MustHaveId[] = [];
  const denied: MustHaveId[] = [];
  for (const h of hits) {
    if (!h.re.test(t)) continue;
    h.re.lastIndex = 0;
    const halfDenied =
      h.id === 'half_board' &&
      /\bkein(?:e|en|em)?\b.{0,56}\bhalbpension\b|\bhalbpension\b.{0,24}\b(nicht|nee|kein)\b/iu.test(t);
    if (halfDenied || amenityDenied(t, h.re)) {
      denied.push(h.id);
      continue;
    }
    const hard = amenityHardness(t, h.re);
    if (hard === 'must') must.push(h.id);
    else if (hard === 'optional') optional.push(h.id);
    else wish.push(h.id);
  }
  return {
    must: [...new Set(must)],
    wish: [...new Set(wish)],
    optional: [...new Set(optional)],
    denied: [...new Set(denied)],
  };
}

function detectCorridor(t: string): string | null {
  if (/\bostsee\b/iu.test(t)) return 'Ostsee';
  if (/\bnordsee\b/iu.test(t)) return 'Nordsee';
  if (/\b(niederlande|holland)\b/iu.test(t)) return 'Niederlande';
  if (/\b(mallorca|palma)\b/iu.test(t)) return 'Mallorca';
  if (/\bantalya\b/iu.test(t)) return 'Antalya';
  if (/\b(griechenland|korfu|kreta|naxos|rhodos|athen)\b/iu.test(t)) return 'Griechenland';
  return null;
}

function parseEuroAmount(t: string): number | null {
  const compact = t.replace(/\b(\d{1,2})\.(\d{3})\b/g, '$1$2');
  const euro =
    compact.match(/\b(\d{2,5})\s*(?:€|euro)\b/iu) ||
    compact.match(/\b(?:budget|max(?:imal)?|unter|so\s+um|circa|ca\.?|ungefähr|ungefaehr|etwa)\s*(\d{2,5})\s*(?:€|euro)?/iu);
  if (euro) {
    const n = Number(euro[1]);
    if (n >= 50 && n <= 20000) return n;
  }
  const all = [...compact.matchAll(/\b(\d{2,5})\b/g)].map((m) => Number(m[1])).filter((n) => n >= 50 && n <= 20000);
  if (all.length === 1) return all[0]!;
  if (all.length > 1) return all[all.length - 1]!;
  const two = t.match(
    /\b(zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun)\s*hundert(?:\s*(?:€|euro))?\b/iu,
  );
  if (two) {
    const base = DAY_WORDS[two[1]!.toLowerCase().replace('ä', 'ae')] ?? DAY_WORDS[two[1]!.toLowerCase()];
    if (base) return base * 100;
  }
  const glued = t.match(
    /\b(hundert|zweihundert|dreihundert|vierhundert|fünfhundert|fuenfhundert|sechshundert|siebenhundert|achthundert|neunhundert|tausend)\b/iu,
  );
  if (glued) {
    const n = HUNDRED_WORDS[glued[1]!.toLowerCase().replace('ä', 'ae')] ?? HUNDRED_WORDS[glued[1]!.toLowerCase()];
    if (n) return n;
  }
  return null;
}

function weekendSpan(
  kind: 'this' | 'next',
  nowMs: number,
): { start: string; end: string; nights: number } | null {
  const fri = nextWeekdayDateKey('freitag', nowMs);
  const sun = nextWeekdayDateKey('sonntag', nowMs);
  if (!fri || !sun) return null;
  if (kind === 'this') {
    const start = fri;
    let end = sun;
    if (end <= start) {
      end = nextWeekdayDateKey('sonntag', Date.parse(`${start}T12:00:00`) + 86_400_000) ?? sun;
    }
    return { start, end, nights: nightsBetween(start, end) };
  }
  const nextFri = nextWeekdayDateKey('freitag', Date.parse(`${sun}T12:00:00`) + 86_400_000);
  const nextSun = nextFri
    ? nextWeekdayDateKey('sonntag', Date.parse(`${nextFri}T12:00:00`) + 86_400_000)
    : null;
  if (!nextFri || !nextSun) return null;
  return { start: nextFri, end: nextSun, nights: nightsBetween(nextFri, nextSun) };
}

function applyNights(patch: Partial<ReiseLedger>, nights: number, source: 'user' | 'inferred'): void {
  patch.stayNights = entry(nights, source);
  if (!patch.stayDays) patch.stayDays = entry(nights + 1, 'inferred');
}

/**
 * Anreise vs. Abreise vs. fester Span / Must-Da-Sein — und „davor flexibel“.
 */
function applyDateAnchorRole(patch: Partial<ReiseLedger>, t: string): void {
  const pinned = patch.dateStart?.value || patch.dateEnd?.value;
  if (!pinned && !patch.dateStart && !patch.dateEnd) return;

  const presenceTalk =
    /\b(auf\s+jeden\s+fall\s+da|muss\s+(?:ich\s+|wir\s+)?(?:auf\s+jeden\s+fall\s+)?da\s+sein|müssen\s+(?:wir\s+)?da\s+sein|muessen\s+(?:wir\s+)?da\s+sein|unbedingt\s+da|anwesend\s+sein|vor\s+ort\s+sein|da\s+sein\s+müssen|da\s+sein\s+muessen|spätestens\s+(?:anreisen|da|ankommen)|spaetestens\s+(?:anreisen|da|ankommen))\b/iu.test(
      t,
    ) ||
    /\b(muss|müssen|muessen).{0,40}\b(vom|von).{0,40}\b(bis).{0,40}\b(da\s+sein|anwesend|vor\s+ort)\b/iu.test(t) ||
    (/\b(hochzeit|trauung|firmung|taufe|konzert|finale|turnier|messe|konferenz)\b/iu.test(t) &&
      (/\b(muss|müssen|muessen|auf\s+jeden\s+fall|termin|an\s+dem\s+tag)\b/iu.test(t) ||
        Boolean(patch.dateStart || patch.dateEnd)));

  const flexBefore =
    /\b(davor\s+(?:sind\s+wir\s+)?flexibel|vorher\s+flexibel|anreise\s+flexibel|flexibel\s+davor|je\s+nach\s+(?:dem\s+)?(?:budget|flug|flüge|fluege|preis|zeiten|angebot)|je\s+nachdem\s+was\s+(?:das\s+)?budget|flexibel.{0,40}(?:flug|budget|preis))\b/iu.test(
      t,
    );
  const returnFlex =
    /\b(egal\s+wann\s+(?:wir\s+)?(?:wieder|zurück|zurueck|heim)|rückreise\s+(?:egal|flex|optional)|zurueckreise\s+(?:egal|flex)|zurück\s+(?:ist\s+)?egal|zurueck\s+(?:ist\s+)?egal|optional.{0,28}(?:zurück|zurueck|rück|heim)|notfalls.{0,24}(?:zurück|zurueck|da)|da\s+ist\s+egal\s+wann)\b/iu.test(
      t,
    );
  const departTalk =
    /\b(abreise|zurück\s+(?:am|müssen|muss)|zurueck\s+(?:am|müssen|muss)|heimflug|heimreise|wieder\s+zurück|wieder\s+zurueck|muss\s+(?:an\s+dem\s+tag|am)|termin\s+(?:haben|am)|bis\s+(?:spätestens|spaetestens)\s+zurück)\b/iu.test(
      t,
    ) ||
    /\b(abreise|zurück|zurueck|heim)\b.{0,24}\b(muss|müssen|muessen|fix|pflicht|termin)\b/iu.test(t) ||
    /\b(muss|müssen|muessen|soll)\b.{0,28}\b(abreise|zurück|zurueck|heim)\b/iu.test(t);
  const arriveTalk =
    /\b(anreise|starten|abfliegen|hin\s+fliegen|fliegen\s+hin)\b/iu.test(t) ||
    /\blos\b/iu.test(t) ||
    /\bam\s+\d{1,2}\.\s*\d{1,2}.{0,16}\blos\b/iu.test(t) ||
    /\blos\s+(?:am|dann)\b/iu.test(t);

  if (presenceTalk && (patch.dateStart || patch.dateEnd)) {
    const s = patch.dateStart?.value || patch.dateEnd!.value;
    const e = patch.dateEnd?.value || patch.dateStart!.value;
    patch.dateStart = entry(s, 'user', 'must');
    patch.dateEnd = entry(e, 'user', 'must');
    patch.dateAnchor = entry('presence', 'user', 'must');
    if (!patch.dateFlex || patch.dateFlex.value === 'exact') {
      patch.dateFlex = entry('exact', 'user', 'must');
    }
    return;
  }

  if (returnFlex && patch.dateStart) {
    patch.dateAnchor = entry('arrive', 'user', 'must');
    if (patch.dateEnd) {
      patch.dateEnd = entry(patch.dateEnd.value, 'user', 'optional');
    }
    if (!patch.dateFlex || patch.dateFlex.value === 'exact') {
      patch.dateFlex = entry('open', 'user', 'wish');
    }
    return;
  }

  if (patch.dateStart && patch.dateEnd && patch.dateFlex?.value === 'exact') {
    if (!patch.dateAnchor) patch.dateAnchor = entry('span', 'user');
    return;
  }

  if (departTalk && (patch.dateStart || patch.dateEnd)) {
    const day = patch.dateEnd?.value || patch.dateStart?.value;
    if (day) {
      const hard =
        /\b(muss|müssen|muessen|fix|pflicht|termin)\b/iu.test(t) || flexBefore ? 'must' : 'must';
      patch.dateEnd = entry(day, 'user', hard);
      patch.dateStart = null;
      patch.dateAnchor = entry('depart', 'user', 'must');
      if (flexBefore || /\bflexibel\b/iu.test(t)) {
        patch.dateFlex = entry('open', 'user', 'wish');
      } else if (!patch.dateFlex) {
        patch.dateFlex = entry('exact', 'user');
      }
    }
    return;
  }

  if (arriveTalk && patch.dateStart && !patch.dateEnd) {
    patch.dateAnchor = entry('arrive', 'user', 'must');
    if (!patch.dateFlex || patch.dateFlex.value === 'exact') {
      patch.dateFlex = entry('exact', 'user', 'must');
    }
    if (patch.dateStart) {
      patch.dateStart = entry(patch.dateStart.value, 'user', 'must');
    }
    return;
  }

  if (arriveTalk && patch.dateStart && patch.dateEnd && !departTalk) {
    patch.dateAnchor = entry('arrive', 'user');
    return;
  }

  if (flexBefore && patch.dateStart && !departTalk) {
    // „flexibel, aber irgendwann um den 16.10.“ — weicher Anker
    patch.dateAnchor = entry('arrive', 'user', 'wish');
    patch.dateFlex = entry('open', 'user', 'wish');
  }
}

/** „zwei/drei Tage vorher“ / „±1 Tag“ → Zahlen. */
function parseFlexDayMention(t: string): { arrive?: number; depart?: number; both?: number } {
  const wordNum: Record<string, number> = {
    ein: 1,
    eine: 1,
    einem: 1,
    einen: 1,
    zwei: 2,
    drei: 3,
    vier: 4,
    fünf: 5,
    fuenf: 5,
    sechs: 6,
  };
  const num = (raw: string): number | null => {
    const s = raw.toLowerCase();
    if (wordNum[s] != null) return wordNum[s]!;
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 1 && n <= 14 ? n : null;
  };

  const out: { arrive?: number; depart?: number; both?: number } = {};

  const bothPm = t.match(
    /\b(?:\+|plus|±|plusminus|circa)\s*(\d{1,2})\s*tage?\b/iu,
  );
  if (bothPm?.[1]) {
    const n = num(bothPm[1]);
    if (n) out.both = n;
  }

  const before =
    t.match(
      /\b(\d{1,2}|ein(?:em|en|e)?|zwei|drei|vier|fünf|fuenf|sechs)\s*(?:bis\s*(?:\d{1,2}|zwei|drei|vier))?\s*tage?\s+(?:vorher|früher|frueher|davor|eher)\b/iu,
    ) ||
    t.match(
      /\b(?:schon|auch)\s+(\d{1,2}|ein(?:em|en|e)?|zwei|drei|vier|fünf|fuenf|sechs)\s*(?:bis\s*(?:\d{1,2}|zwei|drei|vier))?\s*tage?\s+(?:vorher|früher|frueher|davor)\b/iu,
    ) ||
    t.match(
      /\b(?:ein|1)\s+tag\s+(?:früher|frueher|vorher|davor)\b/iu,
    );
  if (before) {
    const raw = before[1] || '1';
    const n = num(raw) ?? 1;
    // „zwei bis drei“ → obere Zahl
    const range = before[0].match(/\bbis\s+(\d{1,2}|zwei|drei|vier)\b/iu);
    const hi = range?.[1] ? num(range[1]) : null;
    out.arrive = Math.max(n, hi ?? n);
  }

  const after =
    t.match(
      /\b(\d{1,2}|ein(?:em|en|e)?|zwei|drei|vier|fünf|fuenf|sechs)\s*(?:bis\s*(?:\d{1,2}|zwei|drei|vier))?\s*tage?\s+(?:länger|laenger|danach|nachher|später|spaeter|dranhängen|dran\s*hängen)\b/iu,
    ) ||
    t.match(
      /\b(?:noch|auch)\s+(\d{1,2}|ein(?:em|en|e)?|zwei|drei|vier)\s*(?:bis\s*(?:\d{1,2}|zwei|drei|vier))?\s*tage?\s+(?:länger|laenger|bleiben|dranhängen)\b/iu,
    );
  if (after) {
    const raw = after[1] || '1';
    const n = num(raw) ?? 1;
    const range = after[0].match(/\bbis\s+(\d{1,2}|zwei|drei|vier)\b/iu);
    const hi = range?.[1] ? num(range[1]) : null;
    out.depart = Math.max(n, hi ?? n);
  }

  if (
    /\b(?:ein\s+tag\s+(?:früher|frueher|spaeter|später)|flexibel\s+mit\s+dem\s+datum|datum\s+flexibel|\+\s*1\s*tag)\b/iu.test(
      t,
    ) &&
    out.arrive == null &&
    out.depart == null &&
    out.both == null
  ) {
    out.both = 1;
  }

  // „früher oder später“ ohne Zahl → ±1
  if (
    /\b(?:früher|frueher)\s+oder\s+(?:später|spaeter)|(?:tag\s+)?vorher\s+oder\s+(?:ein\s+tag\s+)?später\b/iu.test(
      t,
    ) &&
    out.both == null &&
    out.arrive == null
  ) {
    out.both = Math.max(out.both ?? 0, 1) || 1;
  }

  return out;
}


const ORDINAL_DAY: Record<string, number> = {
  ersten: 1,
  erste: 1,
  zweiten: 2,
  dritten: 3,
  vierten: 4,
  fünften: 5,
  fuenften: 5,
  sechsten: 6,
  siebten: 7,
  siebenten: 7,
  achten: 8,
  neunten: 9,
  zehnten: 10,
  elften: 11,
  zwölften: 12,
  zwoelften: 12,
  dreizehnten: 13,
  vierzehnten: 14,
  fünfzehnten: 15,
  fuenfzehnten: 15,
  sechzehnten: 16,
  siebzehnten: 17,
  achtzehnten: 18,
  neunzehnten: 19,
  zwanzigsten: 20,
};

function dayToken(raw: string): number | null {
  const t = raw.toLowerCase().replace('ä', 'ae').replace('ö', 'oe').replace(/\.$/, '');
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 31 ? n : null;
  }
  return ORDINAL_DAY[t] ?? null;
}

export function looksLikeDateSpan(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ');
  if (/\b(?:vom\s+)?(\d{1,2}|elften|zwölften|zwoelften|dreizehnten)\.?\s+bis\b/iu.test(t)) return true;
  if (/\bbis\s+(?:zum\s+)?(\d{1,2}|dreizehnten|vierzehnten)\./iu.test(t)) return true;
  if (/\b\d{1,2}\.\s*(?:–|-)\s*\d{1,2}\./u.test(t)) return true;
  return false;
}

function applyDateSpan(
  patch: Partial<ReiseLedger>,
  t: string,
  nowMs: number,
  prior: ReiseLedger | null | undefined,
): void {
  const named = t.match(
    /\b(?:vom\s+|von\s+)?(\d{1,2}|elften|zwölften|zwoelften|dreizehnten|vierten|fünften|fuenften|zehnten)\.?\s+bis\s+(?:zum\s+)?(\d{1,2}|elften|zwölften|zwoelften|dreizehnten|vierzehnten|fünfzehnten|fuenfzehnten)\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)?/iu,
  );
  const dotted = t.match(
    /\b(\d{1,2})\.\s*(?:bis|–|-)\s*(?:zum\s+)?(\d{1,2})\.\s*(\d{1,2})(?:\.(\d{2,4}))?/u,
  );
  const loose = t.match(
    /\b(?:am\s+)?(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)?(?:,\s*)?(?:den\s+)?(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)?\b[\s\S]{0,180}?\bbis(?:\s+(?:zum|um|den))?\s+(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)?/iu,
  );
  let startDay: number | null = null;
  let endDay: number | null = null;
  let mm: string | null = null;
  let year: number | null = null;
  if (named) {
    startDay = dayToken(named[1]!);
    endDay = dayToken(named[2]!);
    if (named[3]) mm = monthKey(named[3]);
  } else if (dotted) {
    startDay = Number(dotted[1]);
    endDay = Number(dotted[2]);
    mm = dotted[3]!.padStart(2, '0');
    if (dotted[4]) {
      year = Number(dotted[4]);
      if (year < 100) year += 2000;
    }
  } else if (loose) {
    startDay = Number(loose[1]);
    endDay = Number(loose[3]);
    mm = monthKey(loose[4] || loose[2] || '') || null;
  }
  if (!startDay || !endDay || startDay < 1 || endDay > 31) return;
  if (!mm) {
    mm = patch.dateMonth?.value?.slice(5, 7) ?? prior?.dateMonth?.value?.slice(5, 7) ?? null;
  }
  if (!mm) return;
  const y = year ?? yearForMonth(mm, nowMs);
  const start = `${y}-${mm}-${String(startDay).padStart(2, '0')}`;
  let endY = y;
  let endMm = mm;
  if (endDay < startDay) {
    const next = Number(mm) === 12 ? 1 : Number(mm) + 1;
    endMm = String(next).padStart(2, '0');
    endY = Number(mm) === 12 ? y + 1 : y;
  }
  const end = `${endY}-${endMm}-${String(endDay).padStart(2, '0')}`;
  patch.dateStart = entry(start, 'user');
  patch.dateEnd = entry(end, 'user');
  patch.dateFlex = entry('exact', 'user');
  patch.dateAnchor = entry('span', 'user');
  patch.dateMonth = entry(`${y}-${mm}`, 'user');
  applyNights(patch, nightsBetween(start, end), 'user');
}

function detectLodgingPref(t: string): {
  kind: NonNullable<LodgingKind>;
  fallback: NonNullable<LodgingKind> | null;
  hardness: SlotHardness;
} | null {
  // „geilste = AI-Hotel, Notfall = Apartment“
  const geilsteNotfall = t.match(
    /\b(?:am\s+)?(?:geilsten|liebsten|erst(?:e)?(?:r)?(?:spur)?|wunsch)\b.{0,48}\b(hotel|apartment|ferienhaus|ferienwohnung|airbnb|hostel)\b.{0,80}\b(?:notfall(?:s)?|sonst|falls\s+kein|zweite?\s+spur|fallback)\b.{0,40}\b(hotel|apartment|ferienhaus|ferienwohnung|airbnb|hostel)\b/iu,
  );
  if (geilsteNotfall?.[1] && geilsteNotfall[2]) {
    const mapKind = (s: string): NonNullable<LodgingKind> => {
      const x = s.toLowerCase();
      if (/apartment|ferienwohnung|wohnung/.test(x)) return 'apartment';
      if (/ferienhaus|villa/.test(x)) return 'ferienhaus';
      if (/airbnb/.test(x)) return 'airbnb';
      if (/hostel/.test(x)) return 'hostel';
      return 'hotel';
    };
    return {
      kind: mapKind(geilsteNotfall[1]),
      fallback: mapKind(geilsteNotfall[2]),
      hardness: 'wish',
    };
  }
  // All-Inclusive-Hotel zuerst, sonst Apartment (Funnel: AI suchen, Apartment Soft-Fallback)
  const aiHotelThenApt =
    /\b(?:all[\s-]?inclusive[\s-]?(?:hotel)?|hotel.{0,28}all[\s-]?inclusive).{0,100}(?:wenn\s+(?:es\s+)?kein|wenn\s+keins|sonst|falls\s+kein|dann\s+(?:eher\s+)?(?:ein\s+)?(?:eigenes\s+)?).{0,40}(?:apartment|ferienwohnung|wohnung)/iu.test(
      t,
    ) ||
    /\b(?:am\s+(?:geilsten|liebsten)|lieber|optimal(?:fall)?).{0,48}all[\s-]?inclusive.{0,48}hotel.{0,100}(?:apartment|ferienwohnung|wohnung)/iu.test(
      t,
    ) ||
    /\ball[\s-]?inclusive[\s-]?hotel.{0,80}(?:sonst|dann|wenn\s+keins).{0,36}(?:apartment|ferienwohnung|eigenes\s+apartment)/iu.test(
      t,
    ) ||
    // „entweder AI/Hotel oder Apartment“ / „AI und Hotel oder eigenes Apartment“
    /\b(?:entweder\s+)?(?:all[\s-]?inclusive(?:\s+und)?\s+hotel|hotel(?:\s+und)?\s+all[\s-]?inclusive|all[\s-]?inclusive[\s-]?hotel).{0,48}\boder\b.{0,40}(?:eigenes\s+)?(?:apartment|ferienwohnung|wohnung)/iu.test(
      t,
    ) ||
    (/\b(?:all[\s-]?inclusive|hotel).{0,36}\boder\b.{0,36}(?:eigenes\s+)?(?:apartment|ferienwohnung|wohnung)/iu.test(
      t,
    ) &&
      /\ball[\s-]?inclusive\b/iu.test(t) &&
      /\bhotel\b/iu.test(t));
  if (aiHotelThenApt) {
    return { kind: 'hotel', fallback: 'apartment', hardness: 'wish' };
  }
  // „entweder Apartment oder AI/Hotel“ → Apartment zuerst
  if (
    /\b(?:entweder\s+)?(?:eigenes\s+)?(?:apartment|ferienwohnung|wohnung).{0,48}\boder\b.{0,56}(?:all[\s-]?inclusive|hotel)/iu.test(
      t,
    )
  ) {
    return { kind: 'apartment', fallback: 'hotel', hardness: 'wish' };
  }
  const hits: NonNullable<LodgingKind>[] = [];
  if (/\b(apartment|ferienwohnung|wohnung)\b/iu.test(t)) hits.push('apartment');
  // „kein Hostel“ / „Hostel vielleicht nicht“ nie als Lodging-Wahl
  if (
    /\bhostel\b/iu.test(t) &&
    !amenityDenied(t, /\bhostel\b/iu) &&
    !/\bhostel\b.{0,24}\b(nicht|nee|kein)\b/iu.test(t) &&
    !/\b(nicht|kein|keine|nie|ohne)\b.{0,16}\bhostel\b/iu.test(t)
  ) {
    hits.push('hostel');
  }
  if (/\bairbnb\b/iu.test(t)) hits.push('airbnb');
  if (/\b(ferienhaus|villa|eigenes\s+haus|ein\s+haus)\b/iu.test(t)) hits.push('ferienhaus');
  if (/\bhotel\b/iu.test(t)) hits.push('hotel');
  if (!hits.length) return null;
  const unique = [...new Set(hits)].filter((k, _, arr) => {
    if (k === 'airbnb' && arr.includes('apartment')) return false;
    return true;
  });
  const hardness =
    unique.length > 1 || isOptionalTalk(t) || !/\b(unbedingt|nur|pflicht)\b/iu.test(t) ? 'wish' : 'must';
  const fallback = unique[1] && unique[1] !== unique[0] ? unique[1] : null;
  return { kind: unique[0]!, fallback, hardness };
}

function detectPartyGrain(t: string): PartyGrain | null {
  const wantsPrivate = /\b(alleine\s+party|privat\s+(?:party|feiern)|eigene\s+(?:bude|wohnung)|party\s+machen\s+(?:wir\s+)?(?:selbst|alleine|privat|selber)|selber\s+party|hausparty|unter\s+(?:uns|euch))\b/iu.test(
    t,
  );
  // „nicht so wichtig“ / „nicht unbedingt Clubs“ ≠ Club-Absage
  const deniesClub =
    /\b(kein|keine|ohne)\s+(?:den\s+)?(?:club|clubs|disco)|nicht\s+(?:ins\s+|in\s+(?:einen?\s+)?)?(?:club|clubs|disco)\b/iu.test(
      t,
    );
  const wantsClubs = /\b(club|clubs|disco|discothek|techno)\b/iu.test(t) && !deniesClub;
  // Party selbst + Clubs: nicht auf eine Körnung quetschen — partyStyle hält beides
  if (wantsPrivate && wantsClubs) {
    return null;
  }
  if (
    wantsPrivate ||
    /\b(keine?\s+(?:disco|club|partymeile|partyort)|nicht\s+(?:ins\s+)?(?:club|disco)|kein\s+mallorca)\b/iu.test(
      t,
    )
  ) {
    return 'private_house';
  }
  if (wantsClubs) {
    return 'clubs';
  }
  if (/\b(bar|bars|kneipe|kneipen)\b/iu.test(t) && !/\b(kein|keine|ohne)\s+(?:bar|bars|kneipe)/iu.test(t)) {
    return 'bars';
  }
  if (/\b(feier.{0,12}egal|party.{0,12}egal|egal.{0,16}(?:club|bar|party))\b/iu.test(t)) {
    return 'egal';
  }
  return null;
}

function wantsCheapDrinks(t: string): boolean {
  return /\b(günstig(?:e|es|en)?\s+bier(?:preis(?:e)?)?|guenstig(?:e|es|en)?\s+bier(?:preis(?:e)?)?|bier(?:preis(?:e)?)?\s*(?:günstig|guenstig|billig)|billig(?:es|e)?\s+bier|günstige\s+(?:getränke|drinks)|guenstige\s+(?:getränke|drinks|bier)|billig\s+und\s+reichlich|reichlich(?:es)?\s+(?:bier|trinken|getränke|drinks)|trinken.{0,20}(?:billig|günstig|reichlich)|(?:billig|günstig).{0,16}reichlich)\b/iu.test(
    t,
  );
}

function detectPartyStyle(t: string): string | null {
  const bits: string[] = [];
  if (/\b(club|clubs|disko|techno|house\s*musik|elektronisch)\b/iu.test(t) && !amenityDenied(t, /\b(club|clubs|disco)\b/iu)) {
    bits.push('Clubs');
  }
  if (/\b(live\s*musik|konzert|bands?)\b/iu.test(t)) bits.push('Live-Musik');
  if (/\b(bar|bars|kneipe|kneipen|cocktails?)\b/iu.test(t) && !amenityDenied(t, /\b(bar|bars|kneipe)\b/iu)) {
    bits.push('Bars');
  }
  if (/\b(tanz|tanzen|disco|discothek)\b/iu.test(t) && !bits.includes('Clubs')) bits.push('Tanzen');
  if (/\b(open\s*air|openair|festival)\b/iu.test(t)) bits.push('Open Air');
  if (/\b(mainstream|große\s+clubs|grosse\s+clubs|bekannt)\b/iu.test(t)) bits.push('Mainstream');
  if (/\b(kleiner|klein(e|er)?\s+(clubs?|locations?)|underground)\b/iu.test(t)) bits.push('kleiner');
  if (
    /\b(hausparty|privat(?:e)?\s+party|eigene\s+bude|unter\s+(?:uns|euch)|selber\s+party|party\s+machen\s+(?:wir\s+)?(?:selbst|alleine|privat|selber))\b/iu.test(
      t,
    )
  ) {
    bits.push('Hausparty');
  }
  if (/\b(strandparty|beach\s*party)\b/iu.test(t)) bits.push('Strandparty');
  if (!bits.length) return null;
  return bits.join(', ');
}

function detectOriginCities(t: string): string[] {
  const found: string[] = [];
  for (const city of MULTI_ORIGIN_CITIES) {
    const re = new RegExp(`\\b${city}\\b`, 'iu');
    if (re.test(t)) found.push(city);
  }
  // auch ohne Umlaute
  if (/\bkoeln\b/iu.test(t) && !found.includes('Köln')) found.push('Köln');
  if (/\bduesseldorf\b/iu.test(t) && !found.includes('Düsseldorf')) found.push('Düsseldorf');
  if (/\bmuenchen\b/iu.test(t) && !found.includes('München')) found.push('München');
  return found;
}

function detectSpaStyle(t: string, loose = false): string | null {
  if (amenityDenied(t, /\b(spa|wellness|sauna|massage)\b/iu) && !/\bpool\b/iu.test(t)) {
    return 'kein Spa';
  }
  const spaCtx = loose || /\b(spa|wellness|sauna|massage|entspannungswochenende)\b/iu.test(t);
  if (!spaCtx) return null;
  const bits: string[] = [];
  if (/\b(nur\s+pool|pool)\b/iu.test(t) && !amenityDenied(t, /\bpool\b/iu)) bits.push('Pool');
  if (/\b(sand|meer|strand)\b/iu.test(t)) bits.push('Meer/Sand');
  if (/\bmassagen?\b/iu.test(t) && !amenityDenied(t, /\bmassagen?\b/iu)) bits.push('Massage');
  if (/\bsauna\b/iu.test(t) && !amenityDenied(t, /\bsauna\b/iu)) bits.push('Sauna');
  if (/\b(adult\s*only|erwachsenenhotel|nur\s+erwachsen)\b/iu.test(t)) bits.push('Adult-only');
  if (!bits.length) return amenityDenied(t, /\b(spa|sauna|massage)\b/iu) ? 'kein Spa' : null;
  if (bits.length === 1 && bits[0] === 'Pool') return null;
  return bits.join(', ');
}

function detectKidsStyle(t: string, loose = false): string | null {
  const kidsCtx = loose || /\b(kind(?:er(?:n)?)?|kids|familie)\b/iu.test(t);
  if (!kidsCtx) return null;
  const bits: string[] = [];
  if (/\b(kinderclub|kids\s*club|animation|tui|abgeben)\b/iu.test(t)) bits.push('Kids-Club');
  if (/\b(familienhotel|kinderspezifisch|kinderfreundlich)\b/iu.test(t)) bits.push('Familienhotel');
  const like = t.match(
    /\bkind(?:er(?:n)?)?.{0,28}(?:mögen|moegen|stehen\s+auf|lieben|gerne)\s+(.{3,40}?)(?:[.!?]|$)/iu,
  );
  if (like?.[1]) bits.push(like[1].trim());
  if (!bits.length) return null;
  return bits.join(', ');
}

function detectTripShape(t: string): NonNullable<ReiseLedger['tripShape']>['value'] | null {
  if (/\bkreuzfahrt|familienkreuzfahrt|minikreuzfahrt\b/iu.test(t)) return 'cruise';
  if (/\b(fähre|faehre|ferry|inselfähre|autofähre)\b/iu.test(t) && !/\bkreuzfahrt\b/iu.test(t)) {
    return 'ferry';
  }
  if (/\b(roadtrip|rundreise)\b/iu.test(t)) return 'roadtrip';
  if (/\b(kanutour|kajak|geführte\s+tour|gefuehrte\s+tour)\b/iu.test(t)) return 'tour';
  if (/\b(mehrere\s+st[aä]dte|städte\s*hop|staedte\s*hop|hopping)\b/iu.test(t)) return 'hop';
  // „ein Tag länger bleiben“ ≠ Trip-Form „ein Ort“
  if (/\b(ein\s+ort|eine\s+basis|ein\s+hotel\s+als\s+basis)\b/iu.test(t)) return 'stay';
  if (
    /\bbleiben\b/iu.test(t) &&
    !/\b(länger|laenger|früher|frueher|tag\s+länger|tage?\s+länger)\b/iu.test(t)
  ) {
    return 'stay';
  }
  return null;
}

function detectSurfacePref(t: string): SurfacePref | null {
  const trainOk =
    /\b(flix\s*train|zug|bahn|ice)\b/iu.test(t) &&
    !/\bkein(?:e)?\s+(?:flix\s*)?train\b/iu.test(t);
  const busNo =
    /\b(?:kein(?:en)?\s+)?(?:fern)?bus\b.{0,24}(?:nicht|nee|kein)|nicht\s+(?:mit\s+(?:dem\s+)?)?(?:fern)?bus|bus.{0,16}(?:nicht|nee|kein)|lieber\s+(?:kein(?:en)?\s+)?bus\b/iu.test(
      t,
    ) || /\bflix\s*train\b.{0,40}(?:kein|nicht).{0,16}bus\b/iu.test(t);
  const busOk = /\b(?:fern)?bus\b.{0,16}(?:ok|okay|geht|auch)|bus\s+geht\b/iu.test(t) && !busNo;
  if (trainOk && busNo) return 'train_ok_bus_no';
  if (/\bnur\s+(?:mit\s+(?:dem\s+)?)?(?:zug|bahn|flix\s*train)\b/iu.test(t)) return 'train_only';
  if (/\bnur\s+(?:mit\s+(?:dem\s+)?)?(?:fern)?bus\b/iu.test(t)) return 'bus_only';
  if (busOk && trainOk) return 'either';
  if (busOk) return 'bus_ok';
  if (trainOk && /\b(günstig|guenstig|spar)\b/iu.test(t)) return 'train_ok_bus_no';
  return null;
}

/** „Mailand, dann Verona, dann Venedig“ / „über X nach Y“. */
function detectHopStops(t: string): HopStop[] | null {
  const thenChain = t.match(
    /\b([A-ZÄÖÜ][a-zäöüß]{2,24})\s*(?:,\s*|\s+dann\s+|\s+→\s+|\s+->\s+)([A-ZÄÖÜ][a-zäöüß]{2,24})(?:\s*(?:,\s*|\s+dann\s+|\s+→\s+|\s+->\s+)([A-ZÄÖÜ][a-zäöüß]{2,24}))?(?:\s*(?:,\s*|\s+dann\s+|\s+→\s+|\s+->\s+)([A-ZÄÖÜ][a-zäöüß]{2,24}))?/u,
  );
  if (thenChain) {
    const cities = [thenChain[1], thenChain[2], thenChain[3], thenChain[4]].filter(Boolean) as string[];
    const stopWords = /^(Dann|Und|Mit|Von|Nach|Zum|Zur|Der|Die|Das|Ein|Eine|Apartment|Hotel|Ferienhaus|Airbnb|Notfall|Erstspur|Pool|Spa|Party)$/i;
    const cleaned = cities.filter((c) => !stopWords.test(c) && !isJunkPlaceName(c));
    if (cleaned.length >= 2) {
      return cleaned.map((city) => ({ city, nights: null }));
    }
  }
  if (/\b(mailand|milano).{0,48}(verona).{0,48}(venedig|venezia)\b/iu.test(t)) {
    return [
      { city: 'Mailand', nights: null },
      { city: 'Verona', nights: null },
      { city: 'Venedig', nights: null },
    ];
  }
  return null;
}

function detectCruiseSlots(t: string, patch: Partial<ReiseLedger>): void {
  const lineCue =
    /\b(?:mein(?:en|em|e)?\s+schiff|aida|adidia|aidia|aiida)\b/iu.test(t);
  if (/\b(flusskreuzfahrt|fluss\s*kreuzfahrt)\b/iu.test(t)) {
    patch.cruiseKind = entry('river', 'user', 'wish');
  } else if ((/\bkreuzfahrt\b/iu.test(t) || lineCue) && !patch.cruiseKind) {
    patch.cruiseKind = entry('ocean', 'inferred', 'inferred');
  }
  if ((/\bkreuzfahrt\b/iu.test(t) || lineCue) && !patch.tripShape) {
    patch.tripShape = entry('cruise', lineCue ? 'user' : 'inferred', 'wish');
  }
  if (
    /\b(in\s+der\s+nähe\s+starten|nahe\s+starten|ab\s+deutschland|ohne\s+flug|von\s+hier\s+starten|heimathafen)\b/iu.test(
      t,
    )
  ) {
    patch.cruiseEmbarkBias = entry('near_home', 'user', 'wish');
  } else if (
    /\b(günstigste|guenstigste|billigste|egal\s+welcher\s+hafen|irgendwo\s+starten)\b/iu.test(t) &&
    (/\bkreuzfahrt\b/iu.test(t) || lineCue)
  ) {
    patch.cruiseEmbarkBias = entry('cheapest_anywhere', 'user', 'wish');
    patch.dealHunt = entry(true, 'user', 'wish');
    if (!patch.budgetVibe) patch.budgetVibe = entry('cheap', 'user', 'wish');
  }
  const portHit = t.match(
    /\bab\s+([A-ZÄÖÜ][\p{L}\-]{2,40})(?:\s|,|\.|$)/u,
  );
  if (portHit?.[1] && (/\b(kreuzfahrt|einschiff|hafen)\b/iu.test(t) || lineCue)) {
    patch.cruiseEmbarkBias = entry('named_port', 'user', 'wish');
    patch.cruiseEmbarkPort = entry(portHit[1], 'user', 'wish');
    if (!patch.destinationHint) patch.destinationHint = entry(portHit[1], 'user', 'wish');
  }
  if (/\bsuite\b/iu.test(t)) patch.cruiseCabinClass = entry('suite', 'user', 'wish');
  else if (/\bbalkon\b/iu.test(t)) patch.cruiseCabinClass = entry('balcony', 'user', 'wish');
  else if (/\b(innenkabine|innen\s*kabine)\b/iu.test(t)) {
    patch.cruiseCabinClass = entry('inside', 'user', 'wish');
  } else if (/\b(außenkabine|meerblick)\b/iu.test(t)) {
    patch.cruiseCabinClass = entry('oceanview', 'user', 'wish');
  }
  if (
    /\b(all\s*-?\s*inclusive|getränkepaket|premium\s*ai|drinks?\s*package)\b/iu.test(t)
  ) {
    patch.cruiseFareBundle = entry(
      /\b(premium|pro\b|comfort\s*all)/iu.test(t) ? 'premium_ai' : 'drinks',
      'user',
      'wish',
    );
    if (!patch.meals) patch.meals = entry('all', 'user', 'wish');
  }
  if (/\b(viele\s+seetage|wenig\s+häfen|wenig\s+haefen|seetage)\b/iu.test(t)) {
    patch.cruiseSeaDaysBias = entry('many_sea', 'user', 'wish');
  } else if (/\b(viele\s+(häfen|haefen|stopps|anläufe)|viel\s+sehen)\b/iu.test(t)) {
    patch.cruiseSeaDaysBias = entry('many_ports', 'user', 'wish');
  }
  try {
    const {
      extractCruiseShipName,
      lineBiasFromText,
    } = require('./research/cruiseShipFit') as {
      extractCruiseShipName: (s: string) => string | null;
      lineBiasFromText: (s: string) => 'aida' | 'mein_schiff' | 'other' | null;
    };
    const ship = extractCruiseShipName(t);
    if (ship && !patch.cruiseShipName) {
      patch.cruiseShipName = entry(ship, 'user', 'must');
    }
    const line = lineBiasFromText(t);
    if (line === 'aida' || line === 'mein_schiff') {
      if (!patch.cruiseLinePref) {
        patch.cruiseLinePref = entry(line, 'user', 'wish');
      }
    } else if (
      /\b(?:egal\s+(?:welches\s+)?schiff|schiff\s+egal|keine\s+reederei|open\s+fleet)\b/iu.test(t)
    ) {
      if (!patch.cruiseLinePref) patch.cruiseLinePref = entry('open', 'user', 'wish');
      if (!patch.cruiseShipName) patch.cruiseShipName = entry('open', 'user', 'wish');
    }
  } catch {
    /* soft */
  }
  const inDays = t.match(/\bin\s+(\d{1,2})\s+tagen?\b/iu);
  // Nur bei Kreuzfahrt-Kontext — sonst kein Fake-Kalendertag aus „in 10 Tagen“
  if (
    inDays?.[1] &&
    !patch.dateStart &&
    (/\bkreuzfahrt|einschiff|kabine\b/iu.test(t) || lineCue)
  ) {
    const n = Math.min(90, Math.max(1, parseInt(inDays[1], 10)));
    const d = new Date();
    d.setDate(d.getDate() + n);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    patch.dateStart = entry(key, 'user', 'wish');
    patch.arrivalFlexDays = entry(2, 'inferred', 'inferred');
  }
}

export function parseBriefSlots(
  text: string,
  nowMs = Date.now(),
  prior?: ReiseLedger | null,
): Partial<ReiseLedger> {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return {};
  const patch: Partial<ReiseLedger> = {};

  const modePref = detectModePref(t);
  if (modePref) {
    patch.mode = entry(modePref.mode, 'user', modePref.hardness);
    if (modePref.fallback) patch.modeFallback = entry(modePref.fallback, 'user', 'wish');
  }
  if (modePref?.mode === 'daytrip' && !patch.stayDays) {
    patch.stayDays = entry(1, 'inferred');
  }

  const monthHit = t.match(
    /\b(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/iu,
  );
  const mm = monthHit ? monthKey(monthHit[1]!) : null;
  if (mm) {
    const y = yearForMonth(mm, nowMs);
    patch.dateMonth = entry(`${y}-${mm}`, 'user');
    if (/\banfang\b/iu.test(t)) patch.datePart = entry('early', 'user');
    else if (/\bmitte\b/iu.test(t)) patch.datePart = entry('mid', 'user');
    else if (/\bende\b/iu.test(t)) patch.datePart = entry('late', 'user');
    if (!patch.dateFlex) patch.dateFlex = entry('month', 'user');
  }

  applyDateSpan(patch, t, nowMs, prior);
  const exactDates = Boolean(patch.dateStart && patch.dateEnd && patch.dateFlex?.value === 'exact');

  const stay = parseTripStayUtterance(t, nowMs);
  const staedtetrip = /\bst[aä]dtetrip\b/iu.test(t);
  const weekendTalk = /\bwochenende\b/iu.test(t);
  const pinnedWeekend = /\b(dieses|nächstes|naechstes)\s+wochenende\b/iu.test(t);
  if (staedtetrip && !patch.purpose) {
    patch.purpose = entry('Städtetrip', 'user');
  }
  if (stay?.cityName && !FAKE_CITIES.test(stay.cityName)) {
    if (PAST_TRIP.test(t)) patch.inspiration = entry(stay.cityName, 'user', 'wish');
    else if (!weekendTalk || /\b(in|nach|auf)\s+/iu.test(t)) {
      // Abflug-Städte (HAM/BER/BRE…) nie als Reiseziel
      const stayAsAirport = isMultiOriginCity(stay.cityName);
      const depTalk = looksLikeDepartureAirportTalk(t, detectOriginCities(t));
      if (!(stayAsAirport && depTalk)) {
        patch.destinationHint = entry(stay.cityName, 'user');
      }
    }
  }
  if (
    stay?.dayCount &&
    !(staedtetrip && stay.dayCount === 1 && !/\btagestrip\b/iu.test(t)) &&
    !weekendTalk &&
    !mm
  ) {
    patch.stayDays = entry(stay.dayCount, 'user');
    applyNights(patch, Math.max(1, stay.dayCount - 1), 'inferred');
    if (/\b(ab\s+morgen|ab\s+übermorgen|ab\s+uebermorgen|heute)\b/iu.test(t)) {
      patch.dateStart = entry(stay.startDayKey, stay.startDayKey === todayDateKey() ? 'inferred' : 'user');
      patch.dateEnd = entry(
        offsetDateKey(stay.dayCount - 1, Date.parse(`${stay.startDayKey}T12:00:00`)),
        'inferred',
      );
    }
  }

  const pastCity = t.match(
    /\b(?:waren|war|letzten\s+urlaub|letztes?\s+mal)\b.{0,28}\b(?:in|nach)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]{2,20})/u,
  );
  if (pastCity?.[1] && !FAKE_CITIES.test(pastCity[1])) {
    patch.inspiration = entry(pastCity[1], 'user', 'wish');
  }
  if (/\b(irgendwohin|irgendwo\s+hin|egal\s+wo|wohin\s+ist\s+egal|keine\s+ahnung\s+wohin|wissen\s+nicht\s+wohin)\b/iu.test(t) && !patch.destinationHint) {
    patch.destinationHint = entry('offen', 'user', 'wish');
  }
  if (/\b(warm|sonne|süd|sued|heiß|heiss)\b/iu.test(t) && !/\bnicht\s+zu\s+warm\b/iu.test(t)) {
    patch.weatherWant = entry('warm', 'user', 'wish');
  } else if (/\b(kühl|kuehl|nicht\s+zu\s+heiß|nicht\s+zu\s+heiss|mild)\b/iu.test(t)) {
    patch.weatherWant = entry('mild', 'user', 'wish');
  } else if (/\bwetter.{0,16}egal|egal.{0,12}wetter\b/iu.test(t)) {
    patch.weatherWant = entry('egal', 'user', 'wish');
  }
  const originSkip =
    /^(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|hier|da|dort|davon|dahin|uns|dem|der|den|zu|zum|wo|woher|wohin)$/iu;
  // Heimat / Wohnort: „starten in/aus Prisdorf“, „kommen aus Tornesch“
  const homeHit = t.match(
    /\b(?:starten\s+(?:in|aus|von)|start\s+(?:in|aus|von)|wohnen\s+(?:in|bei)|zu\s*hause\s+in|zuhause\s+in|sitz(?:en)?\s+in|kommen\s+aus)\s+([A-Za-zÄÖÜäöüß\-]{3,24})\b/iu,
  );
  if (homeHit?.[1] && !FAKE_CITIES.test(homeHit[1]) && !originSkip.test(homeHit[1])) {
    const city = canonOrigin(homeHit[1]);
    if (city) patch.originCity = entry(city, 'user');
  }
  const originHit = t.match(
    /\b(?:starten\s+(?:von|ab|aus)|abfliegen\s+(?:von|ab)|von|ab|aus)\s+([A-Za-zÄÖÜäöüß\-]{3,24})\b/iu,
  );
  if (originHit?.[1] && !FAKE_CITIES.test(originHit[1]) && !originSkip.test(originHit[1])) {
    const city = canonOrigin(originHit[1]);
    if (city) {
      const multiSoon = detectOriginCities(t);
      // „von Hamburg, Berlin oder Bremen losfliegen“ → nur Abflug-Liste, nicht Hamburg als Heimat
      const depMulti =
        multiSoon.length >= 2 &&
        looksLikeDepartureAirportTalk(t, multiSoon) &&
        isMultiOriginCity(city);
      if (!depMulti) {
        patch.originCity = entry(city, 'user');
      }
    }
  }
  if (/\b(von\s+hier|von\s+zuhause|von\s+zu\s+hause|hier\s+starten)\b/iu.test(t) && prior?.originCity) {
    patch.originCity = entry(prior.originCity.value, 'user');
  }

  if (weekendTalk && !exactDates) {
    patch.dateFlex = entry(pinnedWeekend ? 'exact' : 'weekend', 'user');
    if (!patch.stayNights) applyNights(patch, 2, pinnedWeekend ? 'user' : 'inferred');
    if (/\bdieses\s+wochenende\b/iu.test(t)) {
      const span = weekendSpan('this', nowMs);
      if (span) {
        patch.dateStart = entry(span.start, 'user');
        patch.dateEnd = entry(span.end, 'user');
        patch.dateAnchor = entry('span', 'user');
        applyNights(patch, span.nights, 'user');
      }
    } else if (/\b(nächstes|naechstes)\s+wochenende\b/iu.test(t)) {
      const span = weekendSpan('next', nowMs);
      if (span) {
        patch.dateStart = entry(span.start, 'user');
        patch.dateEnd = entry(span.end, 'user');
        patch.dateAnchor = entry('span', 'user');
        applyNights(patch, span.nights, 'user');
      }
    }
  }
  if (/\b(sommer|im\s+sommer)\b/iu.test(t) && !patch.dateFlex) {
    patch.dateFlex = entry('month', 'user');
  }
  if (/\b(flexibel|kein\s+festes\s+datum|ist\s+egal\s+wann|irgendwann)\b/iu.test(t) && !patch.dateStart) {
    if (!patch.dateFlex || patch.dateFlex.value === 'month') {
      patch.dateFlex = entry(weekendTalk ? 'weekend' : patch.dateMonth ? 'month' : 'open', 'user');
    }
  }

  if (/\bnächste\s+woche\b/iu.test(t)) {
    // Kein Fake-Kalendertag — nur Fenster „nächste Woche“
    if (!patch.dateFlex || patch.dateFlex.value === 'month') {
      patch.dateFlex = entry('open', 'user');
    }
    if (!patch.dateWindow) patch.dateWindow = entry('nächste Woche', 'user', 'wish');
    if (!patch.stayDays) patch.stayDays = entry(7, 'inferred');
    // Kein dateStart erfinden, keine Fake-6-Nächte-Pin
  }
  const span = t.match(
    /\b(?:von\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s+bis\s+(?:zum\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/iu,
  );
  if (span?.[1] && span[2]) {
    const start = nextWeekdayDateKey(span[1], nowMs);
    let end = nextWeekdayDateKey(span[2], nowMs);
    if (start && end) {
      if (end <= start) {
        end = nextWeekdayDateKey(span[2], Date.parse(`${start}T12:00:00`) + 86_400_000);
      }
      if (end) {
        patch.dateStart = entry(start, 'user');
        patch.dateEnd = entry(end, 'user');
        patch.dateFlex = entry('exact', 'user');
        patch.dateAnchor = entry('span', 'user');
        applyNights(patch, nightsBetween(start, end), 'user');
      }
    }
  }
  const dayMonthName = t.match(
    /\b(\d{1,2})\.?\s*(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/iu,
  );
  if (dayMonthName && !exactDates) {
    const namedMm = monthKey(dayMonthName[2]!);
    if (namedMm) {
      const dd = dayMonthName[1]!.padStart(2, '0');
      const year = yearForMonth(namedMm, nowMs);
      patch.dateStart = entry(`${year}-${namedMm}-${dd}`, 'user');
      patch.dateFlex = entry('exact', 'user');
    }
  }
  const dmy = t.match(/\b(\d{1,2})\.\s*(\d{1,2})(?:\.(\d{2,4}))?/u);
  if (dmy && !monthHit && !exactDates) {
    const dd = dmy[1]!.padStart(2, '0');
    const dmyMm = dmy[2]!.padStart(2, '0');
    let y = dmy[3] ? Number(dmy[3]) : new Date(nowMs).getFullYear();
    if (y < 100) y += 2000;
    patch.dateStart = entry(`${y}-${dmyMm}-${dd}`, 'user');
    patch.dateFlex = entry('exact', 'user');
  }

  applyDateAnchorRole(patch, t);

  // „Zurück Montag oder am besten Dienstag“ relativ zur Anreise
  const returnWd = t.match(
    /\b(?:zurück|zurueck|heim(?:flug|reise)?|abreise)\b(?:\s+(?:am|bis))?\s+(?:am\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)(?:\s+oder(?:\s+(?:am\s+)?besten)?\s+(?:am\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag))?/iu,
  );
  if (returnWd?.[1]) {
    const anchorIso = prior?.dateStart?.value || patch.dateStart?.value;
    if (anchorIso) {
      const preferDay = returnWd[2] || returnWd[1]!;
      const fromMs = Date.parse(`${anchorIso}T12:00:00`) + 86_400_000;
      const endIso = nextWeekdayDateKey(preferDay, fromMs);
      if (endIso) {
        patch.dateEnd = entry(endIso, 'user', returnWd[2] ? 'wish' : 'must');
        if (!patch.dateAnchor) patch.dateAnchor = entry('depart', 'user', 'wish');
        if (!patch.dateFlex || patch.dateFlex.value === 'exact') {
          patch.dateFlex = entry(returnWd[2] ? 'open' : 'exact', 'user', 'wish');
        }
        const startIso = patch.dateStart?.value || prior?.dateStart?.value;
        if (startIso) applyNights(patch, nightsBetween(startIso, endIso), 'inferred');
      }
    }
  }

  // „bis Dienstag bleiben“ / „bleiben bis Dienstag“ (ohne „zurück“)
  const stayUntilWd = t.match(
    /\b(?:bis\s+(?:zum\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s+bleiben|bleiben\s+bis\s+(?:zum\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)|bis\s+(?:zum\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s+(?:da|vor\s+ort))\b/iu,
  );
  if (stayUntilWd && !patch.dateEnd) {
    const wd = stayUntilWd[1] || stayUntilWd[2] || stayUntilWd[3];
    if (wd) {
      const anchorIso = prior?.dateStart?.value || patch.dateStart?.value;
      const fromMs = anchorIso
        ? Date.parse(`${anchorIso}T12:00:00`)
        : nowMs;
      const endIso = nextWeekdayDateKey(wd, fromMs);
      if (endIso) {
        patch.dateEnd = entry(endIso, 'user', 'must');
        if (!patch.dateAnchor) {
          patch.dateAnchor = entry(anchorIso ? 'span' : 'depart', 'user', 'wish');
        }
        if (anchorIso) {
          if (!patch.dateStart) patch.dateStart = entry(anchorIso, prior?.dateStart?.source === 'user' ? 'user' : 'inferred');
          applyNights(patch, nightsBetween(anchorIso, endIso), 'inferred');
        }
      }
    }
  }

  // „Sonntag oder Montag hin“ → Anreise-Wunsch + Flex
  const arriveOr = t.match(
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s+oder\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s+(?:hin|an|los|fliegen|fahren|starten)\b/iu,
  );
  if (arriveOr?.[1] && !patch.dateStart) {
    const a = nextWeekdayDateKey(arriveOr[1], nowMs);
    if (a) {
      patch.dateStart = entry(a, 'user', 'wish');
      if (!patch.arrivalFlexDays) patch.arrivalFlexDays = entry(1, 'user', 'wish');
      if (!patch.dateFlex) patch.dateFlex = entry('open', 'user', 'wish');
      const endIso = patch.dateEnd?.value || prior?.dateEnd?.value;
      if (endIso) applyNights(patch, nightsBetween(a, endIso), 'inferred');
    }
  }

  // Nächte-Spanne vor Einzel-Nacht (3–6 Nächte ≠ eine Zahl)
  const nightRange = t.match(
    /\b(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\s*(?:bis|-|–|bis\s+zu)\s*(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\s+n[äa]chte\b/iu,
  );
  if (nightRange) {
    const a = numWord(nightRange[1]!);
    const b = numWord(nightRange[2]!);
    if (a && b && a >= 1 && b <= 28) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      patch.stayNights = entry(lo, 'user', 'wish');
      patch.stayNightsMax = entry(hi, 'user', 'wish');
      patch.stayDays = entry(hi + 1, 'inferred');
    }
  }
  const dayRangeStay = t.match(
    /\b(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\s*(?:bis|-|–)\s*(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\s+tage\b/iu,
  );
  if (dayRangeStay && !nightRange) {
    const a = numWord(dayRangeStay[1]!);
    const b = numWord(dayRangeStay[2]!);
    if (a && b && a >= 1 && b <= 28) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      patch.stayDays = entry(hi, 'user', 'wish');
      patch.stayNights = entry(Math.max(1, lo - 1), 'user', 'wish');
      patch.stayNightsMax = entry(Math.max(1, hi - 1), 'user', 'wish');
    }
  }

  if (!patch.stayNights && !patch.stayNightsMax) {
    const nights = t.match(/\b(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\s+n[äa]chte\b/iu);
    if (nights) {
      const n = numWord(nights[1]!);
      if (n && n >= 1 && n <= 21) applyNights(patch, n, 'user');
    }
  }
  const week = t.match(/\b(\d{1,2}|eine?|zwei|drei)\s+wochen?\b/iu);
  if (week) {
    const n = week[1] && /^eine?$/iu.test(week[1]) ? 1 : numWord(week[1] || '1');
    if (n && n >= 1 && n <= 8) {
      patch.stayDays = entry(n * 7, 'user');
      if (!patch.stayNights) applyNights(patch, n * 7 - 1, 'inferred');
    }
  }
  if (!patch.stayDays && !dayRangeStay) {
    const rangeDays = t.match(
      /\b(\d{1,2}|zwei|drei|vier|fünf|fuenf)\s*(?:bis|-|–)\s*(\d{1,2}|zwei|drei|vier|fünf|fuenf)\s+tage\b/iu,
    );
    if (rangeDays) {
      const a = numWord(rangeDays[1]!);
      const b = numWord(rangeDays[2]!);
      if (a && b) {
        const n = Math.round((a + b) / 2);
        patch.stayDays = entry(n, 'user');
        if (!patch.stayNights) applyNights(patch, Math.max(1, n - 1), 'inferred');
      }
    }
  }
  if (!patch.stayDays) {
    // „ein Tag länger / früher“ ≠ Aufenthaltsdauer
    const flexDayTalk =
      /\b(?:ein|eine|1|\d{1,2}|zwei|drei)\s+tage?\s+(?:länger|laenger|früher|frueher|vorher|danach|später|spaeter|dranhängen)\b/iu.test(
        t,
      ) ||
      /\b(?:noch|auch)\s+(?:ein|eine|1|\d{1,2})\s+tage?\s+(?:länger|laenger|bleiben)\b/iu.test(t);
    if (!flexDayTalk) {
      const daysHit = t.match(
        /\b(\d{1,2}|ein|eine|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\s+tage\b/iu,
      );
      if (daysHit) {
        const n = numWord(daysHit[1]!);
        if (n && n >= 1 && n <= 21) {
          patch.stayDays = entry(n, 'user');
          if (!patch.stayNights && n > 1) applyNights(patch, n - 1, 'inferred');
        }
      }
    }
  }

  const people = t.match(
    /\b(?:zu\s+)?(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\s+(leute|personen|mann|jungs|mädels|maedels|freunde|stück|stueck)\b/iu,
  );
  if (people) {
    const n = numWord(people[1]!);
    if (n && n >= 2 && n <= 16) {
      patch.adults = entry(n, 'user');
      patch.beds = entry(n, 'inferred');
    }
  }
  if (/\bzu\s+viert\b/iu.test(t) || /\bwir\s+(sind\s+)?vier\b/iu.test(t)) {
    patch.adults = entry(4, 'user');
    patch.beds = entry(4, 'inferred');
  }
  if (/\bzu\s+dritt\b/iu.test(t)) {
    patch.adults = entry(3, 'user');
    patch.beds = entry(3, 'inferred');
  }
  if (/\b(baby|säugling|saeugling|neugeboren|\d{1,2}\s+monate)\b/iu.test(t)) {
    if (!patch.children) patch.children = entry(1, 'user');
    if (!patch.infants) patch.infants = entry(1, 'user');
    if (/\bzu\s+dritt\b/iu.test(t)) {
      patch.adults = entry(2, 'user');
      patch.beds = entry(2, 'inferred');
    }
  }
  if (/\bkind(?:es)?\s+unter\s+(?:einem\s+)?(?:jahr|1)\b/iu.test(t) || /\bunter\s+1\s*(?:jahr|j)\b/iu.test(t)) {
    if (!patch.infants) patch.infants = entry(1, 'user');
  }
  const cabinHit = t.match(/\b(\d{1,2}|ein|eine|zwei|drei|vier)\s*(?:x\s*)?(?:handgepäck|handgepaeck|cabin\s*bag)/iu);
  if (cabinHit) {
    const n = numWord(cabinHit[1]!);
    if (n != null) patch.cabinBags = entry(n, 'user');
  }
  const checkedHit = t.match(/\b(\d{1,2}|ein|eine|zwei|drei|vier)\s*(?:x\s*)?(?:aufgabegepäck|aufgabegepaeck|koffer|checked\s*bag)/iu);
  if (checkedHit) {
    const n = numWord(checkedHit[1]!);
    if (n != null) patch.checkedBags = entry(n, 'user');
  }
  if (
    /\b(kein(?:e[sn]?)?|ohne)\s+(?:hand|aufgabe)?gep[äa]ck\b/iu.test(t) ||
    /\bohne\s+koffer\b/iu.test(t)
  ) {
    if (!patch.cabinBags) patch.cabinBags = entry(0, 'user');
    if (!patch.checkedBags) patch.checkedBags = entry(0, 'user');
  } else if (/\bnur\s+handgep[äa]ck\b/iu.test(t) || /\bnur\s+cabin\b/iu.test(t)) {
    if (!patch.cabinBags) {
      const n = numWord(t.match(/\b(\d{1,2}|ein|eine|zwei|drei|vier)\b/iu)?.[1] ?? '') ?? 1;
      patch.cabinBags = entry(n, 'user');
    }
    if (!patch.checkedBags) patch.checkedBags = entry(0, 'user');
  }
  if (
    !patch.adults &&
    /\b(meine\s+frau|mein\s+mann|freundin|freund\b|wir\s+beide|zu\s+zweit|paar)\b/iu.test(t)
  ) {
    patch.adults = entry(2, 'user');
  }
  if (/\bzu\s+zweit\b/iu.test(t)) patch.adults = entry(2, 'user');
  if (/\b(alleine|allein|nur\s+ich)\b/iu.test(t) && !patch.adults) {
    patch.adults = entry(1, 'user');
  }
  // Just-Do-It: Ziel/Hotel genannt → Personen NICHT still auf 2 setzen.
  // Sonst verschwindet die Gruppe vom Board und wird nie nachgefragt.
  // (Preis-Defaults bleiben im Funnel: adults ?? 2)

  const kidsCount = t.match(/\b(\d{1,2}|ein|eine|zwei|drei|vier|fünf|fuenf)\s+kinder(?:n)?\b/iu);
  if (kidsCount) {
    const n = numWord(kidsCount[1]!);
    if (n && n >= 1 && n <= 8) patch.children = entry(n, 'user');
  } else if (/\b(mit\s+(?:den\s+)?kindern|kinder\s+dabei|kind\s+dabei)\b/iu.test(t)) {
    if (!patch.children) patch.children = entry(1, 'inferred');
  }

  const amount = parseEuroAmount(t);
  const budgetCue =
    /\b(€|euro|budget|pro\s+person|pro\s+nase|ausgeben|kosten|p\.?\s*p\.?)\b/iu.test(t) ||
    /\b(hundert|zweihundert|dreihundert|vierhundert|fünfhundert|sechshundert)\b/iu.test(t);
  if (amount != null && (budgetCue || (amount >= 100 && amount % 50 === 0))) {
    patch.budgetEur = entry(amount, 'user');
    patch.budgetScope = entry(
      /\b(gesamt|zusammen|insgesamt|für\s+alle|fuer\s+alle|für\s+uns\s+beide|fuer\s+uns\s+beide)\b/iu.test(t)
        ? 'total'
        : 'per_person',
      'user',
    );
    patch.budgetIncludes = entry(
      /\b(inkl(?:usive)?\s*(?:flug|anreise)|unterkunft\s+und\s+anreise|inklusive\s+flug)\b/iu.test(t)
        ? 'stay_transport'
        : /\b(nur\s+unterkunft|für\s+die\s+unterkunft|fuer\s+die\s+unterkunft)\b/iu.test(t)
          ? 'stay'
          : 'stay',
      'inferred',
    );
    // Budget genannt ohne „billig/Hostel“ → Niveau halten (Value-Floor), kein Dump-Default.
    if (
      !patch.lodgingQuality &&
      !(prior?.lodgingQuality) &&
      patch.budgetVibe?.value !== 'cheap' &&
      prior?.budgetVibe?.value !== 'cheap' &&
      !/\b(billig|hostel|sparsam|so\s+günstig\s+wie\s+möglich|guenstig\s+wie\s+möglich)\b/iu.test(t)
    ) {
      patch.lodgingQuality = entry('nicer_base', 'inferred', 'wish');
    }
  }

  const hours =
    t.match(/\b(?:max(?:imal)?|nicht\s+mehr\s+als|unter)\s*(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|acht|zehn)\s*stunden\b/iu) ||
    t.match(/\b(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|acht|zehn)\s*stunden(?:\s+(?:anfahrt|fahrt|fahren|auto))?\b/iu);
  if (hours) {
    const raw = hours[1]!;
    const n = /^\d+$/.test(raw) ? Number(raw) : numWord(raw);
    if (n && n >= 1 && n <= 16) {
      if (/\b(bahn|zug|ice|flix\s*train)\b/iu.test(t) && !/\b(auto|wagen|autofahrt)\b/iu.test(t)) {
        patch.maxRailHours = entry(n, 'user');
      } else {
        patch.maxDriveHours = entry(n, 'user');
      }
    }
  }
  const railHours = t.match(
    /\b(?:bahn|zug).{0,24}(?:max(?:imal)?|nicht\s+mehr\s+als|unter)\s*(\d{1,2})\s*stunden|\b(\d{1,2})\s*stunden.{0,16}(?:bahn|zug)\b/iu,
  );
  if (railHours) {
    const n = Number(railHours[1] || railHours[2]);
    if (n >= 1 && n <= 16) patch.maxRailHours = entry(n, 'user');
  }
  const departH = t.match(
    /\b(?:ab|erst\s+ab)\s+(\d{1,2})(?::\d{2})?\s*uhr.{0,48}(?:los|fahren|flieger|flug|können\s+wir|koennen\s+wir)|(?:los|fahren|flieger).{0,28}(?:ab\s+)?(\d{1,2})(?::\d{2})?\s*uhr/iu,
  );
  if (departH) {
    const n = Number(departH[1] || departH[2]);
    if (n >= 0 && n <= 23) patch.departAfterHour = entry(n, 'user');
  }
  const arriveH = t.match(
    /\b(?:spätestens|spaetestens|ankommen(?:\s+bis)?|nicht\s+später\s+als)\s+(\d{1,2})\s*uhr/iu,
  );
  if (arriveH) {
    const n = Number(arriveH[1]);
    if (n >= 0 && n <= 23) patch.arriveBeforeHour = entry(n, 'user');
  }
  // Kein Fake-„an bis 20 Uhr“ aus Floskeln wie „nicht zu spät“ / „noch in die Stadt“.

  const energy = detectEnergy(t);
  if (energy) patch.energy = entry(energy, 'user');
  const bias = detectBias(t);
  if (bias) patch.locationBias = entry(bias, 'user');
  const lodgingPref = detectLodgingPref(t);
  if (lodgingPref) {
    const hotelAsAlt =
      lodgingPref.kind === 'hotel' &&
      !lodgingPref.fallback &&
      Boolean(prior?.lodgingKind && prior.lodgingKind.value !== 'hotel') &&
      !/\b(doch\s+hotel|stattdessen\s+hotel|lieber\s+hotel|nur\s+hotel)\b/iu.test(t);
    if (hotelAsAlt) {
      patch.lodgingFallback = entry('hotel', 'user', 'wish');
    } else {
      patch.lodgingKind = entry(lodgingPref.kind, 'user', lodgingPref.hardness);
      const fb = lodgingPref.fallback && lodgingPref.fallback !== lodgingPref.kind ? lodgingPref.fallback : null;
      if (fb) patch.lodgingFallback = entry(fb, 'user', 'wish');
    }
    if (lodgingPref.kind === 'hostel') patch.lodgingQuality = entry('cheap_box', 'inferred');
    if (lodgingPref.kind === 'hotel' || lodgingPref.kind === 'ferienhaus') {
      patch.lodgingQuality = entry('nicer_base', 'inferred');
    }
  } else if (
    /\b(unterkunft.{0,28}(egal|frei)|ziemlich frei|hotel\s+oder\s+apartment|apartment\s+oder\s+hotel|egal\s+ob\s+hotel|egal.{0,20}unterkunft)\b/iu.test(
      t,
    )
  ) {
    patch.lodgingOpen = entry(true, 'user', 'wish');
  }
  const deniesHalfBoard =
    /\bkein(?:e|en|em)?\b.{0,56}\bhalbpension\b|\bhalbpension\b.{0,24}\b(nicht|nee|kein)\b/iu.test(t);
  const wantsAllInclusive = /\ball\s*-?\s*inclusive|allinclusive|alles\s+inklusive\b/iu.test(t);
  if (wantsAllInclusive) {
    const softAi =
      isOptionalTalk(t) ||
      /\bam\s+(?:geilsten|liebsten)\b|\bgeilsten\b|\bwunschdenken|optimalfall|wahrscheinlich.{0,24}teuer|eh\s+zu\s+teuer|wenn.{0,28}budget|je\s+nach(?:dem)?.{0,20}budget|nicht\s+muss|muss\s+(?:aber\s+)?(?:auch\s+)?nicht\b|soll\s+(?:cool|nice)\b/iu.test(
        t,
      );
    // Soft-AI immer optional (Budget entscheidet) — nie grünes Muss
    patch.meals = entry('all', 'user', softAi ? 'optional' : 'wish');
    const aptFirst = /\b(apartment|ferienwohnung|wohnung)\b/iu.test(t) && !/\bhotel\b/iu.test(t);
    if (!aptFirst) {
      if (!patch.lodgingKind) patch.lodgingKind = entry('hotel', 'inferred', 'wish');
      const kind = patch.lodgingKind?.value;
      if (kind === 'hotel' && !patch.lodgingFallback) {
        patch.lodgingFallback = entry('apartment', 'inferred', 'optional');
      }
    }
  } else if (/\bhalbpension\b/iu.test(t) && !deniesHalfBoard) {
    patch.meals = entry('half', 'user', isOptionalTalk(t) ? 'optional' : 'must');
  } else if (/\bfrühstück|fruehstueck\b/iu.test(t)) {
    patch.meals = entry('breakfast', 'user', isOptionalTalk(t) ? 'optional' : 'must');
  } else if (/\b(selbstverpflegung|eigene\s+küche|eigene\s+kueche)\b/iu.test(t)) {
    patch.meals = entry('self', 'user', isOptionalTalk(t) ? 'optional' : 'wish');
  }
  if (
    deniesHalfBoard &&
    /\b(hotel|halbpension|verpflegung)\b/iu.test(t) &&
    !patch.dealbreaker
  ) {
    patch.dealbreaker = entry('kein normales Hotel nur mit Halbpension', 'user', 'must');
  }
  if (/\bpartymeile\b/iu.test(t) && /\b(kein|keine|nicht|ohne)\b/iu.test(t)) {
    patch.dealbreaker = entry('keine Partymeile', 'user', 'must');
  }
  const vibe = detectBudgetVibe(t);
  if (vibe) {
    patch.budgetVibe = entry(vibe, 'user', 'wish');
    if (vibe === 'cheap' && !patch.lodgingQuality) patch.lodgingQuality = entry('cheap_box', 'inferred');
  }

  const partyTalk =
    /\b(männerwochenende|maennerwochenende|jungswochenende|jungs\s*trip|partywochenende|party\s*weekend|städtetrip|staedtetrip)\b/iu.test(
      t,
    ) || Boolean(prior?.purpose?.value && /party|männer|maenner|jungs|städt|staedt|city/i.test(prior.purpose.value));
  const partyVibe =
    /\b(männerwochenende|maennerwochenende|jungswochenende|jungs\s*trip|partywochenende|party\s*weekend)\b/iu.test(t) ||
    Boolean(prior?.purpose?.value && /party|männer|maenner|jungs/i.test(prior.purpose.value));
  const amenities = detectAmenities(t);
  const spaIds: MustHaveId[] = ['spa', 'sauna', 'massage'];
  const echoQ = looksLikeQuestionEcho(t);
  const keepInvented = (id: MustHaveId) => {
    if (echoQ && (spaIds.includes(id) || id === 'rental_car')) return false;
    if (partyVibe && spaIds.includes(id) && !/\b(spa|wellness|massage|sauna)\b/iu.test(t)) return false;
    if (partyTalk && id === 'rental_car' && !/\b(brauchen|unbedingt|wollen).{0,16}mietwagen|mietwagen.{0,12}(brauchen|unbedingt)\b/iu.test(t)) {
      return false;
    }
    return true;
  };
  amenities.must = amenities.must.filter(keepInvented);
  amenities.wish = amenities.wish.filter(keepInvented);
  amenities.optional = amenities.optional.filter(keepInvented);
  if (amenities.must.length) patch.mustHaves = entry(amenities.must, 'user', 'must');
  if (amenities.wish.length) patch.wishHaves = entry(amenities.wish, 'user', 'wish');
  if (amenities.optional.length) patch.niceHaves = entry(amenities.optional, 'user', 'optional');
  if (/\b(whirlpool|jacuzzi|whirl\s*pool)\b/iu.test(t) && !amenityDenied(t, /\b(whirlpool|jacuzzi|whirl)\b/iu)) {
    const acts = [...(patch.mustActivities?.value ?? prior?.mustActivities?.value ?? [])];
    if (!acts.some((a) => /whirl|jacuzzi/i.test(a))) {
      acts.push('Whirlpool');
      patch.mustActivities = entry(acts.slice(0, 6), 'user', 'wish');
    }
  }
  // Partymeile/Disco-Absage ≠ „keine Kneipen“ / party hardNo
  const deniedClean = amenities.denied.filter((id) => {
    if (id !== 'party') return true;
    if (wantsCheapDrinks(t) || detectPartyGrain(t) === 'private_house') return false;
    if (/\b(partymeile|mallorca|partyort|disco|discothek)\b/iu.test(t)) return false;
    return true;
  });
  if (deniedClean.length) patch.hardNos = entry(deniedClean, 'user', 'must');

  if (wantsCheapDrinks(t)) {
    patch.cheapDrinks = entry(true, 'user', 'wish');
  }
  const grain = detectPartyGrain(t);
  if (grain) {
    const softClub =
      grain === 'clubs' &&
      (isOptionalTalk(t) ||
        /\b(nicht\s+so\s+wichtig|nicht\s+wichtig|gerne\s+mal|kann(?:nen)?\s+gerne|nebensache)\b/iu.test(t));
    patch.partyGrain = entry(grain, 'user', softClub ? 'optional' : 'wish');
  }
  const styleBits = detectPartyStyle(t);
  if (styleBits && !patch.partyStyle) {
    const softStyle =
      isOptionalTalk(t) ||
      /\b(nicht\s+so\s+wichtig|gerne\s+mal|kann(?:nen)?\s+gerne)\b/iu.test(t);
    patch.partyStyle = entry(styleBits, 'user', softStyle ? 'optional' : 'wish');
  } else if (grain === 'private_house' && !patch.partyStyle) {
    patch.partyStyle = entry('Hausparty', 'user', 'wish');
  }

  const origins = detectOriginCities(t);
  if (origins.length >= 2 && looksLikeDepartureAirportTalk(t, origins)) {
    patch.originCities = entry(origins, 'user');
    // Erste Flughafen-Stadt nicht als Heimat/Start überschreiben
    if (!patch.originCity && prior?.originCity?.source === 'user') {
      // prior bleibt über merge — kein originCity im Patch
    } else if (!patch.originCity && !prior?.originCity) {
      // Kein Home → primärer Abflug nur als Liste; originOf nimmt [0]
    }
    if (
      !patch.mode &&
      /\b(flughafen|airport|flug|fliegen|abfliegen|starten|losfliegen)\b/iu.test(t)
    ) {
      patch.mode = entry('fly', 'user', 'wish');
    }
  } else if (origins.length >= 2) {
    patch.originCities = entry(origins, 'user');
    if (!patch.originCity) patch.originCity = entry(origins[0]!, 'user');
    if (
      !patch.mode &&
      /\b(flughafen|airport|flug|fliegen|abfliegen|starten)\b/iu.test(t)
    ) {
      patch.mode = entry('fly', 'user', 'wish');
    }
  } else if (origins.length === 1 && !patch.originCity) {
    const only = origins[0]!;
    const destVal = (patch.destinationHint?.value || '').trim().toLowerCase();
    // „Flug nach Berlin“ → Berlin ist Ziel, nicht Abflug
    const onlyIsDest =
      (Boolean(destVal) && only.toLowerCase() === destVal) ||
      (/\bnach\s+/iu.test(t) &&
        new RegExp(
          `\\bnach\\s+${only.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          'iu',
        ).test(t) &&
        !/\bvon\s+/iu.test(t));
    if (!onlyIsDest) {
      patch.originCity = entry(only, 'user');
    }
  }

  // Ziel darf nie eine Abflug-Stadt aus demselben Satz sein
  if (patch.destinationHint && looksLikeDepartureAirportTalk(t, origins)) {
    const d = patch.destinationHint.value.trim().toLowerCase();
    if (origins.some((c) => c.toLowerCase() === d) || isMultiOriginCity(patch.destinationHint.value)) {
      delete (patch as { destinationHint?: unknown }).destinationHint;
    }
  }

  // Abflug ≠ Ziel (Plausibilität vor Commit)
  if (
    patch.originCity?.value &&
    patch.destinationHint?.value &&
    patch.originCity.value.trim().toLowerCase() ===
      patch.destinationHint.value.trim().toLowerCase()
  ) {
    // Explizites „von X nach Y“ mit X≠Y hätte unterschiedliche Werte —
    // gleiche Namen → Origin verwerfen, Ziel behalten
    delete (patch as { originCity?: unknown }).originCity;
  }

  if (
    /\b(?:max(?:imal)?|höchstens|hoechstens)\s*(\d{1,2})\s*(?:h|std|stunden)\s*(?:stopp|zwischenstopp|umsteigen|layover)?\b/iu.test(
      t,
    ) ||
    /\b(?:max(?:imal)?|höchstens|hoechstens)\s*(\d{1,2})\s*(?:zwischenstopp|layover)\b/iu.test(t)
  ) {
    const m =
      t.match(
        /\b(?:max(?:imal)?|höchstens|hoechstens)\s*(\d{1,2})\s*(?:h|std|stunden)\s*(?:stopp|zwischenstopp|umsteigen|layover)?\b/iu,
      ) ||
      t.match(/\b(?:max(?:imal)?|höchstens|hoechstens)\s*(\d{1,2})\s*(?:zwischenstopp|layover)\b/iu);
    const h = Number(m?.[1]);
    if (h >= 1 && h <= 12) patch.maxLayoverHours = entry(h, 'user', 'wish');
  } else if (/\b(?:zwischenstopp|umsteigen).{0,20}(?:max(?:imal)?|höchstens|hoechstens).{0,8}(\d{1,2})\s*h\b/iu.test(t)) {
    const m = t.match(/(\d{1,2})\s*h/iu);
    const h = Number(m?.[1]);
    if (h >= 1 && h <= 12) patch.maxLayoverHours = entry(h, 'user', 'wish');
  } else if (
    /\b(?:max(?:imal)?|nicht\s+länger\s+als|nicht\s+laenger\s+als)\s*(\d+|ein|eine|zwei)\s*(?:h|std|stunde(?:n)?)\b.{0,28}\b(?:flughafen|zwischenstopp|stopp)\b/iu.test(
      t,
    )
  ) {
    const m = t.match(
      /\b(?:max(?:imal)?|nicht\s+länger\s+als|nicht\s+laenger\s+als)\s*(\d+|ein|eine|zwei)\s*(?:h|std|stunde(?:n)?)\b/iu,
    );
    const raw = m?.[1] || '';
    const h = /^\d+$/.test(raw) ? Number(raw) : numWord(raw);
    if (h && h >= 1 && h <= 12) patch.maxLayoverHours = entry(h, 'user', 'wish');
  }

  const longStop =
    t.match(
      /\b(?:kein\s+problem|okay|ok|gerne|explizit|darf|kann).{0,80}?(\d{2})\s*(?:h|std|stunden).{0,40}(?:zwischenstopp|umsteigen|hängen|haengen|dubai|layover)/iu,
    ) ||
    t.match(
      /\b(\d{2})\s*(?:h|std|stunden).{0,36}(?:zwischenstopp|umsteigen|hängen|haengen|dubai|stadt\s+an(?:schauen|gucken)|erkunden)/iu,
    ) ||
    t.match(
      /\b(?:zwischenstopp|layover).{0,40}(?:stadt|angucken|anschauen|erkunden).{0,24}(\d{2})\s*(?:h|std|stunden)/iu,
    );
  if (longStop) {
    const h = Number(longStop[1]);
    if (h >= 16 && h <= 48) {
      patch.longLayoverExploreHours = entry(h, 'user', 'wish');
    }
  } else if (
    /\b(?:zwischenstopp|umsteigen|layover).{0,48}(?:stadt\s+an(?:schauen|gucken)|erkunden|angucken)\b/iu.test(t) ||
    /\b(?:dubai|doha|istanbul|qatar).{0,40}(?:hängen|haengen|bleiben|anschauen|angucken)\b/iu.test(t)
  ) {
    patch.longLayoverExploreHours = entry(20, 'user', 'wish');
  }

  if (
    /\b(?:nachtflug|über\s+nacht\s+flieg|ueber\s+nacht\s+flieg|im\s+flieger\s+schlafen|nacht.{0,20}im\s+flieger)\b/iu.test(
      t,
    ) ||
    /\b(?:hotel\s+spar(?:en)?|keine\s+hotel.?nacht|nachtflug.{0,24}spar)/iu.test(t)
  ) {
    patch.overnightFlightOk = entry(true, 'user', 'wish');
    const prevComfort = patch.flightComfort?.value ?? prior?.flightComfort?.value ?? {};
    patch.flightComfort = entry({ ...prevComfort, overnightOk: true, noNightArrival: false }, 'user', 'wish');
  }

  const corridor = detectCorridor(t);
  if (corridor) patch.corridor = entry(corridor, 'user');

  if (/\b(eigene\s+räder|räder\s+haben\s+wir|fahrräder\s+haben)\b/iu.test(t)) {
    patch.ownBikes = entry(true, 'user');
  }
  if (/\b(andere\s+stadt|nicht\s+zurück|open.?jaw|woanders\s+(raus|zurück))\b/iu.test(t)) {
    patch.openJaw = entry(true, 'user');
  }

  const stopWord = (raw: string): number | null => {
    if (/^\d+$/.test(raw)) return Number(raw);
    if (/^ein/i.test(raw)) return 1;
    if (/^zwei/i.test(raw)) return 2;
    return numWord(raw);
  };
  const stopsTalk =
    /\b(\d+|ein|einen|eine|zwei)\s*(?:bis\s*(?:\d+|zwei)\s*)?(?:stopp|stopps|stops|umstieg|zwischenstopp)/iu.test(t) ||
    /\bmax(?:imal)?\s+(?:ein|1|einen)\s+stopp\b/iu.test(t) ||
    /\b(?:ein|1)\s+bis\s+(?:zwei|2)\s+stopp/iu.test(t);
  const preferDirect =
    /\bdirektflug|direkter\s+flug\b/iu.test(t) ||
    /\b(lieber|am\s+liebsten|bevorzug|hauptsache).{0,28}direkt/iu.test(t) ||
    /\bdirekt.{0,20}(lieber|bevorzug|am\s+liebsten)\b/iu.test(t);
  const allowsStops =
    stopsTalk ||
    (/\bumsteigen\b/iu.test(t) && /\b(auch|okay|ok|geht|in\s+ordnung|wäre|waere|kann)\b/iu.test(t));

  if (preferDirect && allowsStops) {
    patch.directFlight = entry(true, 'user', 'wish');
    const sm = t.match(
      /\b(?:max(?:imal)?|höchstens|hoechstens|bis\s+zu)?\s*(\d+|ein|einen|eine|zwei)\s*(?:bis\s*(\d+|zwei)\s*)?(?:stopp|stopps|stops|umstieg|zwischenstopp)/iu,
    );
    const a = sm?.[1] ? stopWord(sm[1]) : 1;
    const b = sm?.[2] ? stopWord(sm[2]) : null;
    const maxStops = Math.max(a ?? 1, b ?? 0, 1);
    patch.maxFlightStops = entry(Math.min(2, maxStops), 'user', 'wish');
  } else if (preferDirect && !/\b(umsteigen|kein\s+direkt)\b/iu.test(t)) {
    patch.directFlight = entry(true, 'user');
    patch.maxFlightStops = entry(0, 'user', 'wish');
  } else if (allowsStops) {
    patch.directFlight = entry(false, 'user', 'wish');
    const sm = t.match(/\b(\d+|ein|einen|eine|zwei)\s*(?:bis\s*(\d+|zwei)\s*)?(?:stopp|stopps|stops)/iu);
    const a = sm?.[1] ? stopWord(sm[1]) : 1;
    const b = sm?.[2] ? stopWord(sm[2]) : null;
    patch.maxFlightStops = entry(Math.min(2, Math.max(a ?? 1, b ?? 0, 1)), 'user', 'wish');
  }
  if (/\b(in\s+pension|rentner|ruhestand)\b/iu.test(t) && !patch.purpose) {
    patch.purpose = entry('Ruhestand', 'user');
  }
  if (/\b(flach|ebene gegend|nicht\s+bergig)\b/iu.test(t)) {
    patch.extraWishes = entry('flach / Küste', 'user', 'wish');
  } else if (/\b(berge|gebirge|bergig)\b/iu.test(t) && !patch.extraWishes) {
    patch.extraWishes = entry('Berge', 'user', 'wish');
  }

  const softNoRental =
    /\bkein(?:en)?\s+mietwagen|ohne\s+mietwagen|nicht\s+(?:wirklich\s+)?(?:einen?\s+)?mietwagen|mietwagen.{0,20}nicht|brauchen.{0,40}nicht.{0,24}mietwagen|kein(?:en)?\s+(?:auto|wagen)\s+mieten\b/iu.test(
      t,
    );
  if (
    /\b(mietwagen|leihwagen|auto\s*mieten)\b/iu.test(t) &&
    !echoQ &&
    !(partyTalk && !/\b(brauchen|unbedingt|wollen).{0,16}mietwagen\b/iu.test(t) && !softNoRental)
  ) {
    patch.rentalCar = entry(!softNoRental && !/\b(kein(?:en)?|ohne|nicht)\s+mietwagen\b/iu.test(t), 'user');
  }
  if (softNoRental) {
    patch.rentalCar = entry(false, 'user');
  }
  const driver = t.match(/\b([A-ZÄÖÜ][a-zäöüß]{2,12})\s+(?:kann|fährt|faehrt).{0,24}(?:auto|führerschein|fuehrerschein)/iu);
  if (driver) patch.driverName = entry(driver[1]!, 'user');

  const noGo = t.match(/\bauf\s+keinen\s+fall\s+(.{3,70}?)(?:[.!?]|$)/iu);
  if (noGo?.[1]) patch.dealbreaker = entry(noGo[1].trim(), 'user', 'must');
  const lastH = t.match(
    /\b(?:highlight|coolste|schönste|beste).{0,20}(?:war|letzten\s+urlaub)\s*:?\s*(.{3,70}?)(?:[.!?]|$)/iu,
  );
  if (lastH?.[1]) patch.lastHighlight = entry(lastH[1].trim(), 'user', 'wish');
  const wantH = t.match(
    /\b(?:highlight\s+(?:soll|wäre|waere)|unser\s+highlight)\s*:?\s*(.{3,70}?)(?:[.!?]|$)/iu,
  );
  if (wantH?.[1]) patch.highlightWant = entry(wantH[1].trim(), 'user', 'wish');
  // Soft-Wünsche (easy / cool wenn geht) → optional, nicht als langer Gelb-Sticker
  if (!patch.extraWishes) {
    const softHit = /\beasy\b|wenn\s+geht|nice\s+to\s+have|kein\s+muss/iu.test(t);
    const lodgingTalk = /\b(apartment|hotel|ferienhaus|airbnb|unterkunft|wohnung)\b/iu.test(t);
    if (softHit && !lodgingTalk) {
      const short = summarizeWishText(t);
      if (short && short.length <= 40 && !looksLikeGarbageFact(short)) {
        patch.extraWishes = entry(short, 'user', 'optional');
      }
    }
  }
  const partyStyle = detectPartyStyle(t);
  if (partyStyle) {
    const priorBits = (prior?.partyStyle?.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const nextBits = partyStyle.split(',').map((s) => s.trim()).filter(Boolean);
    const merged = [...new Set([...priorBits, ...nextBits])];
    patch.partyStyle = entry(merged.join(', '), 'user', isOptionalTalk(t) ? 'optional' : 'wish');
  }
  const spaStyle = echoQ ? null : detectSpaStyle(t);
  if (spaStyle) patch.spaStyle = entry(spaStyle, 'user', 'wish');
  const kidsStyle = detectKidsStyle(t);
  if (kidsStyle) patch.kidsStyle = entry(kidsStyle, 'user', 'wish');
  const tripShape = detectTripShape(t);
  if (tripShape) patch.tripShape = entry(tripShape, 'user', 'wish');
  detectCruiseSlots(t, patch);

  const whenFlexHit = parseWhenFlexFromText(t);
  if (whenFlexHit) {
    const merged = mergeWhenFlex(prior?.whenFlex?.value || patch.whenFlex?.value, whenFlexHit);
    patch.whenFlex = entry(merged, 'user', 'wish');
    const outEarliest = merged.outbound?.earliestHour;
    if (outEarliest != null && !patch.departAfterHour && !prior?.departAfterHour) {
      patch.departAfterHour = entry(outEarliest, 'user', 'wish');
    }
  }

  const surface = detectSurfacePref(t);
  if (surface) patch.surfacePref = entry(surface, 'user', 'wish');

  const hops = detectHopStops(t);
  if (hops?.length) {
    patch.hopStops = entry(hops, 'user', 'wish');
    if (!patch.tripShape) patch.tripShape = entry('hop', 'inferred', 'wish');
  }

  if (/\b(nur\s+liegen|nur\s+erholen|entspannen\s+liegen)\b/iu.test(t)) {
    patch.spaIntent = entry('lie_down', 'user', 'wish');
  } else if (/\b(wellness\s+aktiv|behandlungen|massage\s+nutzen|sauna\s+richtig)\b/iu.test(t)) {
    patch.spaIntent = entry('active', 'user', 'wish');
  } else if (/\b(beides|spa\s+und\s+strand|liegen\s+und\s+wellness)\b/iu.test(t) && /\bspa|wellness\b/iu.test(t)) {
    patch.spaIntent = entry('mixed', 'user', 'wish');
  }

  const accessTags: string[] = [];
  if (/\brollstuhl|barrierefrei|rollator\b/iu.test(t)) accessTags.push('wheelchair');
  if (/\b(70\+|über\s*70|ueber\s*70|80\+|senior)\b/iu.test(t)) accessTags.push('senior');
  if (/\bkurze\s+wege|wenig\s+laufen|door.?to.?door\b/iu.test(t)) accessTags.push('short_walk');
  if (accessTags.length) patch.accessNeeds = entry(accessTags, 'user', 'must');

  if (/\b(museen?|kirchen?|geschichte|hop.?on|altstadt\s+erkunden)\b/iu.test(t)) {
    const bits = [
      /\bmuseen?\b/iu.test(t) ? 'museen' : null,
      /\bkirchen?\b/iu.test(t) ? 'kirchen' : null,
      /\bgeschichte\b/iu.test(t) ? 'geschichte' : null,
      /\bhop.?on\b/iu.test(t) ? 'hop_on' : null,
    ].filter(Boolean) as string[];
    if (bits.length) patch.cityExplore = entry(bits.join(', '), 'user', 'wish');
  }

  if (/\b(männerwochenende|maennerwochenende|jungswochenende|jungs\s*trip|partywochenende)\b/iu.test(t)) {
    patch.purpose = entry('Männerwochenende', 'user');
  }
  if (/(überraschen|ueberraschen)/iu.test(t) && !patch.purpose) {
    patch.purpose = entry('Überraschung', 'user');
  }
  if (!patch.purpose && /\b(quatschen|abschalten|nur\s+ruhe|runterkommen)\b/iu.test(t)) {
    patch.purpose = entry('Relaxen', 'user', 'wish');
  }
  const spaWanted =
    /\b(spa|wellness|entspannungswochenende|wellnessurlaub)\b/iu.test(t) &&
    !amenityDenied(t, /\b(spa|wellness|sauna|massage)\b/iu) &&
    !echoQ;
  if (spaWanted && !patch.purpose && !partyTalk) {
    patch.purpose = entry('Spa-Wochenende', 'user');
    if (!patch.energy) patch.energy = entry('chill_pool', 'inferred');
  }
  if (/\b(rumreisen|ein\s+bisschen\s+rumreisen|was\s+anderes\s+noch)\b/iu.test(t) && !patch.tripShape) {
    patch.extraWishes = entry(t.slice(0, 80), 'user', 'wish');
  }
  const purposeHit = t.match(
    /\b(?:wir\s+wollen|soll.{0,12}bringen|bock\s+auf|lust\s+auf)\s+(.{8,80}?)(?:[.!?]|$)/iu,
  );
  if (purposeHit?.[1] && !/\b(hotel|flug)\b/iu.test(purposeHit[1]) && !patch.purpose) {
    const raw = purposeHit[1].trim();
    const short = raw.split(/,/)[0]!.trim().slice(0, 40);
    if (
      short &&
      (looksLikeTripTypePurpose(short) || looksLikeTripTypePurpose(raw) ||
        (!looksLikeWishDumpPurpose(short) && short.length <= 36 && !/\b(pool|bier|apartment)\b/iu.test(short)))
    ) {
      patch.purpose = entry(short, 'user');
    }
  }

  // Schon gebucht / nur Flug / nur Hotel (Akt-1 Research-Plan)
  if (
    /\b(hotel|unterkunft|apartment|ferienwohnung|ferienhaus).{0,40}(schon|bereits)\s+(gebucht|gebucht haben|haben)\b/iu.test(t)
    || /\b(schon|bereits)\s+(ein\s+)?(hotel|unterkunft|apartment).{0,24}(gebucht|reserviert)\b/iu.test(t)
    || /\b(hotel|unterkunft)\s+(haben\s+wir|hab\s+ich)\s+schon\b/iu.test(t)
    || /\b(hotel\s+habe?\s+ich\s+schon|unterkunft\s+habe?\s+ich\s+schon|schon\s+(?:ein\s+)?hotel)\b/iu.test(t)
    || /\b(hotel|unterkunft).{0,24}\b(steht|stehen|passt|klar|durch)\b/iu.test(t)
  ) {
    patch.bookedStay = entry(true, 'user', 'must');
  }
  if (
    /\b(flug|flüge|fluege|tickets?|flieger).{0,40}(schon|bereits)\s+(gebucht|haben)\b/iu.test(t)
    || /\b(schon|bereits)\s+(ein\s+)?(flug|ticket|flieger).{0,24}(gebucht|gebucht haben)\b/iu.test(t)
    || /\b(flug|flieger)\s+(haben\s+wir|hab\s+ich)\s+schon\b/iu.test(t)
    || /\b(flieger|flugtickets?)\s+(hab\s+ich|haben\s+wir|habe)\b/iu.test(t)
    || /\b(flug|flüge|fluege).{0,24}\b(steht|stehen|passt|klar|durch)\b/iu.test(t)
    || /\bflug\s+und\s+hotel\s+(steht|stehen|sind\s+da|haben\s+wir)\b/iu.test(t)
  ) {
    patch.bookedFlight = entry(true, 'user', 'must');
    if (/\bflug\s+und\s+hotel\b/iu.test(t)) {
      patch.bookedStay = entry(true, 'user', 'must');
    }
  }
  if (/\b(transfer|shuttle|taxi).{0,30}(schon|bereits)\s+(gebucht|reserviert)\b/iu.test(t)) {
    patch.bookedTransfer = entry(true, 'user', 'must');
  }
  // Transfer / Shuttle noch brauchen
  if (
    !/\b(kein|keine|keinen|ohne|nicht)\b.{0,24}\b(transfer|shuttle)\b/iu.test(t) &&
    (/\b(transfer|shuttle).{0,28}(brauchen|fehlt|fehlen|noch|suche|raussuchen)\b/iu.test(t) ||
      /\b(brauchen|fehlt|fehlen|noch\s+brauchen|suche).{0,28}(transfer|shuttle)\b/iu.test(t) ||
      /\btransfer\s+brauchen\s+wir\s+auch\s+noch\b/iu.test(t))
  ) {
    patch.bookedTransfer = entry(false, 'user', 'wish');
  }
  // Hotel in <Stadt> … schon gebucht → Ziel + Stay-Have
  {
    const hotelCity = t.match(
      /\b(?:hotel|unterkunft|apartment|ferienwohnung)\s+in\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{2,40})\b.{0,48}(?:schon|bereits|gebucht|haben\s+wir|hab\s+ich)/iu,
    );
    if (hotelCity?.[1] && !patch.destinationHint) {
      const city = hotelCity[1].replace(/[.,!]+$/g, '').trim();
      if (city.length >= 2 && !/^(oktober|november|dezember|juni|juli|august)$/iu.test(city)) {
        patch.destinationHint = entry(city, 'user', 'wish');
      }
    }
    if (hotelCity && !patch.bookedStay) {
      patch.bookedStay = entry(true, 'user', 'must');
    }
  }
  // Seed-Städte: „nach Prag“, „Prag dieses Wochenende“, …
  if (!patch.destinationHint) {
    const seedDest = detectSeedDestination(t);
    if (seedDest) patch.destinationHint = entry(seedDest, 'user', 'wish');
  }
  // Ziel ≠ Abflugstadt aus demselben Satz
  if (patch.destinationHint) {
    const originsNow = detectOriginCities(t);
    if (looksLikeDepartureAirportTalk(t, originsNow)) {
      const d = patch.destinationHint.value.trim().toLowerCase();
      if (
        originsNow.some((c) => c.toLowerCase() === d) ||
        isMultiOriginCity(patch.destinationHint.value)
      ) {
        // Nur streichen wenn Stadt nur als Abflug vorkommt, nicht als „nach X“
        const esc = patch.destinationHint.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const asNach = new RegExp(`\\bnach\\s+${esc}\\b|\\brichtung\\s+${esc}\\b`, 'iu').test(t);
        if (!asNach) {
          delete (patch as { destinationHint?: unknown }).destinationHint;
        }
      }
    }
  }
  // Bahn / Zug schon
  if (
    /\b(bahn|zug|ice|zugticket|bahnticket|sparpreis).{0,40}(schon|bereits)\s+(gebucht|haben|reserviert)\b/iu.test(t)
    || /\b(schon|bereits)\s+(ein\s+)?(bahn|zug|ice).{0,24}(ticket|gebucht|reserviert)\b/iu.test(t)
    || /\b(bahn|zugticket)\s+(haben\s+wir|hab\s+ich)\s+schon\b/iu.test(t)
    || /\bzugticket\s+(hab\s+ich|haben\s+wir|habe)\b/iu.test(t)
  ) {
    patch.bookedRail = entry(true, 'user', 'must');
    if (!patch.mode) patch.mode = entry('train', 'user', 'wish');
  }
  // Fernbus / Flix schon
  if (
    /\b(flix(?:bus)?|fernbus|bus\s*ticket).{0,40}(schon|bereits)\s+(gebucht|haben|reserviert)\b/iu.test(t)
    || /\b(schon|bereits)\s+(ein\s+)?(flix|fernbus).{0,24}(gebucht|ticket)\b/iu.test(t)
    || /\bflix\s+(haben\s+wir|hab\s+ich)\s+schon\b/iu.test(t)
  ) {
    patch.bookedBus = entry(true, 'user', 'must');
    if (!patch.mode) patch.mode = entry('bus', 'user', 'wish');
  }
  // Mietwagen schon gebucht
  if (
    /\b(mietwagen|leihwagen|mietauto|rental\s*car).{0,40}(schon|bereits)\s+(gebucht|haben|reserviert)\b/iu.test(t)
    || /\b(schon|bereits)\s+(ein\s+)?(mietwagen|leihwagen).{0,24}(gebucht|reserviert)\b/iu.test(t)
    || /\bmietwagen\s+(haben\s+wir|hab\s+ich)\s+schon\b/iu.test(t)
  ) {
    patch.bookedCar = entry(true, 'user', 'must');
    patch.rentalCar = entry(true, 'user', 'wish');
    patch.needCar = entry(false, 'user', 'wish');
  }
  // Brauche noch Mietwagen
  if (
    !/\b(kein|keine|keinen|ohne|nicht|nee|nö)\b.{0,40}\bmietwagen\b|\bmietwagen\b.{0,24}\b(nicht|nee|kein|unnötig|unnoetig)\b/iu.test(
      t,
    ) &&
    (/\b(noch\s+)?(brauch(?:e|en)?|suche|fehlt|brauch\s+noch).{0,28}(mietwagen|leihwagen|mietauto)\b/iu.test(t) ||
      /\b(mietwagen|leihwagen).{0,20}(noch|fehlt|brauchen|brauchen\s+wir|w[aä]re?\s+nice|waere\s+nice|waer\s+gut)\b/iu.test(
        t,
      ) ||
      /\bnur\s+(?:noch\s+)?(?:einen?\s+)?mietwagen\b/iu.test(t))
  ) {
    patch.needCar = entry(true, 'user', 'wish');
    patch.rentalCar = entry(true, 'user', 'wish');
    if (patch.bookedCar?.value !== true) patch.bookedCar = entry(false, 'user', 'wish');
  }
  // Schon gebuchte Aktivitäten / Tickets (Konzert, Turnier, Event)
  {
    const actHits: Array<{ name: string; dayHint?: string | null }> = [];
    const actRe =
      /\b((?:konzert|festival|turnier|match|spiel|theater|musical|ausstellung|messe|event)[\wÄÖÜäöüß\s-]{0,40}?)\s+(?:schon|bereits)\s+(?:gebucht|reserviert|angemeldet|tickets?\s+hab)/iu;
    const actRe2 =
      /\b(?:tickets?|karten?|anmeldung)\s+(?:für|zum|zur)\s+([\wÄÖÜäöüß][\wÄÖÜäöüß\s-]{2,40})\s+(?:schon|bereits|hab|habe|haben)\b/iu;
    const actRe3 =
      /\b(?:schon|bereits)\s+(?:tickets?|karten?)\s+(?:für|zum|zur)\s+([\wÄÖÜäöüß][\wÄÖÜäöüß\s-]{2,40})\b/iu;
    const actRe4 =
      /\b((?:konzert|festival|turnier|theater|musical)[\wÄÖÜäöüß-]{0,24}?tickets?)\s+(?:hab|habe|haben|schon|bereits)\b/iu;
    const actRe5 =
      /\b((?:konzert|festival|turnier)[\wÄÖÜäöüß-]{0,20})\s*[- ]?\s*tickets?\s+(?:hab\s+ich|haben\s+wir|schon)\b/iu;
    for (const re of [actRe, actRe2, actRe3, actRe4, actRe5]) {
      const m = t.match(re);
      if (m?.[1]) {
        const name = m[1].trim().replace(/\s+/g, ' ').slice(0, 48);
        if (name && !actHits.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
          actHits.push({ name, dayHint: null });
        }
      }
    }
    if (actHits.length) {
      patch.bookedActivities = entry(actHits.slice(0, 6), 'user', 'must');
    }
  }
  // Fast-Scope / Nur noch Flüge / Flüge raussuchen
  {
    let focusSet: import('./gapInventory').ResearchFocus | null = null;
    try {
      const { detectResearchFocus } = require('./gapInventory') as typeof import('./gapInventory');
      focusSet = detectResearchFocus(t);
    } catch {
      /* soft */
    }
    if (focusSet && focusSet !== 'full') {
      patch.researchFocus = entry(focusSet, 'user', 'wish');
      if (focusSet === 'flight') {
        patch.bookedFlight = entry(false, 'user', 'wish');
        if (!patch.mode) patch.mode = entry('fly', 'user', 'wish');
        // Nur explizit „Hotel schon“ → bookedStay; sonst Focus trägt Semantik (kein silent Hack)
        if (
          /\b(hotel|unterkunft).{0,24}(schon|bereits|habe|hab)\b/iu.test(t) ||
          patch.bookedStay?.value === true
        ) {
          if (!patch.bookedStay) patch.bookedStay = entry(true, 'user', 'must');
        }
      } else if (focusSet === 'stay') {
        patch.bookedStay = entry(false, 'user', 'wish');
        if (
          /\b(flug|flüge).{0,24}(schon|bereits|nicht|kein)\b/iu.test(t) ||
          /\b(mit\s+dem\s+auto|auto\s+hin|kein\s+flug)\b/iu.test(t)
        ) {
          if (!patch.bookedFlight) patch.bookedFlight = entry(true, 'user', 'must');
          if (!patch.mode) patch.mode = entry('drive', 'user', 'wish');
        }
      } else if (focusSet === 'activity') {
        // Stay/Flug nicht erzwingen — nur Activity-Spur
      }
    } else if (
      /\b(nur\s+(?:noch\s+)?(?:den\s+|die\s+)?flug|nur\s+flüge|nur\s+fluege|nur\s+flights?|flüge?\s+raussuchen|flug\s+raussuchen|noch\s+flüge?\s+buchen|flüge?\s+buchen\s+für|muss\s+noch\s+(?:einen\s+)?flug|brauche?\s+nur\s+(?:noch\s+)?(?:einen\s+)?flug)\b/iu.test(
        t,
      ) ||
      /\b(noch\s+)?(brauch(?:e|en)?|suche|fehlt).{0,20}(flug|flüge|fluege)\b/iu.test(t) ||
      /\b(flug|flüge|fluege).{0,16}(fehlt|fehlen)\b/iu.test(t) ||
      /\b(flug|flüge|fluege).{0,16}(noch\s+(?:raus|suchen|buchen|brauchen))\b/iu.test(t) ||
      /\bmuss\s+noch\s+hin(?:flieg|fahren|reisen)?\b/iu.test(t) ||
      /\bnoch\s+hinflieg/iu.test(t) ||
      /\banreise\s+fehlt\b/iu.test(t)
    ) {
      patch.bookedFlight = entry(false, 'user', 'wish');
      patch.researchFocus = entry('flight', 'user', 'wish');
      if (
        /\b(hotel|unterkunft).{0,24}(schon|bereits|habe|hab)\b/iu.test(t) ||
        patch.bookedStay?.value === true ||
        /\b(muss\s+noch\s+hin|hinflieg)/iu.test(t)
      ) {
        if (!patch.bookedStay) patch.bookedStay = entry(true, 'user', 'must');
      }
      if (!patch.mode) patch.mode = entry('fly', 'user', 'wish');
    }
  }
  // Nur Hotel / mit Auto hin, Unterkunft fehlt (wenn Focus noch nicht stay)
  if (
    !patch.researchFocus &&
    (/\b(nur\s+(?:noch\s+)?(?:ein\s+|das\s+)?hotel|nur\s+unterkunft|nur\s+hotels?|hotel\s+raussuchen|brauche?\s+nur\s+(?:noch\s+)?(?:ein\s+)?hotel|nur\s+noch\s+hotel)\b/iu.test(
      t,
    ) ||
      /\b(noch\s+)?(brauch(?:e|en)?|suche|fehlt).{0,20}(hotel|unterkunft)\b/iu.test(t) ||
      (/\b(mit\s+dem\s+auto|auto\s+hin|hinfahren|hin\s+fahren)\b/iu.test(t) &&
        /\b(hotel|unterkunft)\b/iu.test(t) &&
        !/\bflug\b/iu.test(t)))
  ) {
    patch.bookedStay = entry(false, 'user', 'wish');
    patch.researchFocus = entry('stay', 'user', 'wish');
    if (
      /\b(flug|flüge).{0,24}(schon|bereits|nicht|kein)\b/iu.test(t) ||
      /\b(mit\s+dem\s+auto|auto\s+hin|kein\s+flug)\b/iu.test(t) ||
      /\bnur\s+(?:noch\s+)?(?:ein\s+|das\s+)?hotel/iu.test(t)
    ) {
      if (!patch.bookedFlight) patch.bookedFlight = entry(true, 'user', 'must');
      if (!patch.mode) patch.mode = entry('drive', 'user', 'wish');
    }
  }
  // Korrektur: doch Full-Trip
  if (/\b(doch\s+auch\s+(?:hotel|flug)|komplett|beides|full\s*trip|alles\s+dazu)\b/iu.test(t)) {
    patch.researchFocus = entry('full', 'user', 'wish');
  }
  // Inventar-Modus ableiten (explizit oder aus booked/need)
  try {
    const { deriveInventoryMode } = require('./gapInventory') as typeof import('./gapInventory');
    const { EMPTY_LEDGER } = require('./types') as typeof import('./types');
    const mode = deriveInventoryMode({ ...EMPTY_LEDGER, ...prior, ...patch });
    if (mode !== 'full_discover') {
      patch.inventoryMode = entry(mode, 'user', 'wish');
    }
  } catch {
    /* soft */
  }
  if (/\b(taxi|uber|bolt)\b/iu.test(t) && /\b(transfer|flughafen|bahnhof|zum\s+hotel|terminal|fähre|faehre|zwischenstopp|einschiff)\b/iu.test(t)) {
    patch.transferPref = entry('taxi', 'user', 'wish');
  } else if (/\b(öpnv|oepnv|bus|bahn|s-bahn|u-bahn|öffentlich)\b/iu.test(t)
    && /\b(transfer|flughafen|bahnhof|zum\s+hotel|hin\s+zum)\b/iu.test(t)) {
    patch.transferPref = entry('public', 'user', 'wish');
  } else if (/\b(pauschal|all.?inclusive).{0,30}(transfer|shuttle)\b/iu.test(t)
    || /\btransfer.{0,20}(drin|inklusive|pauschal)\b/iu.test(t)) {
    patch.transferPref = entry('package', 'user', 'wish');
  } else if (/\bzu\s+fu[sß]s\b/iu.test(t) && /\b(hotel|unterkunft|transfer)\b/iu.test(t)) {
    patch.transferPref = entry('walk', 'user', 'wish');
  }

  const taxiStop = (() => {
    try {
      const { parseZwischenstoppPlace } = require('./research/accessTransfer') as {
        parseZwischenstoppPlace: (s: string) => string | null;
      };
      return parseZwischenstoppPlace(t);
    } catch {
      return null;
    }
  })();
  if (taxiStop) {
    const phrase =
      taxiStop === 'Zwischenstopp' ? 'Zwischenstopp' : `Zwischenstopp in ${taxiStop}`;
    if (!patch.extraWishes) {
      patch.extraWishes = entry(phrase, 'user', 'wish');
    } else if (!/zwischenstopp/i.test(patch.extraWishes.value)) {
      patch.extraWishes = entry(
        `${patch.extraWishes.value}; ${phrase}`.slice(0, 120),
        'user',
        'wish',
      );
    }
  }
  if (/\ball.?inclusive|alles\s+inklusive\b/iu.test(t) && !patch.meals) {
    patch.meals = entry('all', 'user', isOptionalTalk(t) ? 'optional' : 'wish');
  }

  // Research-Ampel / Calendar / Geo
  if (/\b(mai|juni|juli|august).{0,48}(mai|juni|juli|august)|\bsommer\b.{0,24}(mai|juni|flug|malle|mallorca)/iu.test(t)) {
    const y = new Date().getFullYear();
    patch.dateWindow = entry(`${y}-05..${y}-08`, 'user', 'wish');
  } else if (/\b(nächstes\s+jahr|naechstes\s+jahr)\b/iu.test(t)) {
    patch.dateWindow = entry(String(new Date().getFullYear() + 1), 'user', 'wish');
  } else if (/\b(ganzen?\s+)?(oktober|november|september|juni|juli|august|mai)\b/iu.test(t) && !patch.dateWindow) {
    const m = t.match(/\b(oktober|november|september|juni|juli|august|mai)\b/iu);
    const map: Record<string, string> = {
      mai: '05', juni: '06', juli: '07', august: '08', september: '09', oktober: '10', november: '11',
    };
    const mm = m ? map[m[1]!.toLowerCase()] : null;
    if (mm) patch.dateWindow = entry(`${new Date().getFullYear()}-${mm}`, 'user', 'wish');
  }
  {
    const flex = parseFlexDayMention(t);
    if (flex.both != null) {
      patch.arrivalFlexDays = entry(flex.both, 'user', 'wish');
      patch.departureFlexDays = entry(flex.both, 'user', 'wish');
    }
    if (flex.arrive != null) {
      patch.arrivalFlexDays = entry(flex.arrive, 'user', 'wish');
    }
    if (flex.depart != null) {
      patch.departureFlexDays = entry(flex.depart, 'user', 'wish');
    }
  }
  if (/\b(hochzeit|trauung)\b/iu.test(t) && !patch.purpose) {
    patch.purpose = entry('Hochzeit', 'user', 'must');
  }
  // Hochzeit wo / wann → Ziel + Datum (Timeline-fähig)
  if (/\b(hochzeit|trauung)\b/iu.test(t)) {
    const where = t.match(
      /\b(?:hochzeit|trauung)\s+(?:in|auf|bei)\s+([A-ZÄÖÜ][\wÄÖÜäöüß.'-]{2,}(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß.'-]{1,}){0,2})/u,
    );
    if (where?.[1] && !patch.destinationHint) {
      patch.destinationHint = entry(where[1].trim(), 'user', 'must');
    }
    if (where?.[1] && !patch.highlightWant) {
      patch.highlightWant = entry(`Hochzeit in ${where[1].trim()}`, 'user', 'must');
    } else if (!patch.highlightWant) {
      patch.highlightWant = entry('Hochzeit', 'user', 'must');
    }
    const whenIso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    const whenDe = t.match(
      /\b(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(?:(20\d{2}))?\b/,
    );
    if (whenIso?.[1] && !patch.dateStart) {
      patch.dateStart = entry(whenIso[1], 'user', 'must');
    } else if (whenDe && !patch.dateStart) {
      const y = whenDe[3] || String(new Date().getFullYear());
      const iso = `${y}-${String(whenDe[2]).padStart(2, '0')}-${String(whenDe[1]).padStart(2, '0')}`;
      patch.dateStart = entry(iso, 'user', 'must');
    }
  }
  const near = t.match(
    /\b(?:max(?:imal)?|höchstens|hoechstens|unter|innerhalb)\s*(\d{2,4})\s*m(?:eter)?\s+(?:vom?|von\s+der?|zur?|zum?)\s+(.{2,40}?)(?:[.!?,]|$)/iu,
  );
  if (near?.[1] && near[2]) {
    const meters = Number(near[1]);
    if (meters >= 50 && meters <= 5000) {
      patch.radiusM = entry(meters, 'user', 'must');
      patch.anchorPoi = entry(near[2].trim().replace(/\s+/g, ' ').slice(0, 48), 'user', 'must');
    }
  } else if (/\bmegapark\b/iu.test(t)) {
    patch.anchorPoi = entry('Megapark', 'user', 'wish');
    if (!patch.radiusM) patch.radiusM = entry(500, 'inferred', 'wish');
  }
  if (/\b(bahncard\s*100|bahnkarte\s*100)\b/iu.test(t)) patch.bahncard = entry('100', 'user');
  else if (/\b(bahncard\s*50|bahnkarte\s*50)\b/iu.test(t)) patch.bahncard = entry('50', 'user');
  else if (/\b(bahncard\s*25|bahncard|bahnkarte)\b/iu.test(t)) patch.bahncard = entry('25', 'user');
  else if (/\b(keine\s+bahncard|keine\s+bahnkarte|ohne\s+bahncard|ohne\s+bahnkarte)\b/iu.test(t)) {
    patch.bahncard = entry('none', 'user');
  }
  const ageHits = [...t.matchAll(/\b(\d{1,2})\s*(?:jahre?|jährig|jaehrig)\b/giu)].map((x) => Number(x[1]));
  if (ageHits.length && ageHits.every((a) => a >= 1 && a <= 99)) {
    patch.travelerAges = entry(ageHits.slice(0, 8), 'user');
  }
  if (/\b(kein(?:e)?\s+nachtankunft|nicht\s+(?:nachts|um\s+3)\s+ankommen|nicht\s+um\s+23)\b/iu.test(t)) {
    const prevComfort = patch.flightComfort?.value ?? prior?.flightComfort?.value ?? {};
    patch.flightComfort = entry({ ...prevComfort, noNightArrival: true, maxLayoverHours: 5 }, 'user', 'wish');
  }
  if (
    /\b(?:kein(?:e)?\s+früh(?:e)?(?:r)?(?:flug|start)|keine?\s+frühflüge|kein(?:e)?\s+frueh(?:e)?(?:r)?(?:flug|start)|nicht\s+so\s+früh\s+flieg|nicht\s+(?:um\s+)?(?:4|5|6)\s*uhr\s+(?:los|fliegen|starten|abfliegen)|nicht\s+vor\s+(?:7|8|sieben|acht)\s*uhr|kein\s+5[\s-]?uhr[\s-]?flug)\b/iu.test(
      t,
    )
  ) {
    const prevComfort = patch.flightComfort?.value ?? prior?.flightComfort?.value ?? {};
    patch.flightComfort = entry({ ...prevComfort, noEarlyDepart: true }, 'user', 'wish');
  }
  if (/\b(übernacht(?:en)?\s+im\s+zug|nachtzug|nightjet|interrail|früh\s+los.{0,16}sparen|spät\s+fahren.{0,16}sparen)\b/iu.test(t)) {
    patch.railFlex = entry(/nacht|übernacht|uebernacht|nightjet/iu.test(t) ? 'overnight_ok' : 'early_late_ok', 'user', 'wish');
    if (/\b(nightjet|nachtzug|interrail)\b/iu.test(t) && !patch.mode) {
      patch.mode = entry('train', 'user', 'wish');
    }
  }
  if (/\b(öpnv|oepnv|tageskarte|hvv|mvv)\b/iu.test(t)) patch.localMovePref = entry('oepnv', 'user', 'wish');
  else if (patch.rentalCar?.value) patch.localMovePref = entry('rental', 'user', 'wish');
  if (/\b(preisfehler|schnäppchen|schnaeppchen|deal\s+jagen|unglaublich\s+günstig|super\s+deal|last[\s-]?minute|angebot\s+jagen|günstig(?:er)?\s+als\s+üblich|guenstiger\s+als)\b/iu.test(t)) {
    patch.dealHunt = entry(true, 'user', 'wish');
  } else if (
    !patch.dealHunt &&
    /\b(günstig|guenstig|billig|sparsam|budget|student)\b/iu.test(t)
  ) {
    patch.dealHunt = entry(true, 'inferred', 'wish');
  }
  if (
    /\b(einsam(?:er)?\s+strand|wenig\s+tourist|nicht\s+so\s+touristisch|geheimtipp|geheim\s*tipp|exklusiv|hidden\s*gem|abseits|unbekannt(?:er)?\s+ort|insider)\b/iu.test(
      t,
    )
  ) {
    patch.discoverIntent = entry(
      /\beinsam|geheim|hidden|insider|abseits|unbekannt/iu.test(t)
        ? 'lonely_beach'
        : /\bexklusiv/iu.test(t)
          ? 'exclusive'
          : 'low_tourist',
      'user',
      'wish',
    );
  } else if (/\b(wandern|abenteuer).{0,24}(ruhe|allein|natur|perspektive)\b/iu.test(t)) {
    patch.discoverIntent = entry('adventure_hike', 'user', 'wish');
  }
  const acts: string[] = [...(patch.mustActivities?.value ?? prior?.mustActivities?.value ?? [])];
  const pushAct = (label: string) => {
    if (!acts.some((a) => a.toLowerCase() === label.toLowerCase())) acts.push(label);
  };
  if (/\b(clubs?|disco)\b/iu.test(t)) pushAct('Club');
  if (/\bmuseum\b/iu.test(t)) pushAct('Museum');
  if (/\bmegapark\b/iu.test(t)) pushAct('Megapark');
  if (/\b(konzert|festival|hellfest|open\s*air|live\s*musik|gig)\b/iu.test(t)) {
    const named = t.match(
      /\b(hellfest|oktoberfest|tomorrowland|rock\s*am\s*ring|wacken|coachella|lollapalooza|primavera)\b/iu,
    );
    pushAct(named?.[1] ? String(named[1]) : 'Konzert');
  }
  if (/\b(ticket|tickets|eintritt)\b/iu.test(t) && /\b(museum|konzert|show|ausstellung|tour)\b/iu.test(t)) {
    pushAct('Tickets');
  }
  if (
    /\b(e-?sim|esim|reis[ei]sim|daten\s*sim|mobile\s*daten|handy\s*daten|internet\s*unterwegs)\b/iu.test(t)
  ) {
    patch.needEsim = entry(true, 'user', 'wish');
    pushAct('eSIM');
  }
  if (acts.length) patch.mustActivities = entry(acts.slice(0, 8), 'user', 'wish');

  const intents: string[] = [];
  if (/\b(student|günstig|guenstig|billig|sparsam|wenig\s+geld)\b/iu.test(t) && /\b(weil|deshalb|dafür|budget)\b/iu.test(t)) {
    intents.push('Budget-Druck / sparsam');
  }
  if (patch.bookedStay?.value) intents.push('Unterkunft schon gebucht');
  if (patch.bookedFlight?.value) intents.push('Flug schon gebucht');
  if (patch.bookedRail?.value) intents.push('Bahn schon gebucht');
  if (patch.bookedBus?.value) intents.push('Fernbus schon gebucht');
  if (patch.bookedCar?.value) intents.push('Mietwagen schon gebucht');
  if (patch.needCar?.value) intents.push('Noch Mietwagen');
  if (patch.bookedStay?.value === true && patch.bookedFlight?.value === false) {
    intents.push('Nur Flug suchen');
  }
  if (patch.bookedFlight?.value === true && patch.bookedStay?.value === false) {
    intents.push('Nur Hotel suchen');
  }
  if (patch.researchFocus?.value === 'flight') intents.push('Fast-Scope: nur Flüge');
  if (patch.researchFocus?.value === 'stay') intents.push('Fast-Scope: nur Hotels');
  if (patch.researchFocus?.value === 'activity') intents.push('Fast-Scope: nur Aktivitäten');
  if (patch.inventoryMode?.value === 'gap_fill') intents.push('Lücken füllen');
  for (const a of patch.bookedActivities?.value ?? []) {
    if (a?.name) intents.push(`Aktivität gebucht: ${a.name.slice(0, 24)}`);
  }
  if (patch.dateAnchor?.value === 'presence') {
    intents.push('Must-Da-Sein Fenster');
  }
  if (/\b(hochzeit|trauung)\b/iu.test(t)) {
    intents.push('Event-Hook: Hochzeit');
  }
  if (/\b(hellfest|oktoberfest|tomorrowland|rock\s*am\s*ring|wacken|festival|konzert)\b/iu.test(t)) {
    const m = t.match(
      /\b(hellfest|oktoberfest|tomorrowland|rock\s*am\s*ring|wacken|[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s-]{2,28}\s+festival)\b/iu,
    );
    intents.push(`Event-Hook: ${m?.[1] ? String(m[1]).trim() : 'Konzert/Festival'}`);
    if (!patch.discoverIntent) patch.discoverIntent = entry('event_compare', 'user', 'wish');
  }
  if (/\b(grand\s*slam|tennis|wimbledon|roland\s*garros|us\s*open|australian\s*open|golf)\b/iu.test(t)) {
    const m = t.match(/\b(grand\s*slam|tennis(?:turnier)?|wimbledon|roland\s*garros|us\s*open|australian\s*open|golf(?:reise)?)\b/iu);
    const eventTrip =
      /\b(grand\s*slam|wimbledon|roland\s*garros|us\s*open|australian\s*open|oktoberfest|zum\s+turnier|turnierreise)\b/iu.test(
        t,
      ) ||
      (/\btennis\b/iu.test(t) &&
        /\b(wo\s+(muss|kann)|europa|hingehen|zuschauen|tickets?|finale)\b/iu.test(t));
    if (m && eventTrip) intents.push(`Event-Hook: ${m[1]}`);
    else if (m && /\bgolf(?:reise)?\b/iu.test(m[1] || '') && /\b(turnier|masters|open)\b/iu.test(t)) {
      intents.push(`Event-Hook: ${m[1]}`);
    }
    if (eventTrip && !patch.discoverIntent) {
      patch.discoverIntent = entry('event_compare', 'user', 'wish');
    }
    if (eventTrip && /\b(tennis|grand\s*slam|wimbledon|roland)\b/iu.test(t)) {
      const prevMust = patch.mustHaves?.value ?? prior?.mustHaves?.value ?? [];
      if (!prevMust.includes('tennis')) {
        patch.mustHaves = entry([...prevMust, 'tennis'] as import('./types').MustHaveId[], 'inferred', 'wish');
      }
      const acts = [...(patch.mustActivities?.value ?? prior?.mustActivities?.value ?? [])];
      if (!acts.some((a) => /tennis|slam|turnier/i.test(a))) {
        acts.push(m?.[1] ? String(m[1]) : 'Tennis-Turnier');
        patch.mustActivities = entry(acts.slice(0, 6), 'user', 'wish');
      }
    }
  }
  if (/\b(warm|strand|pool).{0,40}(egal\s+wo|irgendwo|offen)\b/iu.test(t)
    || /\b(irgendwo|egal\s+wo).{0,40}(warm|strand|pool)\b/iu.test(t)) {
    intents.push('Ziel offen — Klima/Vibe entscheidet');
  }
  if (intents.length) {
    patch.intentNotes = entry(intents, 'user', 'wish');
  }

  return patch;
}

/** Freie Antwort auf die zuletzt gestellte Lücke — nicht nur Keyword-Regex. */
export function applyAskedContext(
  text: string,
  askedKey: string | null | undefined,
  patch: Partial<ReiseLedger>,
): Partial<ReiseLedger> {
  if (!askedKey) return patch;
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 1) return patch;

  // Ready/Wrap zuerst — kurze „Ja“ zählen (sonst isShrug/len-Filter frisst sie)
  if (askedKey === 'ready_announce' || askedKey === 'wrap_up') {
    const out = { ...patch };
    const no =
      /\b(nein|nee|nö|noch\s+nicht|warte|ändern|aendern|stopp)\b/iu.test(t) &&
      !/\b(ja|ok|klar|passt|los|suche)\b/iu.test(t);
    if (!no && (/\b(ja|passt|ok|okay|mach|los|erstell|suche|klar|jo|gerne|bitte|ready)\b/iu.test(t) || isShrug(t))) {
      out.recapDone = entry(true, 'user');
    }
    return out;
  }

  if (t.length < 3) return patch;
  if (isShrug(t) && askedKey !== 'rentalCar' && askedKey !== 'mode') {
    const out = { ...patch };
    if (askedKey === 'highlight') out.highlightWant = entry('keine', 'user', 'wish');
    if (askedKey === 'lastTrip') out.lastHighlight = entry('keine', 'user', 'wish');
    if (askedKey === 'dealbreaker') out.dealbreaker = entry('keine', 'user', 'wish');
    if (askedKey === 'extraWishes') out.extraWishes = entry('keine', 'user', 'wish');
    if (askedKey === 'partyStyle' && !out.partyStyle) out.partyStyle = entry('egal', 'user', 'wish');
    if (askedKey === 'spaStyle' && !out.spaStyle) out.spaStyle = entry('kein Spa', 'user', 'wish');
    if (askedKey === 'ideaHook' && !out.ideaHook) out.ideaHook = entry('nein', 'user', 'wish');
    if (askedKey === 'bags') {
      if (!out.cabinBags) out.cabinBags = entry(0, 'user', 'wish');
      if (!out.checkedBags) out.checkedBags = entry(0, 'user', 'wish');
    }
    return out;
  }
  if (/^(ja|nein|nee|nö|ok|okay|klar|genau|passt)\.?$/iu.test(t) && askedKey !== 'rentalCar') {
    return patch;
  }
  const out = { ...patch };
  if (askedKey === 'lastTrip' && !out.lastHighlight && !looksLikeGarbageFact(t)) {
    out.lastHighlight = entry(t.slice(0, 72), 'user', 'wish');
  }
  if (askedKey === 'highlight' && !out.highlightWant && !looksLikeGarbageFact(t)) {
    out.highlightWant = entry(summarizeWishText(t), 'user', isOptionalTalk(t) ? 'optional' : 'wish');
  }
  if (askedKey === 'dealbreaker' && !out.dealbreaker && !looksLikeGarbageFact(t)) {
    // Günstiges Bier / privat feiern ist Soft-Wish, kein No-Go-Dump
    if (wantsCheapDrinks(t) || detectPartyGrain(t) === 'private_house') {
      /* soft slots already in patch */
    } else {
      out.dealbreaker = entry(t.slice(0, 72), 'user', 'must');
    }
  }
  if ((askedKey === 'partyStyle' || askedKey === 'partyGrain') && !out.partyGrain) {
    const g = detectPartyGrain(t);
    if (g) out.partyGrain = entry(g, 'user', 'wish');
    else if (/\begal\b/iu.test(t)) out.partyGrain = entry('egal', 'user', 'wish');
    if (!out.partyStyle) {
      const grain = out.partyGrain?.value ?? g;
      if (grain === 'private_house') out.partyStyle = entry('privat unter euch', 'user', 'wish');
      else if (grain) out.partyStyle = entry(grain, 'user', 'wish');
    }
  }
  if (askedKey === 'purpose' && !out.purpose) {
    if (looksLikeTripTypePurpose(t) && !looksLikeWishDumpPurpose(t)) {
      out.purpose = entry(t.slice(0, 40), 'user');
    } else if (!looksLikeWishDumpPurpose(t) && t.length <= 36 && !/\b(pool|bier|hotel|apartment)\b/iu.test(t)) {
      out.purpose = entry(t.slice(0, 40), 'user');
    }
  }
  if (askedKey === 'ages') {
    if (!out.bahncard && /\b(bahncard|bahnkarte)\b/iu.test(t) && !/\bkeine\b/iu.test(t)) {
      out.bahncard = entry('25', 'user');
    }
    if (!out.bahncard && /\b(keine|ohne|nein|nee)\b/iu.test(t) && /\b(bahncard|bahnkarte)\b/iu.test(t)) {
      out.bahncard = entry('none', 'user');
    }
    if (!out.travelerAges) {
      const nums = [...t.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]));
      const ages = nums.filter((n) => {
        if (n < 2 || n > 90) return false;
        // Bahncard-Stufen nur droppen wenn klar als Karte genannt
        if ((n === 25 || n === 50 || n === 100) && /\b(bahncard|bahnkarte)\b/iu.test(t)) return false;
        return true;
      });
      if (ages.length) out.travelerAges = entry(ages.slice(0, 8), 'user');
    }
  }
  if ((askedKey === 'locationBias' || askedKey === 'geo') && !out.locationBias) {
    const bias = detectBias(t);
    if (bias) out.locationBias = entry(bias, 'user');
    // Freitext trotzdem als Intention — Pin kommt aus boardPins
    else if (!looksLikeGarbageFact(t) && t.length >= 4) {
      const prev = out.intentNotes?.value ?? [];
      const line = `Lage: ${t.slice(0, 48)}`;
      if (!prev.some((x) => /Lage:/i.test(x))) {
        out.intentNotes = entry([...prev, line].slice(-12), 'user', 'wish');
      }
    }
  }
  if (askedKey === 'when' && !out.dateStart && !out.dateFlex && !out.stayDays && !out.dateMonth) {
    if (/\b(egal|flexibel|offen|weiss\s+nicht|weiß\s+nicht|irgendwann|egal\s+welches)\b/iu.test(t)) {
      out.dateFlex = entry('open', 'user');
    }
  }
  if (askedKey === 'budget' && !out.budgetEur) {
    const n = parseEuroAmount(t);
    if (n != null) {
      out.budgetEur = entry(n, 'user');
      out.budgetScope = entry('per_person', 'user');
      out.budgetIncludes = entry('stay_transport', 'inferred');
      if (
        !out.lodgingQuality &&
        !/\b(billig|hostel|sparsam)\b/iu.test(t)
      ) {
        out.lodgingQuality = entry('nicer_base', 'inferred', 'wish');
      }
    }
  }
  if (askedKey === 'budget' && out.budgetEur && !/\bgesamt|zusammen|für\s+alle|fuer\s+alle|für\s+uns\s+beide|fuer\s+uns\s+beide|insgesamt\b/iu.test(t)) {
    out.budgetScope = entry('per_person', 'user');
  }
  if (askedKey === 'mode' && !out.mode) {
    const pref = detectModePref(t);
    if (pref) {
      out.mode = entry(pref.mode, 'user', pref.hardness);
      if (pref.fallback) out.modeFallback = entry(pref.fallback, 'user', 'wish');
    } else if (/\begal\b/iu.test(t) && !/\begal\s+wann\b/iu.test(t)) {
      out.mode = entry('mix', 'user', 'wish');
    }
  }
  if (askedKey === 'lodging' && !out.lodgingKind) {
    const pref = detectLodgingPref(t);
    if (pref) {
      out.lodgingKind = entry(pref.kind, 'user', pref.hardness);
      if (pref.fallback) out.lodgingFallback = entry(pref.fallback, 'user', 'wish');
    } else if (
      /\b(egal|frei|keine\s+ahnung|weiss\s+nicht|weiß\s+nicht)\b/iu.test(t) &&
      !/\b(auto|bahn|zug|flug|fliegen)\b/iu.test(t)
    ) {
      out.lodgingOpen = entry(true, 'user', 'wish');
    }
  }
  if (askedKey === 'origin' && !out.originCity) {
    const hit = t.match(/\b(?:von|ab|aus)?\s*([A-Za-zÄÖÜäöüß\-]{3,24})\b/iu);
    const city = hit?.[1];
    if (
      city &&
      !/^(ja|nein|nee|hier|von|ab|aus|wir|ihr|uns|dem|der|den|davon|dahin)$/iu.test(city) &&
      !isJunkPlaceName(city)
    ) {
      const canon = canonOrigin(city);
      if (canon) out.originCity = entry(canon, 'user');
    }
  }
  if (askedKey === 'directFlight' && out.directFlight == null) {
    const allows =
      /\b(umsteigen|stopp|stopps|zwischenstopp)\b/iu.test(t) &&
      /\b(auch|okay|ok|geht|in\s+ordnung|kann|wäre|waere|ein|zwei|1|2)\b/iu.test(t);
    if (allows) {
      out.directFlight = entry(true, 'user', 'wish');
      const n = /\b(zwei|2)\b/iu.test(t) ? 2 : 1;
      out.maxFlightStops = entry(n, 'user', 'wish');
    } else if (/\b(ja|klar|unbedingt|direkt|bitte|lieber)\b/iu.test(t)) {
      out.directFlight = entry(true, 'user');
      out.maxFlightStops = entry(0, 'user', 'wish');
    } else if (/\b(nein|nee|egal|umsteigen)\b/iu.test(t)) {
      out.directFlight = entry(false, 'user');
    }
  }
  if (askedKey === 'bags' && out.cabinBags == null && out.checkedBags == null) {
    if (
      /\b(kein(?:e[sn]?)?|ohne)\s+(?:hand|aufgabe)?gep[äa]ck\b/iu.test(t) ||
      /\bohne\s+koffer\b/iu.test(t) ||
      /^(kein|ohne|nee|nein)\.?$/iu.test(t)
    ) {
      out.cabinBags = entry(0, 'user');
      out.checkedBags = entry(0, 'user');
    } else if (/\bnur\s+handgep[äa]ck\b/iu.test(t) || /\bnur\s+cabin\b/iu.test(t)) {
      const n = numWord(t.match(/\b(\d{1,2}|ein|eine|zwei|drei|vier)\b/iu)?.[1] ?? '') ?? 1;
      out.cabinBags = entry(n, 'user');
      out.checkedBags = entry(0, 'user');
    } else if (/\bhandgep[äa]ck\b/iu.test(t) || /\baufgabegep[äa]ck\b/iu.test(t) || /\bkoffer\b/iu.test(t)) {
      // Zahlen schon in parseBriefSlots — Fallback 1 Hand wenn nur Wort
      if (!out.cabinBags && /\bhandgep[äa]ck\b/iu.test(t)) out.cabinBags = entry(1, 'user');
      if (!out.checkedBags && (/\baufgabegep[äa]ck\b/iu.test(t) || /\bkoffer\b/iu.test(t))) {
        out.checkedBags = entry(1, 'user');
      }
      if (out.cabinBags && out.checkedBags == null) out.checkedBags = entry(0, 'user');
      if (out.checkedBags && out.cabinBags == null) out.cabinBags = entry(0, 'user');
    }
  }
  if (askedKey === 'driveTime' && !out.maxDriveHours) {
    const n = parseEuroAmount(t) ?? numWord(t);
    if (n && n >= 1 && n <= 16) out.maxDriveHours = entry(n, 'user');
  }
  if (askedKey === 'adults' && !out.adults && !looksLikeDateSpan(t)) {
    const n = numWord(t.match(/\b(\d{1,2}|ein|eine|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\b/iu)?.[1] ?? '');
    if (n && n >= 1 && n <= 16) out.adults = entry(n, 'user');
  }
  if (askedKey === 'partyStyle' && !out.partyStyle) {
    const grain = detectPartyStyle(t);
    if (grain) out.partyStyle = entry(grain, 'user', 'wish');
  }
  if (askedKey === 'dest' && !out.destinationHint) {
    if (looksLikeGroupSizeOnly(t)) {
      // „vier Leute“ bei Dest-Frage → Personen, kein Ziel-Sticker.
      if (!out.adults) {
        const n =
          numWord(
            t.match(
              /\b(\d{1,2}|ein|eine|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\b/iu,
            )?.[1] ?? '',
          ) ??
          (/\bviert\b/iu.test(t) ? 4 : /\bdritt\b/iu.test(t) ? 3 : /\bzweit\b/iu.test(t) ? 2 : null);
        if (n && n >= 1 && n <= 16) out.adults = entry(n, 'user');
      }
    } else if (/\b(egal|irgendwo|offen|keine\s+ahnung|weiss\s+nicht|weiß\s+nicht)\b/iu.test(t)) {
      out.destinationHint = entry('offen', 'user', 'wish');
    } else if (looksLikeDepartureAirportTalk(t, detectOriginCities(t))) {
      // „Hamburg Berlin Bremen“ bei Wohin? → Abflug, kein Ziel
    } else if (!looksLikeGarbageFact(t) && !(detectOriginCities(t).length === 1 && isMultiOriginCity(t.trim()))) {
      out.destinationHint = entry(t.slice(0, 40), 'user', 'wish');
    }
  }
  if (askedKey === 'weather' && !out.weatherWant) {
    if (/\b(warm|sonne|heiß|heiss|süd|sued)\b/iu.test(t)) out.weatherWant = entry('warm', 'user', 'wish');
    else if (/\b(kühl|kuehl|mild|nicht\s+zu\s+heiß)\b/iu.test(t)) out.weatherWant = entry('mild', 'user', 'wish');
    else out.weatherWant = entry('egal', 'user', 'wish');
  }
  if (askedKey === 'spaStyle' && !out.spaStyle) {
    if (amenityDenied(t, /\b(spa|sauna|massage)\b/iu) || /^(nein|nee|nö|kein)/iu.test(t)) {
      out.spaStyle = entry('kein Spa', 'user', 'wish');
    } else {
      const spa = detectSpaStyle(t, true);
      if (spa) out.spaStyle = entry(spa, 'user', 'wish');
      else if (!/\bpool\b/iu.test(t) && !looksLikeGarbageFact(t)) {
        out.spaStyle = entry(t.slice(0, 80), 'user', 'wish');
      }
    }
  }
  if (askedKey === 'kidsStyle' && !out.kidsStyle) {
    out.kidsStyle = entry(detectKidsStyle(t, true) || t.slice(0, 80), 'user', 'wish');
  }
  if (askedKey === 'tripShape' && !out.tripShape) {
    out.tripShape = entry(detectTripShape(t) || 'stay', 'user', 'wish');
  }
  if (
    (askedKey === 'cruiseShipVibe' ||
      askedKey === 'cruiseShipPick' ||
      askedKey === 'cruiseCore' ||
      askedKey === 'cruiseDepth') &&
    !out.cruiseShipName
  ) {
    try {
      const { extractCruiseShipName } = require('./research/cruiseShipFit') as {
        extractCruiseShipName: (s: string) => string | null;
      };
      const ship = extractCruiseShipName(t);
      if (ship) out.cruiseShipName = entry(ship, 'user', 'must');
      else if (
        /\b(?:egal|offen|vorschlagen|kein\s+lieblingsschiff|weiss\s+nicht|weiß\s+nicht)\b/iu.test(t)
      ) {
        out.cruiseShipName = entry('open', 'user', 'wish');
        if (!out.cruiseLinePref) out.cruiseLinePref = entry('open', 'user', 'wish');
      }
    } catch {
      /* soft */
    }
  }
  if (askedKey === 'cruiseShipVibe' || askedKey === 'cruiseShipPick') {
    // Amenities already via detectAmenities; soft dump into extraWishes if empty
    if (
      !out.extraWishes &&
      !out.mustHaves?.value?.length &&
      !out.wishHaves?.value?.length &&
      !looksLikeGarbageFact(t) &&
      !/^(egal|offen|weiss\s+nicht|weiß\s+nicht)\.?$/iu.test(t)
    ) {
      out.extraWishes = entry(t.slice(0, 120), 'user', 'wish');
    }
  }
  if (askedKey === 'ideaHook' && !out.ideaHook) {
    out.ideaHook = entry(
      /^(nein|nee|nö|kein|keine|nichts)\b/iu.test(t) ? 'nein' : t.slice(0, 80),
      'user',
      'wish',
    );
  }
  if (askedKey === 'extraWishes' && !out.extraWishes) {
    const none = /^(nein|nee|nö|keine|nichts)\b/iu.test(t) || looksLikeGarbageFact(t);
    const amenCovered =
      Boolean(out.mustHaves?.value?.length || out.wishHaves?.value?.length || out.niceHaves?.value?.length) &&
      /\b(pool|party|club|bier|strand|spa)\b/iu.test(t);
    if (!none && amenCovered) {
      /* Amenities liegen schon als Stickers — kein zweiter Dump-Sticker */
    } else {
      const parts = splitWishPhrases(none ? '' : t);
      out.extraWishes = entry(
        none ? 'keine' : parts[0] || summarizeWishText(t),
        'user',
        none ? 'wish' : isOptionalTalk(t) ? 'optional' : 'wish',
      );
    }
  }
  if (askedKey === 'bookedBits') {
    if (/\b(flug).{0,20}(schon|gebucht|haben)\b/iu.test(t) || /\bflug\s+(ist\s+)?schon\b/iu.test(t)) {
      out.bookedFlight = entry(true, 'user', 'must');
    } else if (/\b(noch|brauch|suche|fehlt).{0,16}flug\b/iu.test(t) || /\bflug\s+(noch|fehlt)\b/iu.test(t)) {
      out.bookedFlight = entry(false, 'user', 'wish');
    } else if (/\b(bahn|zug|ice)\b/iu.test(t) && !/\b(schon|gebucht)\b/iu.test(t)) {
      out.bookedRail = entry(false, 'user', 'wish');
      out.bookedFlight = entry(false, 'user', 'wish');
      if (!out.mode) out.mode = entry('train', 'user', 'wish');
    } else if (/\b(flix|fernbus)\b/iu.test(t)) {
      out.bookedBus = entry(false, 'user', 'wish');
      if (!out.mode) out.mode = entry('bus', 'user', 'wish');
    } else if (/\b(mietwagen|leihwagen)\b/iu.test(t)) {
      out.needCar = entry(true, 'user', 'wish');
      out.rentalCar = entry(true, 'user', 'wish');
      out.bookedCar = entry(false, 'user', 'wish');
    } else if (/\b(ja|klar|noch)\b/iu.test(t) && !/\b(hotel|unterkunft)\b/iu.test(t)) {
      // „ja“ auf „brauchst du noch Flug?“ → Flug fehlt
      out.bookedFlight = entry(false, 'user', 'wish');
    } else if (/\b(nein|nee|nö|schon\s+durch|haben\s+wir)\b/iu.test(t)) {
      out.bookedFlight = entry(true, 'user', 'must');
    }
    if (/\b(hotel|unterkunft).{0,20}(schon|gebucht)\b/iu.test(t)) {
      out.bookedStay = entry(true, 'user', 'must');
    } else if (/\b(noch|brauch|suche|fehlt).{0,16}(hotel|unterkunft)\b/iu.test(t)) {
      out.bookedStay = entry(false, 'user', 'wish');
    }
  }
  if (askedKey === 'meals' && !out.meals) {
    const deniesHalf =
      /\bkein(?:e|en|em)?\b.{0,56}\bhalbpension\b|\bhalbpension\b.{0,24}\b(nicht|nee|kein)\b/iu.test(t);
    if (/\ball\s*-?\s*inclusive|allinclusive|alles\s+inklusive\b/iu.test(t)) {
      const softAi =
        isOptionalTalk(t) ||
        /\bam\s+(?:geilsten|liebsten)\b|\bwunschdenken|optimalfall|wahrscheinlich.{0,24}teuer|wenn.{0,28}budget\b/iu.test(
          t,
        );
      out.meals = entry('all', 'user', softAi ? 'optional' : 'wish');
    } else if (/\bhalbpension\b/iu.test(t) && !deniesHalf) {
      out.meals = entry('half', 'user', 'must');
    } else if (/\bfrühstück|fruehstueck\b/iu.test(t)) out.meals = entry('breakfast', 'user', 'must');
    else if (/\b(selbst|eigene\s+küche|eigene\s+kueche|kochen|einkaufen)\b/iu.test(t)) {
      out.meals = entry('self', 'user', 'wish');
    } else if (/\b(egal|keine\s+ahnung|weiss\s+nicht|weiß\s+nicht|offen)\b/iu.test(t)) {
      out.meals = entry('self', 'user', 'optional');
    }
  }
  if (askedKey === 'transfer' && !out.transferPref) {
    if (/\b(taxi|uber|bolt)\b/iu.test(t)) out.transferPref = entry('taxi', 'user', 'wish');
    else if (/\b(öpnv|oepnv|bus|bahn|öffentlich)\b/iu.test(t)) out.transferPref = entry('public', 'user', 'wish');
    else if (/\b(pauschal|inklusive|shuttle)\b/iu.test(t)) out.transferPref = entry('package', 'user', 'wish');
    else if (/\bmietwagen\b/iu.test(t)) out.transferPref = entry('rental', 'user', 'wish');
    else if (/\b(egal|keine\s+ahnung|weiss\s+nicht|weiß\s+nicht)\b/iu.test(t)) {
      out.transferPref = entry('unsure', 'user', 'wish');
    }
  }
  if (askedKey === 'rentalCar' && out.rentalCar == null) {
    if (/\b(ja|klar|gerne|schon|unbedingt)\b/iu.test(t)) out.rentalCar = entry(true, 'user');
    if (/\b(nein|nee|nö|ohne|nicht|egal|ahnung)\b/iu.test(t)) out.rentalCar = entry(false, 'user');
  }
  return out;
}

export function applyLedgerCorrections(text: string, ledger: ReiseLedger): ReiseLedger {
  let next = { ...ledger };
  // Pseudo-Orte nie im Brief behalten (STT „davon“ ≠ Stadt) — auch ohne neuen Text
  if (next.originCity?.value && isJunkPlaceName(next.originCity.value)) {
    next.originCity = null;
  }
  if (next.originCities?.value?.length) {
    const cleaned = next.originCities.value.filter((c) => !isJunkPlaceName(c));
    next.originCities = cleaned.length
      ? { ...next.originCities, value: cleaned }
      : null;
  }
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return next;
  const originFix = t.match(
    /\b(?:nicht|nee)\s+(?:ab\s+)?([A-Za-zÄÖÜäöüß\-]{3,24})\b.{0,48}?\b(?:sondern|sondern\s+ab)\s+([A-Za-zÄÖÜäöüß\-]{3,24})/iu,
  );
  if (originFix?.[2]) {
    const city = canonOrigin(originFix[2]);
    if (city) next.originCity = entry(city, 'user');
  }
  if (next.partyStyle && looksLikeGarbageFact(next.partyStyle.value)) {
    next.partyStyle = null;
  }
  if (
    /\begal\s+wann\s+(?:wir\s+)?(?:wieder|zurück|zurueck|heim)/iu.test(t) &&
    next.mode?.value === 'mix' &&
    !/\b(auto|bahn|zug|flug|fliegen)\b/iu.test(t)
  ) {
    next.mode = null;
  }
  if (
    /\b(kein(?:en)?\s+flieger|nicht\s+fliegen|möchte.{0,16}nicht\s+fliegen|will.{0,16}nicht\s+fliegen|kein(?:en)?\s+flug)\b/iu.test(
      t,
    )
  ) {
    if (next.mode?.value === 'fly') {
      const fb = next.modeFallback?.value;
      if (fb === 'train' || fb === 'drive') {
        next.mode = entry(fb, 'user', 'wish');
        next.modeFallback = fb === 'train' ? entry('drive', 'user', 'wish') : entry('train', 'user', 'wish');
      } else {
        next.mode = entry('mix', 'user', 'wish');
      }
    } else if (next.mode?.value === 'mix') {
      next.mode = { ...next.mode, hardness: 'wish' };
      if (next.modeFallback?.value === 'fly') next.modeFallback = null;
    }
  }
  const drop = (arr: ReiseLedger['mustHaves'], ids: MustHaveId[]) => {
    if (!arr) return arr;
    const nextIds = arr.value.filter((id) => !ids.includes(id));
    return nextIds.length ? { ...arr, value: nextIds } : null;
  };
  const spaIds: MustHaveId[] = ['spa', 'sauna', 'massage'];
  const denied = detectAmenities(t).denied;
  if (denied.length) {
    next.mustHaves = drop(next.mustHaves, denied);
    next.wishHaves = drop(next.wishHaves, denied);
    const nos = [...new Set([...(next.hardNos?.value ?? []), ...denied])];
    next.hardNos = entry(nos, 'user', 'must');
  }
  if (next.spaStyle?.value && /massage|sauna/i.test(next.spaStyle.value) && denied.some((id) => id === 'sauna' || id === 'massage' || id === 'spa')) {
    next.spaStyle = entry('kein Spa', 'user', 'wish');
  }
  if (
    /party|feier|männerwochenende|maennerwochenende/i.test(t) &&
    next.purpose?.value &&
    /spa/i.test(next.purpose.value)
  ) {
    next.purpose = entry('Männerwochenende', 'user');
  }
  const partyNow = /party|männer|maenner|jungs/i.test(next.purpose?.value ?? '');
  const cityNow = /städt|staedt|city|party|männer|maenner|jungs/i.test(next.purpose?.value ?? '');
  const wantsSpaNow =
    /\b(spa|wellness|massage|sauna)\b/iu.test(t) && !amenityDenied(t, /\b(spa|wellness|sauna|massage)\b/iu);
  if (partyNow && !wantsSpaNow) {
    next.mustHaves = drop(next.mustHaves, spaIds);
    next.wishHaves = drop(next.wishHaves, spaIds);
    if (next.spaStyle && /massage|sauna|spa/i.test(next.spaStyle.value) && next.spaStyle.value !== 'kein Spa') {
      next.spaStyle = entry('kein Spa', 'user', 'wish');
    }
    if (next.purpose?.value && /spa/i.test(next.purpose.value)) {
      next.purpose = entry('Männerwochenende', 'user');
    }
  }
  if (denied.includes('camping') && next.mode?.value === 'camping') {
    next.mode = entry('mix', 'user', 'wish');
  }
  if (
    denied.includes('rental_car') ||
    /\bkein(?:en)?\s+mietwagen|ohne\s+mietwagen|nicht\s+(?:wirklich\s+)?(?:einen?\s+)?mietwagen|mietwagen.{0,20}nicht|brauchen.{0,40}nicht.{0,24}mietwagen\b/iu.test(
      t,
    )
  ) {
    next.rentalCar = entry(false, 'user');
    next.mustHaves = drop(next.mustHaves, ['rental_car']);
    next.wishHaves = drop(next.wishHaves, ['rental_car']);
  }
  if (
    amenityDenied(t, /\bhostel\b/iu) ||
    /\bhostel\b.{0,24}\b(nicht|nee|kein)\b/iu.test(t) ||
    /\b(nicht|kein|keine|nie|ohne)\b.{0,16}\bhostel\b/iu.test(t)
  ) {
    if (next.lodgingKind?.value === 'hostel') {
      const fb = next.lodgingFallback?.value;
      next.lodgingKind = fb && fb !== 'hostel' ? entry(fb, 'user', 'wish') : null;
      if (fb === 'hostel') next.lodgingFallback = null;
    }
  }
  if (cityNow && next.rentalCar?.value && !/\bmietwagen\b/iu.test(t)) {
    next.rentalCar = entry(false, 'user');
    next.mustHaves = drop(next.mustHaves, ['rental_car']);
    next.wishHaves = drop(next.wishHaves, ['rental_car']);
  }
  return next;
}
