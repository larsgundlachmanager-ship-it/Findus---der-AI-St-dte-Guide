/**
 * Zwischenstopp-Helfer — Fassade über multiStopTour.insertTourStop.
 */

export async function addNavZwischenstopp(opts: {
  name: string;
  lat: number;
  lng: number;
}): Promise<boolean> {
  if (!Number.isFinite(opts.lat) || !Number.isFinite(opts.lng)) return false;
  try {
    const { insertTourStop } = require('../../services/navigation/multiStopTour') as {
      insertTourStop: (
        stop: { name: string; lat: number; lng: number },
        o?: { position?: 'next' },
      ) => Promise<unknown>;
    };
    await insertTourStop(
      { name: opts.name, lat: opts.lat, lng: opts.lng },
      { position: 'next' },
    );
    return true;
  } catch {
    return false;
  }
}

export function looksLikeAddStopUtterance(userText: string): boolean {
  return /\b(zwischenstopp|stopp\s+dazwischen|noch\s+einen?\s+stopp|add\s+stop|halt\s+kurz\s+bei)\b/iu.test(
    String(userText || ''),
  );
}
