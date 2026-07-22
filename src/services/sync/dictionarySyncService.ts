/**
 * Offline-First Dictionary Sync — Safe Cloud Merge.
 *
 * Flow:
 * 1) App-Boot: initDictionaryEngine() lädt pronunciations_master.json SOFORT (offline).
 * 2) Bei Internet: Cloud-Download → add-only Merge (User-Keys geschützt) → Master speichern.
 * 3) Scanner-Delta: nur neue User-Korrekturen an POST /api/dictionary/suggest.
 *
 * Audio-Pipeline wartet NIEMALS auf Netzwerk — Master ist immer lokal.
 */
import * as FileSystem from 'expo-file-system';
import * as Network from 'expo-network';
import { env, getPublicEnv } from '../../config/env';
import {
  applyCloudDictionaryUpdate,
  getPendingSuggestEntries,
  initDictionaryEngine,
  persistMasterDictionary,
  getMasterDictionarySize,
  type PronunciationDict,
} from '../tts/dictionaryEngine';

const DOC = FileSystem.documentDirectory;
const META_PATH = DOC ? `${DOC}dictionary_sync_meta.json` : null;

const DEFAULT_SYNC_HOUR = 5; // 05:00 lokal
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // ~20h → max. 1×/Tag

type SyncMeta = {
  lastCheckAt?: string;
  lastDownloadAt?: string;
  lastSuggestAt?: string;
  etag?: string;
  lastModified?: string;
  uploadedKeys?: string[];
};

export type DictionarySyncResult = {
  checked: boolean;
  updated: boolean;
  reason?: string;
  added?: number;
  size?: number;
  skippedProtected?: number;
  suggested?: number;
};

export type SuggestResult = {
  sent: number;
  accepted: number;
  reason?: string;
};

function resolveDictionaryApiBase(): string {
  const explicit = (
    env.dictionaryApiUrl() || getPublicEnv('EXPO_PUBLIC_DICTIONARY_API_URL')
  ).replace(/\/$/, '');
  if (explicit) return explicit;

  const supabase = env.supabaseUrl().replace(/\/$/, '');
  if (supabase) {
    return `${supabase}/storage/v1/object/public/dictionary`;
  }
  return '';
}

function latestUrl(): string {
  const base = resolveDictionaryApiBase();
  if (!base) return '';
  if (base.includes('/api/dictionary')) {
    return `${base}/latest.json`;
  }
  if (base.endsWith('/dictionary')) {
    return `${base}/latest.json`;
  }
  return `${base}/api/dictionary/latest.json`;
}

function suggestUrl(): string {
  const base = resolveDictionaryApiBase();
  if (!base) return '';
  if (base.includes('/api/dictionary')) {
    return `${base}/suggest`;
  }
  if (base.includes('/storage/v1/object/public/dictionary')) {
    const host = env.supabaseUrl().replace(/\/$/, '');
    return host ? `${host}/functions/v1/dictionary-suggest` : '';
  }
  return `${base}/api/dictionary/suggest`;
}

async function readMeta(): Promise<SyncMeta> {
  if (!META_PATH) return {};
  try {
    const info = await FileSystem.getInfoAsync(META_PATH);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(META_PATH, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return JSON.parse(raw) as SyncMeta;
  } catch {
    return {};
  }
}

async function writeMeta(meta: SyncMeta): Promise<void> {
  if (!META_PATH) return;
  await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(meta), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

function shouldRunDailyCheck(meta: SyncMeta, now = new Date()): boolean {
  if (!meta.lastCheckAt) return true;
  const last = new Date(meta.lastCheckAt).getTime();
  if (!Number.isFinite(last)) return true;
  if (now.getTime() - last >= MIN_INTERVAL_MS) return true;

  const windowStart = new Date(now);
  windowStart.setHours(DEFAULT_SYNC_HOUR, 0, 0, 0);
  if (now >= windowStart && last < windowStart.getTime()) return true;
  return false;
}

async function isOnline(): Promise<boolean> {
  try {
    const network = await Network.getNetworkStateAsync();
    return Boolean(
      network.isConnected && network.isInternetReachable !== false,
    );
  } catch {
    return false;
  }
}

/**
 * HEAD-Request: prüft ETag / Last-Modified ohne Full-Download.
 */
export async function checkDictionaryUpdateAvailable(): Promise<{
  available: boolean;
  etag?: string;
  lastModified?: string;
  reason?: string;
}> {
  const url = latestUrl();
  if (!url) {
    return { available: false, reason: 'Dictionary-API nicht konfiguriert' };
  }

  const meta = await readMeta();
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) {
      if (res.status === 405 || res.status === 403) {
        return { available: true, reason: 'HEAD nicht unterstützt' };
      }
      return { available: false, reason: `HEAD ${res.status}` };
    }
    const etag = res.headers.get('etag') ?? undefined;
    const lastModified = res.headers.get('last-modified') ?? undefined;
    if (etag && meta.etag && etag === meta.etag) {
      return { available: false, etag, lastModified, reason: 'ETag unverändert' };
    }
    if (
      lastModified &&
      meta.lastModified &&
      lastModified === meta.lastModified
    ) {
      return {
        available: false,
        etag,
        lastModified,
        reason: 'Last-Modified unverändert',
      };
    }
    return { available: true, etag, lastModified };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : 'HEAD fehlgeschlagen',
    };
  }
}

/**
 * Cloud → Local: Download + Safe Merge in pronunciations_master.json.
 * User-Korrekturen werden nie überschrieben; Master wird sofort persistiert.
 */
export async function downloadAndMergeLatestDictionary(): Promise<{
  ok: boolean;
  added: number;
  updated: number;
  size: number;
  skippedProtected: number;
  reason?: string;
}> {
  const url = latestUrl();
  if (!url) {
    return {
      ok: false,
      added: 0,
      updated: 0,
      size: getMasterDictionarySize(),
      skippedProtected: 0,
      reason: 'Dictionary-API nicht konfiguriert',
    };
  }

  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      return {
        ok: false,
        added: 0,
        updated: 0,
        size: getMasterDictionarySize(),
        skippedProtected: 0,
        reason: `GET ${res.status}`,
      };
    }
    const json = (await res.json()) as unknown;
    const incoming =
      json && typeof json === 'object' && !Array.isArray(json)
        ? ((json as { pronunciations?: PronunciationDict }).pronunciations ??
          (json as PronunciationDict))
        : {};

    const clean: PronunciationDict = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (typeof v === 'string' && v.trim()) clean[k] = v.trim();
    }

    const result = await applyCloudDictionaryUpdate(clean);
    // applyCloudDictionaryUpdate persistiert Master bereits
    await persistMasterDictionary();

    const meta = await readMeta();
    await writeMeta({
      ...meta,
      lastDownloadAt: new Date().toISOString(),
      etag: res.headers.get('etag') ?? meta.etag,
      lastModified: res.headers.get('last-modified') ?? meta.lastModified,
    });

    return {
      ok: true,
      added: result.added,
      updated: result.updated,
      size: result.size,
      skippedProtected: result.skippedProtected,
    };
  } catch (err) {
    return {
      ok: false,
      added: 0,
      updated: 0,
      size: getMasterDictionarySize(),
      skippedProtected: 0,
      reason: err instanceof Error ? err.message : 'Download fehlgeschlagen',
    };
  }
}

/**
 * Local → Cloud: nur Delta (Scanner/User-Korrekturen) als Suggest.
 */
export async function uploadPendingScanDelta(): Promise<SuggestResult> {
  await initDictionaryEngine();
  const meta = await readMeta();
  const uploaded = new Set(meta.uploadedKeys ?? []);
  const delta = getPendingSuggestEntries(uploaded);
  if (Object.keys(delta).length === 0) {
    return { sent: 0, accepted: 0, reason: 'Kein Delta' };
  }
  return suggestDictionaryEntries(delta);
}

/**
 * Voller Hintergrund-Sync bei Internet:
 * 1) Cloud → Local (Safe Merge + Master speichern)
 * 2) Local → Cloud (Suggest-Delta)
 */
export async function runDailyDictionarySync(
  options?: { force?: boolean; uploadDelta?: boolean },
): Promise<DictionarySyncResult> {
  // Offline-First: Master immer zuerst laden
  await initDictionaryEngine();
  const masterSize = getMasterDictionarySize();

  if (!(await isOnline())) {
    return {
      checked: false,
      updated: false,
      size: masterSize,
      reason: 'Offline — Master lokal bereit',
    };
  }

  const meta = await readMeta();
  if (!options?.force && !shouldRunDailyCheck(meta)) {
    // Trotzdem optional Delta pushen
    let suggested = 0;
    if (options?.uploadDelta !== false) {
      const up = await uploadPendingScanDelta();
      suggested = up.accepted;
    }
    return {
      checked: false,
      updated: false,
      size: masterSize,
      suggested,
      reason: 'Bereits heute geprüft',
    };
  }

  await writeMeta({ ...meta, lastCheckAt: new Date().toISOString() });

  const check = await checkDictionaryUpdateAvailable();
  let updated = false;
  let added = 0;
  let skippedProtected = 0;
  let size = masterSize;
  let reason = check.reason ?? 'Kein Update';

  if (check.available) {
    const dl = await downloadAndMergeLatestDictionary();
    if (dl.ok) {
      updated = dl.added > 0;
      added = dl.added;
      skippedProtected = dl.skippedProtected;
      size = dl.size;
      reason = updated
        ? `+${added} Cloud-Keys gemerged (${skippedProtected} geschützt)`
        : 'Cloud geprüft, keine neuen Keys';
      console.log(
        `[dictionarySync] Master updated: +${added}, protected skip=${skippedProtected}, size=${size}`,
      );
    } else {
      reason = dl.reason ?? 'Download fehlgeschlagen';
    }
  }

  let suggested = 0;
  if (options?.uploadDelta !== false) {
    const up = await uploadPendingScanDelta();
    suggested = up.accepted;
    if (up.sent > 0) {
      const m = await readMeta();
      await writeMeta({ ...m, lastSuggestAt: new Date().toISOString() });
    }
  }

  return {
    checked: true,
    updated,
    added,
    size,
    skippedProtected,
    suggested,
    reason,
  };
}

/**
 * Nach Stadt-Download: erzwungener Sync (Cloud-Merge + Scan-Delta).
 */
export async function syncDictionaryAfterCityDownload(): Promise<DictionarySyncResult> {
  return runDailyDictionarySync({ force: true, uploadDelta: true });
}

/**
 * Crowdsourced Upload neuer Scanner-Treffer (anonymisiert).
 * Nur Delta — keine Full-Dict-Uploads.
 */
export async function suggestDictionaryEntries(
  entries: PronunciationDict,
): Promise<SuggestResult> {
  const url = suggestUrl();
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    return { sent: 0, accepted: 0, reason: 'Keine Einträge' };
  }
  if (!url) {
    return {
      sent: 0,
      accepted: 0,
      reason: 'Suggest-Endpoint nicht konfiguriert',
    };
  }

  if (!(await isOnline())) {
    return { sent: 0, accepted: 0, reason: 'Offline — Delta bleibt lokal' };
  }

  const meta = await readMeta();
  const uploaded = new Set(meta.uploadedKeys ?? []);
  const payload: PronunciationDict = {};
  for (const [k, v] of Object.entries(entries)) {
    const key = k.toLowerCase();
    if (uploaded.has(key)) continue;
    payload[key] = v;
  }
  const sendKeys = Object.keys(payload);
  if (sendKeys.length === 0) {
    return { sent: 0, accepted: 0, reason: 'Bereits gemeldet' };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        suggestions: payload,
        source: 'city-scanner',
        locale: 'de',
      }),
    });

    if (!res.ok) {
      return {
        sent: sendKeys.length,
        accepted: 0,
        reason: `POST ${res.status}`,
      };
    }

    let accepted = sendKeys.length;
    try {
      const body = (await res.json()) as { accepted?: number };
      if (typeof body.accepted === 'number') accepted = body.accepted;
    } catch {
      // Endpoint ohne JSON-Body
    }

    for (const k of sendKeys) uploaded.add(k);
    await writeMeta({
      ...meta,
      uploadedKeys: [...uploaded].slice(-2000),
      lastSuggestAt: new Date().toISOString(),
    });

    return { sent: sendKeys.length, accepted };
  } catch (err) {
    return {
      sent: sendKeys.length,
      accepted: 0,
      reason: err instanceof Error ? err.message : 'Suggest fehlgeschlagen',
    };
  }
}

/**
 * Fire-and-forget für App-Start.
 * Master ist bereits via initDictionaryEngine offline geladen —
 * Sync läuft nur im Hintergrund wenn online.
 */
export function syncDictionaryInBackground(force = false): void {
  void runDailyDictionarySync({ force, uploadDelta: true }).catch((err) => {
    console.warn('[dictionarySync] Hintergrund-Sync fehlgeschlagen:', err);
  });
}
