/**
 * Lokale Stadt-Dateien (Pack / Pins / Offline-Karte) — nur Speicher, kein Abo.
 * Löschen = Platz frei. Erneuter Download bleibt erlaubt.
 */

export type LocalCityFileKind = 'pack' | 'pins' | 'map';

export type LocalCityStorageFile = {
  id: string;
  kind: LocalCityFileKind;
};

/** Aggregierte Offline-Dateien einer Stadt auf dem Gerät. */
export type LocalCityDataset = {
  id: string;
  name: string;
  version: number;
  bytes: number;
  packBytes: number;
  pinsBytes: number;
  mapBytes: number;
  hasPack: boolean;
  hasPins: boolean;
  hasMap: boolean;
};

const SKIP_NAMES = new Set([
  'index.cache.json',
  'versions.json',
  'active.json',
  'index.json',
]);

/** `amsterdam.json` / `.pins.json` / `.map.json` — sonst null. */
export function parseLocalCityStorageFile(
  fileName: string,
): LocalCityStorageFile | null {
  const name = String(fileName || '').trim().toLowerCase();
  if (!name.endsWith('.json') || SKIP_NAMES.has(name) || name.startsWith('_')) {
    return null;
  }
  if (name.endsWith('.pins.json')) {
    const id = name.slice(0, -'.pins.json'.length);
    return id && !id.includes('.') ? { id, kind: 'pins' } : null;
  }
  if (name.endsWith('.map.json')) {
    const id = name.slice(0, -'.map.json'.length);
    return id && !id.includes('.') ? { id, kind: 'map' } : null;
  }
  const id = name.slice(0, -'.json'.length);
  if (!id || id.includes('.')) return null;
  return { id, kind: 'pack' };
}

export function formatLocalDatasetBytes(bytes: number): string {
  const n = Math.max(0, Math.floor(Number(bytes) || 0));
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) {
    const kb = n / 1024;
    const s = kb < 10 ? kb.toFixed(1) : String(Math.round(kb));
    return `${s.replace('.', ',')} KB`;
  }
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace('.', ',')} MB`;
}

/** Spot-Key der Stadt? `prisdorf_bahnhof` / `prisdorf:…` / exakt `prisdorf`. */
export function spotKeyBelongsToCity(
  spotKey: string | null | undefined,
  cityId: string | null | undefined,
): boolean {
  const id = String(cityId || '').trim().toLowerCase();
  if (!id) return true;
  const key = String(spotKey || '').trim().toLowerCase();
  if (!key) return false;
  return key === id || key.startsWith(`${id}_`) || key.startsWith(`${id}:`);
}

export function poisLookLikeCity(
  cityId: string,
  pois: Array<{ spot_key?: string | null }>,
): boolean {
  const id = cityId.trim().toLowerCase();
  if (!id || !pois.length) return false;
  const n = Math.min(pois.length, 64);
  let hit = 0;
  for (let i = 0; i < n; i += 1) {
    if (spotKeyBelongsToCity(pois[i]?.spot_key, id)) hit += 1;
  }
  // Mehrheit der Sample-POIs — 20 % ließ Danzig-Reste als „Prisdorf“ durch.
  return hit >= Math.max(3, Math.ceil(n * 0.55));
}
