from pathlib import Path

ROOT = Path(r"C:\Users\larsf\Findus 2.0")

# --- cityMapExtract.ts: smaller chunks + chrome-aware yields + async nearest ---
extract = ROOT / "src/services/homeMap/cityMapExtract.ts"
et = extract.read_text(encoding="utf-8")

old_yield_clip = '''function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wie prepareExtractForDisplay, aber mit Yields â€” Mic/Settings bleiben tippbar.
 */
export async function prepareExtractForDisplayAsync(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  cityId?: string | null,
  radiusOverrideM?: number,
): Promise<CityMapExtract> {
  const id = (cityId || extract.cityId || '').toLowerCase();
  const region = isRegionPackCityId(id);
  const n =
    (extract.roads?.length ?? 0) +
    (extract.buildings?.length ?? 0) +
    (extract.water?.length ?? 0) +
    (extract.parks?.length ?? 0);
  if (n <= 4000 && !region && radiusOverrideM == null) {
    return { ...extract, graph: EMPTY_GRAPH };
  }
  const radiusM =
    radiusOverrideM ??
    (region ? REGION_CLIP_RADIUS_M : DISPLAY_WIDE_RADIUS_M);
  const caps = mapExtractCapsForRadius(radiusM);
  const maxBuildings = region ? 4_000 : caps.maxBuildings;
  return clipCityMapExtractForDisplayAsync(
    extract,
    lat,
    lng,
    radiusM,
    maxBuildings,
    caps.maxRoads,
  );
}

export async function clipCityMapExtractForDisplayAsync(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  radiusM = 5200,
  maxBuildings?: number,
  maxRoads?: number,
): Promise<CityMapExtract> {
  const caps = mapExtractCapsForRadius(radiusM);
  const capBuildings = maxBuildings ?? caps.maxBuildings;
  const capRoads = maxRoads ?? caps.maxRoads;
  const dLat = radiusM / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = radiusM / (111_320 * Math.max(0.2, cos));
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lng - dLng;
  const east = lng + dLng;
  const hit = (ring?: Array<[number, number]>) =>
    ringTouchesBox(ring, south, north, west, east);

  const roads = pickRoadsForDisplay(extract.roads, lat, lng, hit, capRoads);
  await yieldToMainThread();

  // Alle Treffer sammeln, dann die nÃ¤chsten N zum GPS â€” nicht Array-Prefix.
  const inBox: typeof extract.buildings = [];
  const srcB = extract.buildings;
  const CHUNK = 2_500;
  for (let i = 0; i < srcB.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, srcB.length);
    for (let j = i; j < end; j += 1) {
      const b = srcB[j]!;
      if (hit(b)) inBox.push(b);
    }
    if (i + CHUNK < srcB.length) {
      await yieldToMainThread();
    }
  }
  const buildings = pickNearestBuildings(
    inBox,
    lat,
    lng,
    () => true,
    capBuildings,
  );

  const water = extract.water.filter(hit);
  await yieldToMainThread();
  const parks = extract.parks.filter(hit);
'''

# Read rest of function from file to keep woods/land/rails etc
idx = et.find(old_yield_clip)
if idx < 0:
    # try with UTF-8 proper encoding of special chars - file may have mojibake
    # Find by unique markers
    start = et.find("function yieldToMainThread(): Promise<void> {")
    if start < 0:
        raise SystemExit("yieldToMainThread not found")
    # find end of clip async buildings section - parks = extract.parks.filter
    marker = "const parks = extract.parks.filter(hit);"
    mpos = et.find(marker, start)
    if mpos < 0:
        raise SystemExit("parks filter not found")
    # include through parks line
    end = mpos + len(marker)
    old_block = et[start:end]
else:
    old_block = old_yield_clip
    start = idx
    end = idx + len(old_yield_clip)

new_block = '''/** Gebäude-Hit-Test Chunk — klein halten, damit Mic/Chrome atmen. */
export const EXTRACT_BUILDING_CLIP_CHUNK = 800;
/** Scoring/Sort Chunk für pickNearestBuildingsAsync. */
export const EXTRACT_BUILDING_SCORE_CHUNK = 600;

function chromeBusyNow(): boolean {
  try {
    const {
      isMicActive,
      isOverlayBusy,
    } = require('../boot/interactiveBootGate') as {
      isMicActive: () => boolean;
      isOverlayBusy: () => boolean;
    };
    return isMicActive() || isOverlayBusy();
  } catch {
    return false;
  }
}

/**
 * Main-Thread-Yield. Bei Mic/Chrome länger warten — Gebäude-Clip hinter Lane C/B.
 */
function yieldToMainThread(preferChrome = false): Promise<void> {
  const ms = preferChrome && chromeBusyNow() ? 32 : 0;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wie pickNearestBuildings, aber Scoring in Chunks + Yields (kein Sync-Spike auf 10k).
 */
async function pickNearestBuildingsAsync(
  buildings: CityMapExtract['buildings'],
  lat: number,
  lng: number,
  maxBuildings: number,
): Promise<CityMapExtract['buildings']> {
  if (buildings.length <= maxBuildings) return buildings;
  const scored: Array<{ ring: CityMapExtract['buildings'][number]; d2: number }> =
    [];
  const CHUNK = EXTRACT_BUILDING_SCORE_CHUNK;
  for (let i = 0; i < buildings.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, buildings.length);
    for (let j = i; j < end; j += 1) {
      const ring = buildings[j]!;
      const p = ring[0];
      const dLat = p ? p[0] - lat : 99;
      const dLng = p ? p[1] - lng : 99;
      scored.push({ ring, d2: dLat * dLat + dLng * dLng });
    }
    if (end < buildings.length) {
      await yieldToMainThread(true);
    }
  }
  scored.sort((a, b) => a.d2 - b.d2);
  await yieldToMainThread(true);
  const out: CityMapExtract['buildings'] = [];
  for (let i = 0; i < maxBuildings; i += 1) {
    out.push(scored[i]!.ring);
  }
  return out;
}

/**
 * Wie prepareExtractForDisplay, aber mit Yields — Mic/Settings bleiben tippbar.
 */
export async function prepareExtractForDisplayAsync(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  cityId?: string | null,
  radiusOverrideM?: number,
): Promise<CityMapExtract> {
  const id = (cityId || extract.cityId || '').toLowerCase();
  const region = isRegionPackCityId(id);
  const n =
    (extract.roads?.length ?? 0) +
    (extract.buildings?.length ?? 0) +
    (extract.water?.length ?? 0) +
    (extract.parks?.length ?? 0);
  if (n <= 4000 && !region && radiusOverrideM == null) {
    return { ...extract, graph: EMPTY_GRAPH };
  }
  const radiusM =
    radiusOverrideM ??
    (region ? REGION_CLIP_RADIUS_M : DISPLAY_WIDE_RADIUS_M);
  const caps = mapExtractCapsForRadius(radiusM);
  const maxBuildings = region ? 4_000 : caps.maxBuildings;
  return clipCityMapExtractForDisplayAsync(
    extract,
    lat,
    lng,
    radiusM,
    maxBuildings,
    caps.maxRoads,
  );
}

export async function clipCityMapExtractForDisplayAsync(
  extract: CityMapExtract,
  lat: number,
  lng: number,
  radiusM = 5200,
  maxBuildings?: number,
  maxRoads?: number,
): Promise<CityMapExtract> {
  const caps = mapExtractCapsForRadius(radiusM);
  const capBuildings = maxBuildings ?? caps.maxBuildings;
  const capRoads = maxRoads ?? caps.maxRoads;
  const dLat = radiusM / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = radiusM / (111_320 * Math.max(0.2, cos));
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lng - dLng;
  const east = lng + dLng;
  const hit = (ring?: Array<[number, number]>) =>
    ringTouchesBox(ring, south, north, west, east);

  // Straßen zuerst — Chrome bleibt frei; Gebäude bewusst danach.
  const roads = pickRoadsForDisplay(extract.roads, lat, lng, hit, capRoads);
  await yieldToMainThread(true);

  // Gebäude-Hit-Test gestückelt; bei Mic/Chrome extra Pause.
  const inBox: typeof extract.buildings = [];
  const srcB = extract.buildings;
  const CHUNK = EXTRACT_BUILDING_CLIP_CHUNK;
  for (let i = 0; i < srcB.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, srcB.length);
    for (let j = i; j < end; j += 1) {
      const b = srcB[j]!;
      if (hit(b)) inBox.push(b);
    }
    if (end < srcB.length) {
      await yieldToMainThread(true);
    }
  }
  const buildings = await pickNearestBuildingsAsync(
    inBox,
    lat,
    lng,
    capBuildings,
  );

  const water = extract.water.filter(hit);
  await yieldToMainThread(true);
  const parks = extract.parks.filter(hit);'''

et2 = et[:start] + new_block + et[end:]
tmp = extract.with_suffix(".ts.new")
tmp.write_text(et2, encoding="utf-8", newline="\n")
tmp.replace(extract)
print("cityMapExtract ok")

# --- cityMapExtractGeojson.ts: chunked building polygons ---
geo = ROOT / "src/services/homeMap/cityMapExtractGeojson.ts"
gt = geo.read_text(encoding="utf-8")

old_async = '''/**
 * Wie cityMapExtractToGeojson, aber mit Main-Thread-Yields zwischen Layern —
 * Mic/Settings bleiben tippbar während Gebäude-GeoJSON gebaut wird.
 */
export async function cityMapExtractToGeojsonAsync(
  extract: CityMapExtract | null | undefined,
  phase: ExtractGeojsonPhase = 'full',
): Promise<ExtractGeojsonBundle> {
  if (!extract || phase === 'core') {
    return cityMapExtractToGeojson(extract, phase);
  }
  await yieldGeojson();
  const roads = linesFromExtract(extract.roads, true);
  await yieldGeojson();
  const core: ExtractGeojsonBundle = {
    land: polygonsFromRings(extract.land),
    woods: polygonsFromRings(extract.woods),
    parks: polygonsFromRings(extract.parks),
    water: polygonsFromRings(extract.water),
    buildings: EMPTY,
    rails: linesFromExtract(extract.rails),
    roads,
    housenumbers: EMPTY,
    streets: EMPTY,
    hasRoads: (extract.roads?.length ?? 0) > 0,
  };
  await yieldGeojson();
  const buildings = polygonsFromRings(extract.buildings);
  await yieldGeojson();
'''

if old_async not in gt:
    raise SystemExit("geojson async block not found")

new_async = '''/** Gebäude→Polygon Chunk — Sync-Spike auf großen Extracts vermeiden. */
export const EXTRACT_BUILDING_GEOJSON_CHUNK = 350;

function chromeBusyForGeojson(): boolean {
  try {
    const {
      isMicActive,
      isOverlayBusy,
    } = require('../boot/interactiveBootGate') as {
      isMicActive: () => boolean;
      isOverlayBusy: () => boolean;
    };
    return isMicActive() || isOverlayBusy();
  } catch {
    return false;
  }
}

function yieldGeojsonChrome(): Promise<void> {
  const ms = chromeBusyForGeojson() ? 32 : 0;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function polygonsFromRingsAsync(
  rings: Array<Array<[number, number]>> | undefined,
  chunk = EXTRACT_BUILDING_GEOJSON_CHUNK,
): Promise<GeoJsonFc> {
  if (!rings?.length) return EMPTY;
  const features: GeoJsonFeature[] = [];
  for (let i = 0; i < rings.length; i += chunk) {
    const end = Math.min(i + chunk, rings.length);
    for (let j = i; j < end; j += 1) {
      const coords = extractRingToLngLat(rings[j]!);
      if (!coords) continue;
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [coords] },
      });
    }
    if (end < rings.length) {
      await yieldGeojsonChrome();
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Wie cityMapExtractToGeojson, aber mit Main-Thread-Yields zwischen Layern —
 * Mic/Settings bleiben tippbar; Gebäude-Polygone gestückelt + hinter Chrome.
 */
export async function cityMapExtractToGeojsonAsync(
  extract: CityMapExtract | null | undefined,
  phase: ExtractGeojsonPhase = 'full',
): Promise<ExtractGeojsonBundle> {
  if (!extract || phase === 'core') {
    return cityMapExtractToGeojson(extract, phase);
  }
  await yieldGeojson();
  const roads = linesFromExtract(extract.roads, true);
  await yieldGeojson();
  const core: ExtractGeojsonBundle = {
    land: polygonsFromRings(extract.land),
    woods: polygonsFromRings(extract.woods),
    parks: polygonsFromRings(extract.parks),
    water: polygonsFromRings(extract.water),
    buildings: EMPTY,
    rails: linesFromExtract(extract.rails),
    roads,
    housenumbers: EMPTY,
    streets: EMPTY,
    hasRoads: (extract.roads?.length ?? 0) > 0,
  };
  // Gebäude bewusst nach Core + Chrome-Yield — nicht im selben Tick wie Straßen.
  await yieldGeojsonChrome();
  const buildings = await polygonsFromRingsAsync(extract.buildings);
  await yieldGeojsonChrome();
'''

gt2 = gt.replace(old_async, new_async, 1)
# Also update yieldGeojson to stay, but we added yieldGeojsonChrome - keep original yieldGeojson
tmpg = geo.with_suffix(".ts.new")
tmpg.write_text(gt2, encoding="utf-8", newline="\n")
tmpg.replace(geo)
print("cityMapExtractGeojson ok")

# --- smokes ---
ui = ROOT / "src/services/ui/uiInstant.smoke.test.ts"
ut = ui.read_text(encoding="utf-8")
old_asserts = '''// Phase 2 — Extract yields + InteractionManager escape
assert(
  extract.includes('prepareExtractForDisplayAsync'),
  'Async Extract-Clip',
);
assert(extract.includes('yieldToMainThread'), 'Clip Yields');
assert(loader.includes('setTimeout(go, 80)'), 'InteractionManager Escape 80ms');
'''
new_asserts = '''// Phase 2 — Extract yields + InteractionManager escape
assert(
  extract.includes('prepareExtractForDisplayAsync'),
  'Async Extract-Clip',
);
assert(extract.includes('yieldToMainThread'), 'Clip Yields');
assert(
  extract.includes('EXTRACT_BUILDING_CLIP_CHUNK') &&
    /EXTRACT_BUILDING_CLIP_CHUNK\\s*=\\s*[1-9]\\d{2}\\b/.test(extract),
  'Gebäude-Clip Chunk ≤999',
);
assert(
  extract.includes('pickNearestBuildingsAsync') &&
    extract.includes('chromeBusyNow'),
  'Gebäude-Nearest async + Chrome-Yield',
);
assert(loader.includes('setTimeout(go, 80)'), 'InteractionManager Escape 80ms');
'''
if old_asserts not in ut:
    raise SystemExit("uiInstant asserts not found")
ut = ut.replace(old_asserts, new_asserts, 1)

# Add geojson asserts near extract section
geo_src_assert = '''
{
  const geojsonSrc = readFileSync(
    join(root, 'src/services/homeMap/cityMapExtractGeojson.ts'),
    'utf8',
  );
  assert(
    geojsonSrc.includes('polygonsFromRingsAsync') &&
      geojsonSrc.includes('EXTRACT_BUILDING_GEOJSON_CHUNK'),
    'Gebäude-GeoJSON gestückelt',
  );
  assert(
    geojsonSrc.includes('yieldGeojsonChrome') ||
      geojsonSrc.includes('chromeBusyForGeojson'),
    'Gebäude-GeoJSON wartet hinter Mic/Chrome',
  );
}
'''
if "polygonsFromRingsAsync" not in ut:
    ut = ut.replace(
        "assert(loader.includes('setTimeout(go, 80)'), 'InteractionManager Escape 80ms');",
        "assert(loader.includes('setTimeout(go, 80)'), 'InteractionManager Escape 80ms');\n"
        + geo_src_assert,
        1,
    )

tmpu = ui.with_suffix(".ts.new")
tmpu.write_text(ut, encoding="utf-8", newline="\n")
tmpu.replace(ui)
print("uiInstant ok")

idle = ROOT / "src/services/homeMap/mapIdleGate.smoke.test.ts"
it = idle.read_text(encoding="utf-8")
if "polygonsFromRingsAsync" not in it:
    it = it.replace(
        "assert(\n  native.includes('cityMapExtractToGeojsonAsync'),\n  'Native: async GeoJSON für Full-Paint',\n);",
        """assert(
  native.includes('cityMapExtractToGeojsonAsync'),
  'Native: async GeoJSON für Full-Paint',
);
const geojson = readFileSync(
  join(process.cwd(), 'src/services/homeMap/cityMapExtractGeojson.ts'),
  'utf8',
);
assert(
  geojson.includes('polygonsFromRingsAsync'),
  'GeoJSON: Gebäude-Polygone gestückelt',
);
const clipSrc = readFileSync(
  join(process.cwd(), 'src/services/homeMap/cityMapExtract.ts'),
  'utf8',
);
assert(
  clipSrc.includes('EXTRACT_BUILDING_CLIP_CHUNK'),
  'Clip: Gebäude-Chunk exportiert',
);""",
        1,
    )
    tmpi = idle.with_suffix(".ts.new")
    tmpi.write_text(it, encoding="utf-8", newline="\n")
    tmpi.replace(idle)
    print("mapIdleGate ok")

print("DONE")
