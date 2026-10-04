from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\partnerBookingDeepLink.ts")
t = p.read_text(encoding="utf-8")
start = t.find("/** Kiwi Ergebnis-Liste:")
end = t.find("/** Aviasales Kurz-Suche:", start)
if start < 0 or end < 0:
    raise SystemExit(f"markers {start} {end}")
new = """/** Kiwi Ergebnis-Liste via /deep (IATA) — Pfad /ham/ath/ fuellt Von/Nach NICHT. */
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
  const from = opts.fromIata.trim().toUpperCase();
  const to = opts.toIata.trim().toUpperCase();
  const date = ymd(opts.dateKey) || opts.dateKey.trim();
  const retRaw = ymd(opts.returnDateKey || '');
  // One-way: anytime (wie Kiwi-UI); Roundtrip: Rueckdatum
  const ret = retRaw || 'anytime';
  const adults = clampAdults(opts.adults, 1);
  const children = Math.max(0, Math.floor(opts.children ?? 0));
  const infants = Math.max(0, Math.floor(opts.infants ?? 0));
  const per = (opts.bagsPerAdult || '0.0').trim() || '0.0';
  const bags = Array.from({ length: adults }, () => per).join('_') + '-';
  const u = new URL('https://www.kiwi.com/deep');
  u.searchParams.set('from', from);
  u.searchParams.set('to', to);
  u.searchParams.set('departure', date);
  u.searchParams.set('return', ret);
  u.searchParams.set('adults', String(adults));
  u.searchParams.set('children', String(children));
  u.searchParams.set('infants', String(infants));
  u.searchParams.set('bags', bags);
  u.searchParams.set('lang', 'de');
  if (opts.directOnly) {
    // Kiwi: stopNumber=0~true = nur Direktfluege
    u.searchParams.set('stopNumber', '0~true');
  }
  return u.toString();
}

"""
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t[:start] + new + t[end:], encoding="utf-8")
if bak.exists():
    bak.unlink()
p.rename(bak)
tmp.rename(p)
bak.unlink(missing_ok=True)
print("ok builder")

p2 = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\partnerBookingDeepLink.test.ts")
t2 = p2.read_text(encoding="utf-8")
t2 = t2.replace(
    "assert(/kiwi\\.com\\/de\\/search\\/results\\/ham\\/ath\\/2026-09-12\\/anytime/.test(kiwi), kiwi);",
    "assert(/kiwi\\.com\\/deep/.test(kiwi), kiwi);\n"
    "assert(/from=HAM/.test(kiwi) && /to=ATH/.test(kiwi), 'kiwi iata');\n"
    "assert(/departure=2026-09-12/.test(kiwi), 'kiwi date');\n"
    "assert(/return=anytime/.test(kiwi), 'kiwi return anytime');",
)
t2 = t2.replace(
    "assert(/bags=0\\.1_0\\.1/.test(kiwi), `kiwi bags: ${kiwi}`);",
    "assert(/bags=0\\.1_0\\.1-/.test(kiwi), `kiwi bags: ${kiwi}`);",
)
tmp, bak = p2.with_suffix(".ts.__new"), p2.with_suffix(".ts.__bak")
tmp.write_text(t2, encoding="utf-8")
if bak.exists():
    bak.unlink()
p2.rename(bak)
tmp.rename(p2)
bak.unlink(missing_ok=True)
print("ok tests")

p3 = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\hollowPartnerUrl.test.ts")
t3 = p3.read_text(encoding="utf-8")
t3 = t3.replace(
    "'https://www.kiwi.com/de/search/results/ham/ath/2026-11-12/anytime/?adults=2&children=0&infants=0&bags=0.1_0.1&stopNumber=0~true'",
    "'https://www.kiwi.com/deep?from=HAM&to=ATH&departure=2026-11-12&return=anytime&adults=2&children=0&infants=0&bags=0.1_0.1-&stopNumber=0~true&lang=de'",
)
tmp, bak = p3.with_suffix(".ts.__new"), p3.with_suffix(".ts.__bak")
tmp.write_text(t3, encoding="utf-8")
if bak.exists():
    bak.unlink()
p3.rename(bak)
tmp.rename(p3)
bak.unlink(missing_ok=True)
print("ok hollow test")

p4 = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_link_gen_smoke.ts")
if p4.exists():
    t4 = p4.read_text(encoding="utf-8")
    t4 = t4.replace(
        r"/kiwi\.com\/de\/search\/results\/ham\/ath\/2026-11-12\/anytime/.test(kiwi)",
        r"/kiwi\.com\/deep/.test(kiwi) && /from=HAM/.test(kiwi) && /to=ATH/.test(kiwi)",
    )
    t4 = t4.replace(
        r"/bags=0\.1_0\.1/.test(kiwi)",
        r"/bags=0\.1_0\.1-/.test(kiwi)",
    )
    t4 = t4.replace(
        r"/ham\/ath\/2026-11-12/.test(inner)",
        r"(/from=HAM/.test(inner) && /to=ATH/.test(inner))",
    )
    t4 = t4.replace(
        r"/2026-11-12\/2026-11-19/.test(kiwi2)",
        r"/departure=2026-11-12/.test(kiwi2) && /return=2026-11-19/.test(kiwi2)",
    )
    tmp, bak = p4.with_suffix(".ts.__new"), p4.with_suffix(".ts.__bak")
    tmp.write_text(t4, encoding="utf-8")
    if bak.exists():
        bak.unlink()
    p4.rename(bak)
    tmp.rename(p4)
    bak.unlink(missing_ok=True)
    print("ok link_gen smoke")

# hollowPartnerUrl: /deep with from+to is not hollow
p5 = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\hollowPartnerUrl.ts")
t5 = p5.read_text(encoding="utf-8")
if "kiwi.com/deep" not in t5:
    needle = "  if (isBareHostPath(landing, /kiwi\\.com$/i)) return true;"
    insert = """  if (isBareHostPath(landing, /kiwi\\.com$/i)) return true;
  // /deep?from=&to= is a full search deeplink (never hollow)
  if (/kiwi\\.com\\/deep\\?/i.test(landing)) {
    const from = queryParam(landing, 'from');
    const to = queryParam(landing, 'to');
    if (from && to) return false;
  }
"""
    if needle not in t5:
        raise SystemExit("kiwi bare host needle missing")
    t5 = t5.replace(needle, insert, 1)
    tmp, bak = p5.with_suffix(".ts.__new"), p5.with_suffix(".ts.__bak")
    tmp.write_text(t5, encoding="utf-8")
    if bak.exists():
        bak.unlink()
    p5.rename(bak)
    tmp.rename(p5)
    bak.unlink(missing_ok=True)
    print("ok hollow guard")
print("DONE")
