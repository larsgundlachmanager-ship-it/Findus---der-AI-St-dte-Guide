/**
 * Rebuilds src/assets/data/pronunciations.json
 * Sources: existing JSON (base) ⊕ pronunciationOverrides.ts ⊕ essentials.
 * Die große TS-Kategorie-Map ist deprecated — JSON ist Source of Truth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const overridesPath = path.join(root, 'src/services/tts/pronunciationOverrides.ts');
const outPath = path.join(root, 'src/assets/data/pronunciations.json');
const G = '\u0261';

function unescapeStr(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function toIPAIpa(ipa) {
  return ipa.replace(/g/g, G);
}

function extractOverrides(src) {
  const map = new Map();
  const re =
    /(?:^|[\s,{])(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|([A-Za-zÄÖÜäöüß0-9][A-Za-zÄÖÜäöüß0-9'_-]*)\s*):\s*(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const key = unescapeStr(m[1] ?? m[2] ?? m[3] ?? '')
      .toLowerCase()
      .trim();
    const ipa = toIPAIpa(unescapeStr(m[4] ?? m[5] ?? '').trim());
    if (!key || !ipa) continue;
    if (key === 'as' || key === 'const' || key === 'export') continue;
    map.set(key, ipa);
  }
  return map;
}

const essentials = {
  audioguide: `ˈɔːdiəʊ ${G}aɪd`,
  'audio guide': `ˈɔːdiəʊ ${G}aɪd`,
  'audio-guide': `ˈɔːdiəʊ ${G}aɪd`,
  cringe: 'kɹɪndʒ',
  slay: 'sleɪ',
  'no cap': 'noʊ kæp',
  highlight: 'ˈhaɪlaɪt',
  location: 'loʊˈkeɪʃən',
  'check-in': 'ˈtʃekɪn',
  checkin: 'ˈtʃekɪn',
  'side eye': 'saɪd aɪ',
  flexen: 'ˈflɛksən',
  match: 'mætʃ',
  bro: 'bɹoʊ',
  vibe: 'vaɪb',
  tapas: 'ˈtapas',
  bruschetta: 'bʁuˈskɛta',
  gnocchi: 'ˈɲɔki',
  espresso: 'ɛsˈpʁɛso',
  paella: 'paˈeʎa',
  croissant: 'kʁwaˈsɑ̃',
  baguette: `baˈ${G}ɛt`,
  'dim sum': 'dɪm sʌm',
  ramen: 'ˈɹɑːmən',
  moin: 'moːɪn',
  servus: 'ˈsɛʁvʊs',
  "o'zapft is": 'ɔˈt͡sapft ɪs',
  brezn: 'ˈbʁɛt͡sn̩',
  schmankerl: 'ˈʃmaŋkɐl',
  pfefferpotthast: 'ˈp͡fɛfɐˌpɔt.hast',
  findus: 'fˈɪndʊs',
  bus: 'bʊs',
};

const existing = fs.existsSync(outPath)
  ? JSON.parse(fs.readFileSync(outPath, 'utf8'))
  : {};
const overrides = extractOverrides(fs.readFileSync(overridesPath, 'utf8'));

const merged = new Map([
  ...Object.entries(existing).map(([k, v]) => [String(k).toLowerCase(), toIPAIpa(String(v))]),
  ...overrides,
  ...Object.entries(essentials),
]);

for (const key of [...merged.keys()]) {
  if (/lemma\d{3,}$/i.test(key)) merged.delete(key);
}

const obj = Object.fromEntries(
  [...merged.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de')),
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(obj)}\n`, 'utf8');
console.log('Wrote', outPath, 'entries=', Object.keys(obj).length);
