/**
 * Vollwertiges deutsches G2P (de-DE → IPA) für Kokoro.
 *
 * Regelwerk/Engine: Port von @dittli/tts-de (Apache-2.0), angepasst für
 * React Native + Kokoro-Vocab (kein espeak-WASM, kein Metro-Worker).
 *
 * Pipeline: Orthografie → Regelscanner → Auslautverhärtung → Kokoro-IPA-Map.
 */

import { filterPhonemesToVocab } from '../../../constants/kokoroVocab';
import type { GermanG2PProvider } from '../types';
import { normalizeGermanTtsText, spellGermanLetters } from '../germanTextNormalize';
import rulesData from './g2p_de_rules.json';

type RuleAction = string[] | { callback: string };
type RulesPayload = {
  exceptions: Record<string, string[]>;
  rules: [string, RuleAction][];
  prefixes: string[];
  loanword_v_fragments: string[];
  abbreviations: [string, string][];
  back_vowels: string;
  all_vowels: string;
  word_chars: string;
};

const DATA = rulesData as unknown as RulesPayload;
const EXCEPTIONS = DATA.exceptions;
const RULES = DATA.rules;
const PREFIXES = DATA.prefixes;
const LOANWORD_V_FRAGMENTS = DATA.loanword_v_fragments;
const ABBREVIATIONS = DATA.abbreviations;
const BACK_VOWELS = DATA.back_vowels;
const ALL_VOWELS = DATA.all_vowels;
const WORD_CHARS = new Set(DATA.word_chars.split(''));

const VOICED_OBSTRUENTS = new Set(['b', 'd', 'ɡ', 'v', 'z', 'ʒ', 'ʝ']);
const FINAL_DEVOICE: Record<string, string> = {
  b: 'p',
  d: 't',
  ɡ: 'k',
  v: 'f',
  z: 's',
  ʒ: 'ʃ',
};

/** Kokoro-Vocab: ASCII g fehlt — immer IPA ɡ (\u0261). ʏ→y. */
const KOKORO_PHONE_MAP: Record<string, string> = {
  ʏ: 'y',
  ã: 'a',
  ẽ: 'e',
  õ: 'o',
  χ: 'x',
  g: 'ɡ',
};

function chRule(word: string, i: number): string[] {
  if (i === 0) return ['k'];
  if (i >= 2 && word.slice(i - 2, i) === 'au') return ['x'];
  const prev = word[i - 1];
  if (BACK_VOWELS.includes(prev)) return ['x'];
  return ['ç'];
}

function chsRule(word: string, i: number): string[] {
  if (i + 3 === word.length || (i + 3 < word.length && word[i + 3] === 't')) {
    return ['k', 's'];
  }
  return [...chRule(word, i), 's'];
}

function stRule(word: string, i: number): string[] {
  if (i === 0) return ['ʃ', 't'];
  for (const p of PREFIXES) {
    if (word.startsWith(p) && i === p.length) return ['ʃ', 't'];
  }
  return ['s', 't'];
}

function spRule(word: string, i: number): string[] {
  if (i === 0) return ['ʃ', 'p'];
  for (const p of PREFIXES) {
    if (word.startsWith(p) && i === p.length) return ['ʃ', 'p'];
  }
  return ['s', 'p'];
}

function rRule(word: string, i: number): string[] {
  if (i === word.length - 1 && i > 0 && ALL_VOWELS.includes(word[i - 1])) {
    return ['ɐ'];
  }
  if (word.endsWith('er') && i === word.length - 1) return ['ɐ'];
  return ['ʁ'];
}

function sRule(word: string, i: number): string[] {
  if (i === 0 && i + 1 < word.length && ALL_VOWELS.includes(word[i + 1])) {
    return ['z'];
  }
  if (
    i > 0 &&
    i < word.length - 1 &&
    ALL_VOWELS.includes(word[i - 1]) &&
    ALL_VOWELS.includes(word[i + 1])
  ) {
    return ['z'];
  }
  return ['s'];
}

function vRule(word: string, _i: number): string[] {
  for (const frag of LOANWORD_V_FRAGMENTS) {
    if (word.includes(frag)) return ['v'];
  }
  return ['f'];
}

const CALLBACKS: Record<string, (word: string, i: number) => string[]> = {
  ch: chRule,
  chs: chsRule,
  st: stRule,
  sp: spRule,
  r: rRule,
  s: sRule,
  v: vRule,
};

const ONES = [
  'null',
  'eins',
  'zwei',
  'drei',
  'vier',
  'fünf',
  'sechs',
  'sieben',
  'acht',
  'neun',
];
const TEENS: Record<number, string> = {
  10: 'zehn',
  11: 'elf',
  12: 'zwölf',
  13: 'dreizehn',
  14: 'vierzehn',
  15: 'fünfzehn',
  16: 'sechzehn',
  17: 'siebzehn',
  18: 'achtzehn',
  19: 'neunzehn',
};
const TENS: Record<number, string> = {
  20: 'zwanzig',
  30: 'dreißig',
  40: 'vierzig',
  50: 'fünfzig',
  60: 'sechzig',
  70: 'siebzig',
  80: 'achtzig',
  90: 'neunzig',
};

function underHundred(n: number): string {
  if (n < 10) return ONES[n];
  if (TEENS[n] !== undefined) return TEENS[n];
  const tens = Math.floor(n / 10) * 10;
  const ones = n % 10;
  if (ones === 0) return TENS[tens];
  const onesWord = ones === 1 ? 'ein' : ONES[ones];
  return `${onesWord}und${TENS[tens]}`;
}

function underThousand(n: number): string {
  if (n < 100) return underHundred(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = hundreds === 1 ? 'ein' : ONES[hundreds];
  return rest === 0
    ? `${head}hundert`
    : `${head}hundert${underHundred(rest)}`;
}

function underMillion(n: number): string {
  if (n < 1000) return underThousand(n);
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = thousands === 1 ? 'ein' : underThousand(thousands);
  return rest === 0
    ? `${head}tausend`
    : `${head}tausend${underThousand(rest)}`;
}

function numberToWords(n: number): string {
  if (n < 0) return `minus ${numberToWords(-n)}`;
  if (n < 1_000_000) return underMillion(n);
  if (n < 1_000_000_000) {
    const millions = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    const m =
      millions === 1
        ? 'eine Million'
        : `${underMillion(millions)} Millionen`;
    return rest === 0 ? m : `${m} ${underMillion(rest)}`;
  }
  const billions = Math.floor(n / 1_000_000_000);
  const rest = n % 1_000_000_000;
  const b =
    billions === 1
      ? 'eine Milliarde'
      : `${underMillion(billions)} Milliarden`;
  return rest === 0 ? b : `${b} ${underMillion(rest)}`;
}

function normalizeNumbers(text: string): string {
  return text.replace(/-?\d+/g, (m) => numberToWords(parseInt(m, 10)));
}

function expandAbbreviations(text: string): string {
  let out = text;
  for (const [pattern, expansion] of ABBREVIATIONS) {
    out = out.replace(new RegExp(pattern, 'g'), expansion);
  }
  return out;
}

function expandInitialisms(text: string): string {
  return text.replace(/[A-ZÄÖÜ]{2,}/g, (run) => {
    const spelled = spellGermanLetters(run);
    return ` ${spelled} `;
  });
}

function normalizeForG2P(text: string): string {
  return normalizeNumbers(
    expandAbbreviations(expandInitialisms(normalizeGermanTtsText(text))),
  );
}

function applyRules(word: string): string[] {
  const lower = word.toLowerCase();
  const out: string[] = [];
  let i = 0;
  const n = lower.length;
  while (i < n) {
    let matched = false;
    for (const [pattern, action] of RULES) {
      const plen = pattern.length;
      if (i + plen <= n && lower.slice(i, i + plen) === pattern) {
        if (
          typeof action === 'object' &&
          !Array.isArray(action) &&
          action.callback
        ) {
          out.push(...CALLBACKS[action.callback](lower, i));
        } else {
          out.push(...(action as string[]));
        }
        i += plen;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return out;
}

/** Auslautverhärtung: b/d/g/v/z/ʒ → stimmlos am Silben-/Wortende. */
function applyFinalDevoicing(phones: string[]): string[] {
  if (phones.length === 0) return phones;
  const out = phones.slice();
  for (let i = 0; i < out.length; i++) {
    const ph = out[i];
    if (!VOICED_OBSTRUENTS.has(ph)) continue;
    const next = out[i + 1];
    const atBoundary =
      next === undefined ||
      next === ' ' ||
      ',.!?;:'.includes(next) ||
      (next !== undefined &&
        !ALL_VOWELS.includes(next) &&
        !VOICED_OBSTRUENTS.has(next) &&
        next !== 'l' &&
        next !== 'ʁ' &&
        next !== 'm' &&
        next !== 'n' &&
        next !== 'ŋ' &&
        next !== 'j' &&
        next !== 'w' &&
        next !== 'ː');
    if (atBoundary && FINAL_DEVOICE[ph]) {
      out[i] = FINAL_DEVOICE[ph];
    }
  }
  return out;
}

/** Expandiert Mehrzeichen-Phones und mappt auf Kokoro-IPA. */
function toKokoroPhones(phones: string[]): string[] {
  const out: string[] = [];
  for (const raw of phones) {
    if (!raw || raw === '_' || raw === 'UNK') continue;
    // "ts", "yː", "aɪ" etc. → Einzelzeichen
    for (const ch of raw) {
      if (ch === ' ') {
        out.push(' ');
        continue;
      }
      out.push(KOKORO_PHONE_MAP[ch] ?? ch);
    }
  }
  return applyFinalDevoicing(out);
}

function splitPunct(token: string): [string, string, string] {
  const lower = token.toLowerCase();
  const n = lower.length;
  let a = 0;
  while (a < n && !WORD_CHARS.has(lower[a])) a += 1;
  let b = n;
  while (b > a && !WORD_CHARS.has(lower[b - 1])) b -= 1;
  return [token.slice(0, a), token.slice(a, b), token.slice(b)];
}

function phonemizeWord(core: string): string[] {
  const lower = core.toLowerCase();
  const base = EXCEPTIONS[lower]
    ? EXCEPTIONS[lower].slice()
    : applyRules(lower);
  return toKokoroPhones(base);
}

/**
 * Deutscher Text → Kokoro-IPA-Phonemstring (leerzeichengetrennt je Wort).
 */
export function phonemizeGermanIpa(text: string): string {
  const normalized = normalizeForG2P(text);
  const rawWords = normalized.split(/\s+/).filter((w) => w.length > 0);
  const phones: string[] = [];

  for (const raw of rawWords) {
    const [lead, core, trail] = splitPunct(raw);

    for (const ch of lead) {
      if (',.!?;:'.includes(ch) || ch === '"' || ch === "'") {
        phones.push(ch);
      } else if (ch === '…') {
        phones.push('…');
      } else if (ch === '—' || ch === '–') {
        phones.push('—');
      }
    }

    if (core) {
      if (phones.length > 0 && phones[phones.length - 1] !== ' ') {
        phones.push(' ');
      }
      phones.push(...phonemizeWord(core));
    }

    for (const ch of trail) {
      if (',.!?;:'.includes(ch)) {
        phones.push(ch);
      } else if (ch === '…') {
        phones.push('…');
      } else if (ch === '—' || ch === '–') {
        phones.push('—');
      } else if (ch === '"' || ch === "'" || ch === '„' || ch === '“') {
        phones.push('"');
      }
    }
  }

  return filterPhonemesToVocab(phones.join(''));
}

export const germanIpaG2P: GermanG2PProvider = {
  id: 'de-ipa-dittli-v1',
  productionReady: true,
  phonemize(text: string): string {
    return phonemizeGermanIpa(text);
  },
};
