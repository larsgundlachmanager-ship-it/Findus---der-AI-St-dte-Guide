from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\partnerBookingDeepLink.ts")
t = p.read_text(encoding="utf-8")
start = t.find("/** Kiwi Ergebnis-Liste via /deep")
if start < 0:
    start = t.find("/** Kiwi Ergebnis-Liste:")
end = t.find("/** Aviasales Kurz-Suche:", start)
if start < 0 or end < 0:
    raise SystemExit(f"markers {start} {end}")

new = r'''/** Kiwi: Kabine.Aufgabe pro Erwachsenem, z. B. 1.1 = 1 Hand + 1 Aufgabe. */
export function formatKiwiBags(opts: {
  adults: number;
  /** Pro Erwachsenem, z. B. "0.1" / "1.0" / "1.1". */
  bagsPerAdult?: string | null;
  /** Gesamt Handgepaeck (Kabine) — wird auf Erwachsene verteilt. */
  cabinBags?: number | null;
  /** Gesamt Aufgabegepaeck — wird auf Erwachsene verteilt. */
  checkedBags?: number | null;
}): string | null {
  const adults = Math.max(1, Math.floor(opts.adults));
  if (opts.bagsPerAdult != null && String(opts.bagsPerAdult).trim()) {
    const per = String(opts.bagsPerAdult).trim();
    return Array.from({ length: adults }, () => per).join('_') + '-';
  }
  let cabin = Math.max(0, Math.floor(opts.cabinBags ?? 0));
  let checked = Math.max(0, Math.floor(opts.checkedBags ?? 0));
  if (cabin <= 0 && checked <= 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < adults; i++) {
    const c = cabin > 0 ? 1 : 0;
    const k = checked > 0 ? 1 : 0;
    cabin -= c;
    checked -= k;
    parts.push(`${c}.${k}`);
  }
  // Rest auf letzte Person (Kiwi erlaubt >1 selten — lieber verteilen)
  while (cabin > 0 || checked > 0) {
    const last = parts[parts.length - 1] || '0.0';
    const [a, b] = last.split('.').map((n) => Number(n) || 0);
    const addC = cabin > 0 ? 1 : 0;
    const addK = checked > 0 ? 1 : 0;
    cabin -= addC;
    checked -= addK;
    parts[parts.length - 1] = `${a + addC}.${b + addK}`;
  }
  return parts.join('_') + '-';
}

/** Kiwi Ergebnis via /deep (IATA) — Pfad /ham/ath/ fuellt Von/Nach NICHT. */
export function buildKiwiResultsPageUrl(opts: {
  fromIata: string;
  toIata: string;
  dateKey: string;
  returnDateKey?: string | null;
  adults?: number;
  children?: number;
  /** Kind unter 1 Jahr */
  infants?: number;
  /** Kabine.Aufgabe pro Person, z. B. 0.1 / 1.0 / 1.1 */
  bagsPerAdult?: string;
  cabinBags?: number | null;
  checkedBags?: number | null;
  /** Brief: Direktflug → stopNumber=0~true */
  directOnly?: boolean;
}): string {
  const from = opts.fromIata.trim().toUpperCase();
  const to = opts.toIata.trim().toUpperCase();
  const date = ymd(opts.dateKey) || opts.dateKey.trim();
  const retRaw = ymd(opts.returnDateKey || '');
  // Roundtrip nur mit echtem Rueckdatum; anytime = Einweg / Rueck flexibel
  const ret = retRaw || 'anytime';
  const adults = clampAdults(opts.adults, 1);
  const children = Math.max(0, Math.floor(opts.children ?? 0));
  const infants = Math.max(0, Math.floor(opts.infants ?? 0));
  const bags = formatKiwiBags({
    adults,
    bagsPerAdult: opts.bagsPerAdult,
    cabinBags: opts.cabinBags,
    checkedBags: opts.checkedBags,
  });
  const u = new URL('https://www.kiwi.com/deep');
  u.searchParams.set('from', from);
  u.searchParams.set('to', to);
  u.searchParams.set('departure', date);
  u.searchParams.set('return', ret);
  u.searchParams.set('adults', String(adults));
  u.searchParams.set('children', String(children));
  u.searchParams.set('infants', String(infants));
  if (bags) u.searchParams.set('bags', bags);
  u.searchParams.set('lang', 'de');
  if (opts.directOnly) {
    u.searchParams.set('stopNumber', '0~true');
  }
  return u.toString();
}

'''

tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t[:start] + new + t[end:], encoding="utf-8")
if bak.exists():
    bak.unlink()
p.rename(bak)
tmp.rename(p)
bak.unlink(missing_ok=True)
print("ok builder")

# travelpayoutsPartners opts
p2 = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\travelpayoutsPartners.ts")
t2 = p2.read_text(encoding="utf-8")
old = """export function buildKiwiSearchPageUrl(opts: {
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
new2 = """export function buildKiwiSearchPageUrl(opts: {
  fromIata: string;
  toIata: string;
  dateKey: string;
  returnDateKey?: string | null;
  adults?: number;
  children?: number;
  infants?: number;
  bagsPerAdult?: string;
  cabinBags?: number | null;
  checkedBags?: number | null;
  directOnly?: boolean;
}): string {
  return buildKiwiResultsPageUrl(opts);
}"""
if old not in t2:
    raise SystemExit("travelpayouts signature missing")
tmp, bak = p2.with_suffix(".ts.__new"), p2.with_suffix(".ts.__bak")
tmp.write_text(t2.replace(old, new2, 1), encoding="utf-8")
if bak.exists():
    bak.unlink()
p2.rename(bak)
tmp.rename(p2)
bak.unlink(missing_ok=True)
print("ok travelpayouts")

# tests
p3 = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\partnerBookingDeepLink.test.ts")
t3 = p3.read_text(encoding="utf-8")
if "formatKiwiBags" not in t3:
    t3 = t3.replace(
        "buildKiwiResultsPageUrl,",
        "buildKiwiResultsPageUrl,\n  formatKiwiBags,",
    )
block = """
assert(formatKiwiBags({ adults: 3, cabinBags: 2, checkedBags: 2 }) === '1.1_1.1_0.0-', 'bags 2+2 on 3 adults');
assert(formatKiwiBags({ adults: 2, bagsPerAdult: '1.0' }) === '1.0_1.0-', 'bags per adult cabin');
assert(formatKiwiBags({ adults: 2, cabinBags: 0, checkedBags: 0 }) == null, 'no bags omit');

const kiwiRound = buildKiwiResultsPageUrl({
  fromIata: 'HAM',
  toIata: 'ATH',
  dateKey: '2026-11-12',
  returnDateKey: '2026-11-14',
  adults: 3,
  infants: 1,
  cabinBags: 2,
  checkedBags: 2,
  directOnly: true,
});
assert(/return=2026-11-14/.test(kiwiRound), `kiwi round return: ${kiwiRound}`);
assert(/adults=3/.test(kiwiRound) && /infants=1/.test(kiwiRound), 'kiwi pax 3+infant');
assert(/bags=1\\.1_1\\.1_0\\.0-/.test(kiwiRound), `kiwi bags party: ${kiwiRound}`);
assert(/stopNumber=0(%7E|~)true/.test(kiwiRound), 'kiwi direct round');
assert(!/return=anytime/.test(kiwiRound), 'no anytime when return set');
"""
if "bags 2+2 on 3 adults" not in t3:
    t3 = t3.replace(
        "assert(!isHollowPartnerUrl(kiwiDirect), 'kiwi direct not hollow');",
        "assert(!isHollowPartnerUrl(kiwiDirect), 'kiwi direct not hollow');\n" + block,
    )
tmp, bak = p3.with_suffix(".ts.__new"), p3.with_suffix(".ts.__bak")
tmp.write_text(t3, encoding="utf-8")
if bak.exists():
    bak.unlink()
p3.rename(bak)
tmp.rename(p3)
bak.unlink(missing_ok=True)
print("ok tests")
print("DONE")
