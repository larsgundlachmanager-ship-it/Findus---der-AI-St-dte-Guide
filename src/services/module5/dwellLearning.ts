/**
 * Persönliche Verweildauer-Lernen.
 * Google/Recherche-Range + echte User-Aufenthalte → nächste Schätzung.
 *
 * Beispiel: Range 45–90, User 120 Min → Faktor hoch.
 * Range 45–90, User 30 Min → nächstes Mal näher am unteren Ende / darunter.
 */

import * as FileSystem from 'expo-file-system';
import { defaultDwellMinForLabel, inferDwellKind } from '../planning/dwellTiming';
import { researchRealisticTiming } from './researchTiming';
import { env } from '../../config/env';
import {
  getCachedPlaceFacts,
  putCachedPlaceFacts,
} from '../navigation/placesFactCache';

export type DwellRange = {
  minMin: number;
  maxMin: number;
  source: 'google' | 'research' | 'default';
};

export type DwellCategoryStat = {
  kind: string;
  /** relative zu Midpoint der Range (1 = genau Mitte) */
  samples: number[];
  updatedAtMs: number;
};

type DwellStore = {
  byKind: Record<string, DwellCategoryStat>;
  byPlace: Record<string, number[]>;
};

const PATH = `${FileSystem.documentDirectory}findus-dwell-learning.json`;
let store: DwellStore = { byKind: {}, byPlace: {} };
let hydrated = false;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const info = await FileSystem.getInfoAsync(PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(PATH);
    const parsed = JSON.parse(raw) as DwellStore;
    if (parsed?.byKind) store = parsed;
  } catch {
    /* soft */
  }
}

function persist(): void {
  void FileSystem.writeAsStringAsync(PATH, JSON.stringify(store)).catch(
    () => {},
  );
}

function midpoint(r: DwellRange): number {
  return (r.minMin + r.maxMin) / 2;
}

/** Persönlicher Faktor aus letzten Samples (Median). */
function personalFactor(kind: string): number {
  const samples = store.byKind[kind]?.samples ?? [];
  if (!samples.length) return 1;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
}

/**
 * Google Places: versucht Hinweise aus Details/Reviews (kein offizielles Dwell-Feld).
 */
export async function fetchGoogleDwellRangeHint(opts: {
  name: string;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
}): Promise<DwellRange | null> {
  const cached = await getCachedPlaceFacts(opts.name, opts.placeId);
  if (
    cached?.dwellMinMin != null &&
    cached.dwellMaxMin != null &&
    Date.now() - cached.updatedAtMs < 90 * 24 * 60 * 60_000
  ) {
    return {
      minMin: cached.dwellMinMin,
      maxMin: cached.dwellMaxMin,
      source: 'google',
    };
  }

  const key = env.googleMapsApiKey();
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    let placeId = opts.placeId ?? null;
    if (!placeId && opts.name) {
      const u = new URL(
        'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
      );
      u.searchParams.set('input', opts.name);
      u.searchParams.set('inputtype', 'textquery');
      u.searchParams.set('fields', 'place_id');
      u.searchParams.set('key', key);
      if (opts.lat != null && opts.lng != null) {
        u.searchParams.set(
          'locationbias',
          `circle:2000@${opts.lat},${opts.lng}`,
        );
      }
      const res = await fetch(u.toString(), { signal: ctrl.signal });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ place_id?: string }>;
        };
        placeId = data.candidates?.[0]?.place_id ?? null;
      }
    }
    if (!placeId) return null;

    const d = new URL(
      'https://maps.googleapis.com/maps/api/place/details/json',
    );
    d.searchParams.set('place_id', placeId);
    d.searchParams.set(
      'fields',
      'name,types,reviews,editorial_summary,price_level',
    );
    d.searchParams.set('language', 'de');
    d.searchParams.set('key', key);
    const res = await fetch(d.toString(), { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: {
        types?: string[];
        editorial_summary?: { overview?: string };
        reviews?: Array<{ text?: string }>;
        price_level?: number;
      };
    };
    const blob = [
      data.result?.editorial_summary?.overview ?? '',
      ...(data.result?.reviews ?? []).map((r) => r.text ?? ''),
    ]
      .join(' ')
      .toLowerCase();

    const types = data.result?.types ?? [];
    // Snack / fast
    if (
      types.some((t) =>
        /meal_takeaway|fast_food|bakery|cafe/.test(t),
      ) ||
      /schnell|snack|to\s*go|take.?away|imbiss/.test(blob)
    ) {
      const range: DwellRange = { minMin: 20, maxMin: 45, source: 'google' };
      void putCachedPlaceFacts({
        name: opts.name,
        placeId: placeId,
        lat: opts.lat ?? 0,
        lng: opts.lng ?? 0,
        usedEntrance: false,
        via: 'google_place',
        dwellMinMin: range.minMin,
        dwellMaxMin: range.maxMin,
      });
      return range;
    }
    if (/bar|wein|abend|stundenlang|gemütlich|gemuetlich/.test(blob)) {
      const range: DwellRange = { minMin: 90, maxMin: 150, source: 'google' };
      void putCachedPlaceFacts({
        name: opts.name,
        placeId: placeId,
        lat: opts.lat ?? 0,
        lng: opts.lng ?? 0,
        usedEntrance: false,
        via: 'google_place',
        dwellMinMin: range.minMin,
        dwellMaxMin: range.maxMin,
      });
      return range;
    }
    // Minuten-Hinweise in Reviews
    const m = blob.match(
      /(\d{1,2})\s*(?:–|-|bis)\s*(\d{1,2})\s*(?:min|minuten|stunden|h\b)/,
    );
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      if (/stunde|h\b/.test(m[0])) {
        a *= 60;
        b *= 60;
      }
      const range: DwellRange = {
        minMin: Math.min(a, b),
        maxMin: Math.max(a, b),
        source: 'google',
      };
      void putCachedPlaceFacts({
        name: opts.name,
        placeId: placeId,
        lat: opts.lat ?? 0,
        lng: opts.lng ?? 0,
        usedEntrance: false,
        via: 'google_place',
        dwellMinMin: range.minMin,
        dwellMaxMin: range.maxMin,
      });
      return range;
    }
    if (types.some((t) => /restaurant|food/.test(t))) {
      const range: DwellRange = { minMin: 45, maxMin: 90, source: 'google' };
      void putCachedPlaceFacts({
        name: opts.name,
        placeId: placeId,
        lat: opts.lat ?? 0,
        lng: opts.lng ?? 0,
        usedEntrance: false,
        via: 'google_place',
        dwellMinMin: range.minMin,
        dwellMaxMin: range.maxMin,
      });
      return range;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Range holen: Google → Recherche → Default. Dann persönlichen Faktor anwenden.
 * Liefert immer die **Planungsdauer** (eher oberes Ende × Faktor, gerundet).
 */
export async function resolveStayMinutesForPlace(opts: {
  name: string;
  kindHint?: string;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
}): Promise<{
  planMin: number;
  range: DwellRange;
  personalFactor: number;
  notes: string[];
}> {
  await hydrate();
  const kind = inferDwellKind(opts.kindHint ?? opts.name);
  const notes: string[] = [];

  let range =
    (await fetchGoogleDwellRangeHint(opts)) ??
    ({
      minMin: Math.round(defaultDwellMinForLabel(opts.name) * 0.7),
      maxMin: defaultDwellMinForLabel(opts.name),
      source: 'default' as const,
    });

  if (range.source === 'default' || range.maxMin - range.minMin < 10) {
    try {
      const researched = await researchRealisticTiming({
        subject: opts.name,
        kind: 'dwell',
      });
      if (researched.minutes != null) {
        range = {
          minMin: Math.round(researched.minutes * 0.6),
          maxMin: researched.minutes,
          source: 'research',
        };
        notes.push('Verweildauer recherchiert');
      }
    } catch {
      /* soft */
    }
  } else {
    notes.push(`Google/Typ-Hinweis ${range.minMin}–${range.maxMin} Min`);
  }

  const factor = personalFactor(kind);
  // Plan: eher oberes Ende, dann persönlicher Faktor
  let plan = range.maxMin * factor;
  // Wenn User deutlich schneller → näher ans untere Ende
  if (factor < 0.75) {
    plan = range.minMin * Math.max(0.5, factor);
  } else if (factor > 1.25) {
    plan = range.maxMin * factor;
  }
  plan = Math.max(15, Math.round(plan / 5) * 5);
  notes.push(
    `Persönlich ×${factor.toFixed(2)} → plane ${plan} Min (${kind})`,
  );

  return { planMin: plan, range, personalFactor: factor, notes };
}

/**
 * Nach Besuch: echte Minuten speichern und Faktor updaten.
 * actualMin vs. damals erwarteter Midpoint.
 */
export function recordActualDwell(opts: {
  name: string;
  actualMin: number;
  expectedRange?: DwellRange | null;
}): void {
  void hydrate().then(() => {
    if (opts.actualMin < 5 || opts.actualMin > 480) return;
    const kind = inferDwellKind(opts.name);
    const range =
      opts.expectedRange ??
      ({
        minMin: Math.round(defaultDwellMinForLabel(opts.name) * 0.7),
        maxMin: defaultDwellMinForLabel(opts.name),
        source: 'default' as const,
      });
    const mid = Math.max(15, midpoint(range));
    const ratio = opts.actualMin / mid;
    const clamped = Math.min(2.5, Math.max(0.35, ratio));

    const prev = store.byKind[kind] ?? {
      kind,
      samples: [],
      updatedAtMs: Date.now(),
    };
    prev.samples = [...prev.samples, clamped].slice(-12);
    prev.updatedAtMs = Date.now();
    store.byKind[kind] = prev;

    const key = opts.name.toLowerCase().slice(0, 48);
    store.byPlace[key] = [...(store.byPlace[key] ?? []), opts.actualMin].slice(
      -8,
    );
    persist();
  });
}
