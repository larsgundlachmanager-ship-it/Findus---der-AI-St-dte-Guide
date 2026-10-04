# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def atomic_replace(path: Path, old: str, new: str, *, count: int = 1) -> None:
    t = path.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"pattern missing in {path}")
    out = t.replace(old, new, count)
    tmp = path.with_suffix(path.suffix + ".tmp_write")
    tmp.write_text(out, encoding="utf-8")
    os.replace(tmp, path)
    print(f"ok {path.relative_to(ROOT)}")


# --- catalog entry ---
atomic_replace(
    ROOT / "src/services/affiliate/affiliateService.ts",
    """ * - camping.info AWIN mid=44063 (Campingplatz ~5 %)""",
    """ * - camping.info AWIN mid=44063 (Campingplatz ~5 %)
 * - Camping-and-Co AWIN mid=16438 (FR/EU Camping ~7 % thematisch)""",
)

atomic_replace(
    ROOT / "src/services/affiliate/affiliateService.ts",
    """      notes:
        'AWIN mid=44063. ~5 % auf Campingplatz-Buchung (Ø ~€244), App 0,50 €, Shop 30 %. Button bei Camping-Intent.',
    },
    {
      id: 'solmar',""",
    """      notes:
        'AWIN mid=44063. ~5 % auf Campingplatz-Buchung (Ø ~€244), App 0,50 €, Shop 30 %. Mit Camping-and-Co vergleichen (pickCampingBookingOffer).',
    },
    {
      id: 'camping_and_co',
      name: 'Camping-and-Co (AWIN DE/FR)',
      category: 'Camping',
      envKeys: [
        'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
        'EXPO_PUBLIC_CAMPING_AND_CO_AWIN_MID',
        'EXPO_PUBLIC_CAMPING_AND_CO_AFFILIATE_URL',
      ],
      value: (() => {
        try {
          const { getCampingAndCoUrl } = require('./campingAndCoAffiliate') as {
            getCampingAndCoUrl: (d?: string | null, q?: string | null) => string;
          };
          return getCampingAndCoUrl();
        } catch {
          return '';
        }
      })(),
      helperFns: [
        'getCampingAndCoUrl',
        'getCampingAndCoLandingUrl',
        'buildCampingAndCoAction',
        'buildCampingBookingActions',
        'buildAwinClickUrl',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'AWIN DE mid=16438 · FR 13348. ~7 % thematisch / 3 % Cashback. Tracking erst nach Awin-Freigabe zuverlässig — Links nutzbar. Immer vs camping.info vergleichen.',
    },
    {
      id: 'solmar',""",
)

atomic_replace(
    ROOT / "src/services/affiliate/affiliateService.ts",
    """  if (/camping\\.info|awin1\\.com\\/cread\\.php.*44063/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    try {
      const u = new URL(inner);
      return getCampingInfoUrl(inner, null, {
        arrival: u.searchParams.get('arrival'),
        departure: u.searchParams.get('departure'),
        adults: Number(u.searchParams.get('adults') || '') || 2,
      });
    } catch {
      return getCampingInfoUrl(inner);
    }
  }""",
    """  if (/camping\\.info|awin1\\.com\\/cread\\.php.*44063/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    try {
      const u = new URL(inner);
      return getCampingInfoUrl(inner, null, {
        arrival: u.searchParams.get('arrival'),
        departure: u.searchParams.get('departure'),
        adults: Number(u.searchParams.get('adults') || '') || 2,
      });
    } catch {
      return getCampingInfoUrl(inner);
    }
  }
  if (/camping-and-co\\.com|awin1\\.com\\/cread\\.php.*(16438|13348)/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    const { getCampingAndCoUrl } = require('./campingAndCoAffiliate') as {
      getCampingAndCoUrl: (d?: string | null, q?: string | null) => string;
    };
    return getCampingAndCoUrl(/^https?:\\/\\//i.test(inner) ? inner : url);
  }""",
)

atomic_replace(
    ROOT / "src/services/affiliate/hollowPartnerUrl.ts",
    """  if (isBareHostPath(landing, /camping\\.info$/i)) return true;
  if (/camping\\.info\\/[^?\\s]*\\/search/i.test(blob)) {
    const q = queryParam(landing, 'q');
    if (!q) return true;
  }""",
    """  if (isBareHostPath(landing, /camping\\.info$/i)) return true;
  if (/camping\\.info\\/[^?\\s]*\\/search/i.test(blob)) {
    const q = queryParam(landing, 'q');
    if (!q) return true;
  }
  if (isBareHostPath(landing, /(?:de|fr)\\.camping-and-co\\.com$/i)) return true;
  if (/(?:de|fr)\\.camping-and-co\\.com\\/?$/i.test(landing)) {
    const q = queryParam(landing, 'q');
    if (!q) return true;
  }""",
)

atomic_replace(
    ROOT / "src/services/concierge/findusResponsePolicy.ts",
    """Camping → camping.info;""",
    """Camping → camping.info + Camping-and-Co vergleichen (Primär = Pick);""",
)

atomic_replace(
    ROOT / "src/services/affiliate/helpFirstMonetization.ts",
    """        'FLOW Camping: Platz suchen/buchen → camping.info Button. Hilfe-Ton, kein Pitch.',""",
    """        'FLOW Camping: Platz suchen/buchen → camping.info + Camping-and-Co vergleichen (Primär = Pick). Hilfe-Ton, kein Pitch.',""",
)

print("batch1 done")
