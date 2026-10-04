from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\transitGuideSpeech.ts")
t = p.read_text(encoding="utf-8")
old = """export function platformSpoken(raw: string | null | undefined): string | null {
  const p = String(raw ?? '').trim();
  if (!p) return null;
  if (/gleis|steig|bussteig|kante|gate/i.test(p)) return p;
  return `Gleis ${p}`;
}
"""
new = """/**
 * Platform-Ansage. Ohne Tafel-Wert → null (dünne Feeds / Bus oft ohne Steig).
 * Bus: „Steig“, Bahn: „Gleis“ — nichts erfinden.
 */
export function platformSpoken(
  raw: string | null | undefined,
  vehicle?: TransitVehicleKind | null,
): string | null {
  const p = String(raw ?? '').trim();
  if (!p) return null;
  if (/gleis|steig|bussteig|kante|gate/i.test(p)) return p;
  const bus = vehicle === 'Bus';
  return bus ? `Steig ${p}` : `Gleis ${p}`;
}
"""
if old not in t:
    raise SystemExit("platformSpoken missing")
t = t.replace(old, new, 1)
t = t.replace(
    "const plat = platformSpoken(facts.platform);",
    "const plat = platformSpoken(facts.platform, facts.vehicle);",
)
tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_tgs.ts")
tmp.write_text(t, encoding="utf-8", newline="\n")
try:
    p.unlink()
except Exception as e:
    print(e)
p.write_bytes(tmp.read_bytes())
print("speech ok", t.count("facts.vehicle)"))
