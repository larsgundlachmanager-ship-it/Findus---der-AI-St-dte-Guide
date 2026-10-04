from pathlib import Path
import shutil
import tempfile
import os

p = Path(r"src/components/homeMap/HomeMapPlacePopup.tsx")
t = p.read_text(encoding="utf-8")
old = """/** Gelbe Rubrik nur wenn sie wirklich hilft — nicht bei Amenity-Duplikaten. */
function shouldShowHomeMapPopupCategory(
  category: string | null | undefined,
  name: string | null | undefined,
): boolean {
  const cat = String(category || '').trim();
  if (!cat || /^ort$/i.test(cat)) return false;
  if (
    /^(Packstation|Toilette|Briefkasten|Geldautomat|Parkplatz|Bushaltestelle|ÖPNV|Supermarkt|Tankstelle|Apotheke|Kiosk)$/i.test(
      cat,
    )
  ) {
    return false;
  }
  const n = String(name || '').toLowerCase();
  if (n && cat.toLowerCase() && n.includes(cat.toLowerCase())) return false;
  return true;
}"""
new = """/**
 * Gelbe Rubrik im Popup — absichtlich aus.
 * Kategorie steckt schon in Name/Stichpunkten; EN-Tags (supermarket/cafe) sind Rauschen.
 */
function shouldShowHomeMapPopupCategory(
  _category: string | null | undefined,
  _name: string | null | undefined,
): boolean {
  return false;
}"""
if old not in t:
    raise SystemExit("old block not found")
out = t.replace(old, new, 1)
tmp = Path(tempfile.gettempdir()) / "HomeMapPlacePopup.tsx.patch"
tmp.write_text(out, encoding="utf-8")
# Atomic replace via rename (avoids ftruncate on locked file)
bak = p.with_suffix(".tsx.bak_popup")
try:
    if bak.exists():
        bak.unlink()
    os.replace(p, bak)
    shutil.copy2(tmp, p)
    bak.unlink(missing_ok=True)
except OSError as e:
    # Fallback: write via shutil.copyfile from tmp over p
    print("rename failed", e)
    shutil.copyfile(tmp, p)
print("popup patched ok", p.stat().st_size)
