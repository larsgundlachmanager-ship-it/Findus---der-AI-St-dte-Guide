/**
 * Validiert de-DE IPA für den Findus-Testsatz.
 * Nutzt espeak-ng CLI falls installiert, sonst erwartet dokumentierte DE-Merkmale
 * und prüft den JS→IPA-Mapper gegen englische Phoneme.
 *
 * Usage: node scripts/validate-native-espeak-g2p.cjs
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SENTENCE =
  'Willkommen bei Findus, deinem historischen Reiseführer.';

const ENGLISH_ONLY = /[θðæɹɾ]/u;

/** Spiegel von mapEspeakIpaToIPA (ohne Vocab-Filter für CLI-Check) */
function mapEspeakIpa(ipa) {
  let s = ipa.normalize('NFC');
  s = s.replace(/\u028f/g, 'y');
  s = s.replace(/\u0265/g, 'y');
  s = s.replace(/\u03c7/g, 'x');
  s = s.replace(/\u0261/g, 'g');
  s = s.replace(/\u027e/g, 'r');
  s = s.replace(/\u0279/g, 'ʁ');
  s = s.replace(/\u00f0/g, 'd');
  s = s.replace(/\u03b8/g, 't');
  s = s.replace(/\u00e6/g, 'ɛ');
  s = s.replace(/\u025c/g, 'ə');
  s = s.replace(/\u025a/g, 'ə');
  return s.replace(/\s+/g, ' ').trim();
}

function findEspeakCli() {
  for (const bin of ['espeak-ng', 'espeak']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 || (r.stdout || r.stderr || '').includes('eSpeak')) {
      return bin;
    }
  }
  return null;
}

function phonemizeCli(bin, text) {
  // -v de --ipa -q
  const out = execFileSync(
    bin,
    ['-v', 'de', '--ipa', '-q', text],
    { encoding: 'utf8' },
  );
  return out.trim();
}

function checkIpa(ipa, label) {
  const checks = [
    ['nicht leer', ipa.length > 4],
    ['keine engl. θðæɹɾ', !ENGLISH_ONLY.test(ipa)],
    ['DE-Vokale/Konsonanten', /[ɪəʁʃçɔʊøœyɛ]/.test(ipa)],
    ['kein ASCII oe/ue Digraph-Ersatz', !ipa.includes('oe') && !ipa.includes('ue')],
  ];
  console.log(`\n[${label}] ${ipa}`);
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(ok ? '  ✓' : '  ✗', name);
    if (!ok) failed += 1;
  }
  return failed;
}

let failed = 0;

const cli = findEspeakCli();
if (cli) {
  console.log('espeak CLI:', cli);
  const raw = phonemizeCli(cli, SENTENCE);
  failed += checkIpa(raw, 'espeak-ng raw de');
  const mapped = mapEspeakIpa(raw);
  failed += checkIpa(mapped, 'mapped → IPA');
} else {
  console.log('espeak-ng CLI nicht installiert — Offline-Erwartungstest');
  // Typische espeak-ng de IPA (Referenz; kann je nach Version leicht abweichen)
  const reference =
    'vˈɪlkɔmən baɪ fˈɪndʊs, dˈaɪnəm hˌɪstˈoːʁɪʃən rˈaɪzəfyːʁɐ.';
  failed += checkIpa(reference, 'Referenz-IPA (de)');
  failed += checkIpa(mapEspeakIpa(reference), 'mapped Referenz');
  console.log(
    '\nHinweis: Für Live-CLI-Check espeak-ng installieren, dann erneut:',
  );
  console.log('  npm run validate:espeak');
}

// Asset/Source presence
const data = path.join(__dirname, '..', 'native-assets', 'espeak-ng-data');
const src = path.join(
  __dirname,
  '..',
  'modules',
  'findus-espeak',
  'android',
  'src',
  'main',
  'cpp',
  'third_party',
  'espeak-ng',
  'src',
  'include',
  'espeak-ng',
  'speak_lib.h',
);
const so = path.join(
  __dirname,
  '..',
  'modules',
  'findus-espeak',
  'android',
  'src',
  'main',
  'jniLibs',
  'arm64-v8a',
  'libttsespeak.so',
);
console.log('\nNative Artefakte:');
console.log(
  fs.existsSync(path.join(data, 'phontab')) ? '  ✓' : '  ✗',
  'native-assets/espeak-ng-data',
);
console.log(fs.existsSync(src) ? '  ✓' : '  ✗', 'espeak-ng headers');
console.log(fs.existsSync(so) ? '  ✓' : '  ✗', 'libttsespeak.so (arm64)');
if (
  !fs.existsSync(path.join(data, 'phontab')) ||
  !fs.existsSync(src) ||
  !fs.existsSync(so)
) {
  console.log('  → npm run fetch:espeak');
  failed += 1;
}

console.log('\nINPUT:', SENTENCE);
process.exit(failed === 0 ? 0 : 1);
