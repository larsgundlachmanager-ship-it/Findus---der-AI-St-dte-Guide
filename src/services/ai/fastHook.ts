/**
 * Fast-Hook & Approach-Opener: interaktiv, direkt an den User.
 * Kein „Wegweiser“-Wort, kein Selbstgespräch („Was ist das? Ah…“).
 * Stil: Interesse anstupsen → Ort spürbar machen → sanft einladen.
 */

import type { PoiWithFacts } from '../../db/types';
import type { UserProfile, VoiceId } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  humanizePoiTitleForSpeech,
  resolvePersonalEngagement,
} from './promptBuilder';
import {
  lastVisitedPlace,
  type SessionMemory,
} from './sessionMemory';
import { resolvePersonaEngine } from '../personaEngine';

export type PoiHookKind =
  | 'atm'
  | 'cafe'
  | 'bakery'
  | 'salon'
  | 'florist'
  | 'church'
  | 'museum'
  | 'castle'
  | 'park'
  | 'nature'
  | 'golf'
  | 'water'
  | 'bar'
  | 'market'
  | 'shop'
  | 'fire'
  | 'sports'
  | 'historic'
  | 'station'
  | 'service'
  | 'generic';

const KIND_LABEL_DE: Record<PoiHookKind, string> = {
  atm: 'Geldautomat',
  cafe: 'Café',
  bakery: 'Bäckerei',
  salon: 'Friseur',
  florist: 'Blumenladen',
  church: 'Kirche',
  museum: 'Museum',
  castle: 'Schloss',
  park: 'Park',
  nature: 'Naturspot',
  golf: 'Golfplatz',
  water: 'Wasser',
  bar: 'Bar',
  market: 'Markt',
  shop: 'Laden',
  fire: 'Feuerwehr',
  sports: 'Sportplatz',
  historic: 'Gebäude',
  station: 'Bahnhof',
  service: 'Service',
  generic: 'Ort',
};

/** Wortgrenzen — „barrierefrei“ darf nicht „bar“ matchen. */
const RE_BAR_VENUE = /\b(bar|kneipe|pub|club|disco)\b/i;
const RE_BAKERY = /\b(bäckerei|baeckerei|bäcker|baecker|konditorei|backstube|backhaus)\b/i;
const RE_ATM =
  /\b(geldautomat|bankomat|sb-filiale|sb\s+filiale|sparkasse|volksbank|landessparkasse|\batm\b)\b/i;

type HookBank = Record<PoiHookKind, string[]>;

/**
 * Kontext-Hooks bei Ankunft am Ort — direkt, persönlich, ohne Rubrik.
 */
const BASE_HOOKS: HookBank = {
  atm: [
    'Geldautomat voraus — auf Reisen unterschätzt, bis man ihn braucht.',
    'Bargeld-Backup: genau der praktische Spot, wenn die Karte nicht zieht.',
  ],
  service: [
    'Unscheinbar, aber wichtig — hier liegt ein Service, den du bald brauchst.',
  ],
  cafe: [
    'Schau mal! Vor dir duftet schon das Café — kleine Pause gefällig?',
    'Riechst du das auch schon? Genau vor dir wartet ein Spot, der hungrige Seelen rettet.',
  ],
  bakery: [
    'Na, hungrig? Da vorne duftet’s nach frischem Gebäck…',
    'Riechst du das? Genau vor dir backt jemand noch richtig handwerklich.',
  ],
  salon: [
    'Da vorne ein Friseur — wenn Haare gerade Thema sind, lohnt der Blick auf den Spot.',
  ],
  florist: [
    'Blumen voraus — wenn du einen Anlass hast, ist der Laden greifbar nah.',
  ],
  church: [
    'Schau mal: vor dir steht die Kirche. Pst… Wenn diese alten Mauern sprechen könnten…',
    'Spürst du die Stille? Vor dir liegt ein Ort, der Geschichte flüsternd weitergibt.',
  ],
  museum: [
    'Schau mal! Vor dir liegt das Museum — hinter der Tür steckt mehr Story, als man glaubt.',
    'Bereit für einen kurzen Zeitsprung? Geh einfach drauf zu, ich erzähl dir mehr.',
  ],
  castle: [
    'Schau mal hoch! Vor dir steht das Schloss — ganz schön mächtig, oder?',
    'Pass auf: solche Kuh-liss-en vor dir schreibt man nicht jeden Tag.',
  ],
  park: [
    'Schau mal: vor dir liegt der Park. Tief durchatmen — hier darfst du kurz den Alltag draußen lassen.',
    'Grün und Ruhe vor dir — und mehr Geschichte, als der erste Blick verrät.',
  ],
  nature: [
    'Sag mal — hast du eine Pollenallergie? Hier vor dir blüht’s ordentlich…',
    'Warst du schon mal in einer Baumschule? Schau mal, was hier vor dir wächst.',
  ],
  golf: [
    'Schau mal: vor dir liegen die Greens. Bist du bereit für deinen nächsten Abschlag?',
    'Lass das Handicap zu Hause — wir schauen uns jetzt mal diesen Golfplatz an.',
  ],
  water: [
    'Schau mal: Wasser voraus! Ich hoffe, du hast die Badehose dabei.',
    'Vor dir glitzert das Wasser — spürst du schon die Brise?',
  ],
  bar: [
    'Schau mal: vor dir liegt die Bar. Hier geht abends was — merken wir uns.',
    'Nachtleben-Radar piept. Bereit für den Vibe vor dir?',
  ],
  market: [
    'Schau mal: vor dir brummt der Markt. Hand aufs Herz — riecht nach Trubel, oder?',
    'Markt-Vibes vor dir! Hier läuft der Handel schon seit Generationen.',
  ],
  shop: [
    'Da vorne ein Laden — wenn Shopping gerade passt, kurz checken was drin steckt.',
  ],
  fire: [
    'Siehst du die Feuerwache? Hier hält die Freiwillige Feuerwehr den Laden am Laufen.',
    'Blaulicht-Geschichte voraus — magst du hören, seit wann die hier retten?',
  ],
  sports: [
    'Sportplatz voraus — warst du früher eher Teamkapitän oder Zuschauer auf der Bank?',
    'Hier wird geschwitzt und gefeiert. Kurz vorbeischauen?',
  ],
  historic: [
    'Du stehst jetzt direkt vor einem Ort der Stille — nimm dir kurz einen Moment.',
    'Schau mal genau hin: vor dir liegt ein Stück Dorfgeschichte, das man leicht übersieht.',
    'Pass auf: genau dieser Fleck vor dir steckt voller Geschichte.',
  ],
  station: [
    'Tüt-tüt! Vor dir liegt der Bahnhof — Einsteigen bitte.',
    'Schau mal: der Bahnhof vor dir verbindet das Dorf mit der weiten Welt.',
  ],
  generic: [
    'Schau mal genau hin — was du hier siehst, steckt voller Leben.',
    'Pass auf: was vor dir liegt, ist mehr als der erste Blick verrät. Komm näher, ich bleib bei dir.',
  ],
};

/** Ziel-Typ hinter einem Approach (früher: „Wegweiser“). */
export type WegweiserTargetKind =
  | 'water'
  | 'station'
  | 'church'
  | 'golf'
  | 'park'
  | 'school'
  | 'memorial'
  | 'cafe'
  | 'bakery'
  | 'salon'
  | 'florist'
  | 'shop'
  | 'fire'
  | 'sports'
  | 'community'
  | 'generic';

/**
 * Destinationsname vom Schild: „Bilsbek durch Prisdorf · Wegweiser“ → „Bilsbek“.
 */
export function extractWegweiserDestination(poiName: string): string {
  let n = poiName
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .replace(/\s+Wegweiser\s*$/i, '')
    .trim();
  n = humanizePoiTitleForSpeech(n);
  const durch = n.match(/^(.+?)\s+durch\s+/i);
  if (durch?.[1]) return durch[1].trim();
  const anDer = n.match(/^(.+?)\s+an\s+der\s+/i);
  if (anDer?.[1] && anDer[1].split(/\s+/).length <= 3) {
    return n;
  }
  return n;
}

export function classifyWegweiserTarget(
  poi: PoiWithFacts,
  destName?: string,
): WegweiserTargetKind {
  const dest = destName ?? extractWegweiserDestination(poi.name);
  const blob =
    `${dest} ${poi.name} ${poi.category ?? ''} ${poi.tags_json ?? ''} ${poi.facts.map((f) => f.fact_text).join(' ')} ${poi.teaser_text ?? ''}`.toLowerCase();

  if (
    /(fris[oö]r|friseur|coiffeur|haar|salon|barber|haarschnitt)/i.test(blob)
  ) {
    return 'salon';
  }
  if (/(blume|florist|floristik|blumenladen|strauß|strauss)/i.test(blob)) {
    return 'florist';
  }
  if (RE_ATM.test(blob)) return 'generic';
  if (RE_BAKERY.test(blob)) return 'bakery';
  // Gedenkort vor Wasser — „Bilsbek“ im Ehrenmal-Namen ≠ Badehose
  if (/(ehrenmal|denkmal|mahnmal|gedenken|krieger|gedenkstein)/i.test(blob)) {
    return 'memorial';
  }
  if (
    /(fluss|bach|\w+bek\b|pinnau|see\b|teich|kanal|ufer|auen|wasser|hafen|strand|zufluss)/i.test(
      blob,
    ) &&
    !/(brücke|bruecke|schule|raum|verein|reiter|ehrenmal|denkmal)/i.test(blob)
  ) {
    return 'water';
  }
  if (/(bahnhof|haltepunkt|gleis|güter)/i.test(blob)) return 'station';
  if (/(kirche|kapelle|dom|kloster)/i.test(blob)) return 'church';
  if (/(golf|fairway|green|abschlag)/i.test(blob)) return 'golf';
  if (/(park|garten|wiese|grünanlage)/i.test(blob)) return 'park';
  if (/(schule|grundschule|gymnasium|kindergarten)/i.test(blob)) return 'school';
  if (/(café|cafe|kaffee)/i.test(blob)) return 'cafe';
  if (/(feuerwehr|feuerwache|lösch)/i.test(blob)) return 'fire';
  if (/(sport|tennis|verein|stadion|platz|jagd|revier|feldflur)/i.test(blob))
    return 'sports';
  if (/(gemeindezentrum|rathaus|bürger|amt)/i.test(blob)) return 'community';
  if (
    /(markt|laden|shop|einkauf|center|supermarkt|apotheke|drogerie)/i.test(blob)
  ) {
    return 'shop';
  }
  return 'generic';
}

function shortDest(dest: string): string {
  return dest.split(/\s+/).length > 4
    ? dest.split(/\s+/).slice(0, 3).join(' ')
    : dest;
}

/**
 * Entdeckungs-Substanz aus Teaser/Fakten — warum dieser Spot erlebenswert ist.
 * Leer = kein substanzloses Abstecher-Fluff feuern.
 */
function discoverySnippet(poi: PoiWithFacts): string | null {
  const candidates: string[] = [];
  for (const f of poi.facts ?? []) {
    const t = cleanFactSnippet(f.fact_text ?? '');
    if (t.length >= 24 && t.length <= 180 && !/^user-frage/i.test(t)) {
      candidates.push(t);
    }
  }
  if (poi.teaser_text) {
    const t = cleanFactSnippet(poi.teaser_text);
    if (t.length >= 24) candidates.push(t.slice(0, 180));
  }
  const raw =
    candidates.find(
      (t) =>
        !/abstecher\s+lohnt|reinriechen\s+lohnt|lust auf einen kurzen abstecher|shopping-radar|einkaufs-radar/i.test(
          t,
        ),
    ) ?? null;
  if (!raw) return null;
  return raw.length > 140
    ? `${raw.slice(0, 137).replace(/\s+\S*$/, '')}…`
    : raw;
}

function amenityDiscoveryHooks(
  short: string,
  discovery: string | null,
): string[] {
  if (discovery) {
    return [
      `Da vorne: ${short}. ${discovery}`,
      `Schau mal Richtung ${short} — ${discovery}`,
    ];
  }
  // Ohne Discovery: still — kein Name-Drop / Abstecher-Fluff
  return [];
}

/**
 * Interaktiver Approach-Opener — spricht DEN USER an.
 * VERBOTEN: „Wegweiser“, Selbstgespräch („Was ist das? Ah…“), Meta-Regie.
 */
export function buildWegweiserHook(
  poi: PoiWithFacts,
  profile?: UserProfile | null,
): string {
  const p = profile ?? getCachedUserProfile();
  const dest = extractWegweiserDestination(poi.name);
  const kind = classifyWegweiserTarget(poi, dest);
  const short = shortDest(dest);
  const engine = resolvePersonaEngine(p);
  const prefs = p?.experiencePrefs ?? {};
  const discovery = discoverySnippet(poi);

  // Interessen-Check: wenn User das Thema mag → stärkerer Pitch; wenn no → softer
  const likesChurches = engine.preferences.likesChurches && prefs.kirchen !== 'no';
  const likesHistory = engine.preferences.wantsDatesAndHistory;
  const likesFood =
    prefs.fruehstueck === 'yes' ||
    prefs.kaffee === 'yes' ||
    prefs.abendessen === 'yes' ||
    prefs.streetfood === 'yes';

  const waterHooks = [
    `Hörst du das Rauschen? Das glitzernde Band da vorne — das ist ${short}. Magst du kurz zum Wasser?`,
    `Wasser voraus: siehst du die Wellen? Das ist ${short}. Lust auf eine kurze Brise und die Geschichte dazu?`,
    `Na, bereit für etwas Frisches? Gleich vor dir fließt was — ${short}. Komm näher, ich erzähl dir, warum der Ort tickt.`,
  ];

  const stationHooks = [
    `Siehst du das Gebäude mit den Gleisen? Das ist ${short}. Lust auf ein Stück Bahngeschichte?`,
    `Der lange Bau da vorne mit dem Bahnsteig — ${short} verbindet das Dorf mit der weiten Welt. Kurz reinschnuppern?`,
    `Bahn voraus. Magst du wissen, warum ${short} für den Ort so wichtig war?`,
  ];

  const churchHooks = likesChurches
    ? [
        `Pst… da vorne steht ${short}. Magst du kurz reinschnuppern — solche Orte flüstern richtig?`,
        `Siehst du ${short}? Wenn dich alte Mauern interessieren: hier lohnt ein genauer Blick.`,
      ]
    : [
        `Da vorne liegt ${short}. Kein Muss — aber eine kurze Geschichte wäre drin, falls du Lust hast.`,
        `Kurz über ${short}: ein ruhiger Spot. Willst du vorbeischauen, oder lieber weiter?`,
      ];

  const golfHooks = [
    `Fairway voraus — ${short}. Bist du eher Abschlag-Typ oder eher Zuschauer auf der Terrasse?`,
    `Na, Handicap checken? Da vorne liegen die Greens von ${short}.`,
  ];

  const parkHooks = [
    `Grün voraus: ${short}. Lust auf zwei Minuten Durchatmen?`,
    `Da vorne wird’s ruhiger — ${short}. Magst du kurz rein?`,
  ];

  const schoolHooks = [
    `Da vorne liegt ${short}. Magst du wissen, wie das Dorf hier seine Kinder großgezogen hat?`,
    `Schule voraus — ${short}. Dorfgeschichte steckt da oft mehr drin, als man denkt.`,
  ];

  const memorialHooks = /bilsbek|brücke|bruecke/i.test(`${dest} ${poi.name}`)
    ? [
        `Siehst du die kleine Bilsbekbrücke da vorne? Fahr oder geh mal genau darauf zu — direkt an der Brücke steht nämlich ein ganz stiller Zeuge unserer Dorfgeschichte: ${short}.`,
        `Schau mal Richtung Grünanlage an der Brücke: ${short} wartet dort. Wenn du einen Moment hast, erzähl ich dir, warum der Stein so wichtig ist.`,
      ]
    : [
        `Da vorne steht ${short}. Ein Ort zum kurzen Innehalten — magst du näher rangehen?`,
        `Schau mal: ${short}. Wenn du einen Moment hast, steckt da lokale Erinnerung drin.`,
      ];

  const cafeHooks = likesFood
    ? [
        `Riechst du das schon? Da vorne wartet ${short} — Kaffee für dich?`,
        `Na, kleine Pause? ${short} liegt gleich vor dir.`,
      ]
    : [
        `Da vorne liegt ${short}. Kurzer Kaffee-Stopp — oder lieber nur vorbeischauen?`,
      ];

  const bakeryHooks = [
    `Na, hungrig? Da vorne duftet ${short} nach frischem Gebäck…`,
    `Riechst du das? ${short} — der Duft allein ist schon eine Einladung.`,
  ];

  const salonHooks = amenityDiscoveryHooks(short, discovery);
  const floristHooks = amenityDiscoveryHooks(short, discovery);
  const shopHooks = amenityDiscoveryHooks(short, discovery);

  const fireHooks = [
    `Siehst du die Feuerwache? ${short} — hier halten Freiwillige den Laden am Laufen. Reinhören?`,
    `Blaulicht-Geschichte voraus bei ${short}. Magst du wissen, seit wann die hier retten?`,
  ];

  const sportsHooks = [
    `Schau mal rüber Richtung Feld und Waldrand. Genau da drüben liegt ${short} — und die machen hier deutlich mehr als nur auf dem Hochsitz zu sitzen.`,
    `Sportplatz voraus: ${short}. Warst du eher Kapitän oder Bankdrücker?`,
    `Da vorne liegt ${short}. Kurzer Blick auf den Vereinsgeist?`,
  ];

  const communityHooks = [
    `Da vorne schlägt das Dorfherz: ${short}. Lust auf einen Blick hinter die Kulissen?`,
    `Gemeinde-Treffpunkt voraus — ${short}. Magst du hören, was hier alles unter einem Dach steckt?`,
  ];

  const genericHooks = likesHistory
    ? [
        `Da vorne liegt ${short}. Unscheinbar? Vielleicht. Geschichte? Definitiv. Kurz reinschnuppern?`,
        `Schau mal Richtung ${short} — da steckt mehr Story, als der erste Blick verrät.`,
        `Na, ${short} liegt gleich vor dir. Magst du die kleine Geschichte dazu?`,
      ]
    : [
        `Da vorne: ${short}. Kurzer Stopp mit einer netten Anekdote — interessiert?`,
        `Schau mal, ${short}. Wenn du Lust hast, erzähl ich dir gleich, warum der Spot tickt.`,
        `Hey — ${short} liegt vor dir. Rein oder weiter? Deine Wahl.`,
      ];

  const bank: Record<WegweiserTargetKind, string[]> = {
    water: waterHooks,
    station: stationHooks,
    church: churchHooks,
    golf: golfHooks,
    park: parkHooks,
    school: schoolHooks,
    memorial: memorialHooks,
    cafe: cafeHooks,
    bakery: bakeryHooks,
    salon: salonHooks,
    florist: floristHooks,
    shop: shopHooks,
    fire: fireHooks,
    sports: sportsHooks,
    community: communityHooks,
    generic: genericHooks,
  };

  let pool = bank[kind] ?? genericHooks;
  if (!pool.length) {
    // Salon/Florist/Shop ohne Discovery → still bleiben (kein Abstecher-Fluff)
    if (kind === 'salon' || kind === 'florist' || kind === 'shop') return '';
    pool = genericHooks;
  }
  let line = pick(pool);
  // Tippfehler-Schutz: hängendes Komma aus Template
  line = line.replace(/,\s*$/, '').replace(/\?\s*,/g, '?');

  // Persona-Ton leicht einfärben
  if (engine.persona === 'gen_z' && !/yo|check|vibe/i.test(line) && Math.random() < 0.35) {
    line = line.replace(/\?$/, ' — checkst du?');
  }

  // Absolute Tabus final strippen (falls je reinrutschen)
  line = line
    .replace(/\bWegweiser\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();

  return line;
}

/**
 * Pack-Teaser, die langweilig/meta klingen → durch buildWegweiserHook ersetzen.
 */
export function isBoringApproachTeaser(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (
    /^(Gleich voraus liegt|Von hier aus siehst du schon|Von hier aus bist du nah|Hey — hier in der Nähe|Gleich voraus:)/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/kleine Schätzfrage|gibt’s Geschichte, Alltag/i.test(t)) return true;
  if (/\bWegweiser\b/i.test(t)) return true;
  if (
    /was ist das(\s+eigentlich)?\??\s*(ein\s+\w+\??)?\s*(ah\s+okay|ah\s*—|genau:)/i.test(
      t,
    )
  ) {
    return true;
  }
  // Generisches „Siehst du schon X? Genau da gehen wir hin…“
  if (
    /^Siehst du schon .+\?\s*Genau da gehen wir hin/i.test(t) ||
    /Genau da gehen wir hin\s*[—–-]\s*ich erzähl dir gleich mehr/i.test(t)
  ) {
    return true;
  }
  // Zu dünn / nur Name + Einladung
  if (
    t.length < 90 &&
    /^(siehst du|schau mal|genau da|von hier aus)/i.test(t) &&
    !/(skandal|legende|einzige|besonder|berühm|kurios|familie|seit\s+\d{4})/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /Haupteingang laut Google|geh auf den Eingang von|GPS-Eingang|Maps Pin/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

const VOICE_HOOKS: Partial<Record<VoiceId, Partial<HookBank>>> = {
  daniel: {
    cafe: ['Yo, schon Kaffee-Entzug? Der Spot hier rettet dich.'],
    bakery: ['Bro, Brötchen-Alert. Da duftet’s richtig.'],
    golf: ['Ready für den Abschlag? Die Greens hier haben echten Vibe.'],
    station: ['Tüt-tüt, Einsteigen bitte! Bahnhof-Vibe, wir zoomen rein.'],
    water: ['Badehose checken — jetzt wird’s erfrischend!'],
    nature: [
      'Pollen-Check: Hast du eine Allergie — oder dürfen wir hier tief durchatmen?',
    ],
    generic: ['Yo, neuer Spot — kurz reinzoomen, da steckt Story drin.'],
  },
  varson: {
    cafe: ['Yo, schon Kaffee-Entzug? Der Spot hier rettet dich.'],
    bakery: ['Bro, Brötchen-Alert. Da duftet’s richtig.'],
    golf: ['Ready für den Abschlag? Die Greens hier haben echten Vibe.'],
    station: ['Tüt-tüt, Einsteigen bitte! Bahnhof-Vibe, wir zoomen rein.'],
    water: ['Badehose checken — jetzt wird’s erfrischend!'],
    nature: [
      'Pollen-Check: Hast du eine Allergie — oder dürfen wir hier tief durchatmen?',
    ],
    generic: ['Yo, neuer Spot — kurz reinzoomen, da steckt Story drin.'],
  },
  alina: {
    cafe: ['Welch warmer Duft! Ein Ort für eine kleine Pause.'],
    church: ['Pst... Wenn diese alten Mauern sprechen könnten...'],
    golf: ['Bereit für den nächsten Abschlag auf diesen Greens?'],
    station: ['Tüt-tüt, Einsteigen bitte — der Bahnhof ruft.'],
    water: ['Ich hoffe, die Badehose ist dabei — es wird erfrischend!'],
    generic: ['Pst... Dieser Ort flüstert bereits, wenn man genau hinhört.'],
  },
  lukas: {
    cafe: ['Nahaufnahme: dampfender Kaffee. Die Szene beginnt.'],
    golf: ['Abschlag! Die Greens liegen vor uns wie eine Bühne.'],
    station: ['Tüt-tüt, Einsteigen bitte! Schauplatz Bahnhof — Tempo voraus.'],
    water: ['Wasser voraus — und die Geschichte nimmt Fahrt auf.'],
    generic: ['Vorhang auf: Dieser Spot hat eine Steilvorlage für uns.'],
  },
  sebastian: {
    cafe: ['Moin — Kaffee-Duft voraus. Kurz reinschauen?'],
    golf: ['Abschlag bereit? Die Greens hier haben Charakter.'],
    station: ['Tüt-tüt, Einsteigen bitte — Bahnhof voraus.'],
    water: ['Wasser voraus — Badehose parat?'],
    generic: ['Schau mal — hier steckt eine Geschichte drin.'],
  },
};

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)] ?? list[0];
}

function pickSeeded<T>(list: T[], seed: number): T {
  if (!list.length) return list[0];
  const idx = Math.abs(seed) % list.length;
  return list[idx] ?? list[0];
}

const FAQ_PREFIX_RE =
  /^User-Frage:\s*.+?\s*Antwort:\s*/i;

function cleanFactSnippet(raw: string): string {
  return raw
    .replace(FAQ_PREFIX_RE, '')
    .replace(/^\[(Kurzfakt|Erzählung|Detail|FAQ)[^\]]*\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type HookMaterial = {
  title: string;
  hours: string | null;
  accessible: boolean;
  island: boolean;
  detail: string | null;
};

function extractHookMaterial(
  poi: PoiWithFacts,
  profile?: UserProfile | null,
): HookMaterial {
  const title = humanizePoiTitleForSpeech(poi.name);
  const blob = [
    poi.name,
    poi.teaser_text ?? '',
    poi.facts.map((f) => f.fact_text).join(' '),
  ]
    .filter(Boolean)
    .join(' ');

  const hoursMatch =
    blob.match(
      /(?:täglich|daily)[^.]{0,40}?\d{1,2}[:.]?\d{0,2}\s*[–-]\s*\d{1,2}[:.]?\d{0,2}/i,
    ) ??
    blob.match(/\d{1,2}[:.]?\d{2}\s*[–-]\s*\d{1,2}[:.]?\d{2}/);

  const detail =
    poi.facts
      .map((f) => cleanFactSnippet(f.fact_text))
      .find((t) => t.length >= 18 && t.length <= 130 && !/^user-frage/i.test(t)) ??
    (poi.teaser_text ? cleanFactSnippet(poi.teaser_text) : null);

  const cityBlob = `${profile?.cityName ?? ''} ${blob}`;
  const island =
    /\b(wangerooge|juist|norderney|baltrum|langeoog|sylt|helgoland|insel)\b/i.test(
      cityBlob,
    );

  return {
    title,
    hours: hoursMatch?.[0]?.replace(/\s+/g, ' ').trim() ?? null,
    accessible: /barrierefrei|rollstuhl/i.test(blob),
    island,
    detail: detail && detail.length <= 130 ? detail : null,
  };
}

/**
 * Opener aus Ort + Fakten — kein Franzbrötchen an Geldautomaten, kein Template-Roulette.
 */
function buildFactBasedHook(
  poi: PoiWithFacts,
  kind: PoiHookKind,
  profile?: UserProfile | null,
  sessionMemory?: SessionMemory | null,
): string {
  const m = extractHookMaterial(poi, profile);
  const seed = poi.id * 31 + (sessionMemory?.entries?.length ?? 0) * 17;

  const variants: string[] = [];

  switch (kind) {
    case 'atm':
      if (m.island) {
        variants.push(
          `Auf der Insel zählt Bargeld noch — ${m.title} ist dein Backup, wenn die Karte nicht überall zieht.`,
          `Kleine Buden, Strandbar, Fährticket: ${m.title} rettet dich, wenn’s mit dem Geld eng wird.`,
        );
      }
      if (m.accessible) {
        variants.push(
          `${m.title} — barrierefrei${m.hours ? `, ${m.hours}` : ''}. Praktisch, wenn du noch schnell Geld brauchst.`,
        );
      }
      if (m.hours) {
        variants.push(
          `${m.title}: ${m.hours}. Genau der Spot, wenn du noch Bargeld brauchst.`,
        );
      }
      variants.push(
        `Geldautomat voraus — ${m.title}. Auf Reisen unterschätzt, bis man ihn braucht.`,
        `${m.title}: hier holst du dir Bargeld, ohne die Insel zu verlassen.`,
      );
      break;

    case 'service':
      variants.push(
        m.detail
          ? `${m.title} — ${m.detail}`
          : `${m.title}: genau der praktische Service, den du hier brauchst.`,
        `Unscheinbar, aber wichtig: ${m.title}${m.hours ? ` (${m.hours})` : ''}.`,
      );
      break;

    case 'bakery':
      variants.push(
        `Riechst du das? ${m.title}${m.detail ? ` — ${m.detail}` : ' — frisch gebacken vor dir.'}`,
        `${m.title}${m.detail ? `: ${m.detail}` : ' — hier duftet’s nach Handwerk.'}`,
      );
      break;

    case 'cafe':
      variants.push(
        `${m.title}${m.detail ? ` — ${m.detail}` : ' — kurze Pause? Kaffee lockt.'}`,
        `Kaffee-Radar: ${m.title}. Lust auf einen Stopp?`,
      );
      break;

    case 'station':
      variants.push(
        `Spürst du den Bahnsteig unter den Füßen? Gleich erzähl ich, was hier los war.`,
        `Gleich die Gleise — ich erzähl dir kurz, was an diesem Punkt wichtig war.`,
      );
      break;

    case 'water':
      variants.push(
        `Hörst du das Plätschern? Du stehst direkt am Ufer.`,
        `Spürst du die Feuchtigkeit in der Luft? Genau hier am Wasser lohnt ein Blick.`,
      );
      break;

    case 'church':
    case 'museum':
    case 'castle':
    case 'historic':
      variants.push(
        `Schau genau hin: Mauern und Details, die man leicht übersieht.`,
        `Nimm dir einen kurzen Moment — ich zeig dir, was hier sichtbar ist.`,
      );
      break;

    case 'salon':
    case 'florist':
    case 'shop':
      variants.push(
        m.detail
          ? `${m.title} — ${m.detail}`
          : `${m.title} liegt vor dir.`,
      );
      break;

    case 'bar':
      variants.push(
        `${m.title}${m.detail ? `: ${m.detail}` : ' — abends geht hier was.'}`,
      );
      break;

    default:
      // Kein Titel+Fakt-Vorspann — sinnlich starten; Gemini benennt den Ort
      // VERBOTEN: „steckt mehr drin als der erste Blick“ (Cliché / Doppel-Intro)
      variants.push(
        `Nimm dir einen kurzen Moment — schau dich hier einmal richtig um.`,
        `Schau dich kurz um — ich erzähl dir, was an diesem Fleck wichtig ist.`,
      );
  }

  const hook = pickSeeded(variants.filter(Boolean), seed);
  return hook.replace(/\s+/g, ' ').trim();
}

export function classifyPoiHookKind(poi: PoiWithFacts): PoiHookKind {
  const cat = (poi.category ?? '').toLowerCase();
  const name = poi.name.toLowerCase();
  const blobRaw =
    `${poi.name} ${poi.teaser_text ?? ''} ${poi.facts.map((f) => f.fact_text).join(' ')}`;
  const blob = blobRaw.toLowerCase();
  const blobNoBarrier = blob.replace(/barrierefrei/g, '');

  if (
    /(ehrenmal|kriegerdenkmal|krieger\s*denkmal|gedenkstein|gedenkstätte|gedenkstaette|kriegsopfer|gefallenendenkmal)/i.test(
      name + blob,
    ) ||
    cat === 'denkmal' ||
    (/(denkmal)/i.test(name) && !/(naturdenkmal)/i.test(name))
  ) {
    return 'historic';
  }

  if (RE_ATM.test(name + blob)) return 'atm';
  if (cat === 'service' && !RE_BAKERY.test(name + blob)) return 'service';

  if (/(fris[oö]r|friseur|coiffeur|haar|salon|barber)/i.test(name + blob)) {
    return 'salon';
  }
  if (/(blume|florist|floristik|blumenladen)/i.test(name + blob)) {
    return 'florist';
  }
  if (RE_BAKERY.test(name + blob)) return 'bakery';

  if (
    /(teich|see\b|fluss|bach|hafen|strand|wasser|kanal|pinnau)/i.test(name) &&
    !/(brücke|bruecke|denkmal|ehrenmal|schule|raum|verein|reiter)/i.test(name)
  ) {
    return 'water';
  }
  if (/(bahnhof|haltepunkt|gleis)/i.test(name)) return 'station';
  if (/(golf|fairway)/i.test(name) || cat === 'golf' || cat === 'sport') {
    if (/(golf|fairway|abschlag)/i.test(blob) || /(golf|fairway)/i.test(name)) {
      return 'golf';
    }
  }

  if (/(golfplatz|fairway|abschlag|handicap|\bpar\s*\d)/i.test(blob)) {
    return 'golf';
  }
  if (/(bahnhof|haltepunkt|gleis|railway|train\s*station)/i.test(blob)) {
    return 'station';
  }
  if (
    /(schwimm|strandbad|badesee|baden\b|hafen|elbufer|alsterufer|bootshafen)/i.test(
      blob,
    ) ||
    (/(fluss|see\b|strand|kanal|teich)\b/i.test(name) &&
      !/(denkmal|ehrenmal|brücke|bruecke|schule)/i.test(name))
  ) {
    return 'water';
  }
  if (/(feuerwehr|feuerwache)/i.test(blob)) return 'fire';
  if (/(tennis|sportplatz|vereinsheim|stadion)/i.test(blob)) return 'sports';
  if (
    /(baumschule|pollen|wald|wiese|natur|knick|gärtnerei|gaertnerei|biotop|jagd|feldflur|revier)/i.test(
      blob,
    )
  ) {
    return 'nature';
  }
  if (/(café|cafe|kaffee|rösterei|coffee)/i.test(blob)) return 'cafe';
  if (/(kirche|dom|kapelle|cathedral|kloster|münster|muenster)/i.test(blob))
    return 'church';
  if (/(museum|galerie|ausstellung)/i.test(blob)) return 'museum';
  if (/(schloss|burg|castle|festung)/i.test(blob)) return 'castle';
  if (/(park|garten|garden|grünanlage|brunnen)/i.test(blob)) return 'park';
  if (RE_BAR_VENUE.test(name) || RE_BAR_VENUE.test(blobNoBarrier)) return 'bar';
  if (/(markt|market|wochenmarkt|supermarkt|center)/i.test(blob)) return 'market';
  if (/(laden|shop|apotheke|drogerie|einkauf)/i.test(blob)) return 'shop';
  if (
    /(bahnwärter|bahnwaerter|häuschen|haeuschen|denkmal|historisch|fabrik|mühle|muehle|rathaus|ehrenmal)/i.test(
      blob,
    )
  ) {
    return 'historic';
  }
  return 'generic';
}

function bridgeHook(
  kind: PoiHookKind,
  last: { kind: PoiHookKind; name: string } | null,
): string | null {
  if (!last || last.kind !== kind) return null;
  const label = KIND_LABEL_DE[kind];
  switch (kind) {
    case 'golf':
      return 'Und schon der nächste Abschlag — nächster Grün-Spot voraus.';
    case 'station':
      return 'Tüt-tüt — schon der nächste Bahnhof auf unserer Route.';
    case 'water':
      return 'Wasser voraus: Schon der nächste erfrischende Stopp.';
    case 'church':
      return 'Und schon stehen wir vor der nächsten Kirche.';
    case 'cafe':
      return 'Und wieder ein Kaffee-Spot, direkt nach dem letzten.';
    case 'bakery':
      return 'Und schon wieder Duft von frischem Brot — nächster Bäcker voraus.';
    case 'salon':
      return 'Noch ein Friseur voraus — Schnitt-Radar piept schon wieder.';
    case 'museum':
      return 'Schon das nächste Museum, nach dem vorhin.';
    case 'atm':
    case 'service':
      return `Und schon der nächste ${label} auf unserer Route.`;
    case 'historic':
    case 'castle':
      return `Und schon das nächste ${label}, direkt nach ${last.name}.`;
    default:
      return `Und schon stehen wir am nächsten ${label}.`;
  }
}

/**
 * Persönlicher Hook ohne Vorname (Quote nur in Hauptstory).
 */
function maybePersonalHook(
  kind: PoiHookKind,
  profile?: UserProfile | null,
  _poiId?: number,
): string | null {
  const h = resolvePersonalEngagement(profile);
  const roll = Math.random();

  // Salon/Florist/Shop: kein generisches Abstecher-Fluff — Fakt-Hook übernimmt
  if (kind === 'salon' || kind === 'florist' || kind === 'shop') return null;

  // Kein generisches Essens-Hook-Roulette — Opener kommt aus buildFactBasedHook
  if (kind === 'atm' || kind === 'service') return null;

  if (kind === 'bar' && h.alcoholOk) {
    if (h.aperolInterest) {
      return 'Hast du schon wieder Lust auf einen Aperol?';
    }
    if (roll < 0.55) {
      return 'Lust auf einen Drink an diesem Spot — oder ist das noch nicht deine Baustelle?';
    }
  }

  if (kind === 'cafe' && (h.coffeeOk || roll < 0.5)) {
    return 'Jetzt wäre ein Kaffee für dich doch was, oder?';
  }

  if (kind === 'water' && roll < 0.55) {
    return 'Hast du eine Badehose dabei — oder bleiben deine Schuhe an?';
  }

  if (kind === 'nature' && roll < 0.7) {
    return 'Hast du eine Pollenallergie — oder dürfen wir deine Nase freilassen?';
  }

  if (kind === 'golf' && roll < 0.55) {
    return 'Ist Golf dein Ding — oder schaust du dir die Greens nur an?';
  }

  if (kind === 'station' && roll < 0.5) {
    return 'Warst du hier schon mal — oder ist das dein erster Stopp?';
  }

  if (kind === 'historic' && roll < 0.45) {
    return 'Hast du schon mal an so einem Ort selbst Hand angelegt?';
  }

  if (kind === 'museum' && roll < 0.5) {
    return 'Magst du Museen — oder brauchst du erst den richtigen Köder?';
  }

  return null;
}

/**
 * Sofort spielbarer Kontext-Hook für POI-Ankunft.
 */
export function buildFastHook(
  poi: PoiWithFacts,
  profile?: UserProfile | null,
  sessionMemory?: SessionMemory | null,
): string {
  const p = profile ?? getCachedUserProfile();
  const kind = classifyPoiHookKind(poi);
  const spokenTitle = humanizePoiTitleForSpeech(poi.name);
  const nameLower = poi.name.toLowerCase();

  if (
    /(ehrenmal|kriegerdenkmal|gedenkstein|gedenk)/i.test(nameLower) ||
    (poi.category ?? '').toLowerCase() === 'denkmal'
  ) {
    if (/bilsbek|brücke|bruecke/i.test(nameLower)) {
      return 'Du stehst jetzt direkt vor dem Kriegerehrenmal hier an der Bilsbekbrücke. Nimm dir ruhig einen kurzen Moment, um das Ganze auf dich wirken zu lassen.';
    }
    return `Du stehst jetzt direkt vor ${spokenTitle}. Nimm dir ruhig einen kurzen Moment, um das Ganze auf dich wirken zu lassen.`;
  }

  if (/(jagdgemeinschaft|jagdverein|revier)/i.test(nameLower)) {
    return 'Du schaust hier jetzt direkt auf die weite Feldflur mit Feldern und Knicks.';
  }

  const factHook = buildFactBasedHook(poi, kind, p, sessionMemory);
  if (factHook) {
    return factHook.replace(/\bWegweiser\b/gi, '').replace(/\s+/g, ' ').trim();
  }

  return `Schau mal — ${spokenTitle}. Ich erzähl dir gleich, was diesen Spot besonders macht.`;
}
