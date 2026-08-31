/**
 * Homescreen map: contextual emoji pins (hotel, favorites, active geotrigger, needs).
 * City-agnostic — no place-name hardcoding.
 */

import type { Poi } from '../../db/types';
import type { UserEntity } from '../../store/useUserMemoryStore';
import { emojiForPlace } from './stampBullets';

export type MapEmojiPinKind = 'hotel' | 'favorite' | 'geotrigger' | 'need';

export type MapEmojiPin = {
  key: string;
  name: string;
  lat: number;
  lng: number;
  emoji: string;
  kind: MapEmojiPinKind;
};

/** Item/need label → map emoji (toothbrush is the example, not a forever special case). */
export function emojiForShoppingNeed(itemLabel: string): string {
  const t = itemLabel.toLowerCase();
  if (/zahnbürste|zahnbuerste|toothbrush/i.test(t)) return '🪥';
  if (/zahncreme|zahnpasta|toothpaste/i.test(t)) return '🦷';
  if (/shampoo|duschgel|seife|soap/i.test(t)) return '🧴';
  if (/deo|deodorant/i.test(t)) return '💨';
  if (/sonnencreme|sunscreen|sunblock/i.test(t)) return '🧴';
  if (/pflaster|verband|ibuprofen|aspirin|medikament/i.test(t)) return '💊';
  if (/wasser|flasche|drink|cola/i.test(t)) return '💧';
  if (/milch|brot|butter|eier|käse|kaese|obst|gemüse|gemuese/i.test(t))
    return '🛒';
  if (/powerbank|akku|laden|aufladen|charger|kabel/i.test(t)) return '🔋';
  if (/taschentuch|tissue|watte/i.test(t)) return '🧻';
  if (/rasierer|rasur/i.test(t)) return '🪒';
  return '🛍️';
}

function validCoords(lat?: number | null, lng?: number | null): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  );
}

export function hotelEmojiPin(hotel: UserEntity | null | undefined): MapEmojiPin | null {
  if (!hotel?.isConfirmed || !validCoords(hotel.lat, hotel.lng)) return null;
  return {
    key: `hotel:${hotel.id}`,
    name: hotel.name || 'Unterkunft',
    lat: hotel.lat!,
    lng: hotel.lng!,
    emoji: '🏨',
    kind: 'hotel',
  };
}

export function favoriteEmojiPins(
  entities: readonly UserEntity[],
  enabled: boolean,
): MapEmojiPin[] {
  if (!enabled) return [];
  const out: MapEmojiPin[] = [];
  for (const e of entities) {
    if (!e.isConfirmed) continue;
    if (e.type === 'hotel' || e.type === 'transit') continue;
    if (!validCoords(e.lat, e.lng)) continue;
    out.push({
      key: `fav:${e.id}`,
      name: e.name,
      lat: e.lat!,
      lng: e.lng!,
      emoji: '⭐',
      kind: 'favorite',
    });
  }
  return out;
}

export function geotriggerEmojiPin(
  poi: Poi | null | undefined,
): MapEmojiPin | null {
  if (!poi || !validCoords(poi.lat, poi.lng)) return null;
  const name = poi.name.replace(/\s*[·•|]\s*Wegweiser\s*$/i, '').trim();
  return {
    key: `geo:${poi.id}`,
    name: name || 'Ort',
    lat: poi.lat,
    lng: poi.lng,
    emoji: emojiForPlace({
      kind: poi.kind,
      category: poi.category,
      name: poi.name,
    }),
    kind: 'geotrigger',
  };
}

export type NeedMapPlace = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  itemLabel: string;
  taskId: string;
};

export function needEmojiPins(places: readonly NeedMapPlace[]): MapEmojiPin[] {
  const out: MapEmojiPin[] = [];
  const seen = new Set<string>();
  for (const p of places) {
    if (!validCoords(p.lat, p.lng)) continue;
    const key = `need:${p.taskId}:${p.placeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      name: `${p.itemLabel} · ${p.name}`,
      lat: p.lat,
      lng: p.lng,
      emoji: emojiForShoppingNeed(p.itemLabel),
      kind: 'need',
    });
  }
  return out;
}

/** Merge layers; later kinds win on near-identical coords (~25 m). */
export function mergeMapEmojiPins(layers: MapEmojiPin[][]): MapEmojiPin[] {
  const flat = layers.flat().filter((p) => validCoords(p.lat, p.lng));
  const out: MapEmojiPin[] = [];
  for (const pin of flat) {
    const clash = out.findIndex(
      (o) =>
        Math.abs(o.lat - pin.lat) < 0.00025 &&
        Math.abs(o.lng - pin.lng) < 0.00025,
    );
    if (clash >= 0) {
      // Prefer hotel / need / geo over favorite when overlapping
      const rank = (k: MapEmojiPinKind) =>
        k === 'hotel' ? 4 : k === 'need' ? 3 : k === 'geotrigger' ? 2 : 1;
      if (rank(pin.kind) >= rank(out[clash]!.kind)) out[clash] = pin;
      continue;
    }
    out.push(pin);
  }
  return out;
}
