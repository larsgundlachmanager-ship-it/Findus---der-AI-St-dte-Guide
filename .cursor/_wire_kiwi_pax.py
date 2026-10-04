from pathlib import Path
import re

# --- types.ts ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\types.ts")
t = p.read_text(encoding="utf-8")
old = """  adults: LedgerEntry<number> | null;
  children: LedgerEntry<number> | null;
  bedrooms: LedgerEntry<number> | null;"""
new = """  adults: LedgerEntry<number> | null;
  children: LedgerEntry<number> | null;
  /** Kind unter 1 Jahr (Kiwi infants). */
  infants: LedgerEntry<number> | null;
  /** Handgepaeck gesamt (Kiwi cabin). */
  cabinBags: LedgerEntry<number> | null;
  /** Aufgabegepaeck gesamt (Kiwi checked). */
  checkedBags: LedgerEntry<number> | null;
  bedrooms: LedgerEntry<number> | null;"""
if old not in t:
    raise SystemExit("types adults block missing")
t = t.replace(old, new, 1)
old2 = """  adults: null,
  children: null,
  bedrooms: null,"""
new2 = """  adults: null,
  children: null,
  infants: null,
  cabinBags: null,
  checkedBags: null,
  bedrooms: null,"""
if old2 not in t:
    raise SystemExit("empty ledger missing")
t = t.replace(old2, new2, 1)
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t, encoding="utf-8")
if bak.exists(): bak.unlink()
p.rename(bak); tmp.rename(p); bak.unlink(missing_ok=True)
print("ok types")

# --- parseBriefSlots ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\parseBriefSlots.ts")
t = p.read_text(encoding="utf-8")
marker = """  if (/\\b(baby|säugling|saeugling|neugeboren|\\d{1,2}\\s+monate)\\b/iu.test(t)) {
    if (!patch.children) patch.children = entry(1, 'user');
    if (/\\bzu\\s+dritt\\b/iu.test(t)) {
      patch.adults = entry(2, 'user');
      patch.beds = entry(2, 'inferred');
    }
  }"""
ins = """  if (/\\b(baby|säugling|saeugling|neugeboren|\\d{1,2}\\s+monate)\\b/iu.test(t)) {
    if (!patch.children) patch.children = entry(1, 'user');
    if (!patch.infants) patch.infants = entry(1, 'user');
    if (/\\bzu\\s+dritt\\b/iu.test(t)) {
      patch.adults = entry(2, 'user');
      patch.beds = entry(2, 'inferred');
    }
  }
  if (/\\bkind(?:es)?\\s+unter\\s+(?:einem\\s+)?(?:jahr|1)\\b/iu.test(t) || /\\bunter\\s+1\\s*(?:jahr|j)\\b/iu.test(t)) {
    if (!patch.infants) patch.infants = entry(1, 'user');
  }
  const cabinHit = t.match(/\\b(\\d{1,2}|ein|eine|zwei|drei|vier)\\s*(?:x\\s*)?(?:handgepäck|handgepaeck|cabin\\s*bag)/iu);
  if (cabinHit) {
    const n = numWord(cabinHit[1]!);
    if (n != null) patch.cabinBags = entry(n, 'user');
  }
  const checkedHit = t.match(/\\b(\\d{1,2}|ein|eine|zwei|drei|vier)\\s*(?:x\\s*)?(?:aufgabegepäck|aufgabegepaeck|koffer|checked\\s*bag)/iu);
  if (checkedHit) {
    const n = numWord(checkedHit[1]!);
    if (n != null) patch.checkedBags = entry(n, 'user');
  }"""
if marker not in t:
    raise SystemExit("baby marker missing in parse")
t = t.replace(marker, ins, 1)
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t, encoding="utf-8")
if bak.exists(): bak.unlink()
p.rename(bak); tmp.rename(p); bak.unlink(missing_ok=True)
print("ok parse")

# --- transportMatrix ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\transportMatrix.ts")
t = p.read_text(encoding="utf-8")
old = """  const adults = Math.max(1, opts.ledger.adults?.value ?? 1);
  const children = Math.max(0, opts.ledger.children?.value ?? 0);
  let kiwiUrl: string | null = null;
  try {
    kiwiUrl = buildKiwiSearchPageUrl({
      fromIata: from,
      toIata: to,
      dateKey: checkin,
      returnDateKey: checkout && checkout !== checkin ? checkout : null,
      adults,
      children,
      directOnly: opts.ledger.directFlight?.value === true,
    });"""
new = """  const adults = Math.max(1, opts.ledger.adults?.value ?? 1);
  const children = Math.max(0, opts.ledger.children?.value ?? 0);
  const infants = Math.max(0, opts.ledger.infants?.value ?? 0);
  const cabinBags = opts.ledger.cabinBags?.value ?? null;
  const checkedBags = opts.ledger.checkedBags?.value ?? null;
  let kiwiUrl: string | null = null;
  try {
    kiwiUrl = buildKiwiSearchPageUrl({
      fromIata: from,
      toIata: to,
      dateKey: checkin,
      returnDateKey: checkout && checkout !== checkin ? checkout : null,
      adults,
      children,
      infants,
      cabinBags,
      checkedBags,
      directOnly: opts.ledger.directFlight?.value === true,
    });"""
if old not in t:
    raise SystemExit("transportMatrix block missing")
t = t.replace(old, new, 1)
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t, encoding="utf-8")
if bak.exists(): bak.unlink()
p.rename(bak); tmp.rename(p); bak.unlink(missing_ok=True)
print("ok transport")

# --- funnel (both kiwi calls) ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\funnel.ts")
t = p.read_text(encoding="utf-8")
# find adults near flightUrl
# patch both buildKiwiSearchPageUrl blocks similarly
pat = re.compile(
    r"flightUrl = buildKiwiSearchPageUrl\(\{\s*"
    r"fromIata: ([^,]+),\s*"
    r"toIata: ([^,]+),\s*"
    r"dateKey: checkin,\s*"
    r"returnDateKey: checkout !== checkin \? checkout : null,\s*"
    r"adults,\s*"
    r"directOnly: ledger\.directFlight\?\.value === true,\s*"
    r"\}\);",
    re.M,
)
def repl(m):
    return (
        f"flightUrl = buildKiwiSearchPageUrl({{\n"
        f"        fromIata: {m.group(1)},\n"
        f"        toIata: {m.group(2)},\n"
        f"        dateKey: checkin,\n"
        f"        returnDateKey: checkout !== checkin ? checkout : null,\n"
        f"        adults,\n"
        f"        children: Math.max(0, ledger.children?.value ?? 0),\n"
        f"        infants: Math.max(0, ledger.infants?.value ?? 0),\n"
        f"        cabinBags: ledger.cabinBags?.value ?? null,\n"
        f"        checkedBags: ledger.checkedBags?.value ?? null,\n"
        f"        directOnly: ledger.directFlight?.value === true,\n"
        f"      }});"
    )
t2, n = pat.subn(repl, t)
if n < 2:
    raise SystemExit(f"funnel kiwi patches {n}")
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t2, encoding="utf-8")
if bak.exists(): bak.unlink()
p.rename(bak); tmp.rename(p); bak.unlink(missing_ok=True)
print("ok funnel", n)

# --- cheapFlightBook ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\services\flights\cheapFlightBook.ts")
t = p.read_text(encoding="utf-8")
old = """  adults?: number;
  userText?: string | null;
  kiwiPriceEur?: number | null;
  aviasalesPriceEur?: number | null;
  returnDateKey?: string | null;
  /** Brief/Modul-2: nur Direktflüge */
  directOnly?: boolean;
}): QuickAction[] {"""
new = """  adults?: number;
  children?: number;
  infants?: number;
  cabinBags?: number | null;
  checkedBags?: number | null;
  userText?: string | null;
  kiwiPriceEur?: number | null;
  aviasalesPriceEur?: number | null;
  returnDateKey?: string | null;
  /** Brief/Modul-2: nur Direktflüge */
  directOnly?: boolean;
}): QuickAction[] {"""
if old not in t:
    raise SystemExit("cheapFlightBook opts missing")
t = t.replace(old, new, 1)
old = """    const page = buildKiwiSearchPageUrl({
      fromIata: opts.originIata,
      toIata: opts.destIata,
      dateKey: opts.dateKey,
      returnDateKey: opts.returnDateKey ?? null,
      adults,
      directOnly: wantDirect,
    });"""
new = """    const page = buildKiwiSearchPageUrl({
      fromIata: opts.originIata,
      toIata: opts.destIata,
      dateKey: opts.dateKey,
      returnDateKey: opts.returnDateKey ?? null,
      adults,
      children: opts.children ?? 0,
      infants: opts.infants ?? 0,
      cabinBags: opts.cabinBags ?? null,
      checkedBags: opts.checkedBags ?? null,
      directOnly: wantDirect,
    });"""
if old not in t:
    raise SystemExit("cheapFlightBook build missing")
t = t.replace(old, new, 1)
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t, encoding="utf-8")
if bak.exists(): bak.unlink()
p.rename(bak); tmp.rename(p); bak.unlink(missing_ok=True)
print("ok cheapFlight")

# --- openUrlBookingPrefill: keep return ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\services\affiliate\openUrlBookingPrefill.ts")
t = p.read_text(encoding="utf-8")
old = """      if (from && to && dep) {
        const { buildKiwiResultsPageUrl } = require('./partnerBookingDeepLink') as {
          buildKiwiResultsPageUrl: (o: {
            fromIata: string;
            toIata: string;
            dateKey: string;
            adults?: number;
          }) => string;
        };
        inner = buildKiwiResultsPageUrl({
          fromIata: from,
          toIata: to,
          dateKey: dep,
          adults: adults ?? 1,
        });
        u = new URL(inner);
      }"""
new = """      if (from && to && dep) {
        const { buildKiwiResultsPageUrl } = require('./partnerBookingDeepLink') as {
          buildKiwiResultsPageUrl: (o: {
            fromIata: string;
            toIata: string;
            dateKey: string;
            returnDateKey?: string | null;
            adults?: number;
            children?: number;
            infants?: number;
            cabinBags?: number | null;
            checkedBags?: number | null;
            directOnly?: boolean;
          }) => string;
        };
        const ret = u.searchParams.get('return');
        const bags = u.searchParams.get('bags');
        const stop = u.searchParams.get('stopNumber');
        inner = buildKiwiResultsPageUrl({
          fromIata: from,
          toIata: to,
          dateKey: dep,
          returnDateKey: ret && ret !== 'anytime' ? ret : null,
          adults: adults ?? Number(u.searchParams.get('adults') || 1) || 1,
          children: Number(u.searchParams.get('children') || 0) || 0,
          infants: Number(u.searchParams.get('infants') || 0) || 0,
          bagsPerAdult: bags && !bags.includes('_') ? bags.replace(/-$/, '') : undefined,
          cabinBags: null,
          checkedBags: null,
          directOnly: Boolean(stop && stop.includes('0')),
        } as any);
        // Preserve full bags string if already present (e.g. 1.1_1.1_0.0-)
        if (bags) {
          const rebuilt = new URL(inner);
          rebuilt.searchParams.set('bags', bags);
          inner = rebuilt.toString();
        }
        u = new URL(inner);
      }"""
# Fix: buildKiwiResultsPageUrl doesn't take bagsPerAdult in the cast correctly - use bagsPerAdult from first adult slice
# Simpler: if bags already on URL, just update adults and don't rebuild
# Actually rewrite simpler approach
old_simple = """      if (from && to && dep) {
        const { buildKiwiResultsPageUrl } = require('./partnerBookingDeepLink') as {
          buildKiwiResultsPageUrl: (o: {
            fromIata: string;
            toIata: string;
            dateKey: string;
            adults?: number;
          }) => string;
        };
        inner = buildKiwiResultsPageUrl({
          fromIata: from,
          toIata: to,
          dateKey: dep,
          adults: adults ?? 1,
        });
        u = new URL(inner);
      }
      if (adults != null) u.searchParams.set('adults', String(adults));
      if (!u.searchParams.get('children')) u.searchParams.set('children', '0');
      if (!u.searchParams.get('infants')) u.searchParams.set('infants', '0');"""

new_simple = """      if (from && to && dep) {
        const { buildKiwiResultsPageUrl } = require('./partnerBookingDeepLink') as {
          buildKiwiResultsPageUrl: (o: Record<string, unknown>) => string;
        };
        const ret = u.searchParams.get('return');
        const bags = u.searchParams.get('bags');
        const stop = u.searchParams.get('stopNumber') || '';
        inner = buildKiwiResultsPageUrl({
          fromIata: from,
          toIata: to,
          dateKey: dep,
          returnDateKey: ret && ret !== 'anytime' ? ret : null,
          adults: adults ?? Number(u.searchParams.get('adults') || 1) || 1,
          children: Number(u.searchParams.get('children') || 0) || 0,
          infants: Number(u.searchParams.get('infants') || 0) || 0,
          bagsPerAdult: bags ? bags.split('_')[0]?.replace(/-$/, '') : undefined,
          directOnly: /0/.test(stop),
        });
        u = new URL(inner);
        if (bags) u.searchParams.set('bags', bags);
      }
      if (adults != null) u.searchParams.set('adults', String(adults));
      if (!u.searchParams.get('children')) u.searchParams.set('children', '0');
      if (!u.searchParams.get('infants')) u.searchParams.set('infants', '0');"""

if old_simple not in t:
    raise SystemExit("prefill kiwi block missing")
t = t.replace(old_simple, new_simple, 1)
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t, encoding="utf-8")
if bak.exists(): bak.unlink()
p.rename(bak); tmp.rename(p); bak.unlink(missing_ok=True)
print("ok prefill")
print("DONE")
