/**
 * Öffentliche Terminal-Lagepläne — Deep-Link, kein Indoor-GPS.
 * Nur Flughäfen mit belegter, gate-fähiger URL.
 */

export type AirportMapLink = {
  url: string;
  label: string;
};

function gateToken(gate: string | null | undefined): string | null {
  const g = (gate || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!g || g.length > 6) return null;
  if (!/^[A-Z]?\d{1,3}[A-Z]?$/.test(g)) return null;
  return g;
}

/** HAM: easyGuide hinter hamburg-airport.de/lageplan?locationId=B53 */
function hamburgLageplan(gate: string | null | undefined): AirportMapLink {
  const g = gateToken(gate);
  const url = g
    ? `https://www.hamburg-airport.de/de/orientieren-erleben/lageplan?locationId=${encodeURIComponent(g)}`
    : 'https://www.hamburg-airport.de/de/orientieren-erleben/lageplan';
  return {
    url,
    label: g ? `Lageplan Gate ${g}` : 'Lageplan HAM',
  };
}

const BY_IATA: Record<string, (gate?: string | null) => AirportMapLink> = {
  HAM: hamburgLageplan,
};

export function airportLageplanLink(opts: {
  originIata: string;
  gate?: string | null;
}): AirportMapLink | null {
  const iata = (opts.originIata || '').trim().toUpperCase();
  const build = BY_IATA[iata];
  return build ? build(opts.gate) : null;
}
