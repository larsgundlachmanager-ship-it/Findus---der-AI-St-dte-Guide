// @ts-nocheck
/**
 * Pre-Rendered Audio Assets — 0,0s Ladezeiten im Onboarding.
 *
 * Ausgabe:
 *   src/assets/audio/intro.wav          (Standard-Männlich / de_thorsten)
 *   src/assets/audio/samples/*.wav      (8 Stimmvorstellungen)
 *
 * Voraussetzung: npm run fetch:kokoro
 * Usage: npx tsx scripts/preRenderAudio.ts
 *        npm run generate:voice-assets
 */
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const ROOT = path.resolve(__dirname, '..');
const KOKORO = path.join(ROOT, 'native-assets', 'kokoro');
const MODEL = path.join(KOKORO, 'kokoro-martin.onnx');
const VOICES_DIR = path.join(KOKORO, 'voices');
const AUDIO_ROOT = path.join(ROOT, 'src', 'assets', 'audio');
const SAMPLES_OUT = path.join(AUDIO_ROOT, 'samples');

const SAMPLE_RATE = 24000;
const STYLE_DIM = 256;
const STYLE_FRAMES = 510;
const SPEED = 1.0;

const INTRO_TEXT =
  'Hallo und herzlich willkommen. Ich bin Findus. Ich bin kein normaler Audioguide, der einfach nur Texte vorliest. Ich bin das, was du aus mir machst. Gleich darfst du entscheiden, wie ich klingen soll, ob als weiser Historiker, als lockerer Kumpel oder als die gute Seele des Ortes. Lass uns gemeinsam dein Profil anlegen, damit ich dir die Stadt genauso erklären kann, wie es perfekt zu dir passt. Ich freue mich auf dich.';

/** 8 native DE-Rollen — Texte 1:1 synchron zu src/constants/voices.ts */
const VOICES = [
  {
    id: 'standard_m',
    pack: 'de_thorsten',
    sample:
      'Moin! Ich bin Findus. Mit mir erlebst du jeden Ort ganz entspannt und auf den Punkt gebracht. Ein ehrlicher, verlässlicher Begleiter für deine Tour.',
  },
  {
    id: 'standard_w',
    pack: 'de_eva',
    sample:
      'Hallo! Ich freue mich darauf, gemeinsam mit dir die schönsten Ecken und Geheimnisse dieser Gegend zu entdecken. Lass uns einfach losgehen!',
  },
  {
    id: 'prinzessin',
    pack: 'de_eva',
    sample:
      'Trete näher, werter Gast. Lass dich von mir in eine Welt voller Zauber und verborgener Geschichten entführen. Wir wandeln gemeinsam auf königlichen Pfaden.',
  },
  {
    id: 'erzaehler',
    pack: 'de_thorsten',
    sample:
      'Lehn dich zurück. Wenn du diese Gegend erleben willst wie in einem epischen Blockbuster-Film, dann bist du bei mir genau richtig. Geschichte wird lebendig.',
  },
  {
    id: 'dorfaeltester',
    pack: 'de_karl',
    sample:
      'Na, mein Kind. Über achtzig Jahre lebe ich schon hier. Ich kenne jeden Winkel und all die alten Geschichten aus der guten alten Zeit. Setz dich kurz zu mir.',
  },
  {
    id: 'historiker',
    pack: 'de_karl',
    sample:
      'Willkommen. Präzise Fakten, historische Zusammenhänge und fundiertes Wissen – wenn du die Geschichte tiefgründig verstehen willst, bin ich dein perfekter Guide.',
  },
  {
    id: 'gen_z',
    pack: 'de_thorsten',
    sample:
      "Yo Bro! Wenn dir der ganze alte Kram zu langweilig ist und du Bock auf 'nen richtig freshen Vibe hast – safe, dann bin ich dein Mann! Let's go!",
  },
  {
    id: 'energisch',
    pack: 'de_eva',
    sample:
      'Hey! Bist du bereit für ein richtiges Abenteuer? Pack die Sachen ein, wir erkunden diesen Ort mit voller Power und bester Laune!',
  },
];

function loadKokoroVocab() {
  const src = fs.readFileSync(
    path.join(ROOT, 'src', 'constants', 'kokoroVocab.ts'),
    'utf8',
  );
  const vocab: Record<string, number> = {};
  const re = /(?:['"]([^'"]+)['"]|([A-Za-z_]))\s*:\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let key = m[1] ?? m[2];
    key = key.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    );
    key = key
      .replace(/\\n/g, '\n')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
    vocab[key] = Number(m[3]);
  }
  console.log(`[preRenderAudio] Vocab: ${Object.keys(vocab).length} Zeichen`);
  return vocab;
}

function resolveEspeakBin() {
  const candidates = [
    process.env.ESPEAK_NG_PATH,
    'C:\\Program Files\\eSpeak NG\\espeak-ng.exe',
    'C:\\Program Files (x86)\\eSpeak NG\\espeak-ng.exe',
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'espeak-ng';
}

const ESPEAK_BIN = resolveEspeakBin();

/** IPA-typische Zeichen — Werte damit bleiben IPA, keine Ortho-Hints. */
const IPA_HINT_RE =
  /[ˈˌːɪʊəɛɔɑɒæθðʃʒŋɡɟçʁβɸχʏøœʌɒɟɲʎʋɹɾʈɖɤɘɵɨʉɶ]/u;

function isOrthoPronunciation(value: string): boolean {
  const v = value.trim();
  if (!v || IPA_HINT_RE.test(v)) return false;
  return /^[A-Za-zÄÖÜäöüß\s'-]+$/.test(v);
}

function matchWordCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement.charAt(0).toLowerCase() + replacement.slice(1);
}

/**
 * Aktueller Aussprache-Stand: englishOrtho + deProblemWords + pronunciations.json
 * (Ortho-Hints wie Bus→Buss, Hof→Hoff, safe→seef, Vibe→Vaib).
 */
function loadAudioOrthoMap(): Map<string, string> {
  const map = new Map<string, string>();
  const dataDir = path.join(ROOT, 'src', 'assets', 'data');
  const files = [
    'englishOrthoPronunciations.json',
    'deProblemWordPronunciations.json',
    'pronunciations.json',
  ];
  for (const file of files) {
    const full = path.join(dataDir, file);
    if (!fs.existsSync(full)) continue;
    const record = JSON.parse(fs.readFileSync(full, 'utf8')) as Record<
      string,
      string
    >;
    const orthoOnly = file === 'pronunciations.json';
    for (const [k, v] of Object.entries(record)) {
      const key = k.normalize('NFKC').toLowerCase().trim();
      const val = String(v ?? '').trim();
      if (!key || !val) continue;
      if (orthoOnly && !isOrthoPronunciation(val)) continue;
      map.set(key, val);
    }
  }
  // Harte Studio-Fixes (gewinnen)
  for (const [k, v] of Object.entries({
    bus: 'Buss',
    busse: 'Busse',
    hof: 'Hoff',
    höfe: 'Höffe',
    hoefe: 'Höffe',
    bahnhof: 'Bahnoff',
    safe: 'seef',
    vibe: 'Vaib',
    vibes: 'Vaibz',
    bro: 'Broh',
    guide: 'Geid',
    blockbuster: 'Blockbastä',
  })) {
    map.set(k, v);
  }
  console.log(`[preRenderAudio] Ortho-Lexikon: ${map.size} Einträge`);
  return map;
}

function applyAudioOrtho(text: string, ortho: Map<string, string>): string {
  let s = text.normalize('NFKC');
  const phrases = [...ortho.keys()]
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const repl = ortho.get(phrase);
    if (!repl || !s.toLowerCase().includes(phrase)) continue;
    const re = new RegExp(
      `\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'gi',
    );
    s = s.replace(re, (m) => matchWordCase(m, repl));
  }
  s = s.replace(/[\p{L}][\p{L}'’-]*/gu, (word) => {
    const key = word.toLowerCase().replace(/’/g, "'");
    const hit = ortho.get(key) ?? ortho.get(key.replace(/-/g, ''));
    if (!hit) return word;
    return matchWordCase(word, hit);
  });
  return s;
}

function loadPhonemizer(vocab: Record<string, number>) {
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const vocabChars = new Set(Object.keys(vocab));

  function mapEspeakIpaToKokoro(ipa: string): string {
    let s = ipa.normalize('NFC');
    s = s.replace(/\u028f/g, 'y'); // ʏ → y
    s = s.replace(/\u0265/g, 'y'); // ɥ → y
    s = s.replace(/\u03c7/g, 'x'); // χ → x
    s = s.replace(/g/g, '\u0261'); // ASCII g → IPA ɡ
    s = s.replace(/\u027e/g, 'r');
    s = s.replace(/\u0279/g, 'ʁ');
    s = s.replace(/\u00f0/g, 'd');
    s = s.replace(/\u03b8/g, 't');
    s = s.replace(/\u00e6/g, 'ɛ');
    s = s.replace(/\u025c/g, 'ə');
    s = s.replace(/\u025a/g, 'ə');
    s = s.replace(/\u2013/g, '\u2014');
    s = s.replace(/\.{3,}/g, '\u2026');
    s = s.replace(/\s+/g, ' ').trim();
    let out = '';
    for (const ch of s) {
      if (vocabChars.has(ch)) out += ch;
    }
    return out.trim();
  }

  function phonemizeEspeak(text: string): string | null {
    try {
      const r = spawnSync(
        ESPEAK_BIN,
        ['-v', 'de', '--ipa', '-q', text],
        {
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 2_000_000,
          shell: false,
        },
      );
      if (r.error) {
        console.warn('[preRenderAudio] espeak spawn:', r.error.message);
        return null;
      }
      if (r.status !== 0) {
        console.warn(
          '[preRenderAudio] espeak status',
          r.status,
          (r.stderr || '').slice(0, 200),
        );
        return null;
      }
      const raw = (r.stdout || '').replace(/\r/g, '').trim();
      if (!raw) return null;
      const mapped = mapEspeakIpaToKokoro(raw);
      return mapped.length >= 3 ? mapped : null;
    } catch (e) {
      console.warn('[preRenderAudio] espeak error:', e);
      return null;
    }
  }

  // JS-Fallback (nur wenn espeak fehlt) — gekürzt aus g2p_de_rules
  const rulesPath = path.join(
    ROOT,
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
  const MAP: Record<string, string> = {
    ʏ: 'y',
    ã: 'a',
    ẽ: 'e',
    õ: 'o',
    χ: 'x',
    // IPA ɡ bleibt ɡ (Kokoro-Vocab) — nicht nach ASCII g mappen
  };
  const DEVOICE: Record<string, string> = {
    b: 'p',
    d: 't',
    g: 'k',
    v: 'f',
    z: 's',
    ʒ: 'ʃ',
  };
  const VOICED = new Set(Object.keys(DEVOICE));

  function chRule(word: string, i: number) {
    if (i === 0) return ['k'];
    if (i >= 2 && word.slice(i - 2, i) === 'au') return ['x'];
    if (BACK.includes(word[i - 1])) return ['x'];
    return ['ç'];
  }
  function stRule(word: string, i: number) {
    if (i === 0) return ['ʃ', 't'];
    for (const p of PREFIXES)
      if (word.startsWith(p) && i === p.length) return ['ʃ', 't'];
    return ['s', 't'];
  }
  function spRule(word: string, i: number) {
    if (i === 0) return ['ʃ', 'p'];
    for (const p of PREFIXES)
      if (word.startsWith(p) && i === p.length) return ['ʃ', 'p'];
    return ['s', 'p'];
  }
  function rRule(word: string, i: number) {
    if (i === word.length - 1 && i > 0 && ALL_V.includes(word[i - 1]))
      return ['ɐ'];
    return ['ʁ'];
  }
  function sRule(word: string, i: number) {
    if (i === 0 && i + 1 < word.length && ALL_V.includes(word[i + 1]))
      return ['z'];
    if (
      i > 0 &&
      i < word.length - 1 &&
      ALL_V.includes(word[i - 1]) &&
      ALL_V.includes(word[i + 1])
    )
      return ['z'];
    return ['s'];
  }
  function vRule(word: string) {
    for (const f of LOANWORD_V) if (word.includes(f)) return ['v'];
    return ['f'];
  }
  const CB: Record<string, (w: string, i: number) => string[]> = {
    ch: chRule,
    chs: (w, i) =>
      i + 3 === w.length || (i + 3 < w.length && w[i + 3] === 't')
        ? ['k', 's']
        : [...chRule(w, i), 's'],
    st: stRule,
    sp: spRule,
    r: rRule,
    s: sRule,
    v: (w, i) => vRule(w),
  };

  function applyRules(word: string) {
    const lower = word.toLowerCase();
    const out: string[] = [];
    let i = 0;
    while (i < lower.length) {
      let matched = false;
      for (const [pat, action] of RULES) {
        if (lower.slice(i, i + pat.length) === pat) {
          if (action && action.callback)
            out.push(...CB[action.callback](lower, i));
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

  function toKokoro(phones: string[]) {
    const flat: string[] = [];
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

  function phonemizeJs(text: string) {
    const words = text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[„“«»']/g, "'")
      .split(/\s+/)
      .filter(Boolean);
    const phones: string[] = [];
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
      phones.push(...toKokoro(base));
      for (const ch of trail) {
        if (',.!?;:'.includes(ch) || ch === '—' || ch === '–')
          phones.push(ch === '—' || ch === '–' ? '—' : ch);
        if (ch === '…') phones.push('…');
      }
    }
    return phones.join('');
  }

  const probe = phonemizeEspeak('Hallo Findus');
  if (probe) {
    console.log(
      `[preRenderAudio] G2P: espeak-ng (${ESPEAK_BIN}) probe="${probe.slice(0, 60)}"`,
    );
  } else {
    console.warn(
      `[preRenderAudio] G2P: JS-Fallback (espeak-ng nicht nutzbar, bin=${ESPEAK_BIN})`,
    );
  }

  return function phonemize(text: string) {
    const viaEspeak = phonemizeEspeak(text);
    if (viaEspeak) return viaEspeak;
    return phonemizeJs(text);
  };
}

function textToTokenIds(phonemes: string, vocab: Record<string, number>) {
  const capped = phonemes.slice(0, 480);
  const ids = [0];
  for (const ch of capped) {
    const id = vocab[ch] ?? vocab[ch.toLowerCase?.() ? ch.toLowerCase() : ch];
    if (id !== undefined) ids.push(id);
    else if (ch === ' ') ids.push(16);
  }
  ids.push(0);
  return BigInt64Array.from(ids.map((n) => BigInt(n)));
}

function pickStyle(styles: Float32Array, tokenLen: number) {
  const index = Math.min(Math.max(tokenLen, 0), STYLE_FRAMES - 1);
  return styles.subarray(index * STYLE_DIM, index * STYLE_DIM + STYLE_DIM);
}

function trimSilence(pcm: Float32Array) {
  const frame = 240; // 10 ms @ 24 kHz
  const speechThresh = 0.02;
  const minSpeechFrames = 3;

  const energies: number[] = [];
  for (let i = 0; i < pcm.length; i += frame) {
    const end = Math.min(pcm.length, i + frame);
    let e = 0;
    for (let j = i; j < end; j++) e += Math.abs(pcm[j]);
    energies.push(e / Math.max(1, end - i));
  }

  let first = -1;
  let last = -1;
  let run = 0;
  for (let i = 0; i < energies.length; i++) {
    if (energies[i] >= speechThresh) {
      run += 1;
      if (run >= minSpeechFrames && first < 0) first = i - minSpeechFrames + 1;
      last = i;
    } else {
      run = 0;
    }
  }

  if (first < 0 || last < 0) {
    // Fallback: einfaches Peak-Trim
    const threshold = 0.01;
    let end = pcm.length - 1;
    while (end > 0 && Math.abs(pcm[end]) < threshold) end -= 1;
    end = Math.min(pcm.length, end + 32);
    let start = 0;
    while (start < pcm.length && Math.abs(pcm[start]) < threshold) start += 1;
    start = Math.max(0, start - 16);
    return pcm.subarray(start, Math.max(start + 1, end + 1));
  }

  // Nach dem letzten Sprachframe: abschneiden, sobald 250 ms unter Schwellwert
  const quietLimit = Math.ceil(0.25 * SAMPLE_RATE / frame);
  let cut = last;
  let quiet = 0;
  for (let i = last + 1; i < energies.length; i++) {
    if (energies[i] < speechThresh * 0.6) {
      quiet += 1;
      if (quiet >= quietLimit) {
        cut = i - quietLimit;
        break;
      }
    } else {
      quiet = 0;
      cut = i;
    }
  }

  const pad = Math.floor(0.05 * SAMPLE_RATE); // 50 ms
  const start = Math.max(0, first * frame - pad);
  const end = Math.min(pcm.length, (cut + 1) * frame + pad);
  return pcm.subarray(start, Math.max(start + 1, end));
}

function encodeWav(pcm: Float32Array) {
  const trimmed = trimSilence(pcm);
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = SAMPLE_RATE * blockAlign;
  const dataSize = trimmed.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < trimmed.length; i++) {
    const s = Math.max(-1, Math.min(1, trimmed[i]));
    buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, offset);
    offset += 2;
  }
  return buffer;
}

function loadVoiceStyles(packId: string) {
  const binPath = path.join(VOICES_DIR, `${packId}.bin`);
  if (!fs.existsSync(binPath)) throw new Error(`Voice fehlt: ${binPath}`);
  const buf = fs.readFileSync(binPath);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** Lange Texte in 2–3 Chunks splitten (Kokoro-Token-Limit), PCM mergen. */
function splitForSynth(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 180) return [clean];
  const parts = clean.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (parts.length <= 1) return [clean];
  const chunks: string[] = [];
  let buf = '';
  for (const p of parts) {
    if (buf && (buf + ' ' + p).length > 200) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf} ${p}` : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function concatPcm(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function main() {
  if (!fs.existsSync(MODEL)) {
    console.error('[preRenderAudio] FEHLT:', MODEL);
    console.error('Zuerst: npm run fetch:kokoro');
    process.exit(1);
  }

  let ort;
  try {
    ort = require('onnxruntime-node');
  } catch {
    console.error(
      '[preRenderAudio] onnxruntime-node fehlt — npm install -D onnxruntime-node',
    );
    process.exit(1);
  }

  fs.mkdirSync(SAMPLES_OUT, { recursive: true });
  const vocab = loadKokoroVocab();
  const phonemize = loadPhonemizer(vocab);
  const ortho = loadAudioOrthoMap();
  const styleCache = new Map<string, Float32Array>();

  console.log('[preRenderAudio] Lade Kokoro-Martin…');
  const session = await ort.InferenceSession.create(MODEL);

  async function synthChunk(text: string, packId: string): Promise<Float32Array> {
    if (!styleCache.has(packId))
      styleCache.set(packId, loadVoiceStyles(packId));
    const styles = styleCache.get(packId)!;
    const audioText = applyAudioOrtho(text, ortho);
    const ipa = phonemize(audioText);
    const tokens = textToTokenIds(ipa, vocab);
    console.log(
      `    chunk "${text.slice(0, 40)}…" ortho="${audioText.slice(0, 40)}…" ipa=${ipa.length} tokens=${tokens.length}`,
    );
    const style = pickStyle(styles, Number(tokens.length));

    const feeds: Record<string, unknown> = {};
    const inputNames = session.inputNames as string[];
    const tokenName =
      inputNames.find((n) => /token/i.test(n)) ?? inputNames[0];
    const styleName =
      inputNames.find((n) => /style|voice|ref/i.test(n)) ?? inputNames[1];
    const speedName = inputNames.find((n) => /speed/i.test(n));
    const langName = inputNames.find((n) => /lang/i.test(n));

    feeds[tokenName] = new ort.Tensor('int64', tokens, [1, tokens.length]);
    feeds[styleName] = new ort.Tensor('float32', style, [1, STYLE_DIM]);
    if (speedName)
      feeds[speedName] = new ort.Tensor(
        'float32',
        Float32Array.from([SPEED]),
        [1],
      );
    if (langName)
      feeds[langName] = new ort.Tensor(
        'int64',
        BigInt64Array.from([BigInt('d'.charCodeAt(0))]),
        [1],
      );

    const results = await session.run(feeds);
    const outName =
      session.outputNames.find((n: string) =>
        /audio|waveform|output/i.test(n),
      ) ?? session.outputNames[0];
    const audio = results[outName]?.data;
    if (!audio || audio.length === 0) throw new Error('Kein Audio');
    return audio instanceof Float32Array ? audio : Float32Array.from(audio);
  }

  async function synth(text: string, packId: string): Promise<Buffer> {
    const chunks = splitForSynth(text);
    const pcms: Float32Array[] = [];
    for (const c of chunks) {
      pcms.push(await synthChunk(c, packId));
    }
    return encodeWav(concatPcm(pcms));
  }

  const introPath = path.join(AUDIO_ROOT, 'intro.wav');
  console.log('[preRenderAudio] intro.wav…');
  fs.writeFileSync(introPath, await synth(INTRO_TEXT, 'de_thorsten'));
  const introSec = (
    (fs.statSync(introPath).size - 44) /
    (SAMPLE_RATE * 2)
  ).toFixed(1);
  console.log(`  OK intro.wav (${introSec}s, ${fs.statSync(introPath).size} bytes)`);

  // Legacy-Alias für alte Bundles
  const legacyIntro = path.join(SAMPLES_OUT, 'intro-welcome-de.wav');
  fs.copyFileSync(introPath, legacyIntro);

  for (const v of VOICES) {
    const name = `${v.id}.wav`;
    const dest = path.join(SAMPLES_OUT, name);
    console.log(`[preRenderAudio] Sample ${v.id}…`);
    fs.writeFileSync(dest, await synth(v.sample, v.pack));
    const sec = (
      (fs.statSync(dest).size - 44) /
      (SAMPLE_RATE * 2)
    ).toFixed(1);
    console.log(`  OK ${name} (${sec}s, ${fs.statSync(dest).size} bytes)`);
  }

  console.log(`\n[preRenderAudio] Fertig → ${AUDIO_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
