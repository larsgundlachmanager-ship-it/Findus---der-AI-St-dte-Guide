/**
 * IATA- vs ICAO-Flugnummern (4M262 ≡ MGH262).
 * Charter nutzen in AeroAPI oft den ICAO-Ident.
 */

const AIRLINE_IATA_TO_ICAO: Record<string, string> = {
  LH: 'DLH',
  LX: 'SWR',
  OS: 'AUA',
  BA: 'BAW',
  AF: 'AFR',
  KL: 'KLM',
  EW: 'EWG',
  U2: 'EZY',
  FR: 'RYR',
  W6: 'WZZ',
  SK: 'SAS',
  AY: 'FIN',
  IB: 'IBE',
  TP: 'TAP',
  AZ: 'ITY',
  SN: 'BEL',
  DE: 'CFG',
  XQ: 'SXS',
  PC: 'PGT',
  TK: 'THY',
  XC: 'CAI',
  FH: 'FHY',
  '4M': 'MGH',
  A3: 'AEE',
  VF: 'TKJ',
  /** Sky Express — HAM-Tafel GQ, Aero oft SEH */
  GQ: 'SEH',
};

const AIRLINE_ICAO_TO_IATA: Record<string, string> = Object.fromEntries(
  Object.entries(AIRLINE_IATA_TO_ICAO).map(([iata, icao]) => [icao, iata]),
);

export function normalizeFlightIdent(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function splitFlightIdent(
  raw: string,
): { prefix: string; number: string } | null {
  const ident = normalizeFlightIdent(raw);
  const digitIata = ident.match(/^(\d[A-Z])(\d{1,4}[A-Z]?)$/);
  if (digitIata) return { prefix: digitIata[1]!, number: digitIata[2]! };
  const iata = ident.match(/^([A-Z][A-Z0-9])(\d{1,4}[A-Z]?)$/);
  if (iata) return { prefix: iata[1]!, number: iata[2]! };
  const icao = ident.match(/^([A-Z]{3})(\d{1,4}[A-Z]?)$/);
  if (icao) return { prefix: icao[1]!, number: icao[2]! };
  return null;
}

/** Alle Schreibweisen, mit denen AeroAPI denselben Flug meint. */
export function identVariants(raw: string): string[] {
  const ident = normalizeFlightIdent(raw);
  const out = new Set<string>(ident ? [ident] : []);
  const parts = splitFlightIdent(ident);
  if (!parts) return [...out];
  if (parts.prefix.length === 2 || AIRLINE_IATA_TO_ICAO[parts.prefix]) {
    const icao = AIRLINE_IATA_TO_ICAO[parts.prefix];
    if (icao) out.add(`${icao}${parts.number}`);
  }
  if (parts.prefix.length === 3) {
    const iata = AIRLINE_ICAO_TO_IATA[parts.prefix];
    if (iata) out.add(`${iata}${parts.number}`);
  }
  return [...out];
}

export function identsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = new Set(identVariants(a));
  return identVariants(b).some((x) => left.has(x));
}

/** CLK-Stubs sind keine Flugnummer — nie vorlesen oder in die Timeline schreiben. */
export function publicFlightIdent(raw: string | null | undefined): string | null {
  const ident = normalizeFlightIdent(raw ?? '');
  if (!ident || ident.startsWith('CLK')) return null;
  return preferredIataIdent(ident);
}

export function flightTimelineTitle(
  ident: string,
  dest: string,
  clockHm?: string | null,
): string {
  const pub = publicFlightIdent(ident);
  const clock = clockHm?.trim() ? ` ${clockHm.trim()}` : '';
  if (pub) return `Abflug ${pub} nach ${dest}`;
  return `Abflug nach ${dest}${clock}`.trim();
}

/** Nutzer-sichtbare Nummer: IATA wenn ableitbar (4M262 statt MGH262). */
export function preferredIataIdent(raw: string): string {
  const ident = normalizeFlightIdent(raw);
  const parts = splitFlightIdent(ident);
  if (!parts) return ident;
  if (parts.prefix.length === 2) return ident;
  const iata = AIRLINE_ICAO_TO_IATA[parts.prefix];
  return iata ? `${iata}${parts.number}` : ident;
}
