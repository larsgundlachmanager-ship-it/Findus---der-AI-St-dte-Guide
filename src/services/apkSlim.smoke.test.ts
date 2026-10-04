/**
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
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !name.includes('.smoke.')) {
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

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  if (/require\s*\(\s*['"][^'"]*data\/staedte\//.test(text)) {
    packRequireHits.push(relative(root, file));
  }
  if (/require\s*\(\s*['"][^'"]*onboarding\/city-(?!card-hero)/.test(text)) {
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
  /const COVERS:\s*Record<[^>]+>\s*=\s*\{\s*\}/.test(covers),
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
  fuzzy.includes('peekCityIndexCache') &&
    !fuzzy.includes('data/staedte/index.json'),
  'fuzzyCityResolve nutzt Katalog-Cache statt Pack-Index-require',
);

const metroSrc = readFileSync(join(root, 'metro.config.js'), 'utf8');
assert(metroSrc.includes('/data/staedte/'), 'Metro blockList: data/staedte');
assert(
  metroSrc.includes('onboarding/city-'),
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
  !patterns.some(
    (p) =>
      p === '**/*' || p === 'assets/**/*' || p === 'assets/onboarding/**/*',
  ),
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

const easSrc = readFileSync(join(root, '.easignore'), 'utf8');
assert(easSrc.includes('/data/') || easSrc.includes('data/'), 'easignore: data/');
assert(
  easSrc.includes('city-*.png') || easSrc.includes('city-'),
  'easignore: Stadt-Cover-PNGs',
);

console.log('apkSlim.smoke.test.ts OK');
