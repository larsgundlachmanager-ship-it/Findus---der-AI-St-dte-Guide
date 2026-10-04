from pathlib import Path
import re
import json

ROOT = Path(r"C:\Users\larsf\Findus 2.0")

# --- 1) fuzzyCityResolve: kein require(data/staedte/index.json) ---
fuzzy = ROOT / "src/services/navigation/fuzzyCityResolve.ts"
ft = fuzzy.read_text(encoding="utf-8")
old = '''/** Städte aus Pack-Index (sync, optional). */
export function loadNearbyCitiesFromIndex(): NearbyCity[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const index = require('../../../data/staedte/index.json') as {
      available_cities?: Array<{
        name?: string;
        lat?: number;
        lng?: number;
      }>;
    };
    return (index.available_cities ?? [])
      .filter(
        (c) =>
          typeof c.name === 'string' &&
          Number.isFinite(c.lat) &&
          Number.isFinite(c.lng),
      )
      .map((c) => ({
        name: c.name!.trim(),
        lat: c.lat!,
        lng: c.lng!,
      }));
  } catch {
    return [];
  }
}
'''
new = '''/**
 * Städte aus remote Katalog-Cache (sync).
 * Kein require(data/staedte/*) — Packs/Index bleiben remote, APK bleibt schlank.
 */
export function loadNearbyCitiesFromIndex(): NearbyCity[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { peekCityIndexCache } = require('../cityCatalogService') as {
      peekCityIndexCache: () => Array<{
        name?: string;
        lat?: number;
        lng?: number;
      }> | null;
    };
    const entries = peekCityIndexCache() ?? [];
    return entries
      .filter(
        (c) =>
          typeof c.name === 'string' &&
          Number.isFinite(c.lat) &&
          Number.isFinite(c.lng),
      )
      .map((c) => ({
        name: String(c.name).trim(),
        lat: c.lat!,
        lng: c.lng!,
      }));
  } catch {
    return [];
  }
}
'''
if old not in ft:
    raise SystemExit('fuzzyCityResolve block not found')
ft = ft.replace(old, new, 1)
tmp = fuzzy.with_suffix('.ts.new')
tmp.write_text(ft, encoding='utf-8', newline='\n')
tmp.replace(fuzzy)
print('fuzzyCityResolve ok')

# --- 2) metro blockList: data/staedte + cover masters + audit audio ---
metro = ROOT / "metro.config.js"
mt = metro.read_text(encoding='utf-8')
old_bl = '''config.resolver.blockList = new RegExp(
  [
    '/android/',
    '/ios/',
    '/node_modules/[^/]+/android/',
    '/\\.cxx/',
    '/\\.gradle/',
    '/__tests__/',
    // Legacy ONNX under src/assets/piper — native only, not Metro
    '/src/assets/piper/.*\\.onnx$',
  ].join('|'),
);
'''
new_bl = '''config.resolver.blockList = new RegExp(
  [
    '/android/',
    '/ios/',
    '/node_modules/[^/]+/android/',
    '/\\.cxx/',
    '/\\.gradle/',
    '/__tests__/',
    // Legacy ONNX under src/assets/piper — native only, not Metro
    '/src/assets/piper/.*\\.onnx$',
    // Stadt-Packs/Index nie per require() in die APK (remote Supabase)
    '/data/staedte/',
    // Cover-Master nur Upload-Pipeline — App lädt HTTPS cover_url
    '/assets/onboarding/city-.*\\\\.png$',
    '/assets/onboarding/.*-soft\\\\.png$',
    // Dev-only Audio (nicht Voice-Preview)
    '/src/assets/audio/samples/',
    '/src/assets/audio/_female_audit/',
  ].join('|'),
);
'''
if old_bl not in mt:
    raise SystemExit('metro blockList not found')
mt = mt.replace(old_bl, new_bl, 1)
tmpm = metro.with_suffix('.js.new')
tmpm.write_text(mt, encoding='utf-8', newline='\n')
tmpm.replace(metro)
print('metro ok')

# --- 3) app.json assetBundlePatterns whitelist ---
appj = ROOT / "app.json"
aj = json.loads(appj.read_text(encoding='utf-8'))
aj['expo']['assetBundlePatterns'] = [
  'assets/icon.png',
  'assets/adaptive-icon.png',
  'assets/splash-icon.png',
  'assets/splash-logo-clear.png',
  'assets/notification-icon.png',
  'assets/notification-icon-192.png',
  'assets/onboarding/persona-*.jpg',
  'assets/onboarding/city-card-hero.jpg',
  'src/assets/audio/intro.wav',
  'src/assets/audio/voices/*',
  'src/assets/homeMap/**/*',
  'src/assets/data/**/*',
  'src/assets/phonetics/**/*',
]
# write preserving unicode as-is via ensure_ascii False
# keep pretty indent 2 like expo
appj.write_text(json.dumps(aj, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
print('app.json assetBundlePatterns ok')

# --- 4) .easignore harden ---
eas = ROOT / ".easignore"
et = eas.read_text(encoding='utf-8')
extras = '''
# Dev-Audio / Drafts — nicht in EAS-Archive (APK schlank)
src/assets/audio/samples/
src/assets/audio/_female_audit/
assets/brand/
assets/_icon-crops/
assets/onboarding/map-bg.png
assets/onboarding/phone-mockup.png
assets/onboarding/findus-*.png
assets/onboarding/yorro-*.png
assets/onboarding/_*-cover-source.png
assets/icon-*.png
assets/_*.py
'''
if 'src/assets/audio/samples/' not in et:
    eas.write_text(et.rstrip() + '\n' + extras, encoding='utf-8', newline='\n')
    print('easignore ok')
else:
    print('easignore already has samples')

# --- 5) Smoke test ---
smoke = ROOT / "src/services/apkSlim.smoke.test.ts"
smoke.write_text('''/**
 * APK schlank: Covers/Packs remote — kein require(data/staedte), keine Cover-PNGs.
 * Run: npm run test:apk-slim
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const root = process.cwd();

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (
      name === 'node_modules' ||
      name === '.cursor' ||
      name === 'android' ||
      name === 'ios' ||
      name === 'dist'
    ) {
      continue;
    }
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkTsFiles(p, out);
    else if (/\\.(ts|tsx|js|jsx)$/.test(name) && !name.includes('.smoke.')) {
      out.push(p);
    }
  }
  return out;
}

const srcFiles = walkTsFiles(join(root, 'src')).concat(
  [join(root, 'App.tsx'), join(root, 'index.ts')].filter((p) => {
    try {
      statSync(p);
      return true;
    } catch {
      return false;
    }
  }),
);

const packRequireHits: string[] = [];
const coverRequireHits: string[] = [];
const requireAssetRe =
  /require\\s*\\(\\s*['"]([^'"]+\\.(?:png|jpg|jpeg|webp|json|mp3|wav))['"]\\s*\\)/gi;

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  if (/require\\s*\\(\\s*['"][^'"]*data\\/staedte\\//.test(text)) {
    packRequireHits.push(relative(root, file));
  }
  if (/require\\s*\\(\\s*['"][^'"]*onboarding\\/city-(?!card-hero)/.test(text)) {
    coverRequireHits.push(relative(root, file));
  }
}

assert(
  packRequireHits.length === 0,
  `kein require(data/staedte/*) — hits: ${packRequireHits.join(', ') || 'none'}`,
);
assert(
  coverRequireHits.length === 0,
  `kein require(Stadt-Cover-PNG) — hits: ${coverRequireHits.join(', ') || 'none'}`,
);

const covers = readFileSync(join(root, 'src/constants/cityCovers.ts'), 'utf8');
assert(
  /const COVERS:\\s*Record<[^>]+>\\s*=\\s*\\{\\s*\\}/.test(covers) ||
    covers.includes('const COVERS: Record<string, ImageSourcePropType> = {}'),
  'cityCovers COVERS bleibt leer (remote cover_url)',
);
assert(
  covers.includes('cover_url') || covers.includes('HTTPS'),
  'cityCovers dokumentiert remote Covers',
);

const fuzzy = readFileSync(
  join(root, 'src/services/navigation/fuzzyCityResolve.ts'),
  'utf8',
);
assert(
  fuzzy.includes('peekCityIndexCache') && !fuzzy.includes('data/staedte/index.json'),
  'fuzzyCityResolve nutzt Katalog-Cache statt Pack-Index-require',
);

const metro = readFileSync(join(root, 'metro.config.js'), 'utf8');
assert(metro.includes('/data/staedte/'), 'Metro blockList: data/staedte');
assert(
  metro.includes('city-') && metro.includes('onboarding'),
  'Metro blockList: Cover-Master PNGs',
);

const appJson = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as {
  expo?: { assetBundlePatterns?: string[] };
};
const patterns = appJson.expo?.assetBundlePatterns ?? [];
assert(patterns.length > 0, 'assetBundlePatterns gesetzt (Whitelist)');
assert(
  patterns.some((p) => p.includes('city-card-hero')),
  'Whitelist enthält city-card-hero',
);
assert(
  !patterns.some((p) => p === '**/*' || p === 'assets/**/*' || p === 'assets/onboarding/**/*'),
  'keine breite assets/** Whitelist (Cover-Master sonst mit)',
);
assert(
  patterns.some((p) => p.includes('src/assets/audio/voices')),
  'Voice-Previews whitelisted',
);
assert(
  !patterns.some((p) => p.includes('samples') || p.includes('_female_audit')),
  'Dev-Audio samples/audit nicht in assetBundlePatterns',
);

const eas = readFileSync(join(root, '.easignore'), 'utf8');
assert(eas.includes('/data/') || eas.includes('data/'), 'easignore: data/');
assert(
  eas.includes('city-*.png') || eas.includes('city-'),
  'easignore: Stadt-Cover-PNGs',
);

// Inventar: erlaubte require()-Assets (nur zählen, Fail bei Pack/Cover)
const allowedRoots = [
  'assets/homeMap/',
  'src/assets/homeMap/',
  'assets/onboarding/persona-',
  'assets/onboarding/city-card-hero',
  'assets/splash',
  'src/assets/audio/intro',
  'src/assets/audio/voices/',
  'src/assets/data/',
  'src/assets/phonetics/',
  'ownerGold.pack.json',
];
const unexpected: string[] = [];
for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  requireAssetRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = requireAssetRe.exec(text))) {
    const rel = m[1].replace(/\\\\/g, '/');
    // resolve relative to file for display
    const hit = rel;
    if (hit.includes('data/staedte') || /city-[a-z0-9_-]+\\.png/i.test(hit)) {
      unexpected.push(`${relative(root, file)} → ${hit}`);
      continue;
    }
    const ok = allowedRoots.some((a) => hit.includes(a) || hit.endsWith(a));
    // relative paths like ../../assets/... still contain assets/
    if (
      !ok &&
      !hit.includes('assets/homeMap') &&
      !hit.includes('assets/onboarding/persona') &&
      !hit.includes('city-card-hero') &&
      !hit.includes('splash') &&
      !hit.includes('audio/voices') &&
      !hit.includes('audio/intro') &&
      !hit.includes('worldOverview') &&
      !hit.includes('worldLabels') &&
      !hit.includes('ownerGold.pack') &&
      !hit.includes('phonetics') &&
      !hit.includes('europeanBasePhonetics') &&
      !hit.includes('user-arrow') &&
      !hit.includes('notification')
    ) {
      // soft inventory — only fail hard packs/covers above
    }
  }
}
assert(unexpected.length === 0, `unerlaubte Assets: ${unexpected.join('; ')}`);

console.log('apkSlim.smoke.test.ts OK');
''', encoding='utf-8', newline='\n')
print('smoke written')

# --- 6) package.json script ---
pkg = ROOT / "package.json"
pj = json.loads(pkg.read_text(encoding='utf-8'))
pj['scripts']['test:apk-slim'] = (
  'npx --yes --package tsx@4.19.4 tsx src/services/apkSlim.smoke.test.ts'
)
pkg.write_text(json.dumps(pj, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
print('package.json ok')
print('DONE')
