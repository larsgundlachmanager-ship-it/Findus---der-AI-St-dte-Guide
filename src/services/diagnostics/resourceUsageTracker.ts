/**
 * Session resource usage — Datenvolumen + Akku-Attribution (Dev-Board).
 *
 * Daten: instrumentiertes fetch + Cartesia-XHR (Bytes in/out je Abnehmer).
 * Akku: Battery-Sampling + Zeitanteile aktiver Modi (GPS, TTS, Mic, Gen, Nav).
 * Kein OS-Level (Android Settings) — Schätzung für diese App-Session.
 */

import * as Battery from 'expo-battery';
import * as FileSystem from 'expo-file-system';
import { useFinnusStore } from '../../store/useFinnusStore';

export type DataConsumerId =
  | 'gemini'
  | 'cartesia'
  | 'maps'
  | 'supabase'
  | 'transit'
  | 'weather'
  | 'other';

export type BatteryConsumerId =
  | 'gps'
  | 'tts'
  | 'mic'
  | 'llm'
  | 'nav'
  | 'screen'
  | 'other';

const DATA_LABELS: Record<DataConsumerId, string> = {
  gemini: 'Gemini (LLM)',
  cartesia: 'Cartesia (TTS)',
  maps: 'Google Maps',
  supabase: 'Supabase / Stadt-Pack',
  transit: 'ÖPNV / Transit',
  weather: 'Wetter',
  other: 'Sonstiges',
};

const BATTERY_LABELS: Record<BatteryConsumerId, string> = {
  gps: 'GPS / Standort',
  tts: 'TTS / Audio',
  mic: 'Mikrofon / STT',
  llm: 'KI-Generierung',
  nav: 'Navigation',
  screen: 'UI / Screen',
  other: 'Sonstiges / Idle',
};

type ByteBucket = { bytesIn: number; bytesOut: number; requests: number };

type BatteryWeights = Record<BatteryConsumerId, number>;

const STORAGE_PATH = `${FileSystem.documentDirectory}resource-usage-v1.json`;

const dataBuckets: Record<DataConsumerId, ByteBucket> = emptyData();
let batteryWeights: BatteryWeights = emptyBattery();
let sessionStartedAtMs = Date.now();
let batteryStartLevel: number | null = null;
let batteryLastLevel: number | null = null;
let batteryLastSampleAtMs = 0;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let fetchPatched = false;
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function emptyData(): Record<DataConsumerId, ByteBucket> {
  return {
    gemini: { bytesIn: 0, bytesOut: 0, requests: 0 },
    cartesia: { bytesIn: 0, bytesOut: 0, requests: 0 },
    maps: { bytesIn: 0, bytesOut: 0, requests: 0 },
    supabase: { bytesIn: 0, bytesOut: 0, requests: 0 },
    transit: { bytesIn: 0, bytesOut: 0, requests: 0 },
    weather: { bytesIn: 0, bytesOut: 0, requests: 0 },
    other: { bytesIn: 0, bytesOut: 0, requests: 0 },
  };
}

function emptyBattery(): BatteryWeights {
  return {
    gps: 0,
    tts: 0,
    mic: 0,
    llm: 0,
    nav: 0,
    screen: 0,
    other: 0,
  };
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void FileSystem.writeAsStringAsync(
      STORAGE_PATH,
      JSON.stringify({
        dataBuckets,
        batteryWeights,
        sessionStartedAtMs,
        batteryStartLevel,
        batteryLastLevel,
      }),
    ).catch(() => undefined);
  }, 800);
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(STORAGE_PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(STORAGE_PATH);
    const parsed = JSON.parse(raw) as {
      dataBuckets?: Record<DataConsumerId, ByteBucket>;
      batteryWeights?: BatteryWeights;
      sessionStartedAtMs?: number;
      batteryStartLevel?: number | null;
      batteryLastLevel?: number | null;
    };
    if (parsed.dataBuckets) {
      for (const k of Object.keys(dataBuckets) as DataConsumerId[]) {
        const b = parsed.dataBuckets[k];
        if (b) dataBuckets[k] = { ...dataBuckets[k], ...b };
      }
    }
    if (parsed.batteryWeights) {
      batteryWeights = { ...batteryWeights, ...parsed.batteryWeights };
    }
    if (typeof parsed.sessionStartedAtMs === 'number') {
      sessionStartedAtMs = parsed.sessionStartedAtMs;
    }
    if (parsed.batteryStartLevel != null) {
      batteryStartLevel = parsed.batteryStartLevel;
    }
    if (parsed.batteryLastLevel != null) {
      batteryLastLevel = parsed.batteryLastLevel;
    }
  } catch {
    /* ignore */
  }
}


function mapsCallLabel(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('directions')) return 'directions';
  if (u.includes('geocode')) return 'geocode';
  if (u.includes('streetview')) return 'streetview';
  if (u.includes('searchnearby') || u.includes('nearbysearch')) return 'places_nearby';
  if (u.includes('searchtext') || u.includes('textsearch') || u.includes('findplace')) {
    return 'places_text';
  }
  if (u.includes('/details') || u.includes('placedetails')) return 'place_details';
  return 'maps';
}

export function classifyUrl(url: string): DataConsumerId {
  const u = url.toLowerCase();
  if (
    u.includes('generativelanguage.googleapis.com') ||
    u.includes('googleapis.com/v1beta') ||
    u.includes('gemini')
  ) {
    return 'gemini';
  }
  if (u.includes('cartesia.ai')) return 'cartesia';
  if (
    u.includes('maps.googleapis.com') ||
    u.includes('places.googleapis.com') ||
    u.includes('routes.googleapis.com') ||
    u.includes('streetview')
  ) {
    return 'maps';
  }
  if (u.includes('supabase.co') || u.includes('supabase.com')) {
    return 'supabase';
  }
  if (
    u.includes('transitous') ||
    u.includes('transport.rest') ||
    u.includes('flightaware') ||
    u.includes('gtfs') ||
    u.includes('delijn')
  ) {
    return 'transit';
  }
  if (
    u.includes('open-meteo') ||
    u.includes('weather') ||
    u.includes('weather-forecast')
  ) {
    return 'weather';
  }
  return 'other';
}

export function trackDataBytes(
  consumer: DataConsumerId,
  bytesIn: number,
  bytesOut: number,
): void {
  const b = dataBuckets[consumer] ?? dataBuckets.other;
  b.bytesIn += Math.max(0, Math.floor(bytesIn));
  b.bytesOut += Math.max(0, Math.floor(bytesOut));
  b.requests += 1;
  schedulePersist();
}

function byteLengthOfBody(body: unknown): number {
  if (body == null) return 0;
  if (typeof body === 'string') return body.length;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  try {
    return JSON.stringify(body).length;
  } catch {
    return 0;
  }
}

function headerContentLength(headers: Headers): number {
  const raw = headers.get('content-length');
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Patch global fetch once — klassifiziert Traffic nach Host. */
export function installNetworkUsageProbe(): void {
  if (fetchPatched) return;
  fetchPatched = true;
  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const consumer = classifyUrl(url);
    const outBytes = byteLengthOfBody(init?.body);

    if (consumer === 'maps') {
      void import('../llm/apiUsageTracker')
        .then((m) => m.trackMapsUsage(mapsCallLabel(url)))
        .catch(() => undefined);
    }

    const response = await original(input, init);
    let recorded = false;
    const recordIn = (bytesIn: number) => {
      if (recorded) return;
      recorded = true;
      trackDataBytes(consumer, bytesIn, outBytes);
    };

    const cl = headerContentLength(response.headers);
    if (cl > 0) {
      recordIn(cl);
      return response;
    }

    // Ohne Content-Length: Größe beim ersten Body-Read messen (kein Doppel-Download)
    const wrap =
      <T>(fn: () => Promise<T>, sizeOf: (v: T) => number) =>
      async () => {
        const value = await fn();
        try {
          recordIn(sizeOf(value));
        } catch {
          recordIn(0);
        }
        return value;
      };

    const res = response as Response & {
      json: () => Promise<unknown>;
      text: () => Promise<string>;
      arrayBuffer: () => Promise<ArrayBuffer>;
    };

    const origJson = res.json.bind(res);
    const origText = res.text.bind(res);
    const origBuf = res.arrayBuffer.bind(res);

    res.json = wrap(origJson, (v) => {
      try {
        return JSON.stringify(v).length;
      } catch {
        return 0;
      }
    });
    res.text = wrap(origText, (v) => v.length);
    res.arrayBuffer = wrap(origBuf, (v) => v.byteLength);

    // Falls Body nie gelesen wird: trotzdem Request zählen
    setTimeout(() => recordIn(0), 30_000);

    return res;
  }) as typeof fetch;
}

function activeBatteryConsumers(): BatteryConsumerId[] {
  const s = useFinnusStore.getState();
  const active: BatteryConsumerId[] = [];
  if (s.gpsWatching || s.gpsStatus === 'fix' || s.gpsStatus === 'searching') {
    active.push('gps');
  }
  if (s.isPlayingAudio) active.push('tts');
  if (s.isListening) active.push('mic');
  if (s.isGenerating) active.push('llm');
  if (s.navActive) active.push('nav');
  // UI gilt als immer leicht aktiv, wenn App im Vordergrund (Annäherung)
  active.push('screen');
  return active.length > 0 ? active : ['other'];
}

async function sampleBatteryOnce(): Promise<void> {
  let level: number | null = null;
  try {
    level = await Battery.getBatteryLevelAsync();
  } catch {
    return;
  }
  if (level == null || level < 0) return;

  const now = Date.now();
  if (batteryStartLevel == null) {
    batteryStartLevel = level;
    batteryLastLevel = level;
    batteryLastSampleAtMs = now;
    schedulePersist();
    return;
  }

  const dtMs = Math.max(0, now - (batteryLastSampleAtMs || now));
  const dtSec = dtMs / 1000;
  batteryLastSampleAtMs = now;

  // Zeitanteile immer sammeln (auch ohne Drain — für Verteilung)
  const actives = activeBatteryConsumers();
  const share = dtSec / Math.max(1, actives.length);
  for (const id of actives) {
    batteryWeights[id] += share;
  }

  // Wenn Akku steigt (Laden), Start-Level nachziehen — kein negativer Drain
  if (batteryLastLevel != null && level > batteryLastLevel + 0.005) {
    batteryStartLevel = level;
  }
  batteryLastLevel = level;
  schedulePersist();
}

export function startResourceUsageMonitor(): () => void {
  void hydrate();
  installNetworkUsageProbe();
  void sampleBatteryOnce();
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = setInterval(() => {
    void sampleBatteryOnce();
  }, 15_000);
  return () => {
    if (sampleTimer) {
      clearInterval(sampleTimer);
      sampleTimer = null;
    }
  };
}

export function formatBytes(bytes: number): string {
  const b = Math.max(0, bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) {
    return `${(b / 1024).toFixed(b < 10_240 ? 1 : 0).replace('.', ',')} KB`;
  }
  if (b < 1024 * 1024 * 1024) {
    return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 2 : 1).replace('.', ',')} MB`;
  }
  return `${(b / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} GB`;
}

export type DataUsageRow = {
  id: DataConsumerId;
  label: string;
  bytesIn: number;
  bytesOut: number;
  bytesTotal: number;
  requests: number;
  sharePct: number;
};

export type BatteryUsageRow = {
  id: BatteryConsumerId;
  label: string;
  weightSec: number;
  estimatedPctPoints: number;
  sharePct: number;
};

export type ResourceUsageSnapshot = {
  sessionMinutes: number;
  dataTotalBytes: number;
  dataRows: DataUsageRow[];
  batteryStartPct: number | null;
  batteryNowPct: number | null;
  batteryDropPctPoints: number;
  batteryRows: BatteryUsageRow[];
};

export function getResourceUsageSnapshot(): ResourceUsageSnapshot {
  void hydrate();
  const dataRowsRaw = (Object.keys(dataBuckets) as DataConsumerId[]).map(
    (id) => {
      const b = dataBuckets[id];
      return {
        id,
        label: DATA_LABELS[id],
        bytesIn: b.bytesIn,
        bytesOut: b.bytesOut,
        bytesTotal: b.bytesIn + b.bytesOut,
        requests: b.requests,
      };
    },
  );
  const dataTotal = dataRowsRaw.reduce((s, r) => s + r.bytesTotal, 0);
  const dataRows: DataUsageRow[] = dataRowsRaw
    .map((r) => ({
      ...r,
      sharePct: dataTotal > 0 ? (r.bytesTotal / dataTotal) * 100 : 0,
    }))
    .filter((r) => r.bytesTotal > 0 || r.requests > 0)
    .sort((a, b) => b.bytesTotal - a.bytesTotal);

  const weightTotal = (
    Object.keys(batteryWeights) as BatteryConsumerId[]
  ).reduce((s, id) => s + batteryWeights[id], 0);

  const startPct =
    batteryStartLevel != null ? Math.round(batteryStartLevel * 1000) / 10 : null;
  const nowPct =
    batteryLastLevel != null ? Math.round(batteryLastLevel * 1000) / 10 : null;
  const dropPoints =
    startPct != null && nowPct != null
      ? Math.max(0, Math.round((startPct - nowPct) * 10) / 10)
      : 0;

  const batteryRows: BatteryUsageRow[] = (
    Object.keys(batteryWeights) as BatteryConsumerId[]
  )
    .map((id) => {
      const w = batteryWeights[id];
      const share = weightTotal > 0 ? w / weightTotal : 0;
      return {
        id,
        label: BATTERY_LABELS[id],
        weightSec: w,
        estimatedPctPoints: Math.round(dropPoints * share * 10) / 10,
        sharePct: Math.round(share * 1000) / 10,
      };
    })
    .filter((r) => r.weightSec > 0.5)
    .sort((a, b) => b.estimatedPctPoints - a.estimatedPctPoints);

  return {
    sessionMinutes: Math.max(
      0,
      Math.round((Date.now() - sessionStartedAtMs) / 60_000),
    ),
    dataTotalBytes: dataTotal,
    dataRows,
    batteryStartPct: startPct,
    batteryNowPct: nowPct,
    batteryDropPctPoints: dropPoints,
    batteryRows,
  };
}

export async function resetResourceUsage(): Promise<void> {
  for (const k of Object.keys(dataBuckets) as DataConsumerId[]) {
    dataBuckets[k] = { bytesIn: 0, bytesOut: 0, requests: 0 };
  }
  batteryWeights = emptyBattery();
  sessionStartedAtMs = Date.now();
  try {
    batteryStartLevel = await Battery.getBatteryLevelAsync();
    batteryLastLevel = batteryStartLevel;
  } catch {
    batteryStartLevel = null;
    batteryLastLevel = null;
  }
  batteryLastSampleAtMs = Date.now();
  schedulePersist();
}
