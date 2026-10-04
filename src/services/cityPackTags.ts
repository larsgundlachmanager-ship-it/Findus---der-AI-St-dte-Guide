/**
 * Pack-Tag-Policy (rein, kein RN) — Hard-Amenity nie story; Directory ohne Approaches.
 */
import { NO_MODUL1_AUTO_BLOB_RE } from './navigation/mapIdleStoryFill';

export type CitySpotTagInput = {
  name: string;
  category?: string | null;
  pack_role?: string | null;
  place_tier?: number | null;
  tags?: string[] | null;
  facts?: { tags?: string[]; famousPersonConnected?: string } | null;
  booking?: {
    openTableId?: string;
    quandooId?: string;
    resmioId?: string;
    url?: string;
  } | null;
  openTableId?: string;
  quandooId?: string;
  resmioId?: string;
  bookingUrl?: string;
  booking_url?: string;
};

/** Hard-Amenity / Fuel / Alltag — nie story/story_enriched gewinnen lassen. */
const HARD_AMENITY_PACK_RE =
  /\b(tankstelle|fuel|petrol|toilette|\bwc\b|parkplatz|parkhaus|briefkasten|post_box|geldautomat|\batm\b|packstation|parcel_locker|zahnarzt|arztpraxis|\bpraxis\b|\barzt\b|apotheke)\b/i;

function spotPackBlob(spot: CitySpotTagInput): string {
  const parts = [
    spot.name,
    spot.category,
    spot.pack_role,
    ...(spot.tags ?? []),
    ...(spot.facts?.tags ?? []),
  ];
  return parts.map((p) => String(p ?? '')).join(' ').toLowerCase();
}

export function isHardAmenityPackSpot(spot: CitySpotTagInput): boolean {
  const blob = spotPackBlob(spot);
  return HARD_AMENITY_PACK_RE.test(blob) || NO_MODUL1_AUTO_BLOB_RE.test(blob);
}

/** Directory / Hard-Amenity: keine Approaches/Subs emittieren. */
export function shouldSkipApproachAndSubs(
  tags: readonly string[],
  spot: CitySpotTagInput,
): boolean {
  return (
    tags.includes('directory') ||
    tags.includes('tier4') ||
    tags.includes('amenity_skip') ||
    isHardAmenityPackSpot(spot)
  );
}

export function collectTags(spot: CitySpotTagInput): string[] {
  const tags = new Set<string>();
  for (const t of spot.tags ?? []) tags.add(String(t).toLowerCase());
  for (const t of spot.facts?.tags ?? []) tags.add(String(t).toLowerCase());
  if (spot.category) tags.add(spot.category.toLowerCase());
  if (spot.pack_role) tags.add(String(spot.pack_role).toLowerCase());
  if (spot.place_tier != null) tags.add(`tier${spot.place_tier}`);

  const hardAmenity = isHardAmenityPackSpot(spot);
  if (hardAmenity) {
    tags.delete('story');
    tags.delete('story_enriched');
    tags.delete('must_have');
    tags.delete('landmark');
    tags.delete('module1');
    tags.add('directory');
    tags.add('tier4');
    tags.add('offline_lookup');
    tags.add('amenity_skip');
  } else {
    const isStory =
      spot.pack_role === 'story' ||
      tags.has('story') ||
      tags.has('story_enriched');
    if (isStory) {
      tags.delete('directory');
      tags.delete('tier4');
      tags.delete('offline_lookup');
      tags.delete('amenity_skip');
      tags.add('story');
    } else if (
      spot.pack_role === 'directory' ||
      Number(spot.place_tier) === 4
    ) {
      tags.add('directory');
      tags.add('tier4');
      tags.add('offline_lookup');
      tags.add('amenity_skip');
    }
  }
  if (spot.facts?.famousPersonConnected) {
    tags.add('promi');
    tags.add(`famous:${spot.facts.famousPersonConnected}`);
  }

  const ot =
    spot.booking?.openTableId?.trim() || spot.openTableId?.trim() || '';
  const qd = spot.booking?.quandooId?.trim() || spot.quandooId?.trim() || '';
  const rm = spot.booking?.resmioId?.trim() || spot.resmioId?.trim() || '';
  const bookUrl =
    spot.booking?.url?.trim() ||
    spot.bookingUrl?.trim() ||
    spot.booking_url?.trim() ||
    '';
  if (ot) {
    tags.add('opentable');
    tags.add(`ot:${ot}`);
  }
  if (qd) {
    tags.add('quandoo');
    tags.add(`qd:${qd}`);
  }
  if (rm) {
    tags.add('resmio');
    tags.add(`rm:${rm}`);
  }
  if (bookUrl && /^https?:\/\//i.test(bookUrl)) {
    tags.add(`booking_url:${bookUrl}`);
  }

  return [...tags];
}
