/**
 * Merge Gemini Inspiration-Recharge (_inbox) → inspirationHarvest.pack.json
 * + persist rich pool as inspirationRecharge.pool.json
 *
 * Usage: npx tsx scripts/mergeInspirationRecharge.ts
 *        npx tsx scripts/mergeInspirationRecharge.ts --inbox=src/reisebuero/research/_inbox/inspiration-recharge-2026-09.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

type CatalogVibe =
  | 'family'
  | 'kids'
  | 'date'
  | 'adventure'
  | 'spa_value'
  | 'menstrip'
  | 'ultra_cheap'
  | 'anti_party';

type Seed = {
  vibe: CatalogVibe;
  destLabel: string;
  region: string;
  countryCode: string;
  tags: string[];
  seasonHint?: string;
  validUntilMs: number;
  lat: number | null;
  lng: number | null;
  iata: string | null;
  whyFit: string | null;
  source: 'pack';
};

const CATALOG_VIBES: readonly CatalogVibe[] = [
  'family',
  'kids',
  'date',
  'adventure',
  'spa_value',
  'menstrip',
  'ultra_cheap',
  'anti_party',
];

const VIBE_MAP: Record<string, CatalogVibe[]> = {
  party_underground: ['menstrip'],
  party: ['menstrip'],
  festival: ['menstrip'],
  sports_leisure: ['menstrip'],
  menstrip: ['menstrip'],
  adventure_arctic: ['adventure'],
  adventure_water: ['adventure'],
  adventure: ['adventure'],
  remote_escape: ['adventure', 'anti_party'],
  scenic_train: ['adventure'],
  bike_long: ['adventure'],
  bike_niche: ['adventure'],
  bike_coast: ['adventure'],
  hike_coast: ['adventure'],
  hike_forest: ['adventure'],
  scenic_drive: ['adventure'],
  nature_wonder: ['adventure', 'anti_party'],
  foodie: ['date'],
  date: ['date'],
  city_culture: ['date', 'menstrip'],
  spa_value: ['spa_value'],
  eco_retreat: ['anti_party'],
  anti_overtourism: ['anti_party'],
  anti_party: ['anti_party'],
  family_parks: ['family', 'kids'],
  family: ['family'],
  kids: ['kids'],
  ultra_cheap: ['ultra_cheap'],
  stay_first: ['spa_value', 'menstrip'],
  camping_van: ['adventure'],
  island_ferry: ['anti_party', 'adventure'],
  winter_snow: ['adventure', 'date'],
  food_wine: ['date'],
  family_kids: ['family', 'kids'],
  groups_jga: ['menstrip'],
  nightjet_interrail: ['adventure', 'ultra_cheap'],
  overhyped_alt: ['anti_party', 'date'],
  dog_friendly: ['family', 'anti_party'],
  accessibility: ['family', 'adventure'],
  ski_lite_winter: ['adventure', 'ultra_cheap', 'family'],
};

function resolveCatalogVibes(raw: Record<string, unknown>): CatalogVibe[] {
  if (Array.isArray(raw.catalogVibes) && raw.catalogVibes.length) {
    const out = raw.catalogVibes
      .map((v) => String(v).trim() as CatalogVibe)
      .filter((v) => CATALOG_VIBES.includes(v));
    if (out.length) return [...new Set(out)];
  }
  const researchVibe = String(raw.vibe || '').trim();
  if (CATALOG_VIBES.includes(researchVibe as CatalogVibe)) {
    return [researchVibe as CatalogVibe];
  }
  return VIBE_MAP[researchVibe] || ['adventure'];
}

function mapTags(raw: string[], vibe: CatalogVibe): string[] {
  const t = new Set(raw.map((x) => x.toLowerCase().replace(/-/g, '_')));
  if (vibe === 'menstrip' && (t.has('nightlife') || t.has('party') || t.has('festival'))) {
    t.add('party');
  }
  if (vibe === 'adventure' && (t.has('train') || t.has('cycling') || t.has('gravel_bike'))) {
    t.add('train');
    t.add('bike');
  }
  if (t.has('thermal_baths')) t.add('spa');
  if (t.has('padel')) {
    t.add('tennis');
    t.add('padel');
  }
  if (t.has('jga') || t.has('group')) {
    t.add('party');
  }
  if (t.has('themepark')) {
    t.add('kids');
    t.add('family');
  }
  if (t.has('dog')) t.add('quiet');
  return [...t].slice(0, 10);
}

function countryFromLabel(dest: string, region: string, explicit?: string): string {
  if (explicit && /^[A-Z]{2}$/.test(explicit)) return explicit;
  const blob = `${dest} ${region}`.toLowerCase();
  const table: [RegExp, string][] = [
    [/georgien|tbilisi/, 'GE'],
    [/serbien|belgrad/, 'RS'],
    [/norwegen|senja|troms|bergen|kirkenes|hurtigruten/, 'NO'],
    [/italien|piemont|toskana|saturnia|venedig|maira|rom\b/, 'IT'],
    [/schweiz|graubünden|bernina|chur|zürich|zurich/, 'CH'],
    [/österreich|salzburg|alpe adria|ottensheim|wien/, 'AT'],
    [/spanien|girona|málaga|malaga|tarifa|madrid|san sebastián|sebastian|marbella|ibiza|sevilla|teneriffa|mallorca|andalusien/, 'ES'],
    [/portugal|alentejo|vicentina|algarve|porto|lissabon|douro/, 'PT'],
    [/niederlande|\bnl\b|amsterdam|efteling|schiermonnikoog|valkenburg|ndsm/, 'NL'],
    [/luxemburg|mullerthal/, 'LU'],
    [/ungarn|budapest|sziget/, 'HU'],
    [/litauen|nida|kurische/, 'LT'],
    [/irland|atlantic/, 'IE'],
    [/schweden|kattegatt|skåne|maryhill|göteborg|goteborg/, 'SE'],
    [/kroatien|hvar|split/, 'HR'],
    [/polen|warschau|šilainė|silaine/, 'PL'],
    [/rumänien|bukarest/, 'RO'],
    [/griechenland|kreta|navarino|messenien/, 'GR'],
    [/estland|truuta|otepää/, 'EE'],
    [/frankreich|paris|colmar|annecy|évian|evian|allauch|provence/, 'FR'],
    [/belgien|brügge|brugge|brüssel|bruessel/, 'BE'],
    [/slowenien|ljubljana/, 'SI'],
    [/schottland|edinburgh|england|london|manchester|großbritannien/, 'GB'],
    [/deutschland|berlin|hamburg|münchen|muenchen|kiel|köln|koeln/, 'DE'],
    [/tschechien|prag/, 'CZ'],
    [/japan|tokyo|tokio|osaka|machida|kawaguchi|shiomi|gifu|shinjuku|kanazawa/, 'JP'],
    [/peru|cusco|arequipa|titicaca|machu/, 'PE'],
    [/russland|moskau|transsib|sibirien|wladiwostok/, 'RU'],
  ];
  for (const [re, cc] of table) if (re.test(blob)) return cc;
  return 'EU';
}

function cleanDest(label: string): string {
  return label
    .replace(/\s*,\s*(Georgien|Norwegen|Italien|Spanien|Portugal|Ungarn|Litauen|Irland|Luxemburg|NL).*$/i, '')
    .replace(/\s*\(CH\/IT\)\s*/i, '')
    .trim();
}

function main() {
  const inboxArg = process.argv.find((a) => a.startsWith('--inbox='))?.slice('--inbox='.length);
  const inboxPath = path.resolve(
    ROOT,
    inboxArg || 'src/reisebuero/research/_inbox/inspiration-recharge-2026-09.json',
  );
  const packPath = path.join(ROOT, 'src/reisebuero/research/inspirationHarvest.pack.json');
  const poolPath = path.join(ROOT, 'src/reisebuero/research/inspirationRecharge.pool.json');

  const inbox = JSON.parse(fs.readFileSync(inboxPath, 'utf8')) as {
    notes?: string;
    items?: Array<Record<string, unknown>>;
    airports?: unknown[];
    trains?: unknown[];
    flyRailCombos?: unknown[];
    dealPatterns?: unknown[];
    chapters?: unknown[];
  };
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8')) as {
    version: number;
    generatedAtMs: number;
    note: string;
    items: Seed[];
  };

  const validUntilMs = Date.now() + 180 * 24 * 3600_000;
  const incoming: Seed[] = [];

  for (const raw of inbox.items || []) {
    const targets = resolveCatalogVibes(raw);
    const destLabel = cleanDest(String(raw.destLabel || ''));
    if (destLabel.length < 2) continue;
    const region = String(raw.region || 'Europa').slice(0, 80);
    const countryCode = countryFromLabel(
      destLabel,
      region,
      typeof raw.countryCode === 'string' ? raw.countryCode : undefined,
    );
    const baseTags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
    const whyFit =
      typeof raw.whyFit === 'string' && raw.whyFit.trim()
        ? raw.whyFit.trim().slice(0, 160)
        : typeof raw.hook === 'string'
          ? raw.hook.trim().slice(0, 160)
          : null;
    const seasonHint =
      typeof raw.seasonHint === 'string' ? raw.seasonHint.trim().slice(0, 60) : undefined;
    const lat = typeof raw.lat === 'number' ? raw.lat : null;
    const lng = typeof raw.lng === 'number' ? raw.lng : null;
    const iata =
      typeof raw.iata === 'string' && /^[A-Za-z]{3}$/.test(raw.iata)
        ? raw.iata.toUpperCase()
        : null;

    for (const vibe of targets) {
      incoming.push({
        vibe,
        destLabel,
        region,
        countryCode,
        tags: mapTags(baseTags, vibe),
        seasonHint,
        validUntilMs,
        lat,
        lng,
        iata,
        whyFit,
        source: 'pack',
      });
    }
  }

  const map = new Map<string, Seed>();
  const key = (s: Seed) => `${s.vibe}:${s.destLabel.toLowerCase()}`;
  for (const s of pack.items || []) map.set(key(s), { ...s, source: 'pack' });
  for (const s of incoming) map.set(key(s), s);

  const merged = [...map.values()].sort((a, b) =>
    a.vibe === b.vibe
      ? a.destLabel.localeCompare(b.destLabel)
      : a.vibe.localeCompare(b.vibe),
  );

  const byVibe: Record<string, number> = {};
  for (const s of merged) byVibe[s.vibe] = (byVibe[s.vibe] || 0) + 1;

  const inboxRel = path.relative(ROOT, inboxPath).replace(/\\/g, '/');
  const outPack = {
    version: 1,
    generatedAtMs: Date.now(),
    note: `reisebuero inspiration · merge ${path.basename(inboxPath)} · ${merged.length} items`,
    items: merged,
  };
  fs.writeFileSync(packPath, `${JSON.stringify(outPack, null, 2)}\n`, 'utf8');

  type PoolItem = Record<string, unknown> & { id?: string };
  const prevPool = fs.existsSync(poolPath)
    ? (JSON.parse(fs.readFileSync(poolPath, 'utf8')) as {
        items?: PoolItem[];
        airports?: Array<Record<string, unknown>>;
        trains?: Array<Record<string, unknown>>;
        flyRailCombos?: unknown[];
        dealPatterns?: unknown[];
        chapters?: unknown[];
        sourceInboxes?: string[];
        notes?: string;
      })
    : {};

  const itemById = new Map<string, PoolItem>();
  for (const it of prevPool.items || []) {
    if (it?.id) itemById.set(String(it.id), it);
  }
  for (const it of (inbox.items || []) as PoolItem[]) {
    if (it?.id) itemById.set(String(it.id), it);
  }

  const airportByIata = new Map<string, Record<string, unknown>>();
  for (const a of [...(prevPool.airports || []), ...((inbox.airports || []) as Record<string, unknown>[])]) {
    const code = String(a.iata || a.code || '').toUpperCase();
    if (code) airportByIata.set(code, a);
  }
  const trainByName = new Map<string, Record<string, unknown>>();
  for (const t of [...(prevPool.trains || []), ...((inbox.trains || []) as Record<string, unknown>[])]) {
    const name = String(t.name || '');
    if (name) trainByName.set(name, t);
  }

  const uniqStr = (arr: unknown[]) =>
    [...new Set(arr.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean))];

  const pool = {
    version: 1,
    generatedAtMs: Date.now(),
    sourceInbox: inboxRel,
    sourceInboxes: uniqStr([...(prevPool.sourceInboxes || []), prevPool.sourceInbox, inboxRel]),
    notes: [prevPool.notes, inbox.notes].filter(Boolean).join(' · '),
    items: [...itemById.values()],
    airports: [...airportByIata.values()],
    trains: [...trainByName.values()],
    flyRailCombos: [
      ...(prevPool.flyRailCombos || []),
      ...(inbox.flyRailCombos || []),
    ],
    dealPatterns: uniqStr([...(prevPool.dealPatterns || []), ...(inbox.dealPatterns || [])]),
    chapters: [...(prevPool.chapters || []), ...(inbox.chapters || [])],
    overhypedPairs: [
      ...((prevPool as { overhypedPairs?: unknown[] }).overhypedPairs || []),
      ...((inbox as { overhypedPairs?: unknown[] }).overhypedPairs || []),
    ],
    dogFriendly: uniqStr([
      ...((prevPool as { dogFriendly?: unknown[] }).dogFriendly || []),
      ...((inbox as { dogFriendly?: unknown[] }).dogFriendly || []),
    ]),
    accessibility: uniqStr([
      ...((prevPool as { accessibility?: unknown[] }).accessibility || []),
      ...((inbox as { accessibility?: unknown[] }).accessibility || []),
    ]),
    seasonCalendar: [
      ...((prevPool as { seasonCalendar?: unknown[] }).seasonCalendar || []),
      ...((inbox as { seasonCalendar?: unknown[] }).seasonCalendar || []),
    ],
    socialClusters: [
      ...((prevPool as { socialClusters?: unknown[] }).socialClusters || []),
      ...((inbox as { socialClusters?: unknown[] }).socialClusters || []),
    ],
    seasonSocialSpikes: [
      ...((prevPool as { seasonSocialSpikes?: unknown[] }).seasonSocialSpikes || []),
      ...((inbox as { seasonSocialSpikes?: unknown[] }).seasonSocialSpikes || []),
    ],
    top30Speakable: [
      ...((prevPool as { top30Speakable?: unknown[] }).top30Speakable || []),
      ...((inbox as { top30Speakable?: unknown[] }).top30Speakable || []),
    ],
    festivalCalendar: [
      ...((prevPool as { festivalCalendar?: unknown[] }).festivalCalendar || []),
      ...((inbox as { festivalCalendar?: unknown[] }).festivalCalendar || []),
    ],
    eventStayCombos: [
      ...((prevPool as { eventStayCombos?: unknown[] }).eventStayCombos || []),
      ...((inbox as { eventStayCombos?: unknown[] }).eventStayCombos || []),
    ],
    topKidsSpeakable: [
      ...((prevPool as { topKidsSpeakable?: unknown[] }).topKidsSpeakable || []),
      ...((inbox as { topKidsSpeakable?: unknown[] }).topKidsSpeakable || []),
    ],
    topEventSpeakable: [
      ...((prevPool as { topEventSpeakable?: unknown[] }).topEventSpeakable || []),
      ...((inbox as { topEventSpeakable?: unknown[] }).topEventSpeakable || []),
    ],
    wowClusters: [
      ...((prevPool as { wowClusters?: unknown[] }).wowClusters || []),
      ...((inbox as { wowClusters?: unknown[] }).wowClusters || []),
    ],
    seasonWindows: [
      ...((prevPool as { seasonWindows?: unknown[] }).seasonWindows || []),
      ...((inbox as { seasonWindows?: unknown[] }).seasonWindows || []),
    ],
    top40Speakable: [
      ...((prevPool as { top40Speakable?: unknown[] }).top40Speakable || []),
      ...((inbox as { top40Speakable?: unknown[] }).top40Speakable || []),
    ],
    tripClusters: [
      ...((prevPool as { tripClusters?: unknown[] }).tripClusters || []),
      ...((inbox as { tripClusters?: unknown[] }).tripClusters || []),
    ],
    top35Speakable: [
      ...((prevPool as { top35Speakable?: unknown[] }).top35Speakable || []),
      ...((inbox as { top35Speakable?: unknown[] }).top35Speakable || []),
    ],
    sampleItineraries: [
      ...((prevPool as { sampleItineraries?: unknown[] }).sampleItineraries || []),
      ...((inbox as { sampleItineraries?: unknown[] }).sampleItineraries || []),
    ],
    stayClusters: [
      ...((prevPool as { stayClusters?: unknown[] }).stayClusters || []),
      ...((inbox as { stayClusters?: unknown[] }).stayClusters || []),
    ],
    aiClusters: [
      ...((prevPool as { aiClusters?: unknown[] }).aiClusters || []),
      ...((inbox as { aiClusters?: unknown[] }).aiClusters || []),
    ],
    gapClusters: [
      ...((prevPool as { gapClusters?: unknown[] }).gapClusters || []),
      ...((inbox as { gapClusters?: unknown[] }).gapClusters || []),
    ],
    catalogMappedCount: incoming.length,
  };
  fs.writeFileSync(poolPath, `${JSON.stringify(pool, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        inbox: inboxRel,
        packItemsBefore: (pack.items || []).length,
        packItemsAfter: merged.length,
        rechargeMapped: incoming.length,
        poolItems: pool.items.length,
        byVibe,
        pool: path.relative(ROOT, poolPath).replace(/\\/g, '/'),
      },
      null,
      2,
    ),
  );
}

main();
