from pathlib import Path
import json

ROOT = Path(r"C:\Users\larsf\Findus 2.0")
metro = ROOT / "metro.config.js"
mt = metro.read_text(encoding="utf-8")

# File contains: '/src/assets/piper/.*\\.onnx$',  (two backslash chars)
insert_after = "'/src/assets/piper/.*\\\\.onnx$',"
assert insert_after in mt, repr(insert_after)

if "/data/staedte/" not in mt:
    extra = (
        insert_after
        + """
    // Stadt-Packs/Index nie per require() in die APK (remote Supabase)
    '/data/staedte/',
    // Cover-Master nur Upload-Pipeline — App lädt HTTPS cover_url
    '/assets/onboarding/city-.*\\\\.png$',
    '/assets/onboarding/.*-soft\\\\.png$',
    // Dev-only Audio (nicht Voice-Preview)
    '/src/assets/audio/samples/',
    '/src/assets/audio/_female_audit/',"""
    )
    mt = mt.replace(insert_after, extra, 1)
    tmp = metro.with_suffix(".js.new")
    tmp.write_text(mt, encoding="utf-8", newline="\n")
    tmp.replace(metro)
    print("metro ok")
else:
    print("metro already")

appj = ROOT / "app.json"
aj = json.loads(appj.read_text(encoding="utf-8"))
aj["expo"]["assetBundlePatterns"] = [
    "assets/icon.png",
    "assets/adaptive-icon.png",
    "assets/splash-icon.png",
    "assets/splash-logo-clear.png",
    "assets/notification-icon.png",
    "assets/notification-icon-192.png",
    "assets/onboarding/persona-*.jpg",
    "assets/onboarding/city-card-hero.jpg",
    "src/assets/audio/intro.wav",
    "src/assets/audio/voices/*",
    "src/assets/homeMap/**/*",
    "src/assets/data/**/*",
    "src/assets/phonetics/**/*",
]
appj.write_text(
    json.dumps(aj, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
    newline="\n",
)
print("app.json ok")

eas = ROOT / ".easignore"
et = eas.read_text(encoding="utf-8")
extras = """
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
"""
if "src/assets/audio/samples/" not in et:
    eas.write_text(et.rstrip() + "\n" + extras, encoding="utf-8", newline="\n")
    print("easignore ok")
else:
    print("easignore already")

smoke = ROOT / "src/services/apkSlim.smoke.test.ts"
smoke.write_text(
    """/**
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

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  if (/require\\s*\\(\\s*['\"][^'\"]*data\\/staedte\\//.test(text)) {
    packRequireHits.push(relative(root, file));
  }
  if (/require\\s*\\(\\s*['\"][^'\"]*onboarding\\/city-(?!card-hero)/.test(text)) {
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
  /const COVERS:\\s*Record<[^>]+>\\s*=\\s*\\{\\s*\\}/.test(covers),
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
""",
    encoding="utf-8",
    newline="\n",
)
print("smoke ok")

pkg = ROOT / "package.json"
pj = json.loads(pkg.read_text(encoding="utf-8"))
pj["scripts"]["test:apk-slim"] = (
    "npx --yes --package tsx@4.19.4 tsx src/services/apkSlim.smoke.test.ts"
)
pkg.write_text(
    json.dumps(pj, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
    newline="\n",
)
print("package.json ok")
print("DONE")
