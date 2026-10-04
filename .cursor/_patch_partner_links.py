# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

p = ROOT / "src/services/affiliate/partnerBookingDeepLink.ts"
t = p.read_text(encoding="utf-8")
start = t.find("/** Kiwi Ergebnis-Liste:")
end = t.find("/** Aviasales Kurz-Suche:", start)
if start < 0 or end < 0:
    raise SystemExit(f"kiwi block markers missing start={start} end={end}")
new_kiwi = """/** Kiwi Ergebnis-Liste: Strecke + Hin/Rück + Personen + Gepäck (+ optional Direkt). */
export function buildKiwiResultsPageUrl(opts: {
  fromIata: string;
  toIata: string;
  dateKey: string;
  returnDateKey?: string | null;
  adults?: number;
  children?: number;
  infants?: number;
  /** Kabine.Aufgabe pro Person, z. B. 0.1 = 0 Kabine + 1 Aufgabe. */
  bagsPerAdult?: string;
  /** Brief: Direktflug → stopNumber=0~true */
  directOnly?: boolean;
}): string {
  const from = opts.fromIata.trim().toLowerCase();
  const to = opts.toIata.trim().toLowerCase();
  const date = ymd(opts.dateKey) || opts.dateKey.trim();
  const retRaw = ymd(opts.returnDateKey || '');
  // One-way: anytime (wie Kiwi-UI); Roundtrip: Rückdatum
  const ret = retRaw || 'anytime';
  const adults = clampAdults(opts.adults, 1);
  const children = Math.max(0, Math.floor(opts.children ?? 0));
  const infants = Math.max(0, Math.floor(opts.infants ?? 0));
  const per = (opts.bagsPerAdult || '0.0').trim() || '0.0';
  const bags = Array.from({ length: adults }, () => per).join('_');
  const u = new URL(
    `https://www.kiwi.com/de/search/results/${encodeURIComponent(from)}/${encodeURIComponent(to)}/${encodeURIComponent(date)}/${encodeURIComponent(ret)}/`,
  );
  u.searchParams.set('adults', String(adults));
  u.searchParams.set('children', String(children));
  u.searchParams.set('infants', String(infants));
  u.searchParams.set('bags', bags);
  if (opts.directOnly) {
    // Kiwi: stopNumber=0~true = nur Direktflüge
    u.searchParams.set('stopNumber', '0~true');
  }
  return u.toString();
}

"""
p.write_text(t[:start] + new_kiwi + t[end:], encoding="utf-8")
print("ok partnerBookingDeepLink")

p = ROOT / "src/services/affiliate/travelpayoutsPartners.ts"
t = p.read_text(encoding="utf-8")
old = """export function buildKiwiSearchPageUrl(opts: {
  fromIata: string;
  toIata: string;
  dateKey: string;
  returnDateKey?: string | null;
  adults?: number;
  children?: number;
  infants?: number;
  bagsPerAdult?: string;
}): string {
  return buildKiwiResultsPageUrl(opts);
}"""
new = """export function buildKiwiSearchPageUrl(opts: {
  fromIata: string;
  toIata: string;
  dateKey: string;
  returnDateKey?: string | null;
  adults?: number;
  children?: number;
  infants?: number;
  bagsPerAdult?: string;
  directOnly?: boolean;
}): string {
  return buildKiwiResultsPageUrl(opts);
}"""
if old not in t:
    raise SystemExit("travelpayoutsPartners: signature not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("ok travelpayoutsPartners")

p = ROOT / "src/reisebuero/research/funnel.ts"
t = p.read_text(encoding="utf-8")
t2 = t.replace(
    """      flightUrl = buildKiwiSearchPageUrl({
        fromIata: originUsed,
        toIata: place.iata,
        dateKey: checkin,
        returnDateKey: checkout !== checkin ? checkout : null,
        adults,
      });""",
    """      flightUrl = buildKiwiSearchPageUrl({
        fromIata: originUsed,
        toIata: place.iata,
        dateKey: checkin,
        returnDateKey: checkout !== checkin ? checkout : null,
        adults,
        directOnly: ledger.directFlight?.value === true,
      });""",
    1,
)
t2 = t2.replace(
    """      flightUrl = buildKiwiSearchPageUrl({
        fromIata: ledger.airportIata.value,
        toIata: place.iata,
        dateKey: checkin,
        returnDateKey: checkout !== checkin ? checkout : null,
        adults,
      });""",
    """      flightUrl = buildKiwiSearchPageUrl({
        fromIata: ledger.airportIata.value,
        toIata: place.iata,
        dateKey: checkin,
        returnDateKey: checkout !== checkin ? checkout : null,
        adults,
        directOnly: ledger.directFlight?.value === true,
      });""",
    1,
)
old_fin = """              return finalizeHotelBookAffiliateUrl({
                hotelName: pick.name,
                city: place.name,
                bookUrl: pick.bookUrl,
                checkin,
                checkout,
                adults,
                expediaPropertyId: pick.expediaPropertyId,
              });"""
new_fin = """              return finalizeHotelBookAffiliateUrl({
                hotelName: pick.name,
                city: place.name,
                bookUrl: pick.bookUrl,
                checkin,
                checkout,
                adults,
                expediaPropertyId: pick.expediaPropertyId,
                priceEur: pick.priceTotal,
              });"""
if old_fin not in t2:
    raise SystemExit("funnel finalizeHotel block not found")
t2 = t2.replace(old_fin, new_fin, 1)
t2 = t2.replace(
    """                finalizeHotelBookAffiliateUrl: (o: {
                  hotelName: string;
                  city?: string | null;
                  bookUrl?: string | null;
                  checkin: string;
                  checkout: string;
                  adults?: number;
                  expediaPropertyId?: string | null;
                }) => string;""",
    """                finalizeHotelBookAffiliateUrl: (o: {
                  hotelName: string;
                  city?: string | null;
                  bookUrl?: string | null;
                  checkin: string;
                  checkout: string;
                  adults?: number;
                  expediaPropertyId?: string | null;
                  priceEur?: number | null;
                }) => string;""",
    1,
)
if t2 == t:
    raise SystemExit("funnel: no changes applied")
p.write_text(t2, encoding="utf-8")
print("ok funnel")
print("ALL PATCHES OK")
