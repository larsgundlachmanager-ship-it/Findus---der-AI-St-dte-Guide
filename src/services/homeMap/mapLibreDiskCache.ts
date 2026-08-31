/**
 * MapLibre JS/CSS + Liberty-Style auf Disk (12 h), damit der erste
 * Straßen-Umriss nicht jedes Mal von unpkg/CDN kommt.
 */

import * as FileSystem from 'expo-file-system';
import { HOME_MAP_VECTOR_STYLE } from './homeMapStyle';

export const MAPLIBRE_JS_URL =
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
export const MAPLIBRE_CSS_URL =
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';

const CACHE_MAX_AGE_MS = 12 * 60 * 60_000;
const DIR = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}findus-maplibre/`;

export type MapLibreHtmlAssets = {
  jsInline: string | null;
  cssInline: string | null;
  styleJson: string | null;
};

let mem: MapLibreHtmlAssets | null = null;
let inflight: Promise<MapLibreHtmlAssets> | null = null;

export function peekMapLibreHtmlAssets(): MapLibreHtmlAssets | null {
  return mem;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  }
}

async function readIfFresh(path: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists || info.isDirectory) return null;
    const mod = info.modificationTime;
    if (typeof mod === 'number') {
      const modMs = mod > 1e12 ? mod : mod * 1000;
      if (Date.now() - modMs > CACHE_MAX_AGE_MS) return null;
    }
    const text = await FileSystem.readAsStringAsync(path);
    return text.length > 80 ? text : null;
  } catch {
    return null;
  }
}

async function downloadTo(path: string, url: string): Promise<string | null> {
  try {
    const tmp = `${path}.tmp`;
    const res = await FileSystem.downloadAsync(url, tmp);
    if (res.status !== 200) {
      await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => undefined);
      return readIfFresh(path);
    }
    await FileSystem.moveAsync({ from: tmp, to: path }).catch(async () => {
      await FileSystem.copyAsync({ from: tmp, to: path });
      await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => undefined);
    });
    return readIfFresh(path);
  } catch {
    return readIfFresh(path);
  }
}

export async function ensureMapLibreDiskCache(): Promise<MapLibreHtmlAssets> {
  if (mem?.jsInline && mem.cssInline) return mem;
  if (inflight) return inflight;
  inflight = (async () => {
    const empty: MapLibreHtmlAssets = {
      jsInline: null,
      cssInline: null,
      styleJson: null,
    };
    try {
      await ensureDir();
      const jsPath = `${DIR}maplibre-gl.js`;
      const cssPath = `${DIR}maplibre-gl.css`;
      const stylePath = `${DIR}liberty.json`;
      const [js, css, style] = await Promise.all([
        readIfFresh(jsPath).then((hit) => hit ?? downloadTo(jsPath, MAPLIBRE_JS_URL)),
        readIfFresh(cssPath).then((hit) => hit ?? downloadTo(cssPath, MAPLIBRE_CSS_URL)),
        readIfFresh(stylePath).then(
          (hit) => hit ?? downloadTo(stylePath, HOME_MAP_VECTOR_STYLE),
        ),
      ]);
      mem = {
        jsInline: js,
        cssInline: css,
        styleJson: style,
      };
      return mem;
    } catch {
      mem = empty;
      return mem;
    }
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
