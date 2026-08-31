/**
 * Kurzer ÖPNV-Spike GPS → Zielstadt für Timeline-Seed.
 * Roh-Minuten + Puffer → aufrunden auf volle Stunde (genug Luft).
 */

export function bufferedTravelMinutesToHour(rawMin: number): number {
  const n = Number.isFinite(rawMin) ? Math.max(1, Math.round(rawMin)) : 60;
  const withBuf = Math.ceil(n * 1.15);
  // Vorort→Großstadt oft ~45–65 Min Roh → 1 h Slot; darüber volle Stunden.
  if (withBuf <= 75) return 60;
  return Math.ceil(withBuf / 60) * 60;
}

function addMinutesHm(hm: string, addMin: number): string {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  const total = ((h || 0) * 60 + (m || 0) + addMin + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export type TravelEtaSpikeResult = {
  rawMin: number;
  bufferedMin: number;
  source: 'transit' | 'heuristic';
};

/**
 * Ungefähre ÖPNV-Dauer Standort → Stadt. Timeout kurz — Seed nicht blockieren.
 */
export async function spikeTransitMinutesToCity(opts: {
  destCity: string;
  lat: number;
  lng: number;
  timeoutMs?: number;
}): Promise<TravelEtaSpikeResult> {
  const dest = (opts.destCity || '').trim();
  const timeoutMs = opts.timeoutMs ?? 4500;
  if (!dest || !Number.isFinite(opts.lat) || !Number.isFinite(opts.lng)) {
    return { rawMin: 60, bufferedMin: 60, source: 'heuristic' };
  }

  let destLat: number | null = null;
  let destLng: number | null = null;
  try {
    const { geocodePlaceName } = await import(
      '../../services/navigation/googleMapsNav'
    );
    const geo = await geocodePlaceName(dest, { cityHint: dest });
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
      destLat = geo.lat;
      destLng = geo.lng;
    }
  } catch {
    /* soft */
  }
  if (destLat == null || destLng == null) {
    return { rawMin: 60, bufferedMin: 60, source: 'heuristic' };
  }

  try {
    const { planTransitHandsFree } = await import(
      '../../services/navigation/handsFreeNav/transitBridge'
    );
    const best = await Promise.race([
      planTransitHandsFree({
        from: { lat: opts.lat, lng: opts.lng },
        to: { lat: destLat, lng: destLng },
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
    if (best && typeof best.durationSec === 'number' && best.durationSec > 0) {
      const rawMin = Math.max(1, Math.round(best.durationSec / 60));
      return {
        rawMin,
        bufferedMin: bufferedTravelMinutesToHour(rawMin),
        source: 'transit',
      };
    }
  } catch {
    /* soft */
  }

  // Fallback: grobe Luftlinie → Bahn-Heuristik (~50 km/h + 20 Min Umstieg)
  try {
    const { haversineMeters } = require('../../db/database') as {
      haversineMeters: (
        a: number,
        b: number,
        c: number,
        d: number,
      ) => number;
    };
    const m = haversineMeters(opts.lat, opts.lng, destLat, destLng);
    const rawMin = Math.max(30, Math.round(m / 1000 / 50 * 60) + 20);
    return {
      rawMin,
      bufferedMin: bufferedTravelMinutesToHour(rawMin),
      source: 'heuristic',
    };
  } catch {
    return { rawMin: 60, bufferedMin: 60, source: 'heuristic' };
  }
}

/** Frühstück/Ankunft = Abfahrt + gepufferte Reisezeit. */
export function arrivalHmAfterTravel(
  departHm: string,
  travelBufferedMin: number,
): string {
  return addMinutesHm(departHm, travelBufferedMin);
}
