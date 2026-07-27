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
  | 'generic';

const KIND_LABEL_DE: Record<PoiHookKind, string> = {
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
  generic: 'Ort',
};

type HookBank = Record<PoiHookKind, string[]>;

/**
 * Kontext-Hooks bei Ankunft am Ort — direkt, persönlich, ohne Rubrik.
 */
const BASE_HOOKS: HookBank = {
  cafe: [
    'Schau mal! Vor dir duftet schon das Café — kleine Pause gefällig?',
    'Riechst du das auch schon? Genau vor dir wartet ein Spot, der hungrige Seelen rettet.',
  ],
  bakery: [
    'Na, hungrig? Da vorne duftet’s nach frischen Brötchen…',
    'Hand aufs Herz — wann hattest du zuletzt ein richtiges Franzbrötchen?',
  ],
  salon: [
    'Na, ein neuer Haarschnitt nötig? Da vorne wartet ein Friseur auf dich.',
    'Spieglein, Spieglein — Lust auf einen frischen Schnitt?',
  ],
  florist: [
    'Na, Blumen für jemanden — oder nur reinriechen? Der Laden liegt genau vor dir.',
    'Duft von frischen Blumen voraus — Lust auf einen kurzen Blick an die Theke?',
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
    'Da vorne liegt ein Laden, den die Einheimischen kennen — kurz reinschnuppern?',
    'Shopping-Radar piept. Lust auf einen kurzen Abstecher?',
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
  if (/(bäck|baeck|brot|brötchen|franzbrötchen|konditorei)/i.test(blob)) {
    return 'bakery';
  }
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

function firstNameOf(profile?: UserProfile | null): string {
  return profile?.firstName?.trim() || '';
}

function hey(name: string, line: string): string {
  if (!name) return line;
  if (new RegExp(name, 'i').test(line)) return line;
  if (/^(na|hey|schau|riechst|spürst|hörst|magst|lust|bist|warst|hand)/i.test(line)) {
    return line.replace(
      /^(na|hey|schau mal|riechst du|spürst du|hörst du|magst du|lust|bist du|warst du|hand aufs herz)/i,
      (m) => `${m}, ${name}`,
    );
  }
  return `${name}, ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
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
  const name = firstNameOf(p);
  const engine = resolvePersonaEngine(p);
  const prefs = p?.experiencePrefs ?? {};

  // Interessen-Check: wenn User das Thema mag → stärkerer Pitch; wenn no → softer
  const likesChurches = engine.preferences.likesChurches && prefs.kirchen !== 'no';
  const likesHistory = engine.preferences.wantsDatesAndHistory;
  const likesFood =
    prefs.fruehstueck === 'yes' ||
    prefs.kaffee === 'yes' ||
    prefs.abendessen === 'yes' ||
    prefs.streetfood === 'yes';

  const waterHooks = [
    `Hörst du das Rauschen? Da vorne liegt ${short} — magst du kurz zum Wasser?`,
    `Wasser voraus: ${short}. Lust auf eine kurze Brise und die Geschichte dazu?`,
    `Na, bereit für etwas Frisches? Gleich vor dir fließt ${short} — komm näher, ich erzähl dir, warum der Ort tickt.`,
  ];

  const stationHooks = [
    `Tüt-tüt — da vorne liegt ${short}. Lust auf ein Stück Bahngeschichte?`,
    `Siehst du den Bahnhof schon? ${short} verbindet das Dorf mit der weiten Welt — kurz reinschnuppern?`,
    `Bahn voraus. Magst du wissen, warum ${short} für den Ort so wichtig war?`,
  ];

  const churchHooks = likesChurches
    ? [
        `Pst… da vorne steht ${short}. Magst du kurz reinschnuppern — solche Orte flüstern richtig?`,
        `Siehst du ${short}? Wenn dich alte Mauern interessieren: da steckt mehr drin, als der erste Blick verrät.`,
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
    `Na, hungrig? Da vorne duftet ${short} nach frischen Brötchen…`,
    `Hand aufs Herz — wann hattest du zuletzt ein richtiges Franzbrötchen? ${short} liegt gleich vor dir.`,
    `Riechst du das? ${short} — der Duft allein ist schon eine Einladung.`,
  ];

  const salonHooks = [
    `Na, ein neuer Haarschnitt nötig? Da vorne auf der rechten Seite liegt ${short}.`,
    `Spieglein, Spieglein — Lust auf einen frischen Schnitt? ${short} wartet gleich vorne.`,
    `Hey${name ? ` ${name}` : ''}, da vorne ist ein Friseur: ${short}. Termin-Idee für später — oder nur vorbeischauen?`,
    `Frische Frisur gefällig? Vorne rechts siehst du ${short} — soll ich dir kurz erzählen, was den Spot besonders macht?`,
  ];

  const floristHooks = [
    `Na, Blumen für jemanden — oder nur reinriechen? Da vorne liegt ${short}.`,
    `Duft von frischen Blumen voraus: ${short}. Lust auf einen kurzen Blick an die Theke?`,
    `Hey${name ? ` ${name}` : ''}, ${short} liegt gleich vor dir — Fest, Alltag oder Trauer, hier gibt’s den Strauß ohne Extra-Weg.`,
    `Magst du kurz zur Floristik? ${short} sitzt praktisch mitten im Einkauf — reinriechen lohnt sich.`,
  ];

  const shopHooks = [
    `Da vorne brummt ${short}. Lust auf einen kurzen Abstecher mit Insider-Tipp?`,
    `Einkaufs-Radar piept: ${short}. Magst du wissen, warum die Locals hier landen?`,
  ];

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
        `Na${name ? ` ${name}` : ''}, ${short} liegt gleich vor dir. Magst du die kleine Geschichte dazu?`,
      ]
    : [
        `Da vorne: ${short}. Kurzer Stopp mit einer netten Anekdote — interessiert?`,
        `Schau mal, ${short}. Wenn du Lust hast, erzähl ich dir gleich, warum der Spot tickt.`,
        `Hey${name ? ` ${name}` : ''} — ${short} liegt vor dir. Rein oder weiter? Deine Wahl.`,
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

  let line = pick(bank[kind] ?? genericHooks);
  // Tippfehler-Schutz: hängendes Komma aus Template
  line = line.replace(/,\s*$/, '').replace(/\?\s*,/g, '?');

  // Persona-Ton leicht einfärben
  if (engine.persona === 'gen_z' && !/yo|check|vibe/i.test(line) && Math.random() < 0.35) {
    line = line.replace(/\?$/, ' — checkst du?');
  }

  if (name && !new RegExp(name, 'i').test(line) && Math.random() < 0.5) {
    line = hey(name, line);
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
  return false;
}

const VOICE_HOOKS: Partial<Record<VoiceId, Partial<HookBank>>> = {
  gen_z: {
    cafe: ['Yo, schon Kaffee-Entzug? Der Spot hier rettet dich.'],
    bakery: ['Bro, Brötchen-Alert. Da duftet’s richtig.'],
    salon: ['Na, Cut nötig? Der Friseur vorne rettet schlechte Haartage.'],
    golf: ['Ready für den Abschlag? Die Greens hier haben echten Vibe.'],
    station: ['Tüt-tüt, Einsteigen bitte! Bahnhof-Vibe, wir zoomen rein.'],
    water: ['Badehose checken — jetzt wird’s erfrischend!'],
    nature: [
      'Pollen-Check: Hast du eine Allergie — oder dürfen wir hier tief durchatmen?',
    ],
    generic: ['Yo, neuer Spot — kurz reinzoomen, da steckt Story drin.'],
  },
  prinzessin: {
    cafe: ['Welch warmer Duft! Ein Ort für eine kleine Pause.'],
    salon: ['Vielleicht ein wenig Frische für die Haare? Der Salon wartet.'],
    church: ['Pst... Wenn diese alten Mauern sprechen könnten...'],
    golf: ['Bereit für den nächsten Abschlag auf diesen Greens?'],
    station: ['Tüt-tüt, Einsteigen bitte — der Bahnhof ruft.'],
    water: ['Ich hoffe, die Badehose ist dabei — es wird erfrischend!'],
    generic: ['Pst... Dieser Ort flüstert bereits, wenn man genau hinhört.'],
  },
  erzaehler: {
    cafe: ['Nahaufnahme: dampfender Kaffee. Die Szene beginnt.'],
    salon: ['Schnitt! Die nächste Szene spielt im Salon vor dir.'],
    golf: ['Abschlag! Die Greens liegen vor uns wie eine Bühne.'],
    station: ['Tüt-tüt, Einsteigen bitte! Schauplatz Bahnhof — Tempo voraus.'],
    water: ['Wasser voraus — und die Geschichte nimmt Fahrt auf.'],
    generic: ['Vorhang auf: Dieser Spot hat eine Steilvorlage für uns.'],
  },
  dorfaeltester: {
    cafe: ['Ach ja. Riechst du auch schon den frischen Bohnenkaffee?'],
    salon: ['Ach ja. Friseur voraus — früher gab’s nur einen im Dorf.'],
    bakery: ['Ach ja. Der Duft von frischem Brot… den kenn ich noch.'],
    golf: ['Ach ja. Bereit für den Abschlag? Die Greens kenn ich schon ewig.'],
    station: ['Ach ja. Tüt-tüt — hier am Bahnhof hab ich als Junge die Züge gezählt.'],
    nature: ['Ach ja. Hast du eine Pollenallergie? Hier blüht’s echt.'],
    generic: ['Ach ja. Moin — hier steckt mehr drin, als man denkt.'],
  },
  historiker: {
    church: [
      'Schau mal: vor dir steht die Kirche. Diese Mauern könnten ein ganzes Kapitel erzählen.',
    ],
    station: [
      'Tüt-tüt! Vor dir liegt der Bahnhof — ein geschichtsintensiver Knotenpunkt.',
    ],
    salon: [
      'Vor dir der Salon — Alltagsgeschichte, die man oft übersieht. Magst du kurz reinschnuppern?',
    ],
    golf: [
      'Schau mal: vor dir liegt die Anlage. Mehr Hintergrund als das Fairway verrät.',
    ],
    historic: [
      'Schau mal! Vor dir steht das Bauwerk. Geh einfach drauf zu, und ich erzähl dir, was dahintersteckt.',
    ],
    generic: [
      'Schau mal! Vor dir liegt der Ort. Geh drauf zu — ich bleib bei dir und erzähl dir mehr.',
    ],
  },
};

export function classifyPoiHookKind(poi: PoiWithFacts): PoiHookKind {
  const cat = (poi.category ?? '').toLowerCase();
  const name = poi.name.toLowerCase();
  const blob =
    `${poi.name} ${poi.facts.map((f) => f.fact_text).join(' ')}`.toLowerCase();

  // Gedenkorte ZUERST — „Bilsbek“ im Namen darf nie Badehose-Hooks triggern
  if (
    /(ehrenmal|kriegerdenkmal|krieger\s*denkmal|gedenkstein|gedenkstätte|gedenkstaette|kriegsopfer|gefallenendenkmal)/i.test(
      name + blob,
    ) ||
    cat === 'denkmal' ||
    (/(denkmal)/i.test(name) && !/(naturdenkmal)/i.test(name))
  ) {
    return 'historic';
  }

  if (/(fris[oö]r|friseur|coiffeur|haar|salon|barber)/i.test(name + blob)) {
    return 'salon';
  }
  if (/(blume|florist|floristik|blumenladen)/i.test(name + blob)) {
    return 'florist';
  }
  if (/(bäck|baeck|brötchen|franzbrötchen|konditorei)/i.test(name + blob)) {
    return 'bakery';
  }
  // Wasser nur, wenn der ORT selbst Wasser ist — nicht weil „Bilsbek“ im Ortsnamen vorkommt
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
  if (/(bar|club|kneipe|pub|disco)/i.test(blob) && !/golf/i.test(blob))
    return 'bar';
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

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)] ?? list[0];
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
    case 'historic':
    case 'castle':
      return `Und schon das nächste ${label}, direkt nach ${last.name}.`;
    default:
      return `Und schon stehen wir am nächsten ${label}.`;
  }
}

/**
 * Persönlicher Hook: Name + du/dein, wenn Profil bekannt.
 */
function maybePersonalHook(
  kind: PoiHookKind,
  profile?: UserProfile | null,
): string | null {
  const h = resolvePersonalEngagement(profile);
  const name = h.firstName;
  const heyName = name ? `Hey ${name}, ` : '';
  const roll = Math.random();

  if (kind === 'salon') {
    return name
      ? `Hey ${name}, na — neuer Haarschnitt nötig? Der Salon liegt genau vor dir.`
      : 'Na, ein neuer Haarschnitt nötig? Der Friseur liegt genau vor dir.';
  }

  if (kind === 'florist') {
    return name
      ? `Hey ${name}, Lust auf frische Blumen — oder nur kurz reinriechen?`
      : 'Na, Blumen für jemanden — oder nur reinriechen? Der Laden liegt genau vor dir.';
  }

  if (kind === 'bakery' && roll < 0.7) {
    return name
      ? `Hey ${name}, riechst du die Brötchen schon — oder soll ich dich erst überreden?`
      : 'Riechst du die Brötchen schon — oder soll ich dich erst überreden?';
  }

  if (kind === 'bar' && h.alcoholOk) {
    if (h.aperolInterest) {
      return name
        ? `Hey ${name}, hast du schon wieder Lust auf einen Aperol?`
        : 'Hast du schon wieder Lust auf einen Aperol?';
    }
    if (roll < 0.55) {
      return `${heyName}Lust auf einen Drink an diesem Spot — oder ist das noch nicht deine Baustelle?`;
    }
  }

  if (kind === 'cafe' && (h.coffeeOk || roll < 0.5)) {
    return name
      ? `Hey ${name}, jetzt wäre ein Kaffee für dich doch was, oder?`
      : 'Jetzt wäre ein Kaffee für dich doch was, oder?';
  }

  if (kind === 'water' && roll < 0.55) {
    return name
      ? `Hey ${name}, hast du eine Badehose dabei — oder bleiben deine Schuhe an?`
      : 'Hast du eine Badehose dabei — oder bleiben deine Schuhe an?';
  }

  if (kind === 'nature' && roll < 0.7) {
    return name
      ? `${name}, hast du eine Pollenallergie — oder dürfen wir deine Nase freilassen?`
      : 'Hast du eine Pollenallergie — oder dürfen wir deine Nase freilassen?';
  }

  if (kind === 'golf' && roll < 0.55) {
    return name
      ? `${name}, ist Golf dein Ding — oder schaust du dir die Greens nur an?`
      : 'Ist Golf dein Ding — oder schaust du dir die Greens nur an?';
  }

  if (kind === 'station' && roll < 0.5) {
    return name
      ? `${name}, warst du hier schon mal — oder ist das dein erster Stopp?`
      : 'Warst du hier schon mal — oder ist das dein erster Stopp?';
  }

  if (kind === 'historic' && roll < 0.45) {
    return name
      ? `${heyName}hast du schon mal an so einem Ort selbst Hand angelegt?`
      : 'Hast du schon mal an so einem Ort selbst Hand angelegt?';
  }

  if (kind === 'museum' && roll < 0.5) {
    return name
      ? `${name}, magst du Museen — oder brauchst du erst den richtigen Köder?`
      : 'Magst du Museen — oder brauchst du erst den richtigen Köder?';
  }

  if (name && roll < 0.45) {
    return `Hey ${name}, schau mal — das hier vor dir ist für dich spannend.`;
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
  const voiceId = (p?.voiceId ?? 'standard_m') as VoiceId;
  const kind = classifyPoiHookKind(poi);
  const last = lastVisitedPlace(sessionMemory);
  const spokenTitle = humanizePoiTitleForSpeech(poi.name);
  const nameLower = poi.name.toLowerCase();

  // Memorial / Ehrenmal: respektvoller Anker — nie Badehose/Wasser-Humor
  if (
    /(ehrenmal|kriegerdenkmal|gedenkstein|gedenk)/i.test(nameLower) ||
    (poi.category ?? '').toLowerCase() === 'denkmal'
  ) {
    if (/bilsbek|brücke|bruecke/i.test(nameLower)) {
      return 'Du stehst jetzt direkt vor dem Kriegerehrenmal hier an der Bilsbekbrücke. Nimm dir ruhig einen kurzen Moment, um das Ganze auf dich wirken zu lassen.';
    }
    return `Du stehst jetzt direkt vor ${spokenTitle}. Nimm dir ruhig einen kurzen Moment, um das Ganze auf dich wirken zu lassen.`;
  }

  // Jagd / Feldflur: Umgebung statt Rohname
  if (/(jagdgemeinschaft|jagdverein|revier)/i.test(nameLower)) {
    return 'Du schaust hier jetzt direkt auf die weite Feldflur. Ehrlich gesagt sieht das auf den ersten Blick einfach nur nach ruhiger Natur aus — aber hier steckt richtig Leben drin!';
  }

  const personal = maybePersonalHook(kind, p);
  if (personal) return personal;

  const bridge = bridgeHook(
    kind,
    last ? { kind: last.kind, name: last.name } : null,
  );
  if (bridge) return bridge;

  const voiceBank = VOICE_HOOKS[voiceId];
  const candidates =
    voiceBank?.[kind] ??
    voiceBank?.generic ??
    BASE_HOOKS[kind] ??
    BASE_HOOKS.generic;

  let hook = pick(candidates);

  if (kind === 'station') {
    if (!/bahnhof/i.test(hook) && /bahnhof/i.test(spokenTitle)) {
      hook = `Tüt-tüt, Einsteigen bitte! Wir stehen am ${spokenTitle}.`;
    } else if (/am Bahnhof\.?$/i.test(hook)) {
      hook = hook.replace(/am Bahnhof\.?$/i, `am ${spokenTitle}.`);
    }
  }

  if (kind === 'golf' && /peiner|hof|fairway/i.test(spokenTitle)) {
    if (!/green|abschlag|handicap/i.test(hook)) {
      hook = pick(BASE_HOOKS.golf);
    }
  }

  if (kind === 'salon' && !/frisur|schnitt|friseur|salon/i.test(hook)) {
    hook = pick(BASE_HOOKS.salon);
  }

  const firstName = p?.firstName?.trim();
  if (firstName && !new RegExp(firstName, 'i').test(hook)) {
    if (Math.random() < 0.55) {
      hook = hook.match(/^(schau mal|pass auf|sag mal|tüt-tüt|na[,!]?)/i)
        ? hook.replace(
            /^(schau mal|pass auf|sag mal|tüt-tüt[!.,]?|na[,!]?)\s*/i,
            (_m, open: string) => `${open} ${firstName}, `,
          )
        : `${firstName}, ${hook.charAt(0).toLowerCase()}${hook.slice(1)}`;
    }
  } else if (
    !firstName &&
    !/\b(du|dein|deine|dir)\b/i.test(hook) &&
    Math.random() < 0.4
  ) {
    hook = hook.replace(/\?$/, ' — für dich?');
  }

  return hook
    .replace(/\bWegweiser\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
