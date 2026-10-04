/**
 * Brief-Shelf: stabile Prefs aus früheren Trips — gefragt → Wert merken → nächster Trip abgehakt.
 * UX: Flipchart-Chips „✓ Thema“ wenn aus Shelf übernommen (kein Vorlese-Skript).
 */

import type { ReiseLedger, SlotSource } from './types';
import { entry } from './slotLedger';

const STORAGE_KEY = 'findus.reisebuero.shelf_asked.v1';

export type ShelfSlotSnap = {
  id: string;
  /** JSON-serialisierbarer Ledger-Wert. */
  value: unknown;
  /** Kurzes Thema für Chip — kein Speech. */
  topic: string;
  updatedAtMs: number;
};

type ShelfBag = {
  /** Legacy: nur IDs. */
  answeredIds: string[];
  /** Werte-Snapshots für Apply. */
  slots: ShelfSlotSnap[];
  updatedAtMs: number;
};

let cache: ShelfBag = { answeredIds: [], slots: [], updatedAtMs: 0 };
let hydrated = false;

async function storage(): Promise<{
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
} | null> {
  try {
    const mod = require('@react-native-async-storage/async-storage');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

export async function hydrateShelfAsked(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const s = await storage();
    if (!s) return;
    const raw = await s.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as ShelfBag;
    const ids = Array.isArray(p?.answeredIds) ? p.answeredIds.slice(0, 40) : [];
    const slots = Array.isArray(p?.slots)
      ? p.slots
          .filter((x) => x && typeof x.id === 'string')
          .slice(0, 40)
      : [];
    cache = {
      answeredIds: ids.length ? ids : slots.map((x) => x.id),
      slots,
      updatedAtMs: p.updatedAtMs ?? 0,
    };
  } catch {
    /* soft */
  }
}

async function persist(): Promise<void> {
  try {
    const s = await storage();
    if (!s) return;
    await s.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* soft */
  }
}

type ShelfDef = {
  topic: string;
  has: (ledger: ReiseLedger) => boolean;
  read: (ledger: ReiseLedger) => unknown;
  /** Patch nur leere Slots — source shelf. */
  write: (value: unknown) => Partial<ReiseLedger> | null;
};

/** Stabile Prefs (nicht destination/when/budget-Trip-spezifisch). */
export const SHELFABLE_DEFS: Record<string, ShelfDef> = {
  origin: {
    topic: 'Start',
    has: (l) => Boolean(l.originCity?.value || l.originCities?.value?.length),
    read: (l) => ({
      city: l.originCity?.value ?? null,
      cities: l.originCities?.value ?? null,
    }),
    write: (v) => {
      const o = v as { city?: string | null; cities?: string[] | null };
      const patch: Partial<ReiseLedger> = {};
      if (o?.city) patch.originCity = entry(String(o.city), 'shelf');
      if (o?.cities?.length) patch.originCities = entry(o.cities.map(String), 'shelf');
      return Object.keys(patch).length ? patch : null;
    },
  },
  bags: {
    topic: 'Gepäck',
    has: (l) => l.cabinBags != null || l.checkedBags != null,
    read: (l) => ({
      cabin: l.cabinBags?.value ?? null,
      checked: l.checkedBags?.value ?? null,
    }),
    write: (v) => {
      const o = v as { cabin?: number | null; checked?: number | null };
      const patch: Partial<ReiseLedger> = {};
      if (o?.cabin != null) patch.cabinBags = entry(Number(o.cabin), 'shelf');
      if (o?.checked != null) patch.checkedBags = entry(Number(o.checked), 'shelf');
      return Object.keys(patch).length ? patch : null;
    },
  },
  bahncard: {
    topic: 'Bahncard',
    has: (l) => l.bahncard != null,
    read: (l) => l.bahncard?.value ?? null,
    write: (v) =>
      v == null ? null : { bahncard: entry(v as never, 'shelf') },
  },
  ages: {
    topic: 'Alter',
    has: (l) => Boolean(l.travelerAges?.value?.length),
    read: (l) => l.travelerAges?.value ?? null,
    write: (v) =>
      Array.isArray(v) && v.length
        ? { travelerAges: entry(v.map(Number), 'shelf') }
        : null,
  },
  meals: {
    topic: 'Essen',
    has: (l) => Boolean(l.meals),
    read: (l) => l.meals?.value ?? null,
    write: (v) => (v == null ? null : { meals: entry(v as never, 'shelf') }),
  },
  localMove: {
    topic: 'vor Ort',
    has: (l) => Boolean(l.localMovePref || l.rentalCar != null),
    read: (l) => ({
      move: l.localMovePref?.value ?? null,
      rental: l.rentalCar?.value ?? null,
    }),
    write: (v) => {
      const o = v as { move?: string | null; rental?: boolean | null };
      const patch: Partial<ReiseLedger> = {};
      if (o?.move) patch.localMovePref = entry(o.move as never, 'shelf');
      if (o?.rental != null) patch.rentalCar = entry(Boolean(o.rental), 'shelf');
      return Object.keys(patch).length ? patch : null;
    },
  },
  surfacePref: {
    topic: 'Spar-Anreise',
    has: (l) => Boolean(l.surfacePref),
    read: (l) => l.surfacePref?.value ?? null,
    write: (v) =>
      v == null ? null : { surfacePref: entry(v as never, 'shelf') },
  },
  partyGrain: {
    topic: 'Feier',
    has: (l) => Boolean(l.partyGrain || l.partyStyle),
    read: (l) => ({
      grain: l.partyGrain?.value ?? null,
      style: l.partyStyle?.value ?? null,
    }),
    write: (v) => {
      const o = v as { grain?: string | null; style?: string | null };
      const patch: Partial<ReiseLedger> = {};
      if (o?.grain) patch.partyGrain = entry(String(o.grain), 'shelf');
      if (o?.style) patch.partyStyle = entry(String(o.style), 'shelf');
      return Object.keys(patch).length ? patch : null;
    },
  },
  spaStyle: {
    topic: 'Spa',
    has: (l) => Boolean(l.spaStyle),
    read: (l) => l.spaStyle?.value ?? null,
    write: (v) =>
      v == null ? null : { spaStyle: entry(String(v), 'shelf') },
  },
  lodging: {
    topic: 'Unterkunft',
    has: (l) => Boolean(l.lodgingKind || l.lodgingOpen),
    read: (l) => ({
      kind: l.lodgingKind?.value ?? null,
      open: l.lodgingOpen?.value ?? null,
    }),
    write: (v) => {
      const o = v as { kind?: string | null; open?: boolean | null };
      const patch: Partial<ReiseLedger> = {};
      if (o?.kind) patch.lodgingKind = entry(o.kind as never, 'shelf');
      if (o?.open != null) patch.lodgingOpen = entry(Boolean(o.open), 'shelf');
      return Object.keys(patch).length ? patch : null;
    },
  },
  accessNeeds: {
    topic: 'Zugang',
    has: (l) => Boolean(l.accessNeeds?.value?.length),
    read: (l) => l.accessNeeds?.value ?? null,
    write: (v) =>
      Array.isArray(v) && v.length
        ? { accessNeeds: entry(v.map(String), 'shelf') }
        : null,
  },
  directFlight: {
    topic: 'Direktflug',
    has: (l) => l.directFlight != null,
    read: (l) => l.directFlight?.value ?? null,
    write: (v) =>
      v == null ? null : { directFlight: entry(Boolean(v), 'shelf') },
  },
  cheapDrinks: {
    topic: 'Drinks',
    has: (l) => l.cheapDrinks != null,
    read: (l) => l.cheapDrinks?.value ?? null,
    write: (v) =>
      v == null ? null : { cheapDrinks: entry(Boolean(v), 'shelf') },
  },
};

export const SHELFABLE = new Set(Object.keys(SHELFABLE_DEFS));

function upsertSlot(snap: ShelfSlotSnap): void {
  const rest = cache.slots.filter((s) => s.id !== snap.id);
  const nextSlots = [...rest, snap].slice(-40);
  const nextIds = [...new Set([...cache.answeredIds, snap.id])].slice(-40);
  cache = { answeredIds: nextIds, slots: nextSlots, updatedAtMs: Date.now() };
  void persist();
}

/** Nur IDs merken (Legacy / soft). */
export function rememberShelfAsked(ids: string[]): void {
  const filtered = ids.filter((id) => SHELFABLE.has(id));
  if (!filtered.length) return;
  const next = [...new Set([...cache.answeredIds, ...filtered])].slice(-40);
  cache = { ...cache, answeredIds: next, updatedAtMs: Date.now() };
  void persist();
}

/** Gefragt + beantwortet → Wert + Thema aufs Shelf. */
export function rememberShelfFromLedger(ledger: ReiseLedger, ids: string[]): string[] {
  const saved: string[] = [];
  for (const id of ids) {
    const def = SHELFABLE_DEFS[id];
    if (!def || !def.has(ledger)) continue;
    try {
      const value = def.read(ledger);
      if (value == null) continue;
      upsertSlot({
        id,
        value,
        topic: def.topic,
        updatedAtMs: Date.now(),
      });
      saved.push(id);
    } catch {
      /* soft */
    }
  }
  if (saved.length) rememberShelfAsked(saved);
  return saved;
}

/** Alle aktuell gefüllten Shelfables aus dem Ledger snapshotten. */
export function rememberShelfFilled(ledger: ReiseLedger): string[] {
  return rememberShelfFromLedger(
    ledger,
    Object.keys(SHELFABLE_DEFS).filter((id) => SHELFABLE_DEFS[id]!.has(ledger)),
  );
}

export function listShelfAsked(): string[] {
  return [...new Set([...cache.answeredIds, ...cache.slots.map((s) => s.id)])];
}

export function listShelfSlots(): ShelfSlotSnap[] {
  return [...cache.slots];
}

/**
 * Leere Ledger-Slots aus Shelf füllen (source: shelf).
 * User/Profile bleiben stärker (mergeEntry).
 */
export function applyShelfPrefsToLedger(ledger: ReiseLedger): {
  ledger: ReiseLedger;
  appliedIds: string[];
} {
  let next = { ...ledger };
  const applied: string[] = [];
  for (const snap of cache.slots) {
    const def = SHELFABLE_DEFS[snap.id];
    if (!def) continue;
    if (def.has(next)) continue; // schon da — nicht überschreiben
    try {
      const patch = def.write(snap.value);
      if (!patch) continue;
      next = { ...next, ...patch };
      if (def.has(next)) applied.push(snap.id);
    } catch {
      /* soft */
    }
  }
  // Legacy: ID ohne Value — nichts anzuwenden
  return { ledger: next, appliedIds: [...new Set(applied)] };
}

/**
 * Merge Shelf in asked — nur wenn Ledger den Slot schon trägt
 * (nach applyShelfPrefsToLedger greifen Snapshots).
 */
export function mergeShelfIntoAsked(ledger: ReiseLedger, asked: string[]): string[] {
  const ids = listShelfAsked();
  const fromShelf = ids.filter((id) => {
    if (!SHELFABLE.has(id)) return false;
    if (asked.includes(id)) return false;
    const def = SHELFABLE_DEFS[id];
    return def ? def.has(ledger) : false;
  });
  return [...new Set([...asked, ...fromShelf])];
}

/** Flipchart-Chips: Themen die aus Shelf im Ledger sitzen. */
export function shelfCheckOffChips(ledger: ReiseLedger): { id: string; topic: string }[] {
  const out: { id: string; topic: string }[] = [];
  for (const snap of cache.slots) {
    const def = SHELFABLE_DEFS[snap.id];
    if (!def || !def.has(ledger)) continue;
    // Nur anzeigen wenn Quelle shelf (oder Profile-Origin oft schon da)
    const src = shelfSourceForId(ledger, snap.id);
    if (src === 'shelf' || src === 'profile' || src === 'user') {
      out.push({ id: snap.id, topic: def.topic });
    }
  }
  // Legacy IDs ohne Snap: Chip wenn Wert da und ID shelf-known
  for (const id of cache.answeredIds) {
    if (out.some((x) => x.id === id)) continue;
    const def = SHELFABLE_DEFS[id];
    if (!def || !def.has(ledger)) continue;
    out.push({ id, topic: def.topic });
  }
  return out.slice(0, 8);
}

function shelfSourceForId(ledger: ReiseLedger, id: string): SlotSource | null {
  switch (id) {
    case 'origin':
      return ledger.originCity?.source ?? ledger.originCities?.source ?? null;
    case 'bags':
      return ledger.cabinBags?.source ?? ledger.checkedBags?.source ?? null;
    case 'bahncard':
      return ledger.bahncard?.source ?? null;
    case 'ages':
      return ledger.travelerAges?.source ?? null;
    case 'meals':
      return ledger.meals?.source ?? null;
    case 'localMove':
      return ledger.localMovePref?.source ?? ledger.rentalCar?.source ?? null;
    case 'surfacePref':
      return ledger.surfacePref?.source ?? null;
    case 'partyGrain':
      return ledger.partyGrain?.source ?? ledger.partyStyle?.source ?? null;
    case 'spaStyle':
      return ledger.spaStyle?.source ?? null;
    case 'lodging':
      return ledger.lodgingKind?.source ?? ledger.lodgingOpen?.source ?? null;
    case 'accessNeeds':
      return ledger.accessNeeds?.source ?? null;
    case 'directFlight':
      return ledger.directFlight?.source ?? null;
    case 'cheapDrinks':
      return ledger.cheapDrinks?.source ?? null;
    default:
      return null;
  }
}

/** Kurzer Struktur-Hint für Ack (kein fester Satz) — Themenliste. */
export function shelfReuseTopics(ledger: ReiseLedger): string[] {
  return shelfCheckOffChips(ledger)
    .filter((c) => shelfSourceForId(ledger, c.id) === 'shelf')
    .map((c) => c.topic);
}

/** Sync-Seed für Tests. */
export function __setShelfAskedForTest(ids: string[], slots?: ShelfSlotSnap[]): void {
  cache = {
    answeredIds: ids,
    slots: slots ?? [],
    updatedAtMs: Date.now(),
  };
  hydrated = true;
}

export function __resetShelfAskedForTest(): void {
  cache = { answeredIds: [], slots: [], updatedAtMs: 0 };
  hydrated = true;
}
