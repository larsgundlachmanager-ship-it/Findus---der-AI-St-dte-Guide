/**
 * Öffentliche Airline-Service-Hotlines (E.164) — nur belegt, sonst kein Button.
 * Prefix aus IATA/ICAO-Ident (4M262 / MGH262).
 */

import { identVariants, splitFlightIdent } from './flightIdent';

export type AirlineHotline = {
  name: string;
  e164: string;
};

const BY_PREFIX: Record<string, AirlineHotline> = {
  LH: { name: 'Lufthansa', e164: '+496986799799' },
  DLH: { name: 'Lufthansa', e164: '+496986799799' },
  EW: { name: 'Eurowings', e164: '+4922159988298' },
  EWG: { name: 'Eurowings', e164: '+4922159988298' },
  DE: { name: 'Condor', e164: '+4961716988988' },
  CFG: { name: 'Condor', e164: '+4961716988988' },
  XQ: { name: 'SunExpress', e164: '+496931099797' },
  SXS: { name: 'SunExpress', e164: '+496931099797' },
  XC: { name: 'Corendon', e164: '+4921196294085' },
  CAI: { name: 'Corendon', e164: '+4921196294085' },
  XR: { name: 'Corendon', e164: '+4921196294085' },
  '4M': { name: 'Mavi Gök', e164: '+908507772777' },
  MGH: { name: 'Mavi Gök', e164: '+908507772777' },
};

export function lookupAirlineHotline(ident: string): AirlineHotline | null {
  const parts = splitFlightIdent(ident);
  if (parts && BY_PREFIX[parts.prefix]) return BY_PREFIX[parts.prefix]!;
  for (const v of identVariants(ident)) {
    const p = splitFlightIdent(v);
    if (p && BY_PREFIX[p.prefix]) return BY_PREFIX[p.prefix]!;
  }
  return null;
}
