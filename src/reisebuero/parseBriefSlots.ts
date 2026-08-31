/**
 * Instant local slot parser — Board tickt ohne LLM.
 */

import { parseTripStayUtterance } from '../services/trip/parseTripStay';
import { nextWeekdayDateKey, offsetDateKey, todayDateKey } from '../utils/dateKeys';
import type {
  BudgetVibe,
  EnergyKind,
  LocationBias,
  LodgingKind,
  MustHaveId,
  ReiseLedger,
  ReiseMode,
  SlotHardness,
} from './types';
import { entry } from './slotLedger';

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
  const sonstTrain = /\bsonst.{0,16}(bahn|zug)|bahn.{0,20}(auch|okay|ok|geht)/iu.test(t);
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
  if (/\b(ruhig|außerhalb|ausserhalb|abseits|abgeschieden|nicht\s+in\s+der\s+stadt)\b/iu.test(t)) {
    return 'quiet_outskirts';
  }
  if (/\b(zentral|innenstadt|mitte|nah\s+am\s+zentrum)\b/iu.test(t)) {
    return 'cheap_central';
  }
  if (/\b(nah\s+an\s+der\s+aktivität|direkt\s+am\s+(strand|padel|meer)|fußläufig|fusslaeufig|restaurants?\s+in\s+(?:der\s+nähe|gehweite))\b/iu.test(t)) {
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
  return /\b(optional|wenn\s+(?:es\s+)?passt|falls\s+(?:es\s+)?passt|wenn\s+nicht\s+zu\s+(?:teuer|lang)|kein\s+muss|nicht\s+unbedingt|muss\s+(?:aber\s+)?auch\s+nicht|wäre\s+(?:schon\s+)?(?:cool|nice|schön)|waere\s+(?:schon\s+)?(?:cool|nice)|wahrscheinlich.{0,20}teuer|eh\s+zu\s+teuer|wenn\s+es\s+nicht\s+klappt|nicht\s+schlimm)\b/iu.test(
    t,
  );
}

function nightsBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00`);
  const b = Date.parse(`${end}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

function detectBudgetVibe(t: string): BudgetVibe {
  if (/\b(günstig|guenstig|billig|budget|nicht\s+teuer|preiswert|was\s+halt\s+günstig)\b/iu.test(t)) {
    return 'cheap';
  }
  if (/\b(flexibel|mal\s+schauen|kein\s+limit)\b/iu.test(t)) return 'flex';
  if (/\b(ordentlich|vernünftig|nicht\s+das\s+billigste|midrange)\b/iu.test(t)) return 'mid';
  return null;
}

const FAKE_CITIES = /^(machen|wissen|irgendwo|nicht|wollen|einfach|mal|jetzt|gerne|party|urlaub|hin|wohin)$/iu;

function titleCity(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const FIRST_NAME_ORIGIN =
  /^(kristof|christoph|christopher|andreas|michael|thomas|martin|christian|stefan|peter|lars|jan|tim|max|luca|nico|paul|david|daniel|klaus|hans|leon|finn|jonas)$/iu;

function canonOrigin(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s || s.length < 3) return null;
  const low = s.toLowerCase();
  if (/apriesdorf|priesdorf|prisdorf|briesdorf|chrisdorf/.test(low)) return 'Prisdorf';
  if (FIRST_NAME_ORIGIN.test(s)) return null;
  if (/^(uhr|los|hier|da|dort)$/iu.test(s)) return null;
  return titleCity(s);
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
  if (/^(möchte|will|ist|und|immer|ah|äh|aeh)\b/iu.test(s) && s.split(/\s+/).length <= 8) {
    return true;
  }
  if (/möchte und ist immer/iu.test(s)) return true;
  if (/\b(nicht mehr im hotel|dann auc)\b/iu.test(s)) return true;
  if (/\s[a-zäöü]{1,3}$/iu.test(s) && s.split(/\s+/).length <= 8) return true;
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
    /\b(bonus|wäre\s+(?:schon\s+)?(?:cool|nice|schön)|waere|wenn\s+geht|nice\s+to\s+have|kein\s+muss|muss\s+(?:aber\s+)?auch\s+nicht|nicht\s+unbedingt|optional|wenn\s+es\s+klappt|wäre\s+cool)\b/iu.test(
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
    { id: 'pool', re: /\bpool\b/iu },
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
    { id: 'party', re: /\b(party|feiern|club|kneipe|kneipen|männerwochenende|maennerwochenende|jungswochenende)\b/iu },
    { id: 'vegan', re: /\bvegan\b/iu },
    { id: 'grill', re: /\b(grill|grillen|bbq)\b/iu },
    { id: 'boat', re: /\b(boot|bootsausflug|boot\s*mieten)\b/iu },
    { id: 'rental_car', re: /\b(mietwagen|leihwagen|auto\s*mieten)\b/iu },
    { id: 'paddle', re: /\b(paddel(?:n|boot)|kajak|kanu)\b/iu },
    { id: 'warm', re: /\b(warm|sonne|süd|sued)\b/iu },
    { id: 'spa', re: /\b(spa|wellness|entspannungswochenende|wellnessurlaub)\b/iu },
    { id: 'sauna', re: /\bsauna\b/iu },
    { id: 'massage', re: /\bmassagen?\b/iu },
    { id: 'tennis', re: /\btennis\b/iu },
    { id: 'wine', re: /\b(wein|weinfest|winzer)\b/iu },
    { id: 'cruise', re: /\bkreuzfahrt\b/iu },
    { id: 'kids_club', re: /\b(kinderclub|kids\s*club|animation|tui)\b/iu },
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
    if (amenityDenied(t, h.re)) {
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
  patch.dateMonth = entry(`${y}-${mm}`, 'user');
  applyNights(patch, nightsBetween(start, end), 'user');
}

function detectLodgingPref(t: string): {
  kind: NonNullable<LodgingKind>;
  fallback: NonNullable<LodgingKind> | null;
  hardness: SlotHardness;
} | null {
  const hits: NonNullable<LodgingKind>[] = [];
  if (/\b(apartment|ferienwohnung|wohnung)\b/iu.test(t)) hits.push('apartment');
  if (/\bhostel\b/iu.test(t)) hits.push('hostel');
  if (/\bairbnb\b/iu.test(t)) hits.push('airbnb');
  if (/\b(ferienhaus|villa|eigenes\s+haus|ein\s+haus)\b/iu.test(t)) hits.push('ferienhaus');
  if (/\bhotel\b/iu.test(t)) hits.push('hotel');
  if (!hits.length) return null;
  const unique = [...new Set(hits)];
  const hardness =
    unique.length > 1 || isOptionalTalk(t) || !/\b(unbedingt|nur|pflicht)\b/iu.test(t) ? 'wish' : 'must';
  return { kind: unique[0]!, fallback: unique[1] ?? null, hardness };
}

function detectPartyStyle(t: string): string | null {
  const bits: string[] = [];
  if (/\b(club|clubs|disko|techno|house\s*musik|elektronisch)\b/iu.test(t)) bits.push('Clubs');
  if (/\b(live\s*musik|konzert|bands?)\b/iu.test(t)) bits.push('Live-Musik');
  if (/\b(bar|bars|kneipe|kneipen|cocktails?)\b/iu.test(t)) bits.push('Bars');
  if (/\b(tanz|tanzen|disco|discothek)\b/iu.test(t)) bits.push('Tanzen');
  if (/\b(open\s*air|openair|festival)\b/iu.test(t)) bits.push('Open Air');
  if (/\b(mainstream|große\s+clubs|grosse\s+clubs|bekannt)\b/iu.test(t)) bits.push('Mainstream');
  if (/\b(kleiner|klein(e|er)?\s+(clubs?|locations?)|underground)\b/iu.test(t)) bits.push('kleiner');
  if (/\b(hausparty|privat|eigene\s+bude)\b/iu.test(t)) bits.push('Hausparty');
  if (/\b(strandparty|beach\s*party)\b/iu.test(t)) bits.push('Strandparty');
  if (!bits.length) return null;
  return bits.join(', ');
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
  if (/\bkreuzfahrt\b/iu.test(t)) return 'cruise';
  if (/\b(roadtrip|rundreise)\b/iu.test(t)) return 'roadtrip';
  if (/\b(kanutour|kajak|geführte\s+tour|gefuehrte\s+tour)\b/iu.test(t)) return 'tour';
  if (/\b(mehrere\s+st[aä]dte|städte\s*hop|staedte\s*hop|hopping)\b/iu.test(t)) return 'hop';
  if (/\b(ein\s+ort|bleiben|eine\s+basis|ein\s+hotel\s+als\s+basis)\b/iu.test(t)) return 'stay';
  return null;
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
      patch.destinationHint = entry(stay.cityName, 'user');
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
    /^(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|hier|da|dort|uns|dem|der|den|zu|zum|wo|woher)$/iu;
  const originHit = t.match(
    /\b(?:starten\s+(?:von|ab|aus)|abfliegen\s+(?:von|ab)|von|ab|aus)\s+([A-Za-zÄÖÜäöüß\-]{3,24})\b/iu,
  );
  if (originHit?.[1] && !FAKE_CITIES.test(originHit[1]) && !originSkip.test(originHit[1])) {
    const city = canonOrigin(originHit[1]);
    if (city) patch.originCity = entry(city, 'user');
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
        applyNights(patch, span.nights, 'user');
      }
    } else if (/\b(nächstes|naechstes)\s+wochenende\b/iu.test(t)) {
      const span = weekendSpan('next', nowMs);
      if (span) {
        patch.dateStart = entry(span.start, 'user');
        patch.dateEnd = entry(span.end, 'user');
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
    patch.dateFlex = entry('exact', 'user');
    patch.dateStart = entry(offsetDateKey(7, nowMs), 'user');
    if (!patch.stayDays) patch.stayDays = entry(7, 'inferred');
    if (!patch.stayNights) applyNights(patch, 6, 'inferred');
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
  if (!patch.stayNights) {
    const nights = t.match(/\b(\d{1,2}|zwei|drei|vier|fünf|fuenf)\s+n[äa]chte\b/iu);
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
  if (!patch.stayDays) {
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
    const daysHit = t.match(/\b(\d{1,2}|ein|eine|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht)\s+tage\b/iu);
    if (daysHit) {
      const n = numWord(daysHit[1]!);
      if (n && n >= 1 && n <= 21) {
        patch.stayDays = entry(n, 'user');
        if (!patch.stayNights && n > 1) applyNights(patch, n - 1, 'inferred');
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
    if (/\bzu\s+dritt\b/iu.test(t)) {
      patch.adults = entry(2, 'user');
      patch.beds = entry(2, 'inferred');
    }
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
  // Just-Do-It: Hotel/Tickets/Ziel schon im ersten Satz → nicht zuerst „Allein oder zu mehreren?“
  if (
    !patch.adults &&
    (patch.lodgingKind ||
      patch.destinationHint ||
      /\b(hotel|unterkunft|übernacht|uebernacht|tickets?)\b/iu.test(t))
  ) {
    patch.adults = entry(2, 'inferred');
  }

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
  }

  const hours =
    t.match(/\b(?:max(?:imal)?|nicht\s+mehr\s+als|unter)\s*(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|acht|zehn)\s*stunden\b/iu) ||
    t.match(/\b(\d{1,2}|zwei|drei|vier|fünf|fuenf|sechs|acht|zehn)\s*stunden(?:\s+(?:anfahrt|fahrt|fahren|auto))?\b/iu);
  if (hours) {
    const raw = hours[1]!;
    const n = /^\d+$/.test(raw) ? Number(raw) : numWord(raw);
    if (n && n >= 1 && n <= 16) patch.maxDriveHours = entry(n, 'user');
  }
  const departH = t.match(
    /\b(?:ab|erst\s+ab)\s+(\d{1,2})\s*uhr.{0,40}(?:los|fahren|können\s+wir|koennen\s+wir)|(?:los|fahren).{0,24}(?:ab\s+)?(\d{1,2})\s*uhr/iu,
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
  } else if (
    /\b(nicht\s+zu\s+spät(?:\s+ankommen)?|noch\s+(?:was\s+)?in\s+der\s+stadt|noch\s+in\s+die\s+stadt)\b/iu.test(t)
  ) {
    patch.arriveBeforeHour = entry(20, 'user');
  }

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
  if (/\bhalbpension\b/iu.test(t)) patch.meals = entry('half', 'user');
  else if (/\ball\s*-?\s*inclusive|allinclusive\b/iu.test(t)) patch.meals = entry('all', 'user');
  else if (/\bfrühstück|fruehstueck\b/iu.test(t)) patch.meals = entry('breakfast', 'user');
  else if (/\b(selbstverpflegung|eigene\s+küche|eigene\s+kueche)\b/iu.test(t)) patch.meals = entry('self', 'user');
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
  if (amenities.denied.length) patch.hardNos = entry(amenities.denied, 'user', 'must');

  const corridor = detectCorridor(t);
  if (corridor) patch.corridor = entry(corridor, 'user');

  if (/\b(eigene\s+räder|räder\s+haben\s+wir|fahrräder\s+haben)\b/iu.test(t)) {
    patch.ownBikes = entry(true, 'user');
  }
  if (/\b(andere\s+stadt|nicht\s+zurück|open.?jaw|woanders\s+(raus|zurück))\b/iu.test(t)) {
    patch.openJaw = entry(true, 'user');
  }
  if (/\b(direktflug|direkter\s+flug)\b/iu.test(t) && !/\b(umsteigen|kein\s+direkt)\b/iu.test(t)) {
    patch.directFlight = entry(true, 'user');
  } else if (/\bumsteigen\b/iu.test(t) && /\b(auch|okay|ok|geht|in\s+ordnung)\b/iu.test(t)) {
    patch.directFlight = entry(false, 'user', 'wish');
  }
  if (/\b(in\s+pension|rentner|ruhestand)\b/iu.test(t) && !patch.purpose) {
    patch.purpose = entry('Ruhestand', 'user');
  }
  if (/\b(flach|ebene gegend|nicht\s+bergig)\b/iu.test(t)) {
    patch.extraWishes = entry('flach / Küste', 'user', 'wish');
  } else if (/\b(berge|gebirge|bergig)\b/iu.test(t) && !patch.extraWishes) {
    patch.extraWishes = entry('Berge', 'user', 'wish');
  }

  if (
    /\b(mietwagen|leihwagen|auto\s*mieten)\b/iu.test(t) &&
    !echoQ &&
    !(partyTalk && !/\b(brauchen|unbedingt|wollen).{0,16}mietwagen\b/iu.test(t))
  ) {
    patch.rentalCar = entry(!/\b(kein(?:en)?|ohne|nicht)\s+mietwagen\b/iu.test(t), 'user');
  }
  if (/\bkein(?:en)?\s+mietwagen|ohne\s+mietwagen\b/iu.test(t)) {
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
  const partyStyle = detectPartyStyle(t);
  if (partyStyle) patch.partyStyle = entry(partyStyle, 'user', 'wish');
  const spaStyle = echoQ ? null : detectSpaStyle(t);
  if (spaStyle) patch.spaStyle = entry(spaStyle, 'user', 'wish');
  const kidsStyle = detectKidsStyle(t);
  if (kidsStyle) patch.kidsStyle = entry(kidsStyle, 'user', 'wish');
  const tripShape = detectTripShape(t);
  if (tripShape) patch.tripShape = entry(tripShape, 'user', 'wish');
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
    patch.purpose = entry(purposeHit[1].trim(), 'user');
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
  if (t.length < 3) return patch;
  if (isShrug(t) && askedKey !== 'rentalCar' && askedKey !== 'wrap_up' && askedKey !== 'mode') {
    const out = { ...patch };
    if (askedKey === 'highlight') out.highlightWant = entry('keine', 'user', 'wish');
    if (askedKey === 'lastTrip') out.lastHighlight = entry('keine', 'user', 'wish');
    if (askedKey === 'dealbreaker') out.dealbreaker = entry('keine', 'user', 'wish');
    if (askedKey === 'extraWishes') out.extraWishes = entry('keine', 'user', 'wish');
    if (askedKey === 'partyStyle' && !out.partyStyle) out.partyStyle = entry('egal', 'user', 'wish');
    if (askedKey === 'spaStyle' && !out.spaStyle) out.spaStyle = entry('kein Spa', 'user', 'wish');
    if (askedKey === 'ideaHook' && !out.ideaHook) out.ideaHook = entry('nein', 'user', 'wish');
    return out;
  }
  if (/^(ja|nein|nee|nö|ok|okay|klar|genau|passt)\.?$/iu.test(t) && askedKey !== 'rentalCar' && askedKey !== 'wrap_up') {
    return patch;
  }
  const out = { ...patch };
  if (askedKey === 'lastTrip' && !out.lastHighlight && !looksLikeGarbageFact(t)) {
    out.lastHighlight = entry(t.slice(0, 72), 'user', 'wish');
  }
  if (askedKey === 'highlight' && !out.highlightWant && !looksLikeGarbageFact(t)) {
    out.highlightWant = entry(t.slice(0, 72), 'user', 'wish');
  }
  if (askedKey === 'dealbreaker' && !out.dealbreaker && !looksLikeGarbageFact(t)) {
    out.dealbreaker = entry(t.slice(0, 72), 'user', 'must');
  }
  if (askedKey === 'purpose' && !out.purpose) {
    out.purpose = entry(t.slice(0, 80), 'user');
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
      !/^(ja|nein|nee|hier|von|ab|aus|wir|ihr|uns|dem|der|den)$/iu.test(city)
    ) {
      const canon = canonOrigin(city);
      if (canon) out.originCity = entry(canon, 'user');
    }
  }
  if (askedKey === 'directFlight' && out.directFlight == null) {
    if (/\b(ja|klar|unbedingt|direkt|bitte)\b/iu.test(t)) out.directFlight = entry(true, 'user');
    if (/\b(nein|nee|egal|umsteigen)\b/iu.test(t)) out.directFlight = entry(false, 'user');
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
    if (/\b(egal|irgendwo|offen|keine\s+ahnung|weiss\s+nicht|weiß\s+nicht)\b/iu.test(t)) {
      out.destinationHint = entry('offen', 'user', 'wish');
    } else if (!looksLikeGarbageFact(t)) {
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
  if (askedKey === 'ideaHook' && !out.ideaHook) {
    out.ideaHook = entry(
      /^(nein|nee|nö|kein|keine|nichts)\b/iu.test(t) ? 'nein' : t.slice(0, 80),
      'user',
      'wish',
    );
  }
  if (askedKey === 'extraWishes' && !out.extraWishes) {
    out.extraWishes = entry(
      /^(nein|nee|nö|keine|nichts)\b/iu.test(t) || looksLikeGarbageFact(t) ? 'keine' : t.slice(0, 80),
      'user',
      'wish',
    );
  }
  if (askedKey === 'rentalCar' && out.rentalCar == null) {
    if (/\b(ja|klar|gerne|schon|unbedingt)\b/iu.test(t)) out.rentalCar = entry(true, 'user');
    if (/\b(nein|nee|nö|ohne|nicht|egal|ahnung)\b/iu.test(t)) out.rentalCar = entry(false, 'user');
  }
  if (askedKey === 'wrap_up' && (/\b(ja|passt|ok|okay|mach|los|erstell|suche|nein|nee|nichts)\b/iu.test(t) || isShrug(t))) {
    out.recapDone = entry(true, 'user');
  }
  return out;
}

export function applyLedgerCorrections(text: string, ledger: ReiseLedger): ReiseLedger {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return ledger;
  let next = { ...ledger };
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
  if (denied.includes('rental_car') || /\bkein(?:en)?\s+mietwagen|ohne\s+mietwagen|mietwagen.{0,12}nicht\b/iu.test(t)) {
    next.rentalCar = entry(false, 'user');
    next.mustHaves = drop(next.mustHaves, ['rental_car']);
    next.wishHaves = drop(next.wishHaves, ['rental_car']);
  }
  if (cityNow && next.rentalCar?.value && !/\bmietwagen\b/iu.test(t)) {
    next.rentalCar = entry(false, 'user');
    next.mustHaves = drop(next.mustHaves, ['rental_car']);
    next.wishHaves = drop(next.wishHaves, ['rental_car']);
  }
  return next;
}
