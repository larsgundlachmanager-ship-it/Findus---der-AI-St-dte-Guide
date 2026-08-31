/**
 * Live-HUD Gastro-Vorschläge: echte Orte in der Nähe + Fuß-Minuten.
 * Slot: morgens Bäckerei · mittags Lunch · abends Dinner.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { searchOpenPlacesAhead } from '../navigation/googleMapsNav';
import { walkMinutesForDistanceM } from '../navigation/travelEta';
import { fitHudMeta } from './hudTextFit';

export type MealSlotKind = 'bakery' | 'lunch' | 'dinner';

export type MealHudSuggestion = {
  name: string;
  walkMin: number;
  distanceM: number;
  openNow: boolean | null;
  lat?: number;
  lng?: number;
  cuisine?: string | null;
  types?: string[];
};

export type MealHudCache = {
  slot: MealSlotKind;
  atMs: number;
  lat: number;
  lng: number;
  items: MealHudSuggestion[];
  title: string;
  meta: string;
  tellMorePrompt: string;
};

const TTL_MS = 25 * 60_000;
const CELL_M = 180;

let cache: MealHudCache | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function subscribeMealHud(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export function resolveMealSlot(nowMs = Date.now()): MealSlotKind {
  const h = new Date(nowMs).getHours() + new Date(nowMs).getMinutes() / 60;
  if (h >= 6 && h < 11) return 'bakery';
  if (h >= 11 && h < 16) return 'lunch';
  return 'dinner';
}

function slotLabel(slot: MealSlotKind): string {
  if (slot === 'bakery') return 'Bäckerei';
  if (slot === 'lunch') return 'Mittagessen';
  return 'Abendessen';
}

function placeTypeFor(slot: MealSlotKind): string {
  if (slot === 'bakery') return 'bakery';
  if (slot === 'lunch') return 'restaurant';
  return 'restaurant';
}

function looksLikeStreetLabel(name: string): boolean {
  const n = name.trim();
  if (
    /restaurant|imbiss|pizza|sushi|grill|café|cafe|bar|bistro|kitchen|stube|krug|haus|thai|asia|steak|burger/i.test(
      n,
    )
  ) {
    return false;
  }
  if (/\b(straße|strasse|weg|allee|damm|ring|platz)\s+\d+/i.test(n)) return true;
  if (/^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+ \d+[a-zA-Z]?\s*$/.test(n)) return true;
  return false;
}

function cuisineFromPlace(name: string, types: string[]): string | null {
  const blob = `${name} ${types.join(' ')}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/burger|smash/, 'Burger'],
    [/sushi|ramen|thai|viet|pho|asia|chinese|japan|korea|poke|wok|indisch|curry/, 'Asiatisch'],
    [/steak|grill|bbq|ribs|steakhouse/, 'Steak & Grill'],
    [/pizza|pasta|trattoria|italiano|italian/, 'Italienisch'],
    [/döner|doener|kebab|gyros|meze|griech/, 'Grill & Döner'],
    [/tapas|spanisch|paella/, 'Spanisch'],
    [/fisch|meeres|seafood/, 'Fisch'],
    [/vegan|veggie/, 'Vegetarisch'],
    [/schnitzel|gasthaus|brauhaus|deutsch/, 'Deftig'],
  ];
  for (const [re, label] of rules) {
    if (re.test(blob)) return label;
  }
  if (types.some((t) => /restaurant|meal_takeaway|food/.test(t))) return 'Küche vor Ort';
  return null;
}

function cellKey(lat: number, lng: number): string {
  return `${(lat / (CELL_M / 111_000)).toFixed(0)},${(
    lng /
    (CELL_M / (111_000 * Math.cos((lat * Math.PI) / 180)))
  ).toFixed(0)}`;
}

export function getMealHudCache(): MealHudCache | null {
  if (!cache) return null;
  if (Date.now() - cache.atMs > TTL_MS) return null;
  return cache;
}

export async function ensureMealHudFresh(opts?: {
  nowMs?: number;
  force?: boolean;
}): Promise<MealHudCache | null> {
  const nowMs = opts?.nowMs ?? Date.now();
  const store = useFinnusStore.getState();
  const lat = store.lastGpsLat;
  const lng = store.lastGpsLng;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return getMealHudCache();
  }

  const slot = resolveMealSlot(nowMs);
  const existing = getMealHudCache();
  if (
    !opts?.force &&
    existing &&
    existing.slot === slot &&
    cellKey(existing.lat, existing.lng) === cellKey(lat, lng)
  ) {
    return existing;
  }

  if (inFlight) {
    await inFlight;
    return getMealHudCache();
  }

  inFlight = (async () => {
    try {
      const type = placeTypeFor(slot);
      const hits = await searchOpenPlacesAhead({
        lat,
        lng,
        placeType: type,
        radiusM: slot === 'bakery' ? 900 : 1400,
        openNow: true,
      });
      const ranked: MealHudSuggestion[] = [];
      const seenCuisine = new Set<string>();
      for (const h of hits) {
        const name = h.name.trim();
        if (!name || looksLikeStreetLabel(name)) continue;
        const types = h.types ?? [];
        const cuisine = cuisineFromPlace(name, types);
        if (slot === 'dinner' && cuisine && seenCuisine.has(cuisine) && ranked.length) {
          continue;
        }
        if (cuisine) seenCuisine.add(cuisine);
        ranked.push({
          name,
          walkMin: walkMinutesForDistanceM(h.distanceM),
          distanceM: Math.round(h.distanceM),
          openNow: h.openNow ?? null,
          lat: h.lat,
          lng: h.lng,
          cuisine,
          types,
        });
        if (ranked.length >= 2) break;
      }
      const items = ranked;

      if (items.length === 0) {
        cache = null;
        notify();
        return;
      }

      const primary = items[0]!;
      const secondary = items[1];
      const title =
        primary.cuisine && primary.cuisine !== 'Küche vor Ort'
          ? `Bock auf ${primary.cuisine}?`
          : slot === 'bakery'
            ? `🥐 ${primary.name}`
            : `🍽 ${primary.name}`;
      const metaLines: string[] = [
        primary.cuisine && primary.cuisine !== 'Küche vor Ort'
          ? `${primary.name} · ${primary.walkMin} Min`
          : `${primary.walkMin} Min zu Fuß${primary.openNow ? ' · offen' : ''}`,
      ];
      if (secondary) {
        metaLines.push(
          secondary.cuisine
            ? `oder ${secondary.name} (${secondary.cuisine}, ${secondary.walkMin} Min)`
            : `oder ${secondary.name} · ${secondary.walkMin} Min`,
        );
      }
      const names = items.map((i) => i.name).join(' oder ');
      const dirs = items
        .map((i) => i.cuisine)
        .filter((c): c is string => Boolean(c))
        .join(' vs. ');
      cache = {
        slot,
        atMs: nowMs,
        lat,
        lng,
        items,
        title,
        meta: fitHudMeta(metaLines.join('\n')),
        tellMorePrompt:
          slot === 'dinner'
            ? `Abendessen: zwei Richtungen${dirs ? ` (${dirs})` : ''} — ${names}. Sofort Pitch-Modus, kurze Pitches, Route-Buttons. Keine Straßen als Restaurant, keine Frage ob ich noch essen will.`
            : `Pitch: ${slotLabel(slot)} in meiner Nähe — zeig mir 1–2 Optionen (${names}) mit kurzem Pitch und Route-Button. Sofort Pitch-Modus, keine lange Liste.`,
      };
      notify();
    } catch {
      /* soft */
    } finally {
      inFlight = null;
    }
  })();

  await inFlight;
  return getMealHudCache();
}
