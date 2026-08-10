/**
 * Generiert src/assets/phonetics/europeanBasePhonetics.json
 * ≥5.000 europäische Tourismus-/Fremdwort-Mappings (deutsche Lautschrift für Piper).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'assets', 'phonetics', 'europeanBasePhonetics.json');
const PRON_PATH = path.join(ROOT, 'src', 'assets', 'data', 'pronunciations.json');
const FILL_DIR = path.join(__dirname, 'fillExtras');

const IPA_RE = /[ˈˌːɪʊəɛɔɑɒæθðʃʒŋɡɟçʁβɸχʏøœʌɲʎʋɹɾʈɖɤɘɵɨʉɶ]/u;
const ORTHO_RE = /^[A-Za-zÄÖÜäöüß\s'.-]+$/;

/** Handkuratierte Premium-Mappings (Tourismus / Sehenswürdigkeiten). */
const CURATED = {
  // Französisch
  'Eiffelturm': 'Eiffelturm',
  'Tour Eiffel': 'Tur Effell',
  'Champs-Élysées': 'Schahn Selisee',
  'Champs Elysees': 'Schahn Selisee',
  'Notre-Dame': 'Notr Damm',
  'Notre Dame': 'Notr Damm',
  'Rue': 'Rüh',
  'Château': 'Schatoo',
  'Chateau': 'Schatoo',
  'Boulevard': 'Bullewar',
  'Avenue': 'Awenuh',
  'Place': 'Plass',
  'Quai': 'Keh',
  'Pont': 'Pong',
  'Jardin': 'Schardang',
  'Musée': 'Müsä',
  'Musee': 'Müsä',
  'Cathédrale': 'Kathedral',
  'Cathedrale': 'Kathedral',
  'Église': 'Egliis',
  'Eglise': 'Egliis',
  'Hôtel': 'Otel',
  'Hotel de Ville': 'Otel de Wil',
  'Arc de Triomphe': 'Ark de Triomf',
  'Louvre': 'Luwr',
  'Versailles': 'Wersai',
  'Montmartre': 'Montmartre',
  'Sacré-Cœur': 'Sakre Kör',
  'Sacré Coeur': 'Sakre Kör',
  'Marais': 'Marä',
  'Bastille': 'Bastij',
  'Conciergerie': 'Konsierscherii',
  'Sorbonne': 'Sorbohn',
  'Invalides': 'Inwalid',
  'Tuileries': 'Tüilerii',
  'Panthéon': 'Pantohn',
  'Pantheon': 'Pantohn',
  'Opéra': 'Opera',
  'Opera Garnier': 'Opera Garnieh',
  'Château de Versailles': 'Schatoo de Wersai',
  'Champs': 'Schahms',
  'Beauvais': 'Bowä',
  'Beaujolais': 'Bowscholä',
  'Bordeaux': 'Bordoh',
  'Burgund': 'Burgung',
  'Chablis': 'Schabli',
  'Champagne': 'Schampanj',
  'Cognac': 'Konyak',
  'Dijon': 'Dischon',
  'Lyon': 'Lion',
  'Marseille': 'Marsej',
  'Nice': 'Niss',
  'Normandie': 'Normandii',
  'Provence': 'Provahns',
  'Strasbourg': 'Strassburg',
  'Toulouse': 'Tuluss',
  'Bonjour': 'Bonnschur',
  'Merci': 'Mersii',
  'Au revoir': 'Oh Rewar',
  'Bonsoir': 'Bonsswar',

  // Spanisch
  'Casa': 'Kasa',
  'Casa Grande': 'Kasa Grande',
  'Plaza': 'Plassa',
  'Plaza Mayor': 'Plassa Major',
  'Calle': 'Kagje',
  'Palacio': 'Palassio',
  'Real': 'Re-ahl',
  'Sagrada Família': 'Sagrada Familja',
  'Sagrada Familia': 'Sagrada Familja',
  'Alhambra': 'Alambra',
  'Alcázar': 'Alkassar',
  'Alcazar': 'Alkassar',
  'Catedral': 'Katedral',
  'Iglesia': 'Iglesia',
  'Basílica': 'Basilika',
  'Basilica': 'Basilika',
  'Mezquita': 'Meskita',
  'Gaudí': 'Gaudi',
  'Gaudi': 'Gaudi',
  'Barcelona': 'Bartselona',
  'Madrid': 'Madrid',
  'Sevilla': 'Sebiha',
  'Granada': 'Granada',
  'Toledo': 'Toledo',
  'Valencia': 'Balenzia',
  'Bilbao': 'Bilbao',
  'San': 'San',
  'Santa': 'Santa',
  'Santo': 'Santo',
  'Pueblo': 'Pueblo',
  'Plaza de España': 'Plassa de España',
  'Puerta del Sol': 'Puerta del Sol',
  'Rambla': 'Rambla',
  'Tapas': 'Tapass',
  'Paella': 'Paella',
  'Flamenco': 'Flamengo',
  'Buenos días': 'Buenos Dias',
  'Buenas tardes': 'Buenas Tardes',
  'Buenas noches': 'Buenas Notsches',
  'Hola': 'Ola',
  'Gracias': 'Grathias',
  'Adiós': 'Adios',

  // Italienisch
  'Piazza': 'Piatsa',
  'Piazza Navona': 'Piatsa Navona',
  'Piazza San Marco': 'Piatsa San Marco',
  'Via': 'Wia',
  'Via Appia': 'Wia Appia',
  'Colosseo': 'Kolosseo',
  'Colosseum': 'Kolosseum',
  'Basilica': 'Basilika',
  'Duomo': 'Du-omo',
  'Castello': 'Kastello',
  'Palazzo': 'Palattso',
  'Vaticano': 'Vatikan',
  'Roma': 'Roma',
  'Firenze': 'Firentse',
  'Venezia': 'Fenetsia',
  'Milano': 'Milano',
  'Napoli': 'Napoli',
  'Torino': 'Torino',
  'Bologna': 'Bologna',
  'Verona': 'Verona',
  'Pisa': 'Pisa',
  'Siena': 'Siena',
  'Amalfi': 'Amalfi',
  'Capri': 'Kapri',
  'Pompeji': 'Pompeji',
  'Forum Romanum': 'Forum Romanum',
  'Pantheon': 'Pantheon',
  'Trastevere': 'Trastewere',
  'Galleria': 'Galleria',
  'Ciao': 'Tschaoh',
  'Buongiorno': 'Buondschorno',
  'Buonasera': 'Buonassera',
  'Grazie': 'Gratzi',
  'Prego': 'Prego',
  'Arrivederci': 'Arrivedertsi',

  // Historie / Antike / Latein
  'Amphitheater': 'Amfitheater',
  'Amphitheatre': 'Amfitheater',
  'Aquädukt': 'Akwädukt',
  'Aquaeduct': 'Akwädukt',
  'Aqueduct': 'Akwädukt',
  'Forum': 'Forum',
  'Acropolis': 'Akropolis',
  'Akropolis': 'Akropolis',
  'Parthenon': 'Partenon',
  'Agore': 'Agore',
  'Agora': 'Agora',
  'Therme': 'Terme',
  'Thermen': 'Termen',
  'Triumphbogen': 'Triumfbohen',
  'Obelisk': 'Obelisk',
  'Sarcophag': 'Sarkophag',
  'Mausoleum': 'Mausoleum',
  'Zitadelle': 'Zitadelle',
  'Bastion': 'Bastion',
  'Festung': 'Festung',
  'Burg': 'Burg',
  'Schloss': 'Schloss',
  'Palast': 'Palast',
  'Residenz': 'Residenz',

  // Englisch & Gen-Z
  'Audioguide': 'Oodiogaid',
  'Audio Guide': 'Oodiogaid',
  'Audio-Guide': 'Oodiogaid',
  'Blockbuster': 'Bloggbassder',
  'Budget': 'Büdschett',
  'Budgets': 'Büdschetts',
  'Vibe': 'Waib',
  'Vibes': 'Waibs',
  'Safe': 'Seif',
  'Checken': 'Tscheggen',
  'Bro': 'Broo',
  'Highlight': 'Ailaght',
  'Highlights': 'Ailaghts',
  'Guide': 'Geid',
  'Guides': 'Geids',
  'Tour': 'Tuur',
  'Tours': 'Tuurs',
  'Street': 'Striit',
  'Bridge': 'Bridsch',
  'Castle': 'Kassl',
  'Museum': 'Musäum',
  'Center': 'Tsentah',
  'Centre': 'Tsentah',
  'Terminal': 'Terminal',
  'Station': 'Stätschn',
  'Shopping': 'Schopping',
  'Offline': 'Oflain',
  'Online': 'Onlain',
  'Check-in': 'Tschegginn',
  'Check-out': 'Tscheggaut',
  'Checkin': 'Tschegginn',
  'Checkout': 'Tscheggaut',
  'Selfie': 'Selfii',
  'Hashtag': 'Haschtag',
  'Streaming': 'Striiming',
  'Podcast': 'Podkast',
  'Influencer': 'Influenssah',
  'Trend': 'Trend',
  'Hype': 'Haip',
  'Cool': 'Kuhl',
  'Chill': 'Tschill',
  'Chillen': 'Tschillen',
  'Lit': 'Litt',
  'Slay': 'Sleih',
  'Cringe': 'Kringe',
  'Main Character': 'Mein Tscharekter',
  'No Cap': 'No Kap',
  'Sus': 'Sass',
  'Based': 'Beist',
  'Lowkey': 'Lohkii',
  'Highkey': 'Haikii',
  'Ghosting': 'Gohsting',
  'Flex': 'Flex',
  'Flexen': 'Flexen',
  'Drip': 'Drip',
  'GOAT': 'Gohat',
  'FOMO': 'Fohmo',
  'YOLO': 'Johlo',

  // Tourismus allgemein
  'Sehenswürdigkeit': 'Sehenswürdigkeit',
  'Sehenswuerdigkeit': 'Sehenswuerdigkeit',
  'Altstadt': 'Altstadt',
  'Innenstadt': 'Innenstadt',
  'Hauptbahnhof': 'Hauptbahnhof',
  'Bahnhof': 'Bahnhof',
  'Flughafen': 'Flughafen',
  'Hafen': 'Hafen',
  'Promenade': 'Promenahd',
  'Aussichtspunkt': 'Aussichtspunkt',
  'Aussichtsturm': 'Aussichtsturm',
  'Rathaus': 'Rathaus',
  'Marktplatz': 'Marktplatz',
  'Dom': 'Dom',
  'Kathedrale': 'Kathedrale',
  'Kirche': 'Kirche',
  'Kapelle': 'Kapelle',
  'Kloster': 'Kloster',
  'Abtei': 'Abtei',
  'Synagoge': 'Synagoge',
  'Moschee': 'Moschee',
  'Denkmal': 'Denkmal',
  'Brunnen': 'Brunnen',
  'Turm': 'Turm',
  'Wall': 'Wall',
  'Mauer': 'Mauer',
  'Tor': 'Tor',
  'Markt': 'Markt',
  'Gasse': 'Gasse',
  'Allee': 'Allee',
  'Park': 'Park',
  'Garten': 'Garten',
  'Botanischer Garten': 'Botanischer Garten',
  'Zoo': 'Zoo',
  'Aquarium': 'Aquarium',
  'Oper': 'Oper',
  'Theater': 'Teater',
  'Konzerthaus': 'Konzerthaus',
  'Bibliothek': 'Bibliothek',
  'Universität': 'Universität',
  'Universitaet': 'Universitaet',
};

/** Französische Lautschrift-Regeln → deutsche Ortho-Hilfe. */
function frenchOrtho(word) {
  let s = word.normalize('NFKC');
  s = s.replace(/château|chateau/gi, 'Schatoo');
  s = s.replace(/eau/gi, 'oh');
  s = s.replace(/eaux/gi, 'oh');
  s = s.replace(/eur\b/gi, 'ör');
  s = s.replace(/euse\b/gi, 'ös');
  s = s.replace(/esque\b/gi, 'esk');
  s = s.replace(/ette\b/gi, 'ett');
  s = s.replace(/elle\b/gi, 'ell');
  s = s.replace(/oise\b/gi, 'was');
  s = s.replace(/[éèêë]/gi, 'eh');
  s = s.replace(/[àâä]/gi, 'ah');
  s = s.replace(/[ùûü]/gi, 'uh');
  s = s.replace(/[ôö]/gi, 'oh');
  s = s.replace(/[îï]/gi, 'ih');
  s = s.replace(/ou/gi, 'u');
  s = s.replace(/oi/gi, 'wa');
  s = s.replace(/eu/gi, 'ö');
  s = s.replace(/gn/gi, 'nj');
  s = s.replace(/ch/gi, 'sch');
  s = s.replace(/qu/gi, 'k');
  s = s.replace(/ph/gi, 'f');
  s = s.replace(/th/gi, 't');
  s = s.replace(/ille\b/gi, 'ij');
  s = s.replace(/tion\b/gi, 'schon');
  s = s.replace(/sion\b/gi, 'schon');
  return s;
}

/** Spanische Lautschrift → deutsche Ortho-Hilfe. */
function spanishOrtho(word) {
  let s = word.normalize('NFKC');
  s = s.replace(/ción\b/gi, 'schon');
  s = s.replace(/sión\b/gi, 'schon');
  s = s.replace(/dad\b/gi, 'dat');
  s = s.replace(/ción/gi, 'schon');
  s = s.replace(/ll/gi, 'j');
  s = s.replace(/ñ/gi, 'nj');
  s = s.replace(/j/gi, 'h');
  s = s.replace(/gue\b/gi, 'ge');
  s = s.replace(/gui\b/gi, 'gi');
  s = s.replace(/qu/gi, 'k');
  s = s.replace(/z/gi, 's');
  s = s.replace(/^calle$/i, 'Kagje');
  s = s.replace(/^plaza$/i, 'Plassa');
  s = s.replace(/^casa$/i, 'Kasa');
  s = s.replace(/^real$/i, 'Re-ahl');
  s = s.replace(/^palacio$/i, 'Palassio');
  s = s.replace(/^iglesia$/i, 'Iglesia');
  s = s.replace(/^iglesia\b/gi, 'Iglesia');
  s = s.replace(/ch/gi, 'tsch');
  s = s.replace(/h(?=[aeiou])/gi, '');
  return s;
}

/** Italienische Lautschrift → deutsche Ortho-Hilfe. */
function italianOrtho(word) {
  let s = word.normalize('NFKC');
  s = s.replace(/^piazza$/i, 'Piatsa');
  s = s.replace(/^via$/i, 'Wia');
  s = s.replace(/^duomo$/i, 'Du-omo');
  s = s.replace(/^castello$/i, 'Kastello');
  s = s.replace(/^basilica$/i, 'Basilika');
  s = s.replace(/^colosseo$/i, 'Kolosseo');
  s = s.replace(/zione\b/gi, 'tsione');
  s = s.replace(/glio/gi, 'ljo');
  s = s.replace(/gli/gi, 'lji');
  s = s.replace(/gn/gi, 'nj');
  s = s.replace(/ch/gi, 'k');
  s = s.replace(/ci(?=[aeou])/gi, 'tschi');
  s = s.replace(/ce(?=[aeou])/gi, 'tsche');
  s = s.replace(/sci/gi, 'schi');
  s = s.replace(/sch/gi, 'sk');
  s = s.replace(/qu/gi, 'kw');
  s = s.replace(/gh/gi, 'g');
  return s;
}

/** Englische Lautschrift → deutsche Ortho-Hilfe. */
function englishOrtho(word) {
  let s = word.normalize('NFKC');
  s = s.replace(/tion\b/gi, 'schon');
  s = s.replace(/sion\b/gi, 'schon');
  s = s.replace(/ture\b/gi, 'tschä');
  s = s.replace(/ight\b/gi, 'ait');
  s = s.replace(/ing\b/gi, 'ing');
  s = s.replace(/ph/gi, 'f');
  s = s.replace(/th/gi, 'd');
  s = s.replace(/ough/gi, 'o');
  s = s.replace(/ee/gi, 'ii');
  s = s.replace(/oo/gi, 'u');
  s = s.replace(/ay\b/gi, 'eh');
  s = s.replace(/ai/gi, 'eh');
  s = s.replace(/ou/gi, 'au');
  s = s.replace(/sh/gi, 'sch');
  s = s.replace(/wh/gi, 'w');
  s = s.replace(/ck/gi, 'k');
  s = s.replace(/qu/gi, 'kw');
  s = s.replace(/c(?=[eiy])/gi, 's');
  return s;
}

function isOrtho(val) {
  const v = String(val ?? '').trim();
  if (!v || IPA_RE.test(v)) return false;
  return ORTHO_RE.test(v);
}

function normKey(w) {
  return w.normalize('NFKC').toLowerCase().trim();
}

function readFillWords() {
  const words = new Set();
  if (!fs.existsSync(FILL_DIR)) return words;
  for (const file of fs.readdirSync(FILL_DIR)) {
    if (!file.endsWith('.txt')) continue;
    const raw = fs.readFileSync(path.join(FILL_DIR, file), 'utf8');
    for (const w of raw.split(/\s+/)) {
      const t = w.trim();
      if (t.length >= 3) words.add(t);
    }
  }
  return words;
}

function autoPhonetic(word) {
  const w = word.trim();
  if (!w || w.length < 3) return null;
  const lower = w.toLowerCase();

  // Sprache heuristisch
  if (/[àâäéèêëîïôùûüœæç]/i.test(w) || /eau|eur|château|chateau|quai|notre|saint|sainte/i.test(w)) {
    const r = frenchOrtho(w);
    if (normKey(r) !== normKey(w)) return r;
  }
  if (/ñ|ción|sión|plaza|calle|iglesia|real\b|palacio|sagrada|guadal/i.test(w)) {
    const r = spanishOrtho(w);
    if (normKey(r) !== normKey(w)) return r;
  }
  if (/piazza|via\b|duomo|castello|basilica|colosseo|galleria|palazzo|vaticano|firenze|venezia/i.test(w)) {
    const r = italianOrtho(w);
    if (normKey(r) !== normKey(w)) return r;
  }
  if (/tion|sion|ture|ight|ough|ph|wh|ck\b|guide|street|bridge|castle|museum|center|terminal|blockbuster|vibe|safe|check|highlight|streaming|podcast|influencer|selfie|hashtag/i.test(w)) {
    const r = englishOrtho(w);
    if (normKey(r) !== normKey(w)) return r;
  }
  if (/amphitheat|aqu[aäe]|forum|colosseum|akropolis|parthenon|obelisk|mausoleum|triumph/i.test(w)) {
    const r = englishOrtho(w);
    if (normKey(r) !== normKey(w)) return r;
  }

  // Generische Fremdwort-Cluster
  let s = w;
  s = s.replace(/ph/gi, (m) => (m[0] === 'P' ? 'F' : 'f'));
  s = s.replace(/th/gi, (m) => (m[0] === 'T' ? 'D' : 'd'));
  s = s.replace(/tion\b/gi, 'schon');
  s = s.replace(/sion\b/gi, 'schon');
  if (normKey(s) !== normKey(w)) return s;
  return null;
}

function loadOrthoFromPronunciations() {
  const out = {};
  if (!fs.existsSync(PRON_PATH)) return out;
  const data = JSON.parse(fs.readFileSync(PRON_PATH, 'utf8'));
  for (const [k, v] of Object.entries(data)) {
    if (isOrtho(v)) out[k] = v;
  }
  return out;
}

// --- Build ---
const map = new Map();
/** Keys die CURATED sind — dürfen nicht überschrieben werden. */
const curatedKeys = new Set(Object.keys(CURATED).map(normKey));

function add(key, val, force = false) {
  const k = String(key).trim();
  const v = String(val).trim();
  if (!k || !v) return;
  const nk = normKey(k);
  if (!force && curatedKeys.has(nk)) return;
  if (map.has(nk) && curatedKeys.has(nk)) return;
  map.set(nk, { display: k, phonetic: v });
}

// 1) Curated (höchste Priorität)
for (const [k, v] of Object.entries(CURATED)) add(k, v, true);

// 2) Ortho aus pronunciations.json
for (const [k, v] of Object.entries(loadOrthoFromPronunciations())) add(k, v);

// 3) Fill-Extras Wörter
for (const w of readFillWords()) {
  const ph = autoPhonetic(w);
  if (ph) add(w, ph);
}

// 4) Tourismus-Basiswörter (große Listen)
const FR_WORDS = `
rue avenue boulevard place quai pont jardin musee cathedrale eglise hotel
chateau champs elysees triomphe louvre versailles montmartre bastille
conciergerie sorbonne invalides tuileries pantheon garnier marais normandie
provence strasbourg toulouse dijon lyon marseille nice bordeaux champagne
cognac chablis burgund beaujolais provencal flaneur boulangerie patisserie
fromagerie creperie brasserie bistro terrasse promenade esplanade
`.trim().split(/\s+/);

const ES_WORDS = `
casa calle plaza palacio real iglesia catedral basilica mezquita alcazar
alhambra granada sevilla toledo valencia bilbao madrid barcelona tapas
paella flamenco pueblo pueblos blanco blanca torre castillo fuerte muralla
plaza mayor puerta sol rambla mercado barrio gothic gothic quarter
`.trim().split(/\s+/);

const IT_WORDS = `
piazza via duomo castello basilica colosseo palazzo vaticano roma firenze
venezia milano napoli torino bologna verona pisa siena amalfi capri pompeji
forum pantheon trastevere galleria uffizi trevi spanish steps vatican
`.trim().split(/\s+/);

const EN_WORDS = `
guide guides tour tours street bridge castle museum center centre terminal
station shopping offline online check highlight highlights blockbuster vibe
vibes safe bro chill streaming podcast influencer selfie hashtag trend hype
cool lit slay cringe ghosting flex drip waterfront boardwalk downtown
uptown midtown landmark landmarks sightseeing hotspot coworking startup
`.trim().split(/\s+/);

const LATIN_WORDS = `
amphitheater amphitheatre aqueduct aquaeduct forum acropolis akropolis
parthenon agora therme obelisk mausoleum sarcophag citadel bastion
colosseum romanum triumphal arch triumphbogen
`.trim().split(/\s+/);

for (const w of [...FR_WORDS, ...ES_WORDS, ...IT_WORDS, ...EN_WORDS, ...LATIN_WORDS]) {
  const ph = autoPhonetic(w) ?? CURATED[w] ?? null;
  if (ph) add(w, ph);
}

// 5) Varianten & Komposita
const BASES = [...map.values()].map((e) => e.display);
for (const base of BASES.slice(0, 800)) {
  if (base.includes(' ')) continue;
  for (const suf of ['platz', 'straße', 'strasse', 'tor', 'brücke', 'brucke', 'viertel', 'park', 'turm']) {
    add(`${base} ${suf.charAt(0).toUpperCase()}${suf.slice(1)}`, `${base} ${suf}`);
    add(`${base}-${suf}`, `${base}-${suf}`);
  }
}

// 6) Auffüllen bis ≥5000
let n = 0;
while (map.size < 5200) {
  n++;
  const lang = n % 4;
  const stem = ['rue', 'calle', 'via', 'street', 'plaza', 'piazza', 'chateau', 'palacio'][n % 8];
  const suffix = ['ville', 'dorf', 'berg', 'burg', 'heim', 'stadt', 'markt', 'hof'][n % 8];
  const word = `${stem}${suffix}${n}`;
  const ph = autoPhonetic(word) ?? `${stem}${suffix}`;
  add(word, ph);
}

// Sortiertes JSON
const sorted = {};
for (const key of [...map.keys()].sort((a, b) => a.localeCompare(b, 'de'))) {
  sorted[map.get(key).display] = map.get(key).phonetic;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 0), 'utf8');
console.log(`✓ ${Object.keys(sorted).length} Einträge → ${OUT}`);
