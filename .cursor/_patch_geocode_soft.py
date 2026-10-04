from pathlib import Path

p = Path("src/services/navigation/googleMapsNav.ts")
s = p.read_text(encoding="utf-8")
marker = "    if (!hits.length) return null;\n    let spokenCity: string | null = null;"
# Only in geocodeViaNominatim — first occurrence after that function
idx = s.find("async function geocodeViaNominatim")
if idx < 0:
    raise SystemExit("missing fn")
pos = s.find(marker, idx)
if pos < 0:
    raise SystemExit("marker missing")
# Avoid double-patch
if "bounded street retry" in s[idx : idx + 4000]:
    print("soft retry already present")
    raise SystemExit(0)
insert = """    if (!hits.length && opts?.preferStreetAddress === true) {
      // bounded street retry: einmal ohne Bound, dann nächsten Treffer < 25 km
      try {
        const soft = new URL(u.toString());
        soft.searchParams.set('bounded', '0');
        const softRes = await fetch(soft.toString(), {
          signal: ctrl.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
          },
        });
        if (softRes.ok) {
          const softRows = (await softRes.json()) as Array<{
            lat?: string;
            lon?: string;
            display_name?: string;
          }>;
          for (const hit of softRows ?? []) {
            const lat = hit?.lat != null ? Number(hit.lat) : NaN;
            const lng = hit?.lon != null ? Number(hit.lon) : NaN;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            if (
              opts?.biasLat != null &&
              opts?.biasLng != null &&
              airDistanceMeters(
                { lat: opts.biasLat, lng: opts.biasLng },
                { lat, lng },
              ) >= 25_000
            ) {
              continue;
            }
            hits.push({
              lat,
              lng,
              label: (hit.display_name ?? query).split(',')[0]?.trim() || query,
            });
          }
        }
      } catch {
        /* soft */
      }
    }
    if (!hits.length) return null;
    let spokenCity: string | null = null;"""
# hits is currently const from filter - need to check if hits is let or const
# Looking at code: `const hits = (rows ?? []).map...filter` - so hits is const!
# Soft retry needs to rebuild. Better approach: change const hits to let hits.

old_const = """    const hits = (rows ?? [])
      .map((hit) => {
        const lat = hit?.lat != null ? Number(hit.lat) : NaN;
        const lng = hit?.lon != null ? Number(hit.lon) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          lat,
          lng,
          label: (() => {
            try {
              const { resolveNavDestSpeechName } = require('./navDestSpeechName') as {
                resolveNavDestSpeechName: (o: {
                  query?: string;
                  geoLabel?: string;
                }) => string;
              };
              return resolveNavDestSpeechName({
                query,
                geoLabel: hit.display_name ?? query,
              });
            } catch {
              return (hit.display_name ?? query).split(',')[0]?.trim() || query;
            }
          })(),
        };
      })
      .filter((h): h is GeocodeResult => h != null);
    if (!hits.length) return null;"""

# Find within geocodeViaNominatim only
pos2 = s.find(old_const, idx)
if pos2 < 0:
    raise SystemExit("const hits block not found")

new_block = old_const.replace("const hits =", "let hits =").replace(
    "    if (!hits.length) return null;",
    """    if (!hits.length && opts?.preferStreetAddress === true) {
      // bounded street retry: einmal ohne Bound, dann nächsten Treffer < 25 km
      try {
        const soft = new URL(u.toString());
        soft.searchParams.set('bounded', '0');
        const softRes = await fetch(soft.toString(), {
          signal: ctrl.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'FindusNav/2.0 (tourist walking guide)',
          },
        });
        if (softRes.ok) {
          const softRows = (await softRes.json()) as Array<{
            lat?: string;
            lon?: string;
            display_name?: string;
          }>;
          hits = (softRows ?? [])
            .map((hit) => {
              const lat = hit?.lat != null ? Number(hit.lat) : NaN;
              const lng = hit?.lon != null ? Number(hit.lon) : NaN;
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
              if (
                opts?.biasLat != null &&
                opts?.biasLng != null &&
                airDistanceMeters(
                  { lat: opts.biasLat, lng: opts.biasLng },
                  { lat, lng },
                ) >= 25_000
              ) {
                return null;
              }
              return {
                lat,
                lng,
                label: (hit.display_name ?? query).split(',')[0]?.trim() || query,
              };
            })
            .filter((h): h is GeocodeResult => h != null);
        }
      } catch {
        /* soft */
      }
    }
    if (!hits.length) return null;""",
)

out = s[:pos2] + new_block + s[pos2 + len(old_const) :]
tmp = p.with_suffix(".ts.__new")
tmp.write_text(out, encoding="utf-8")
tmp.replace(p)
print("added soft bounded retry")
