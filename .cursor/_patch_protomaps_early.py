from pathlib import Path

ROOT = Path(r"C:\Users\larsf\Findus 2.0")

# --- 1) loadYorroProtomapsBasemapStyle: Disk + Netz parallel ---
style = ROOT / "src/services/homeMap/yorroProtomapsBasemapStyle.ts"
st = style.read_text(encoding="utf-8")

old_load = '''/**
 * Lädt Protomaps Style-JSON einmal, färbt um, cached (RAM + Disk).
 * Fehler → null (Caller behält Fallback-Hintergrund).
 */
export async function loadYorroProtomapsBasemapStyle(): Promise<StyleJson | null> {
  if (cached) return cached;
  if (inflight) return inflight;

  const url = resolveProtomapsStyleUrl();
  if (!url) return null;

  inflight = (async () => {
    try {
      const fromDisk = await readStyleFromDisk(url);
      if (fromDisk) {
        if (__DEV__) {
          console.log(
            '[map-vector] style disk hit',
            fromDisk.name || 'ok',
            'layers',
            fromDisk.layers.length,
          );
        }
        void refreshStyleFromNetwork(url);
        return fromDisk;
      }

      const res = await fetch(url);
      if (!res.ok) {
        if (__DEV__) console.warn('[map-vector] style fetch', res.status);
        return null;
      }
      const json = (await res.json()) as StyleJson;
      if (!json?.layers?.length || !json.sources) return null;
      const rawFp = protomapsStyleRawFingerprint(json);
      const recolored = recolorProtomapsStyleForYorro(json);
      rememberCached(recolored, rawFp);
      void writeStyleToDisk(url, recolored, rawFp);
      if (__DEV__) {
        console.log(
          '[map-vector] style loaded',
          recolored.name || 'ok',
          'layers',
          recolored.layers.length,
        );
      }
      return recolored;
    } catch (e) {
      if (__DEV__) console.warn('[map-vector] style fetch failed', e);
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

async function refreshStyleFromNetwork(url: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const json = (await res.json()) as StyleJson;
    if (!json?.layers?.length || !json.sources) return;
    const rawFp = protomapsStyleRawFingerprint(json);
    // Gleicher Roh-Fingerprint → kein Sync-Recolor.
    if (cached && cachedRawFp && cachedRawFp === rawFp) {
      return;
    }
    const next = recolorProtomapsStyleForYorro(json);
    rememberCached(next, rawFp);
    void writeStyleToDisk(url, next, rawFp);
  } catch {
    /* soft */
  }
}

/**
 * Sofort starten (Splash/Boot) — Disk zuerst, sonst Netz.
 * Dedupliziert; Map peekt danach aus RAM.
 */
export function beginYorroProtomapsStyleWarm(): Promise<StyleJson | null> {
  if (cached) return Promise.resolve(cached);
  if (splashWarmInflight) return splashWarmInflight;
  splashWarmInflight = (async () => {
    try {
      const fromDisk = await hydrateYorroProtomapsBasemapStyleFromDisk();
      if (fromDisk) return fromDisk;
      return await loadYorroProtomapsBasemapStyle();
    } finally {
      splashWarmInflight = null;
    }
  })();
  return splashWarmInflight;
}

/** Splash: Style so lange mitnehmen, bis Peek warm oder Budget um. */
export async function awaitYorroProtomapsStyleWarm(
  maxMs = 1_200,
): Promise<StyleJson | null> {
'''

new_load = '''/**
 * Netz-Fetch + Recolor + Cache. Soft bei Fehler.
 * Gleicher Roh-Fingerprint → kein erneutes Recolor.
 */
async function fetchRecolorAndCache(url: string): Promise<StyleJson | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (__DEV__) console.warn('[map-vector] style fetch', res.status);
      return null;
    }
    const json = (await res.json()) as StyleJson;
    if (!json?.layers?.length || !json.sources) return null;
    const rawFp = protomapsStyleRawFingerprint(json);
    // Gleicher Roh-Fingerprint → kein Sync-Recolor.
    if (cached && cachedRawFp && cachedRawFp === rawFp) {
      return cached;
    }
    const recolored = recolorProtomapsStyleForYorro(json);
    rememberCached(recolored, rawFp);
    void writeStyleToDisk(url, recolored, rawFp);
    if (__DEV__) {
      console.log(
        '[map-vector] style loaded',
        recolored.name || 'ok',
        'layers',
        recolored.layers.length,
      );
    }
    return recolored;
  } catch (e) {
    if (__DEV__) console.warn('[map-vector] style fetch failed', e);
    return null;
  }
}

/**
 * Lädt Protomaps Style-JSON einmal, färbt um, cached (RAM + Disk).
 * Disk + Netz parallel: Disk-Hit liefert sofort, Netz läuft als Soft-Refresh;
 * Cold-Miss wartet auf Netz ohne serielle Disk-Wartezeit vor dem Fetch.
 * Fehler → null (Caller behält Fallback-Hintergrund).
 */
export async function loadYorroProtomapsBasemapStyle(): Promise<StyleJson | null> {
  if (cached) return cached;
  if (inflight) return inflight;

  const url = resolveProtomapsStyleUrl();
  if (!url) return null;

  inflight = (async () => {
    try {
      // Fetch sofort starten — nicht hinter Disk-I/O verstecken.
      const diskP = readStyleFromDisk(url);
      const netP = fetchRecolorAndCache(url);

      const fromDisk = await diskP;
      if (fromDisk) {
        if (__DEV__) {
          console.log(
            '[map-vector] style disk hit',
            fromDisk.name || 'ok',
            'layers',
            fromDisk.layers.length,
          );
        }
        // Soft-Refresh bereits als netP unterwegs (gleicher Fetch).
        void netP;
        return fromDisk;
      }

      return await netP;
    } catch (e) {
      if (__DEV__) console.warn('[map-vector] style fetch failed', e);
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

async function refreshStyleFromNetwork(url: string): Promise<void> {
  try {
    await fetchRecolorAndCache(url);
  } catch {
    /* soft */
  }
}

/**
 * Sofort starten (Splash/Boot) — Disk+Netz parallel via load.
 * Dedupliziert; Map peekt danach aus RAM.
 */
export function beginYorroProtomapsStyleWarm(): Promise<StyleJson | null> {
  if (cached) return Promise.resolve(cached);
  if (splashWarmInflight) return splashWarmInflight;
  splashWarmInflight = loadYorroProtomapsBasemapStyle().finally(() => {
    splashWarmInflight = null;
  });
  return splashWarmInflight;
}

/** Splash: Style so lange mitnehmen, bis Peek warm oder Budget um. */
export async function awaitYorroProtomapsStyleWarm(
  maxMs = 2_400,
): Promise<StyleJson | null> {
'''

if old_load not in st:
    raise SystemExit('load/begin block not found')
st = st.replace(old_load, new_load, 1)
tmp = style.with_suffix('.ts.new')
tmp.write_text(st, encoding='utf-8', newline='\n')
tmp.replace(style)
print('yorroProtomapsBasemapStyle ok')

# --- 2) warmupHomeMap: Vector = Style + GPS, kein GeoJSON-Extract ---
warmup = ROOT / "src/services/homeMap/warmupHomeMap.ts"
wu = '''/**
 * Native-only Homescreen-Karte — MapLibre Native (kein WebView-HTML mehr).
 * Warmup: Protomaps-Style unter Splash; Legacy-Extract nur wenn Vector aus.
 */

import { hydrateLastKnownMapGps, seedMapCameraGps } from '../location/lastKnownMapGps';
import { getCachedUserProfile } from '../userProfileService';
import { env } from '../../config/env';
import {
  ensureCityMapExtract,
  hydrateDisplayExtract,
  peekDisplayExtract,
  prepareExtractForDisplay,
  rememberDisplayExtract,
} from './cityMapExtract';
import { noteSplashStarted } from './splashReadyGate';
import { useMapExtractStore } from '../../store/useMapExtractStore';
import {
  markHomeMapBoot,
  markHomeMapBootStart,
} from './homeMapBootMetrics';
import { isVectorBasemapEnabled } from './mapTileConfig';
import {
  awaitYorroProtomapsStyleWarm,
  beginYorroProtomapsStyleWarm,
} from './yorroProtomapsBasemapStyle';

/** Splash-Overlap: Style so lange mitnehmen, bis Peek warm oder Budget um. */
export const PROTOMAPS_STYLE_SPLASH_BUDGET_MS = 2_400;

let inflight: Promise<void> | null = null;
let cameraWarmUntilMs = 0;

export function noteSplashMapWarmup(ms = 8_000): void {
  cameraWarmUntilMs = Math.max(cameraWarmUntilMs, Date.now() + ms);
}

export function canWarmupMapCamera(): boolean {
  return Date.now() < cameraWarmUntilMs;
}

function pushSnapToMapStore(
  cityId: string,
  snap: {
    lat: number;
    lng: number;
    extract: NonNullable<ReturnType<typeof peekDisplayExtract>>['extract'];
  },
): void {
  useMapExtractStore.getState().setExtract(cityId, snap.extract, {
    lat: snap.lat,
    lng: snap.lng,
  });
}

async function warmupCityExtract(): Promise<void> {
  const cityId = (
    getCachedUserProfile()?.cityId ||
    env.cityId() ||
    ''
  ).toLowerCase();
  if (!cityId) return;
  await hydrateDisplayExtract(cityId);
  const existing = peekDisplayExtract(cityId);
  if (existing?.extract) {
    pushSnapToMapStore(cityId, existing);
    markHomeMapBoot('displayHydrate');
    // Kein Vollextract während des Intros — JSON.parse von 10–28 MB friert Dock/Mic ein.
    return;
  }
  const full = await ensureCityMapExtract(cityId);
  if (!full) return;
  const seed = seedMapCameraGps();
  const lat =
    seed?.lat ?? (full.bbox.south + full.bbox.north) / 2;
  const lng =
    seed?.lng ?? (full.bbox.west + full.bbox.east) / 2;
  const extract = prepareExtractForDisplay(full, lat, lng);
  rememberDisplayExtract({
    cityId,
    lat,
    lng,
    atMs: Date.now(),
    extract,
  });
  pushSnapToMapStore(cityId, { lat, lng, extract });
  markHomeMapBoot('displayHydrate');
}

export function warmupHomeMapDuringIntro(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    markHomeMapBootStart();
    noteSplashStarted();
    noteSplashMapWarmup(4_000);

    const gpsWarm = Promise.race([
      hydrateLastKnownMapGps(),
      new Promise<void>((resolve) => setTimeout(resolve, 350)),
    ]);

    // Vector-Default: Protomaps unter Splash — kein GeoJSON-Extract im Kaltstart.
    if (isVectorBasemapEnabled()) {
      beginYorroProtomapsStyleWarm();
      await Promise.all([
        awaitYorroProtomapsStyleWarm(PROTOMAPS_STYLE_SPLASH_BUDGET_MS),
        gpsWarm,
      ]);
    } else {
      // Legacy Extract: Display-Snapshot parallel zu GPS.
      const extractWarm = warmupCityExtract();
      await gpsWarm;
      await Promise.race([
        extractWarm,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }

    try {
      const { warmupGpsDuringIntro } = await import('../locationService');
      void warmupGpsDuringIntro();
    } catch {
      /* Permission / GPS optional */
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
'''
tmpw = warmup.with_suffix('.ts.new')
tmpw.write_text(wu, encoding='utf-8', newline='\n')
tmpw.replace(warmup)
print('warmupHomeMap ok')

# --- 3) index.ts: Prefetch vor React-Mount ---
index = ROOT / "index.ts"
idx = '''import { registerRootComponent } from 'expo';

// Protomaps-Style sofort — Splash-Overlap vor React-Mount / DB.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isVectorBasemapEnabled } = require('./src/services/homeMap/mapTileConfig') as {
    isVectorBasemapEnabled: () => boolean;
  };
  if (isVectorBasemapEnabled()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { beginYorroProtomapsStyleWarm } = require('./src/services/homeMap/yorroProtomapsBasemapStyle') as {
      beginYorroProtomapsStyleWarm: () => Promise<unknown>;
    };
    void beginYorroProtomapsStyleWarm();
  }
} catch {
  /* soft — Env/Bundling */
}

import App from './App';

registerRootComponent(App);
'''
# Keep import App before register; require before App import is intentional for early kick.
# Actually in ES modules, imports are hoisted - `import App` will still run first!
# So we need a side-effect import or dynamic approach.

# Better: create tiny kick module imported first
kick = ROOT / "src/services/homeMap/kickProtomapsStyleWarm.ts"
kick.write_text(
    '''/**
 * Side-effect: Protomaps-Style Warm beim Bundle-Einstieg (Splash-Overlap).
 * Import zuerst in index.ts — vor App-Mount.
 */
import { isVectorBasemapEnabled } from './mapTileConfig';
import { beginYorroProtomapsStyleWarm } from './yorroProtomapsBasemapStyle';

if (isVectorBasemapEnabled()) {
  void beginYorroProtomapsStyleWarm();
}
''',
    encoding='utf-8',
    newline='\n',
)
print('kick module ok')

index.write_text(
    '''import './src/services/homeMap/kickProtomapsStyleWarm';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
''',
    encoding='utf-8',
    newline='\n',
)
print('index.ts ok')

# --- 4) App.tsx: Vector Warm-Budget länger unter Splash vor DB-Schwarm ---
app = ROOT / "App.tsx"
at = app.read_text(encoding='utf-8')
old_race = '''      // Warmup parallel — Boot/UI nicht auf Extract/Disk warten.
      const warm = warmupHomeMapDuringIntro();
      await Promise.race([warm, new Promise((r) => setTimeout(r, 300))]);'''
new_race = '''      // Warmup parallel — Vector: Style länger unter Splash mitnehmen (kein Extract).
      const warm = warmupHomeMapDuringIntro();
      const warmBudgetMs = isVectorBasemapEnabled() ? 1_000 : 300;
      await Promise.race([
        warm,
        new Promise((r) => setTimeout(r, warmBudgetMs)),
      ]);'''
if old_race not in at:
    raise SystemExit('App race block not found')
at = at.replace(old_race, new_race, 1)
tmpa = app.with_suffix('.tsx.new')
tmpa.write_text(at, encoding='utf-8', newline='\n')
tmpa.replace(app)
print('App.tsx ok')

# --- 5) Smokes ---
smoke = ROOT / "src/services/homeMap/yorroProtomapsBasemapStyle.smoke.test.ts"
sm = smoke.read_text(encoding='utf-8')
extra = '''
assert(
  loader.includes('Disk + Netz parallel') ||
    loader.includes('fetchRecolorAndCache'),
  'style load races disk with network',
);
assert(
  loader.includes('loadYorroProtomapsBasemapStyle().finally') ||
    /splashWarmInflight\\s*=\\s*loadYorroProtomapsBasemapStyle/.test(loader),
  'begin warm uses parallel load path',
);

const kick = readFileSync(
  join(process.cwd(), 'src/services/homeMap/kickProtomapsStyleWarm.ts'),
  'utf8',
);
assert(kick.includes('beginYorroProtomapsStyleWarm'), 'kick starts style warm');
const index = readFileSync(join(process.cwd(), 'index.ts'), 'utf8');
assert(
  index.includes('kickProtomapsStyleWarm'),
  'index imports style warm before App',
);

const warmFull = readFileSync(
  join(process.cwd(), 'src/services/homeMap/warmupHomeMap.ts'),
  'utf8',
);
assert(
  warmFull.includes('PROTOMAPS_STYLE_SPLASH_BUDGET_MS') ||
    /awaitYorroProtomapsStyleWarm\\(\\s*2[_]?400/.test(warmFull),
  'splash style budget >= 2.4s',
);
assert(
  warmFull.includes('kein GeoJSON-Extract') ||
    warmFull.includes('kein GeoJSON'),
  'vector splash skips GeoJSON extract',
);
'''
# Insert before final console.log
if 'kickProtomapsStyleWarm' not in sm:
    sm = sm.replace(
        "console.log('yorroProtomapsBasemapStyle.smoke.test.ts OK');",
        extra + "\nconsole.log('yorroProtomapsBasemapStyle.smoke.test.ts OK');",
        1,
    )
    tmps = smoke.with_suffix('.ts.new')
    tmps.write_text(sm, encoding='utf-8', newline='\n')
    tmps.replace(smoke)
    print('style smoke ok')
else:
    print('style smoke already patched')

# mapLibreDiskCache smoke: vector may skip extract
ml = ROOT / "src/services/homeMap/mapLibreDiskCache.smoke.test.ts"
mlt = ml.read_text(encoding='utf-8')
old_assert = "assert(warmup.includes('warmupCityExtract'), 'Splash lädt Stadt-Extract vor der Map');"
new_assert = """assert(warmup.includes('warmupCityExtract'), 'Legacy-Extract-Helper bleibt');
assert(
  warmup.includes('isVectorBasemapEnabled') &&
    (warmup.includes('kein GeoJSON') || warmup.includes('PROTOMAPS_STYLE_SPLASH_BUDGET')),
  'Vector-Splash: Style statt GeoJSON-Extract',
);"""
if old_assert in mlt and 'Vector-Splash: Style statt GeoJSON' not in mlt:
    mlt = mlt.replace(old_assert, new_assert, 1)
    tmpm = ml.with_suffix('.ts.new')
    tmpm.write_text(mlt, encoding='utf-8', newline='\n')
    tmpm.replace(ml)
    print('mapLibreDiskCache smoke ok')

# nativeHomeMap: vector skip extract ok
nh = ROOT / "src/components/homeMap/nativeHomeMap.smoke.test.ts"
nht = nh.read_text(encoding='utf-8')
# Keep peekDisplayExtract assert for legacy path - warmup still has the function
if 'PROTOMAPS_STYLE_SPLASH_BUDGET' not in nht:
    anchor = "assert(warmupSrc.includes('peekDisplayExtract'), 'Splash nutzt Display-Snapshot');"
    add = """assert(warmupSrc.includes('peekDisplayExtract'), 'Splash nutzt Display-Snapshot');
assert(
  warmupSrc.includes('isVectorBasemapEnabled') &&
    (warmupSrc.includes('kein GeoJSON') ||
      warmupSrc.includes('PROTOMAPS_STYLE_SPLASH_BUDGET')),
  'Vector-Kaltstart: Protomaps unter Splash, kein Extract-Default',
);"""
    if anchor in nht:
        nht = nht.replace(anchor, add, 1)
        tmpn = nh.with_suffix('.ts.new')
        tmpn.write_text(nht, encoding='utf-8', newline='\n')
        tmpn.replace(nh)
        print('nativeHomeMap smoke ok')

print('ALL DONE')
