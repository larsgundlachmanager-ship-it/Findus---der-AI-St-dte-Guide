/**
 * Handy laden — stadt-agnostisch: Powerbank-Automaten, Device-Ladestationen,
 * Cafés/Orte mit Steckdose (OSM + Google).
 */

import type { QuickAction } from '../../types/concierge';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import {
  searchPlacesExpanding,
  PLACE_FAR_SPEECH_M,
} from './expandingPlaceSearch';
import type { DiscoveredPlace } from './googleMapsNav';
import type { DiscoveryCandidate, DiscoveryResult } from './contextualDiscovery';

export type ChargeKind = 'powerbank' | 'device' | 'outlet' | 'cafe';

type Ranked = DiscoveredPlace & { kind: ChargeKind; sortKey: number };

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function kindLabel(kind: ChargeKind): string {
  if (kind === 'powerbank') return 'Powerbank';
  if (kind === 'device') return 'Ladestation';
  if (kind === 'outlet') return 'Steckdose';
  return 'Café';
}

function inferKind(place: DiscoveredPlace, fromType: string): ChargeKind {
  const blob = `${place.name} ${place.types.join(' ')}`.toLowerCase();
  if (
    fromType === 'powerbank' ||
    /powerbank|power.?bank|voozaa|cheetah|batterybar|rechargy|chargery/.test(
      blob,
    )
  ) {
    return 'powerbank';
  }
  if (
    fromType === 'phone_charge' ||
    /device_charg|ladestation|charging.?station|usb.?charg/.test(blob)
  ) {
    return 'device';
  }
  if (fromType === 'outlet_cafe' || /socket|steckdose/.test(blob)) {
    return 'outlet';
  }
  return 'cafe';
}

/** Powerbank vor Device vor Steckdose-Café vor generischem Café; dann Distanz. */
function sortKeyFor(kind: ChargeKind, distanceM: number): number {
  const bias =
    kind === 'powerbank'
      ? 0
      : kind === 'device'
        ? 80
        : kind === 'outlet'
          ? 180
          : 320;
  return distanceM + bias;
}

function dedupePush(into: Ranked[], place: DiscoveredPlace, kind: ChargeKind) {
  if (
    into.some(
      (h) =>
        Math.abs(h.lat - place.lat) < 0.00025 &&
        Math.abs(h.lng - place.lng) < 0.00025,
    )
  ) {
    return;
  }
  into.push({
    ...place,
    kind,
    sortKey: sortKeyFor(kind, place.distanceM),
  });
}

async function gatherChargePlaces(
  lat: number,
  lng: number,
): Promise<Ranked[]> {
  const [powerbanks, devices, outlets, cafes] = await Promise.all([
    searchPlacesExpanding({
      lat,
      lng,
      placeType: 'powerbank',
      openNow: true,
      minResults: 1,
      rings: [900, 2500, 6000, 12_000],
    }).catch(() => null),
    searchPlacesExpanding({
      lat,
      lng,
      placeType: 'phone_charge',
      openNow: true,
      minResults: 1,
      rings: [900, 2500, 6000, 12_000],
    }).catch(() => null),
    searchPlacesExpanding({
      lat,
      lng,
      placeType: 'outlet_cafe',
      openNow: true,
      minResults: 1,
      rings: [900, 2500, 6000],
    }).catch(() => null),
    searchPlacesExpanding({
      lat,
      lng,
      placeType: 'cafe',
      keyword: 'steckdose',
      openNow: true,
      minResults: 1,
      rings: [900, 2500, 6000],
      fallbackTypes: ['library'],
    }).catch(() => null),
  ]);

  const out: Ranked[] = [];
  for (const p of powerbanks?.places ?? []) {
    dedupePush(out, p, inferKind(p, 'powerbank'));
  }
  for (const p of devices?.places ?? []) {
    dedupePush(out, p, inferKind(p, 'phone_charge'));
  }
  for (const p of outlets?.places ?? []) {
    dedupePush(out, p, inferKind(p, 'outlet_cafe'));
  }
  for (const p of cafes?.places ?? []) {
    dedupePush(out, p, inferKind(p, 'cafe'));
  }

  out.sort((a, b) => a.sortKey - b.sortKey);
  return out.slice(0, 6);
}

function toCandidates(ranked: Ranked[]): DiscoveryCandidate[] {
  return ranked.map((p) => ({
    placeId: p.placeId,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    distanceM: p.distanceM,
    aheadM: p.distanceM,
    rating: p.rating,
    openNow: p.openNow !== false,
    lowRated: p.rating != null && p.rating < 3.8,
    types: [...p.types, p.kind],
    detourM: null,
  }));
}

function toActions(ranked: Ranked[]): QuickAction[] {
  return ranked.slice(0, 2).map((c, i) => {
    const dist =
      c.distanceM < 1000
        ? `${Math.round(c.distanceM / 10) * 10} m`
        : `${(c.distanceM / 1000).toFixed(1)} km`;
    const prefix =
      i === 0
        ? kindLabel(c.kind)
        : `Alt · ${kindLabel(c.kind)}`;
    return {
      type: 'START_NAVIGATION' as const,
      label: shortenActionLabel(`${prefix}: ${c.name} (${dist})`),
      payload: {
        destLat: c.lat,
        destLng: c.lng,
        destName: c.name,
        targetPoiId: `place:${c.placeId}`,
      },
    };
  });
}

function buildSpeech(ranked: Ranked[]): string {
  if (!ranked.length) {
    return (
      'In der Nähe finde ich gerade keinen klaren Powerbank-Automaten oder Steckdosen-Spot. ' +
      'Versuch’s mit einem Café, Hotel-Lobby oder Bahnhof — oder sag „nochmal suchen“.'
    );
  }
  const top = ranked[0]!;
  const far = top.distanceM >= PLACE_FAR_SPEECH_M;
  const kind = kindLabel(top.kind);
  if (ranked.length === 1) {
    return far
      ? `Zum Laden: ${top.name} (${kind}) — ca. ${formatDist(top.distanceM)}. Passt das? Tippe die Route.`
      : `Zum Laden: ${top.name} (${kind}), ca. ${formatDist(top.distanceM)}. Ich kann dich hinbringen.`;
  }
  const second = ranked[1]!;
  return (
    `Zum Laden: ${top.name} (${kindLabel(top.kind)}, ca. ${formatDist(top.distanceM)}). ` +
    `Alternative: ${second.name} (${kindLabel(second.kind)}, ca. ${formatDist(second.distanceM)}). ` +
    `Wohin soll’s gehen?`
  );
}

/**
 * Nächste praktische Lademöglichkeit — Powerbank bevorzugt, sonst Steckdose/Café.
 */
export async function runPhoneChargeDiscovery(opts: {
  origin: { lat: number; lng: number };
}): Promise<DiscoveryResult> {
  const ranked = await gatherChargePlaces(opts.origin.lat, opts.origin.lng);
  const candidates = toCandidates(ranked);
  const speech = buildSpeech(ranked);
  const quickActions =
    ranked.length > 0
      ? toActions(ranked)
      : [
          {
            type: 'SHOW_MORE' as const,
            label: shortenActionLabel('🔍 Nochmal'),
            payload: {
              textPrompt:
                'Akku fast leer — such Powerbank-Automaten oder Café mit Steckdosen in der Nähe und gib mir Route-Buttons.',
            },
          },
        ];

  return {
    queryLabel: 'Handy laden',
    speech,
    candidates,
    quickActions,
    needsConfirmation: ranked[0] != null && ranked[0].distanceM >= PLACE_FAR_SPEECH_M,
    autoInserted: false,
  };
}

export function isPhoneChargeIntent(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(powerbank|power\s*bank|ladeautomat|ladestation)\b/iu.test(t) ||
    /\b(steckdose|usb[-\s]?laden|handy\s*laden|smartphone\s*laden)\b/iu.test(t) ||
    /\b(handyakku|akku\s*(leer|schwach|fast\s*leer)|akku\s*laden)\b/iu.test(t) ||
    /\b(café|cafe).{0,24}steckdose|steckdose.{0,24}(café|cafe)\b/iu.test(t) ||
    /\b(laden|aufladen).{0,20}(handy|smartphone|akku)\b/iu.test(t)
  );
}
