from pathlib import Path
import re

p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\storyMagazine.ts")
t = p.read_text(encoding="utf-8")
new = """export function buildCoverHeadline(opt: ReiseOption, ledger: ReiseLedger): string {
  const place = shortenPlaceName(opt.placeName);
  const hook = pickExperienceHook(ledger);
  const purpose = (ledger.purpose?.value || '').trim();
  // Merkbarer Trip-Titel — Preis steht separat im Badge, Ort nicht 3×
  if (purpose && purpose.length >= 4 && purpose.length <= 40 && !/pool|brief/i.test(purpose)) {
    return purpose.slice(0, 52);
  }
  if (hook) return `${hook} in ${place}`.slice(0, 52);
  return place.slice(0, 52);
}
"""
m = re.search(r"export function buildCoverHeadline\(opt: ReiseOption, ledger: ReiseLedger\): string \{.*?\n\}", t, re.S)
if not m:
    raise SystemExit("headline fn not found")
t = t[: m.start()] + new + t[m.end() :]
p.write_text(t, encoding="utf-8")
print("headline ok")

# smoke extras
p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\researchTheater.smoke.test.ts")
t = p.read_text(encoding="utf-8")
if "Rügen" not in t:
    insert = """
assert(approxPinForSpark('Rügen') != null, 'ruegen');
assert(approxPinForSpark('Bukarest') != null, 'bukarest');
assert(approxPinForSpark('Lissabon') != null, 'lissabon');
assert(approxPinForSpark('Palma de Mallorca') != null, 'palma full');
assert(approxPinForSpark('OTP') != null, 'OTP');
assert(approxPinForSpark('Hamburg') != null, 'hamburg city');
const swapped = enrichSparkGeo({ label: 'Lissabon', lat: -9.14, lng: 38.72 });
assert(swapped.lat != null && swapped.lat > 30, 'swap/sane lisbon lat');
const wrongBud = enrichSparkGeo({ label: 'Budapest', lat: 10, lng: 10 });
assert(Math.abs((wrongBud.lat || 0) - 47.5) < 2, 'known wins over far coords');
"""
    t = t.replace(
        "assert(approxPinForSpark('Unbekannte Insel XYZ123') == null, 'unknown → null');",
        "assert(approxPinForSpark('Unbekannte Insel XYZ123') == null, 'unknown → null');\n" + insert,
        1,
    )
    p.write_text(t, encoding="utf-8")
    print("smoke geo ok")
else:
    print("smoke already")

# flipchart ages+bahncard clearer
p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\flipchartNotes.ts")
t = p.read_text(encoding="utf-8")
t = t.replace(
    "      label: `Alter ${ledger.travelerAges.value.join('/')}`,\n      hint: 'Gruppe',",
    "      label: `Alter ${ledger.travelerAges.value.join(', ')} J.`,\n      hint: 'pro Person',",
)
t = t.replace(
    """        bc === 'none'
          ? 'keine Bahncard'
          : bc === 'unknown'
            ? 'Bahncard unklar'
            : `Bahncard ${bc}`,
""",
    """        bc === 'none'
          ? 'keine Bahncard'
          : bc === 'unknown'
            ? 'Bahncard unklar'
            : `eine Person: Bahncard ${bc}`,
""",
)
p.write_text(t, encoding="utf-8")
print("flipchart ok")
