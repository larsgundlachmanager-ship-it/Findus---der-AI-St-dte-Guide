from pathlib import Path

p = Path("src/services/navigation/googleMapsNav.ts")
s = p.read_text(encoding="utf-8")
old = """    if (
      opts?.biasLat != null &&
      Number.isFinite(opts.biasLat) &&
      opts?.biasLng != null &&
      Number.isFinite(opts.biasLng)
    ) {
      const d = 0.4;
      u.searchParams.set(
        'viewbox',
        `${opts.biasLng - d},${opts.biasLat + d},${opts.biasLng + d},${opts.biasLat - d}`,
      );
      u.searchParams.set('bounded', '0');
    }"""
new = """    if (
      opts?.biasLat != null &&
      Number.isFinite(opts.biasLat) &&
      opts?.biasLng != null &&
      Number.isFinite(opts.biasLng)
    ) {
      // Straße+Nr.: enger + bounded — sonst springt Nominatim zur gleichen Straße in anderer Stadt.
      const d = opts?.preferStreetAddress === true ? 0.12 : 0.4;
      u.searchParams.set(
        'viewbox',
        `${opts.biasLng - d},${opts.biasLat + d},${opts.biasLng + d},${opts.biasLat - d}`,
      );
      u.searchParams.set(
        'bounded',
        opts?.preferStreetAddress === true ? '1' : '0',
      );
    }"""
# Only patch inside geocodeViaNominatim
idx = s.find("async function geocodeViaNominatim")
if idx < 0:
    raise SystemExit("geocodeViaNominatim missing")
# Find first occurrence after the function start
pos = s.find(old, idx)
if pos < 0:
    # maybe already patched
    if "preferStreetAddress === true ? 0.12" in s[idx : idx + 3000]:
        print("already patched")
        raise SystemExit(0)
    raise SystemExit("pattern not found")
out = s[:pos] + new + s[pos + len(old) :]
tmp = p.with_suffix(".ts.__new")
tmp.write_text(out, encoding="utf-8")
tmp.replace(p)
print("patched googleMapsNav geocodeViaNominatim")
