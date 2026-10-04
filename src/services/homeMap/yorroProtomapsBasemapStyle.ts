/**
 * Protomaps Hosted Style laden + Yorro-Farben — Basiskarte für MapLibre Native.
 * Style als Objekt (nicht nur URL): Android lädt remote styleURL oft unzuverlässig.
 * Yorro-Overlays (Orte/Städte/Route/GPS) bleiben ShapeSources darüber.
 *
 * Disk-Cache: Cold-Start ohne erneuten Style-Fetch (Kacheln bleiben MapLibre-HTTP-Cache).
 * Recolor einmal (RAM + Disk mit Rev) — nicht bei jedem Hydrate/Refresh sync.
 */

import * as FileSystem from 'expo-file-system';
import {
  HOME_MAP_BG,
  HOME_MAP_BUILDING_FILL,
  HOME_MAP_BUILDING_STROKE,
  HOME_MAP_COUNTRY_BORDER,
  HOME_MAP_PARK,
  HOME_MAP_ROAD_COLORS,
  HOME_MAP_STREET_LABEL,
  HOME_MAP_WATER,
  HOME_MAP_WOOD,
} from './homeMapStyle';
import { resolveProtomapsStyleUrl } from './mapTileConfig';

type StyleJson = {
  version: number;
  name?: string;
  glyphs?: string;
  sprite?: string;
  sources: Record<string, unknown>;
  layers: Array<
    Record<string, unknown> & {
      id: string;
      type?: string;
      paint?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    }
  >;
};

/** Bump wenn Palette / recolorProtomapsStyleForYorro sich ändert → Disk neu färben. */
export const YORRO_PROTOMAPS_RECOLOR_REV = 6;

type StyleDiskEnvelope = {
  rev: number;
  rawFp: string;
  style: StyleJson;
};

const STYLE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const STYLE_CACHE_DIR = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''}yorro-protomaps-style/`;

let inflight: Promise<StyleJson | null> | null = null;
let cached: StyleJson | null = null;
let cachedRawFp: string | null = null;
let diskHydrateInflight: Promise<StyleJson | null> | null = null;
let splashWarmInflight: Promise<StyleJson | null> | null = null;

function paintSet(
  layer: StyleJson['layers'][number],
  key: string,
  value: unknown,
): void {
  if (!layer.paint) layer.paint = {};
  layer.paint[key] = value;
}


/**
 * Ländergrenzen aus der Basemap (OSM/Protomaps) — weiß, zoom-scharf.
 * Keine eigenen Grob-Polygone. Region/County aus.
 */
function ensureProtomapsBoundaryLayers(style: StyleJson): void {
  for (const layer of style.layers) {
    const id = String(layer.id || '').toLowerCase();
    if (!id.includes('boundar')) continue;
    const type = String(layer.type || '');
    const layout = (layer.layout as Record<string, unknown> | undefined) ?? {};
    const isCountryLine =
      type === 'line' &&
      (id.includes('country') ||
        id === 'boundaries_country' ||
        id.endsWith('_country'));
    if (isCountryLine) {
      layout.visibility = 'visible';
      paintSet(layer, 'line-color', HOME_MAP_COUNTRY_BORDER);
      paintSet(layer, 'line-opacity', 0.92);
      paintSet(layer, 'line-width', [
        'interpolate',
        ['linear'],
        ['zoom'],
        2,
        0.9,
        5,
        1.35,
        8,
        1.75,
        11,
        1.4,
        14,
        1.1,
      ]);
      // Solid — keine gestrichelte Theme-Linie.
      if (layer.paint && 'line-dasharray' in layer.paint) {
        delete layer.paint['line-dasharray'];
      }
      // Nur Staatsgrenze (admin ≤ 2), falls Filter fehlt / zu weit.
      const filter = (layer as { filter?: unknown }).filter;
      if (!filter) {
        (layer as { filter?: unknown }).filter = [
          'any',
          ['==', ['get', 'kind'], 'country'],
          ['<=', ['get', 'kind_detail'], 2],
        ];
      }
    } else {
      layout.visibility = 'none';
    }
    (layer as { layout?: Record<string, unknown> }).layout = layout;
  }
}

/**
 * Basemap-Ortsnamen aus: Pack zeichnet Stadtlabel einmal (cities-label).
 * Sonst „Danzig“ 2–3× (Protomaps place=city/town + Pack).
 */
function ensureProtomapsPlaceLabelsOff(style: StyleJson): void {
  for (const layer of style.layers) {
    if (String(layer.type || '') !== 'symbol') continue;
    const id = String(layer.id || '').toLowerCase();
    const isPlace =
      id.includes('place') ||
      id.startsWith('places_') ||
      id.includes('places_') ||
      id.includes('city_label') ||
      id.includes('town_label') ||
      id.includes('locality') ||
      (id.includes('label') &&
        (id.includes('city') ||
          id.includes('town') ||
          id.includes('village') ||
          id.includes('suburb') ||
          id.includes('neighbourhood') ||
          id.includes('neighborhood')));
    if (!isPlace) continue;
    const layout = (layer.layout as Record<string, unknown> | undefined) ?? {};
    layout.visibility = 'none';
    (layer as { layout?: Record<string, unknown> }).layout = layout;
  }
}

/** Protomaps v5 Layer-IDs → Yorro-Palette (grün/gelb). */
export function recolorProtomapsStyleForYorro(style: StyleJson): StyleJson {
  const next: StyleJson = {
    ...style,
    layers: style.layers.map((l) => ({
      ...l,
      paint: l.paint ? { ...l.paint } : undefined,
    })),
  };

  for (const layer of next.layers) {
    const id = layer.id.toLowerCase();
    const type = String(layer.type || '');

    if (type === 'background' || id.includes('background')) {
      paintSet(layer, 'background-color', HOME_MAP_BG);
      continue;
    }
    if (id.includes('earth') || id.includes('landcover') || id === 'land') {
      if (type === 'fill') paintSet(layer, 'fill-color', HOME_MAP_BG);
      continue;
    }
    if (id.includes('landuse') || id.includes('park') || id.includes('grass')) {
      if (type === 'fill') {
        paintSet(
          layer,
          'fill-color',
          id.includes('forest') || id.includes('wood')
            ? HOME_MAP_WOOD
            : HOME_MAP_PARK,
        );
      }
      continue;
    }
    if (id.includes('water')) {
      if (type === 'fill') paintSet(layer, 'fill-color', HOME_MAP_WATER);
      if (type === 'line') paintSet(layer, 'line-color', HOME_MAP_WATER);
      continue;
    }
    if (id.includes('building')) {
      if (type === 'fill') {
        paintSet(layer, 'fill-color', HOME_MAP_BUILDING_FILL);
        paintSet(layer, 'fill-outline-color', HOME_MAP_BUILDING_STROKE);
      }
      if (type === 'line') paintSet(layer, 'line-color', HOME_MAP_BUILDING_STROKE);
      continue;
    }
    if (id.includes('boundar')) {
      // Sichtbarkeit/Farbe in ensureProtomapsBoundaryLayers (nur Country, weiß).
      continue;
    }
    if (
      id.includes('road') ||
      id.includes('highway') ||
      id.includes('street') ||
      id.includes('path') ||
      id.includes('rail')
    ) {
      if (type === 'line') {
        const major =
          id.includes('major') ||
          id.includes('highway') ||
          id.includes('motorway') ||
          id.includes('trunk') ||
          id.includes('primary');
        const path =
          id.includes('path') || id.includes('walk') || id.includes('cycle');
        const rail = id.includes('rail');
        paintSet(
          layer,
          'line-color',
          rail
            ? '#8E9BA3'
            : path
              ? HOME_MAP_ROAD_COLORS.path
              : major
                ? HOME_MAP_ROAD_COLORS.major
                : HOME_MAP_ROAD_COLORS.street,
        );
      }
      if (
        type === 'symbol' &&
        (id.includes('label') || id.includes('name')) &&
        !id.includes('place') &&
        !id.includes('poi') &&
        !id.includes('housenumber')
      ) {
        paintSet(layer, 'text-color', HOME_MAP_STREET_LABEL.text);
        paintSet(layer, 'text-halo-color', HOME_MAP_STREET_LABEL.halo);
        paintSet(layer, 'text-halo-width', HOME_MAP_STREET_LABEL.haloWidth);
      }
    }
  }

  ensureProtomapsBoundaryLayers(next);
  ensureProtomapsPlaceLabelsOff(next);

  // Straßenname-Layer ans Ende — Route kann per belowLayerID darunter landen.
  const layers = Array.isArray(next.layers) ? [...(next.layers as object[])] : [];
  const roadLabels: object[] = [];
  const rest: object[] = [];
  for (const layer of layers) {
    const id = String((layer as { id?: string }).id ?? '').toLowerCase();
    const type = String((layer as { type?: string }).type ?? '');
    if (
      type === 'symbol' &&
      (id.includes('roads_labels') ||
        id.includes('roads_label') ||
        (id.includes('road') && id.includes('label') && !id.includes('shield')))
    ) {
      roadLabels.push(layer);
    } else {
      rest.push(layer);
    }
  }
  if (roadLabels.length) {
    next.layers = [...rest, ...roadLabels];
  }

  return next;
}

/** Fingerprint der Roh-Style (ohne Recolor) — Refresh ohne erneutes Sync-Recolor. */
export function protomapsStyleRawFingerprint(style: StyleJson): string {
  const sources = style.sources
    ? Object.keys(style.sources)
        .sort()
        .map((k) => {
          const s = style.sources[k] as
            | { url?: string; tiles?: string[] }
            | undefined;
          return `${k}:${s?.url ?? ''}:${(s?.tiles ?? []).join(',')}`;
        })
        .join('|')
    : '';
  const layers = Array.isArray(style.layers)
    ? style.layers.map((l) => `${l.id}:${l.type ?? ''}`).join(',')
    : '';
  const base = `${style.version}|${style.glyphs ?? ''}|${style.sprite ?? ''}|${sources}|${layers}`;
  let hash = 2166136261;
  for (let i = 0; i < base.length; i += 1) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function styleCachePath(url: string): string | null {
  if (!STYLE_CACHE_DIR || STYLE_CACHE_DIR.startsWith('undefined')) return null;
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0;
  }
  return `${STYLE_CACHE_DIR}v5_${(hash >>> 0).toString(16)}.json`;
}

async function ensureStyleCacheDir(): Promise<boolean> {
  if (!STYLE_CACHE_DIR || STYLE_CACHE_DIR.startsWith('undefined')) return false;
  try {
    const info = await FileSystem.getInfoAsync(STYLE_CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(STYLE_CACHE_DIR, {
        intermediates: true,
      });
    }
    return true;
  } catch {
    return false;
  }
}

function parseStyleJson(raw: unknown): StyleJson | null {
  try {
    const json = (
      typeof raw === 'string' ? JSON.parse(raw) : raw
    ) as StyleJson;
    if (!json?.layers?.length || !json.sources) return null;
    return json;
  } catch {
    return null;
  }
}

function rememberCached(style: StyleJson, rawFp: string | null): StyleJson {
  cached = style;
  cachedRawFp = rawFp;
  return style;
}

function parseDiskEnvelopeOrLegacy(raw: string): {
  style: StyleJson;
  rawFp: string | null;
  needsRewrite: boolean;
} | null {
  try {
    const parsed = JSON.parse(raw) as StyleDiskEnvelope | StyleJson;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'rev' in parsed &&
      'style' in parsed &&
      typeof (parsed as StyleDiskEnvelope).rev === 'number'
    ) {
      const env = parsed as StyleDiskEnvelope;
      const style = parseStyleJson(env.style);
      if (!style) return null;
      if (env.rev === YORRO_PROTOMAPS_RECOLOR_REV) {
        return {
          style,
          rawFp: typeof env.rawFp === 'string' ? env.rawFp : null,
          needsRewrite: false,
        };
      }
      // Palette/Rev geändert → einmal neu färben, Envelope neu schreiben.
      return {
        style: recolorProtomapsStyleForYorro(style),
        rawFp: typeof env.rawFp === 'string' ? env.rawFp : null,
        needsRewrite: true,
      };
    }
    const legacy = parseStyleJson(parsed);
    if (!legacy) return null;
    // Legacy = bereits recolored (alter Cache) → nicht nochmal sync färben.
    return {
      style: legacy,
      rawFp: null,
      needsRewrite: true,
    };
  } catch {
    return null;
  }
}

async function readStyleFromDisk(url: string): Promise<StyleJson | null> {
  const path = styleCachePath(url);
  if (!path) return null;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory) return null;
    const mod = info.modificationTime;
    if (typeof mod === 'number') {
      const modMs = mod > 1e12 ? mod : mod * 1000;
      if (Date.now() - modMs > STYLE_CACHE_MAX_AGE_MS) return null;
    }
    const raw = await FileSystem.readAsStringAsync(path);
    if (raw.length < 200) return null;
    const hit = parseDiskEnvelopeOrLegacy(raw);
    if (!hit) return null;
    rememberCached(hit.style, hit.rawFp);
    if (hit.needsRewrite) {
      void writeStyleToDisk(url, hit.style, hit.rawFp);
    }
    return hit.style;
  } catch {
    return null;
  }
}

async function writeStyleToDisk(
  url: string,
  style: StyleJson,
  rawFp: string | null = cachedRawFp,
): Promise<void> {
  const path = styleCachePath(url);
  if (!path) return;
  try {
    if (!(await ensureStyleCacheDir())) return;
    const envelope: StyleDiskEnvelope = {
      rev: YORRO_PROTOMAPS_RECOLOR_REV,
      rawFp: rawFp ?? '',
      style,
    };
    const tmp = `${path}.tmp`;
    await FileSystem.writeAsStringAsync(tmp, JSON.stringify(envelope));
    await FileSystem.moveAsync({ from: tmp, to: path }).catch(async () => {
      await FileSystem.copyAsync({ from: tmp, to: path });
      await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(
        () => undefined,
      );
    });
  } catch {
    /* soft — Style bleibt in RAM */
  }
}

/**
 * Disk-Hydrate vor Map-Mount (Splash-Warmup).
 * Füllt RAM-Cache, damit MapView ohne OFFLINE-Placeholder starten kann.
 * Kein Recolor wenn Envelope-Rev passt.
 */
export async function hydrateYorroProtomapsBasemapStyleFromDisk(): Promise<StyleJson | null> {
  if (cached) return cached;
  if (diskHydrateInflight) return diskHydrateInflight;
  const url = resolveProtomapsStyleUrl();
  if (!url) return null;

  diskHydrateInflight = (async () => {
    try {
      const fromDisk = await readStyleFromDisk(url);
      if (!fromDisk) return null;
      if (__DEV__) {
        console.log(
          '[map-vector] style disk hit',
          fromDisk.name || 'ok',
          'layers',
          fromDisk.layers.length,
          'rev',
          YORRO_PROTOMAPS_RECOLOR_REV,
        );
      }
      void refreshStyleFromNetwork(url);
      return fromDisk;
    } catch {
      return null;
    } finally {
      diskHydrateInflight = null;
    }
  })();

  return diskHydrateInflight;
}

/**
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
  if (cached) return cached;
  const warm = beginYorroProtomapsStyleWarm();
  await Promise.race([
    warm.then(() => undefined),
    new Promise<void>((r) => setTimeout(r, Math.max(0, maxMs))),
  ]);
  return cached;
}

export function peekYorroProtomapsBasemapStyle(): StyleJson | null {
  return cached;
}

export function invalidateYorroProtomapsBasemapStyle(): void {
  cached = null;
  cachedRawFp = null;
  inflight = null;
  diskHydrateInflight = null;
  splashWarmInflight = null;
}
