/**
 * Reise-Geschmack merken — lokal + Auto-Learn, kein Script.
 * AsyncStorage lazy, damit Node-Smoke ohne RN läuft.
 */

import type { PersonaVariant } from '../module2/router/routeAllowlist';
import type { ReiseLedger } from './types';
import { detectTripVibes } from './vibeProbes';

const STORAGE_KEY = 'findus.reisebuero.taste.v1';

export type TasteMem = {
  counts: Record<string, number>;
  likes: string[];
  /** Stabile Prefs: party_yes|party_no|cheap_beer|eco|… */
  stablePrefs: string[];
  updatedAtMs: number;
};

let mem: TasteMem = { counts: {}, likes: [], stablePrefs: [], updatedAtMs: 0 };
let hydrated = false;

async function getStorage(): Promise<{
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

async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const AsyncStorage = await getStorage();
    if (!AsyncStorage) return;
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as TasteMem;
    if (p && p.counts && Array.isArray(p.likes)) {
      mem = {
        counts: p.counts,
        likes: p.likes,
        stablePrefs: Array.isArray(p.stablePrefs) ? p.stablePrefs : [],
        updatedAtMs: p.updatedAtMs ?? 0,
      };
    }
  } catch {
    /* soft */
  }
}

async function persist(): Promise<void> {
  try {
    const AsyncStorage = await getStorage();
    if (!AsyncStorage) return;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(mem));
  } catch {
    /* soft */
  }
}

function bump(key: string, n = 1): void {
  mem.counts[key] = (mem.counts[key] ?? 0) + n;
}

function rememberLike(raw: string | null | undefined): void {
  const v = (raw || '').trim();
  if (v.length < 3) return;
  const cut = v.slice(0, 48);
  if (!mem.likes.includes(cut)) mem.likes = [...mem.likes.slice(-11), cut];
}

export function tastePersona(ledger: ReiseLedger): PersonaVariant {
  const v = detectTripVibes(ledger);
  if (v.kids) return 'family_kids';
  if (v.party) return 'party_nightlife';
  return 'default';
}

export function tastePromptLine(): string {
  const top = Object.entries(mem.counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, n]) => `${k}×${n}`);
  const likes = mem.likes.slice(-6).join(', ');
  const prefs = mem.stablePrefs.slice(-8).join(', ');
  if (!top.length && !likes && !prefs) return '(noch kein gespeicherter Geschmack)';
  return [
    top.length ? `Archetypen: ${top.join(', ')}` : '',
    likes ? `mag: ${likes}` : '',
    prefs ? `Prefs: ${prefs}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Stabile Prefs (Party ja/nein, günstiges Bier, Eco) — Brief startet nicht bei Null. */
export async function rememberStablePref(pref: string): Promise<void> {
  await hydrate();
  const cut = pref.trim().toLowerCase().slice(0, 40);
  if (cut.length < 3) return;
  if (!mem.stablePrefs.includes(cut)) {
    mem.stablePrefs = [...mem.stablePrefs.slice(-23), cut];
  }
  mem.updatedAtMs = Date.now();
  await persist();
}

export function listStablePrefs(): string[] {
  return [...mem.stablePrefs];
}

export async function rememberOptionReject(opts: {
  placeOrHotel: string;
  reason?: string | null;
}): Promise<void> {
  await hydrate();
  bump('reject');
  rememberLike(`skip:${opts.placeOrHotel.slice(0, 40)}`);
  if (opts.reason) rememberLike(`why:${opts.reason.slice(0, 40)}`);
  mem.updatedAtMs = Date.now();
  await persist();
  try {
    const { putTravelCache, buildTravelCacheKey } = require('./research/travelResearchCache') as {
      putTravelCache: (e: {
        key: string;
        kind: 'near_miss';
        payload: Record<string, unknown>;
        validUntilMs: number;
      }) => Promise<void>;
      buildTravelCacheKey: (p: { musts?: string[] }) => string;
    };
    await putTravelCache({
      key: buildTravelCacheKey({ musts: [opts.placeOrHotel] }),
      kind: 'near_miss',
      payload: {
        name: opts.placeOrHotel,
        reason: opts.reason ?? 'user_reject',
      },
      validUntilMs: Date.now() + 90 * 24 * 3600 * 1000,
    });
  } catch {
    /* soft */
  }
}

export async function rememberTripTaste(ledger: ReiseLedger, lastAsk?: string | null): Promise<void> {
  await hydrate();
  const v = detectTripVibes(ledger);
  if (v.party) bump('party');
  if (v.spa) bump('spa');
  if (v.kids) bump('kids');
  if (v.wine) bump('wine');
  if (v.sport) bump('sport');
  if (v.water) bump('water');
  if (v.hop) bump('hop');
  rememberLike(ledger.partyStyle?.value);
  rememberLike(ledger.spaStyle?.value);
  rememberLike(ledger.kidsStyle?.value);
  rememberLike(ledger.tripShape?.value);
  rememberLike(ledger.highlightWant?.value);
  mem.updatedAtMs = Date.now();
  await persist();

  const slot = lastAsk && lastAsk !== 'keep_talking' ? lastAsk : null;
  if (!slot) return;
  try {
    const { recordLearnSignal } = require('../module2/blueprints/autoLearn/index') as {
      recordLearnSignal: (o: {
        blueprintId: string;
        personaVariant: PersonaVariant;
        userText: string;
        missingSlot?: string | null;
      }) => Promise<unknown>;
    };
    void recordLearnSignal({
      blueprintId: 'reisebuero',
      personaVariant: tastePersona(ledger),
      userText: [ledger.partyStyle?.value, ledger.spaStyle?.value, ledger.kidsStyle?.value]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 120) || slot,
      missingSlot: slot,
    });
  } catch {
    /* soft */
  }
  try {
    const { contributeFollowUpSignal } = require('../services/memory/collectiveLearning') as {
      contributeFollowUpSignal: (o: {
        intentFamily: string;
        slot: 'duration';
        topic?: string | null;
      }) => Promise<void>;
    };
    void contributeFollowUpSignal({
      intentFamily: 'reise',
      slot: 'duration',
      topic: slot.slice(0, 40),
    });
  } catch {
    /* soft */
  }
}

export async function hydrateTasteMemory(): Promise<string> {
  await hydrate();
  return tastePromptLine();
}

/** Test helper */
export function _resetTasteMemoryForTests(): void {
  mem = { counts: {}, likes: [], stablePrefs: [], updatedAtMs: 0 };
  hydrated = true;
}
