/**
 * Nominatim-Query: Land aus cityId / Koordinaten — nicht hart auf DE/SH.
 * Homescreen-Stadtflächen brauchen die echte OSM-Verwaltungsgrenze.
 */

export type NominatimCityLocale = {
  countryCode: string;
  displayName: string;
};

const CITY_COUNTRY: Record<string, { countryCode: string; countryName: string }> =
  {
    london: { countryCode: 'gb', countryName: 'United Kingdom' },
    lissabon: { countryCode: 'pt', countryName: 'Portugal' },
    lisbon: { countryCode: 'pt', countryName: 'Portugal' },
    amsterdam: { countryCode: 'nl', countryName: 'Netherlands' },
  };

function stripCountrySuffix(name: string): string {
  return name.replace(/,.*$/, '').trim();
}

/** berlin-zentral ist ein Pack, keine OSM-Gemeinde — Grenze = Stadt Berlin. */
export function isBerlinCityPackId(cityId: string): boolean {
  const id = cityId.trim().toLowerCase();
  if (!id || id.includes('umland')) return false;
  return id === 'berlin' || id.startsWith('berlin-') || id.startsWith('berlin_');
}

/** Pack-IDs → OSM-Gemeindename (Slug ≠ Nominatim-Query). */
const OSM_ADMIN_NAME_BY_ID: Record<string, string> = {
  halle_saale: 'Halle (Saale)',
  amsterdam: 'Amsterdam',
  berlin_zentral: 'Berlin',
  berlin_umland: 'Berlin',
  frankfurt_am_main: 'Frankfurt am Main',
  hochheim_am_main: 'Hochheim am Main',
  brandenburg_havel: 'Brandenburg an der Havel',
};

/** Name für Nominatim-Verwaltungsgrenze (nicht Produktname). */
export function osmAdminNameForCity(opts: {
  cityId?: string | null;
  name?: string | null;
}): string {
  const id = (opts.cityId ?? '').trim().toLowerCase();
  if (isBerlinCityPackId(id)) return 'Berlin';
  if (OSM_ADMIN_NAME_BY_ID[id]) return OSM_ADMIN_NAME_BY_ID[id];
  const fromName = stripCountrySuffix((opts.name || '').trim());
  if (fromName && !/^[a-z0-9_-]+$/i.test(fromName)) {
    return fromName.replace(/\s+(zentral|zentrum)$/i, '').trim() || fromName;
  }
  // Slug → lesbarer Name: halle_saale → Halle Saale
  const fromId = id
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  const raw = fromName || fromId || 'city';
  return raw.replace(/\s+(zentral|zentrum)$/i, '').trim() || raw;
}

function alreadyQualified(name: string): boolean {
  return /\b(united kingdom|uk|great britain|england|scotland|wales|ireland|germany|deutschland|france|austria|österreich|switzerland|schweiz|netherlands|belgium|italy|spain|poland|denmark|sweden|norway)\b/i.test(
    name,
  );
}

function fromCoords(
  lat: number,
  lng: number,
  rawName: string,
): NominatimCityLocale | null {
  // Irland vor UK (überlappende Längen)
  if (lat >= 51.2 && lat <= 55.5 && lng >= -10.7 && lng <= -5.9) {
    return {
      countryCode: 'ie',
      displayName: alreadyQualified(rawName)
        ? rawName
        : `${rawName}, Ireland`,
    };
  }
  if (lat >= 49.8 && lat <= 60.9 && lng >= -8.7 && lng <= 1.85) {
    return {
      countryCode: 'gb',
      displayName: alreadyQualified(rawName)
        ? rawName
        : `${rawName}, United Kingdom`,
    };
  }
  if (lat >= 47.2 && lat <= 55.15 && lng >= 5.8 && lng <= 15.1) {
    return {
      countryCode: 'de',
      displayName: alreadyQualified(rawName) ? rawName : `${rawName}, Germany`,
    };
  }
  return null;
}

export function nominatimLocaleForCity(opts: {
  cityId?: string | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
}): NominatimCityLocale {
  const id = (opts.cityId ?? '').trim().toLowerCase();
  const rawName = osmAdminNameForCity({ cityId: id, name: opts.name });
  const known = CITY_COUNTRY[id];
  if (known) {
    return {
      countryCode: known.countryCode,
      displayName: alreadyQualified(rawName)
        ? rawName
        : `${rawName}, ${known.countryName}`,
    };
  }
  const lat = opts.lat;
  const lng = opts.lng;
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    const hit = fromCoords(lat, lng, rawName);
    if (hit) return hit;
  }
  return {
    countryCode: 'de',
    displayName: alreadyQualified(rawName)
      ? rawName
      : `${rawName}, Germany`,
  };
}
