/**
 * Handy laden — stadt-agnostisch: Powerbank-Automaten, Device-Ladestationen,
 * Cafés/Orte mit Steckdose (OSM + Google).
 *
 * Wichtig DE: Keyword „laden“ = Laden/Geschäft → Google liefert Heimat-/Touristen-
 * Läden ohne Ladeoption. Nie solche Orte als Lade-Spot verkaufen.
 */

import type { QuickAction } from '../../types/concierge';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import {
  acceptChargePlace,
  formatChargeBullet,
  kindLabel,
  kindSpeechHint,
  type ChargeKind,
} from './chargePlacePolicy';
import {
  searchPlacesExpanding,
  PLACE_FAR_SPEECH_M,
} from './expandingPlaceSearch';
import type { DiscoveredPlace } from './googleMapsNav';
import type { DiscoveryCandidate, DiscoveryResult } from './contextualDiscovery';

export type { ChargeKind } from './chargePlacePolicy';
export {
  acceptChargePlace,
  kindLabel,
  looksLikeChargeJunk,
  isPhoneChargeIntent,
} from './chargePlacePolicy';

type Ranked = DiscoveredPlace & { kind: ChargeKind; sortKey: number };

function formatDist(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} m`;
  return `${(m / 1000).toFixed(1)} km`;
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
      strictOpenNow: true,
      minResults: 1,
      rings: [900, 2500, 6000, 12_000],
    }).catch(() => null),
    searchPlacesExpanding({
      lat,
      lng,
      placeType: 'phone_charge',
      openNow: true,
      strictOpenNow: true,
      minResults: 1,
      rings: [900, 2500, 6000, 12_000],
    }).catch(() => null),
    searchPlacesExpanding({
      lat,
      lng,
      placeType: 'outlet_cafe',
      openNow: true,
      strictOpenNow: true,
      minResults: 1,
      rings: [900, 2500, 6000],
    }).catch(() => null),
    // Kein Keyword „steckdose“/„laden“ — Google matched sonst Souvenir-/Heimatläden.
    searchPlacesExpanding({
      lat,
      lng,
      placeType: 'cafe',
      openNow: true,
      strictOpenNow: true,
      minResults: 1,
      rings: [900, 2500, 6000],
      fallbackTypes: ['library'],
    }).catch(() => null),
  ]);

  const out: Ranked[] = [];
  for (const p of powerbanks?.places ?? []) {
    const kind = acceptChargePlace(p, 'powerbank');
    if (kind) dedupePush(out, p, kind);
  }
  for (const p of devices?.places ?? []) {
    const kind = acceptChargePlace(p, 'phone_charge');
    if (kind) dedupePush(out, p, kind);
  }
  for (const p of outlets?.places ?? []) {
    const kind = acceptChargePlace(p, 'outlet_cafe');
    if (kind) dedupePush(out, p, kind);
  }
  for (const p of cafes?.places ?? []) {
    const kind = acceptChargePlace(p, 'cafe');
    if (kind) dedupePush(out, p, kind);
  }
  out.sort((a, b) => a.sortKey - b.sortKey);
  return out.slice(0, 4);
}

function toCandidates(ranked: Ranked[]): DiscoveryCandidate[] {
  return ranked.map((p) => ({
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
  return ranked.slice(0, 2).map((c) => {
    const short = c.name.replace(/\s+/g, ' ').trim().slice(0, 28);
    return {
      type: 'START_NAVIGATION' as const,
      label: shortenActionLabel(`🚶 → ${short}`),
      payload: {
        destLat: c.lat,
        destLng: c.lng,
        destName: c.name,
        targetPoiId: `place:${c.placeId}`,
        preferWalk: true,
      },
    };
  });
}

function buildSpeech(ranked: Ranked[]): string {
  if (!ranked.length) {
    return (
      'In der Nähe finde ich gerade keinen glaubwürdigen Powerbank-Automaten, ' +
      'keine Ladestation und kein offenes Café zum Aufladen. ' +
      'Kein Fake-Tipp — tipp „nochmal suchen“, oder sag Hotel/Bahnhof, wenn du da hinwillst.'
    );
  }
  const top = ranked[0]!;
  const far = top.distanceM >= PLACE_FAR_SPEECH_M;
  if (ranked.length === 1) {
    const tip =
      top.kind === 'cafe'
        ? 'Steckdose oft da, aber nicht garantiert'
        : kindSpeechHint(top.kind);
    return far
      ? `${top.name} wäre mein Tipp zum Laden — ${tip}, ca. ${formatDist(top.distanceM)}. Tippe die Route, wenn du willst.`
      : `${top.name} liegt gut — ${tip}, ca. ${formatDist(top.distanceM)}. Route startest du mit dem Button.`;
  }
  const second = ranked[1]!;
  const aTip =
    top.kind === 'cafe'
      ? 'Steckdose oft da, nicht garantiert'
      : kindSpeechHint(top.kind);
  const bTip =
    second.kind === 'cafe'
      ? 'Steckdose oft da, nicht garantiert'
      : kindSpeechHint(second.kind);
  return (
    `Entweder ${top.name} — ${aTip}, ca. ${formatDist(top.distanceM)}. ` +
    `Oder ${second.name} — ${bTip}, ca. ${formatDist(second.distanceM)}. ` +
    `Was passt dir besser?`
  );
}

/** Stichpunkte 1:1 zu Speech (gleiche Orte, gleiches Kind, gleiche Distanz). */
export function chargeVisualBullets(
  ranked: Array<{ kind: ChargeKind; name: string; distanceM: number }>,
): string[] {
  return ranked.slice(0, 2).map((c) =>
    formatChargeBullet({
      kind: c.kind,
      name: c.name,
      distanceM: c.distanceM,
    }),
  );
}

function chargeOptionBullets(c: Ranked): string[] {
  const dist = formatDist(c.distanceM);
  const lines = [`${kindLabel(c.kind)} · ${dist}`];
  if (c.kind === 'cafe') lines.push('Steckdose nicht garantiert');
  else if (c.kind === 'outlet') lines.push('Steckdose belegt');
  else if (c.kind === 'powerbank') lines.push('Powerbank-Automat');
  else lines.push('Ladestation');
  return lines.slice(0, 3);
}

/** Live Switch-Modul (A|B) für Lade-Optionen — gleiche UI wie Pitch. */
export function publishChargePitchUi(ranked: Ranked[]): void {
  if (!ranked.length) return;
  try {
    const { useLivePitchStore } = require('../../module2/pitch/publishPitchUi') as {
      useLivePitchStore: {
        getState: () => {
          setPitch: (
            r: import('../../module2/pitch/types').PitchResult,
            headline?: string,
            meta?: { pitchKind?: string | null; pitchContext?: string | null },
          ) => void;
        };
      };
    };
    const top = ranked.slice(0, 2);
    const options = top.map((c, i) => {
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`;
      return {
        id: `charge_${i}_${c.placeId || c.name.slice(0, 12)}`,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        placeId: c.placeId ? String(c.placeId) : null,
        role: (i === 0 ? 'favorite' : 'alternative') as
          | 'favorite'
          | 'alternative',
        speechPitch:
          c.kind === 'cafe'
            ? `${c.name}: Café, Steckdose oft da, nicht garantiert.`
            : `${c.name}: ${kindSpeechHint(c.kind)}.`,
        bullets: chargeOptionBullets(c),
        mapsUrl,
        actions: [
          {
            type: 'START_NAVIGATION' as const,
            label: shortenActionLabel(`🚶 → ${c.name.slice(0, 22)}`),
            payload: {
              destLat: c.lat,
              destLng: c.lng,
              destName: c.name,
              targetPoiId: `place:${c.placeId}`,
              preferWalk: true,
            },
          },
        ],
        showNavBeforeSelect: true,
      };
    });
    useLivePitchStore.getState().setPitch(
      {
        requestId: `charge_${Date.now()}`,
        softFail: false,
        spokenText: buildSpeech(top),
        summary: 'Handy laden',
        options,
        uiLayout: 'live_split',
      },
      'Zum Laden',
      { pitchKind: 'generic', pitchContext: 'charge' },
    );
  } catch (err) {
    console.warn('[charge] pitch ui failed', err);
  }
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
  const visualBullets = chargeVisualBullets(ranked);
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

  if (ranked.length > 0) publishChargePitchUi(ranked);

  return {
    queryLabel: 'Handy laden',
    speech,
    candidates,
    quickActions,
    visualBullets,
    needsConfirmation:
      ranked[0] != null && ranked[0].distanceM >= PLACE_FAR_SPEECH_M,
    autoInserted: false,
  };
}
