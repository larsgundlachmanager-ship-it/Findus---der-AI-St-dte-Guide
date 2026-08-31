/**
 * Stadt-Cover + Such-Metadaten (Region/Land/Aliase).
 * Unbekannte Städte → Fallback-Hero.
 *
 * Cover-Bilder: nur on-demand per HTTPS (`cover_url` / Supabase).
 * Keine Stadt-PNGs in der APK bündeln.
 */

import type { ImageSourcePropType } from 'react-native';
import { CITY_CARD_HERO } from './personaPortraits';

export type CitySearchMeta = {
  /** Bundesland / Region */
  region?: string;
  /** Land */
  country?: string;
  /** Tipps / andere Sprachen / Tippfehler-nahe Schreibweisen */
  aliases?: string[];
};

/** Crop-Fokus: früher Zoom — Covers werden 1:1 angezeigt. */
export type CityCoverFocus = {
  scale: number;
  translateY: number;
  translateX: number;
};

/**
 * Optional lokale Offline-Fallbacks. Stadt-Cover kommen primär per HTTPS
 * (`cover_url` / Supabase `staedte/covers`) — damit bleibt die APK schlank.
 * Lokale Cover-Master gehören nicht ins Repo; Upload-Scripts holen/stylen on demand.
 */
const COVERS: Record<string, ImageSourcePropType> = {};

const DEFAULT_FOCUS: CityCoverFocus = {
  scale: 1,
  translateY: 0,
  translateX: 0,
};

export const CITY_SEARCH_META: Record<string, CitySearchMeta> = {
  prisdorf: {
    region: 'Schleswig-Holstein',
    country: 'Deutschland',
    aliases: [
      'Prisdorf',
      'Prisdorfer',
      'Prisdor',
      'Prizdorf',
      'SH',
      'Holstein',
      'Germany',
      'Germany Pinneberg district',
      'Kreis Pinneberg',
    ],
  },
  pinneberg: {
    region: 'Schleswig-Holstein',
    country: 'Deutschland',
    aliases: [
      'Pinneberg',
      'Pineberg',
      'Pinneburg',
      'Pinnberg',
      'Pillerberg',
      'SH',
      'Holstein',
      'Germany',
      'Kreis Pinneberg',
      'Pinneberg district',
    ],
  },
  tornesch: {
    region: 'Schleswig-Holstein',
    country: 'Deutschland',
    aliases: [
      'Tornesch',
      'Tornesh',
      'Tornesch SH',
      'SH',
      'Holstein',
      'Germany',
      'Kreis Pinneberg',
    ],
  },
  luebeck: {
    region: 'Schleswig-Holstein',
    country: 'Deutschland',
    aliases: [
      'Lübeck',
      'Lubeck',
      'Luebeck',
      'HL',
      'Hansestadt Lübeck',
      'Holstentor',
      'SH',
      'Holstein',
      'Germany',
      'Deutschland',
    ],
  },
  hechingen: {
    region: 'Baden-Württemberg',
    country: 'Deutschland',
    aliases: [
      'Hechingen',
      'Hochingen',
      'Zollernstadt',
      'Zollernstadt Hechingen',
      'Hohenzollern',
      'Zollernalb',
      'Zollernalbkreis',
      'BW',
      'Baden-Württemberg',
      'Germany',
      'Deutschland',
    ],
  },
  tettnang: {
    region: 'Baden-Württemberg',
    country: 'Deutschland',
    aliases: [
      'Tettnang',
      'Trettnag',
      'Tettnag',
      'Hopfenstadt',
      'Neues Schloss Tettnang',
      'Bodensee',
      'BW',
      'Baden-Württemberg',
      'Germany',
      'Deutschland',
    ],
  },
  wangerooge: {
    region: 'Niedersachsen',
    country: 'Deutschland',
    aliases: [
      'Wangerooge',
      'Wangeroog',
      'Vangereuge',
      'Wangerooge Island',
      'Insel',
      'Inseln',
      'Nordseeinsel',
      'Ostfriesland',
      'Ostfriesische Inseln',
      'East Frisia',
      'East Frisian Islands',
      'North Sea',
      'Nordsee',
      'Niedersachsen',
      'Lower Saxony',
      'Germany',
      'Deutschland',
    ],
  },
  hamburg: {
    region: 'Hamburg',
    country: 'Deutschland',
    aliases: [
      'Hamburg',
      'HH',
      'Hansestadt Hamburg',
      'Free and Hanseatic City of Hamburg',
      'Elbphilharmonie',
      'Elphi',
      'HafenCity',
      'Speicherstadt',
      'Metropolregion Hamburg',
      'Germany',
      'Deutschland',
    ],
  },
  flensburg: {
    region: 'Schleswig-Holstein',
    country: 'Deutschland',
    aliases: [
      'Flensburg',
      'Flensborg',
      'FL',
      'Fördestadt',
      'Fordestadt',
      'Flensburger Förde',
      'Kreis Flensburg',
      'SH',
      'Schleswig-Holstein',
      'Germany',
      'Deutschland',
      'Denmark border',
      'Dänemark',
    ],
  },
  laboe: {
    region: 'Schleswig-Holstein',
    country: 'Deutschland',
    aliases: [
      'Laboe',
      'Ostseebad Laboe',
      'Marine-Ehrenmal Laboe',
      'Marine Ehrenmal',
      'U 995',
      'U-Boot Laboe',
      'Kieler Förde',
      'Probstei',
      'Kreis Plön',
      'SH',
      'Schleswig-Holstein',
      'Germany',
      'Deutschland',
    ],
  },
  korbach: {
    region: 'Hessen',
    country: 'Deutschland',
    aliases: [
      'Korbach',
      'Hansestadt Korbach',
      'Kreisstadt Korbach',
      'Waldeck',
      'Waldeck-Frankenberg',
      'Korbacher Spalte',
      'Eisenberg',
      'Goldhausen',
      'Nordhessen',
      'Hessen',
      'Germany',
      'Deutschland',
    ],
  },
  'berlin-zentral': {
    region: 'Berlin',
    country: 'Deutschland',
    aliases: [
      'Berlin',
      'Berlin Zentral',
      'Berlin Zentrum',
      'Berlin Mitte',
      'B',
      'Hauptstadt',
      'Brandenburger Tor',
      'Fernsehturm',
      'Alexanderplatz',
      'Museumsinsel',
      'Reichstag',
      'Charlottenburg',
      'Kreuzberg',
      'Germany',
      'Deutschland',
    ],
  },
  'berlin-umland': {
    region: 'Berlin',
    country: 'Deutschland',
    aliases: [
      'Berlin Umland',
      'Berlin außen',
      'Berlin Umgebung',
      'Spandau',
      'Zehlendorf',
      'Köpenick',
      'Marzahn',
      'Gärten der Welt',
      'Hellersdorf',
      'Frohnau',
      'Rudow',
      'Gatow',
      'Tempelhofer Feld',
      'Olympiastadion',
      'Germany',
      'Deutschland',
    ],
  },
  potsdam: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: [
      'Potsdam',
      'Babelsberg',
      'Sanssouci',
      'Filmpark Babelsberg',
      'Brandenburg',
      'Germany',
      'Deutschland',
    ],
  },
  spreewald: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: ['Spreewald', 'Lübbenau', 'Lubbenau', 'Burg Spreewald', 'Kahnfahrt'],
  },
  beelitz: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: ['Beelitz', 'Beelitz-Heilstätten', 'Beelitz Heilstätten', 'Baumkronenpfad'],
  },
  oranienburg: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: ['Oranienburg', 'Sachsenhausen', 'Schloss Oranienburg'],
  },
  werder: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: ['Werder', 'Werder Havel', 'Werder (Havel)', 'Baumblütenfest'],
  },
  brandenburg_havel: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: [
      'Brandenburg an der Havel',
      'Brandenburg Havel',
      'Brandenburg a. d. Havel',
      'Dom Brandenburg',
      'Havel',
    ],
  },
  bad_saarow: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: [
      'Bad Saarow',
      'Saarow',
      'Scharmützelsee',
      'Scharmuetzelsee',
      'Bad Saarow-Pieskow',
    ],
  },
  chorin: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: ['Chorin', 'Kloster Chorin', 'Schorfheide', 'Biosphärenreservat Schorfheide'],
  },
  wandlitz: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: ['Wandlitz', 'Liepnitzsee', 'Waldsiedlung Wandlitz'],
  },
  rheinsberg: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: ['Rheinsberg', 'Schloss Rheinsberg', 'Tucholsky', 'Fontane'],
  },
  muenchen: {
    region: '',
    country: 'Deutschland',
    aliases: ['München'],
  },
  koeln: {
    region: '',
    country: 'Deutschland',
    aliases: ['Köln'],
  },
  duesseldorf: {
    region: '',
    country: 'Deutschland',
    aliases: ['Düsseldorf'],
  },
  stuttgart: {
    region: '',
    country: 'Deutschland',
    aliases: ['Stuttgart'],
  },
  dresden: {
    region: '',
    country: 'Deutschland',
    aliases: ['Dresden'],
  },
  hochheim: {
    region: '',
    country: 'Deutschland',
    aliases: ['Hochheim am Main'],
  },
  frankfurt: {
    region: '',
    country: 'Deutschland',
    aliases: ['Frankfurt am Main'],
  },
  lissabon: {
    region: 'Portugal',
    country: 'Portugal',
    aliases: [
      'Lissabon',
      'Lisboa',
      'Lisbon',
      'Belém',
      'Belem',
      'Alfama',
      'Portugal',
    ],
  },
  london: {
    region: 'England',
    country: 'United Kingdom',
    aliases: [
      'London',
      'Londinium',
      'Greater London',
      'Westminster',
      'City of London',
      'Tower Bridge',
      'Big Ben',
      'England',
      'UK',
    ],
  },
  finsterwalde: {
    region: 'Brandenburg',
    country: 'Deutschland',
    aliases: [
      'Finsterwalde',
      'Sängerstadt',
      'Saengerstadt',
      'Finsterwalde Brandenburg',
      'Elbe-Elster',
      'Niederlausitz',
      'Brandenburg',
      'Germany',
      'Deutschland',
    ],
  },
  halle_saale: {
    region: 'Sachsen-Anhalt',
    country: 'Deutschland',
    aliases: [
      'Halle',
      'Halle (Saale)',
      'Halle Saale',
      'Halle an der Saale',
      'Händelstadt',
      'Haendelstadt',
      'Saale',
      'Sachsen-Anhalt',
      'Saxony-Anhalt',
      'Germany',
      'Deutschland',
    ],
  },

  amsterdam: {
    region: 'Noord-Holland',
    country: 'Niederlande',
    aliases: [
      'Amsterdam',
      'Amsterdam NL',
      'Amsterdam Netherlands',
      'Dam',
      'Grachtengordel',
      'Jordaan',
      'Nederland',
      'Netherlands',
      'Holland',
      'Niederlande',
    ],
  },
  kiel: {
    region: '',
    country: 'Deutschland',
    aliases: ['Kiel'],
  },
  bremen: {
    region: '',
    country: 'Deutschland',
    aliases: ['Bremen'],
  },

};

export function cityCoverSource(cityId: string): ImageSourcePropType {
  return COVERS[cityId] ?? CITY_CARD_HERO;
}

/** HTTPS-Cover aus Pack/Index, sonst null. */
export function remoteCityCoverUrl(
  coverUrl?: string | null,
): string | null {
  const url = (coverUrl || '').trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * HTTPS-Cover (Pack/Index) → optionales Lokal-Asset → Fallback-Hero.
 * Remote first hält die App klein; lokale requires sind bewusst leer.
 */
export function resolveCityCoverSource(
  cityId: string,
  coverUrl?: string | null,
  _opts?: { preferRemote?: boolean },
): ImageSourcePropType {
  const remote = remoteCityCoverUrl(coverUrl);
  if (remote) return { uri: remote };
  if (hasCityCover(cityId)) return COVERS[cityId]!;
  return CITY_CARD_HERO;
}

/** Früher Crop-Zoom — Covers werden 1:1 angezeigt (kein Scale/Translate). */
export function cityCoverFocus(_cityId: string): CityCoverFocus {
  return DEFAULT_FOCUS;
}

export function citySearchMeta(cityId: string): CitySearchMeta {
  return CITY_SEARCH_META[cityId] ?? {};
}

export function hasCityCover(cityId: string): boolean {
  return Object.prototype.hasOwnProperty.call(COVERS, cityId);
}

/** Cover einmal auf die Platte legen — nicht jedes Mal per CDN. */
export function prefetchCityCover(
  coverUrl?: string | null,
  cityId?: string,
): void {
  const url = remoteCityCoverUrl(coverUrl);
  if (!url) return;
  void import('../services/cityCoverCache')
    .then((mod) => mod.ensureCityCoverCached(cityId || '_', coverUrl))
    .catch(() => undefined);
}

export function prefetchCityCovers(
  cities: Array<{ id?: string; coverUrl?: string | null } | null | undefined>,
): void {
  for (const c of cities) {
    if (c) prefetchCityCover(c.coverUrl, c.id);
  }
}
