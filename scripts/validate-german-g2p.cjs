/**
 * Smoke-Test: deutsches IPA-G2P für IPA (ohne RN-Runtime).
 * Usage: node scripts/validate-german-g2p.cjs
 */
const fs = require('fs');
const path = require('path');

const rulesPath = path.join(
  __dirname,
  '..',
  'src',
  'services',
  'g2p',
  'de',
  'g2p_de_rules.json',
);
const DATA = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

const EXCEPTIONS = DATA.exceptions;
const RULES = DATA.rules;
const PREFIXES = DATA.prefixes;
const LOANWORD_V = DATA.loanword_v_fragments;
const BACK = DATA.back_vowels;
const ALL_V = DATA.all_vowels;
const WORD_CHARS = new Set(DATA.word_chars.split(''));
const MAP = { ʏ: 'y', ã: 'a', ẽ: 'e', õ: 'o', χ: 'x', ɡ: 'g' };
const DEVOICE = { b: 'p', d: 't', g: 'k', v: 'f', z: 's', ʒ: 'ʃ' };
const VOICED = new Set(Object.keys(DEVOICE));

function chRule(word, i) {
  if (i === 0) return ['k'];
  if (i >= 2 && word.slice(i - 2, i) === 'au') return ['x'];
  if (BACK.includes(word[i - 1])) return ['x'];
  return ['ç'];
}
function stRule(word, i) {
  if (i === 0) return ['ʃ', 't'];
  for (const p of PREFIXES) if (word.startsWith(p) && i === p.length) return ['ʃ', 't'];
  return ['s', 't'];
}
function spRule(word, i) {
  if (i === 0) return ['ʃ', 'p'];
  for (const p of PREFIXES) if (word.startsWith(p) && i === p.length) return ['ʃ', 'p'];
  return ['s', 'p'];
}
function rRule(word, i) {
  if (i === word.length - 1 && i > 0 && ALL_V.includes(word[i - 1])) return ['ɐ'];
  return ['ʁ'];
}
function sRule(word, i) {
  if (i === 0 && i + 1 < word.length && ALL_V.includes(word[i + 1])) return ['z'];
  if (
    i > 0 &&
    i < word.length - 1 &&
    ALL_V.includes(word[i - 1]) &&
    ALL_V.includes(word[i + 1])
  )
    return ['z'];
  return ['s'];
}
function vRule(word) {
  for (const f of LOANWORD_V) if (word.includes(f)) return ['v'];
  return ['f'];
}
const CB = {
  ch: chRule,
  chs: (w, i) =>
    i + 3 === w.length || (i + 3 < w.length && w[i + 3] === 't')
      ? ['k', 's']
      : [...chRule(w, i), 's'],
  st: stRule,
  sp: spRule,
  r: rRule,
  s: sRule,
  v: (w, i) => vRule(w, i),
};

function applyRules(word) {
  const lower = word.toLowerCase();
  const out = [];
  let i = 0;
  while (i < lower.length) {
    let matched = false;
    for (const [pat, action] of RULES) {
      if (lower.slice(i, i + pat.length) === pat) {
        if (action && action.callback) out.push(...CB[action.callback](lower, i));
        else out.push(...action);
        i += pat.length;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return out;
}

function toIPA(phones) {
  const flat = [];
  for (const raw of phones) for (const ch of raw) flat.push(MAP[ch] || ch);
  for (let i = 0; i < flat.length; i++) {
    const ph = flat[i];
    if (!VOICED.has(ph)) continue;
    const next = flat[i + 1];
    const boundary =
      next === undefined ||
      next === ' ' ||
      ',.!?;:'.includes(next) ||
      (next &&
        !ALL_V.includes(next) &&
        !VOICED.has(next) &&
        !'lʁmnŋjwː'.includes(next));
    if (boundary && DEVOICE[ph]) flat[i] = DEVOICE[ph];
  }
  return flat;
}

function phonemize(text) {
  const words = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[„“«»]/g, '"')
    .split(/\s+/)
    .filter(Boolean);
  const phones = [];
  for (const raw of words) {
    let a = 0;
    const lower = raw.toLowerCase();
    while (a < lower.length && !WORD_CHARS.has(lower[a])) a++;
    let b = lower.length;
    while (b > a && !WORD_CHARS.has(lower[b - 1])) b--;
    const core = raw.slice(a, b);
    const trail = raw.slice(b);
    if (!core) continue;
    if (phones.length) phones.push(' ');
    const base = EXCEPTIONS[core.toLowerCase()]
      ? EXCEPTIONS[core.toLowerCase()].slice()
      : applyRules(core);
    phones.push(...toIPA(base));
    for (const ch of trail) if ('.,!?;:'.includes(ch) || ch === '?') phones.push(ch);
  }
  return phones.join('');
}

const SENTENCE =
  'Möchtest du schöne Städte und historische Orte in Deutschland entdecken?';

const ipa = phonemize(SENTENCE);
console.log('INPUT:', SENTENCE);
console.log('IPA:  ', ipa);

const checks = [
  ['ö/œ in möchtest', /œ|ø/.test(ipa)],
  ['sch → ʃ', ipa.includes('ʃ')],
  ['ä/ɛ in Städte', ipa.includes('ɛ')],
  ['eu/ɔy in Deutschland', /ɔy|ɔʏ/.test(ipa)],
  ['ch → ç (möchtest/ich-Laut)', ipa.includes('ç')],
  ['kein ASCII oe/ue/ae Digraph', !/\boe\b|\bue\b|\bae\b/.test(ipa) && !ipa.includes('oe') && !ipa.includes('ue')],
  ['Auslautverhärtung und→ʊnt', /ʊnt/.test(ipa) || ipa.includes('ʊnt')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(ok ? '✓' : '✗', name);
  if (!ok) failed += 1;
}

// Stimmen-Hinweis (Inferenz läuft in der App)
console.log('');
console.log('Stimmen-Validierung (App): Thorsten / Eva / Puck mit gleichem IPA-String.');
console.log('Pack-Routing unverändert — nur G2P-Eingabe ist jetzt echtes de-IPA.');

process.exit(failed === 0 ? 0 : 1);
