from pathlib import Path
import time

def patch(path: Path, replacements: list[tuple[str, str]]):
    for attempt in range(10):
        try:
            t = path.read_text(encoding="utf-8")
            for old, new in replacements:
                if old not in t:
                    raise SystemExit(f"missing block in {path.name}: {old[:60]!r}")
                t = t.replace(old, new, 1)
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(t, encoding="utf-8")
            tmp.replace(path)
            print("ok", path.name)
            return
        except OSError as e:
            print("retry", path.name, attempt, e)
            time.sleep(1.2)
    raise SystemExit(f"failed {path}")

patch(
    Path(r"c:\Users\larsf\Findus 2.0\src\services\discovery\nominatimCityLocale.ts"),
    [
        (
            "    danzig: { countryCode: 'pl', countryName: 'Poland' },\n"
            "    gdansk: { countryCode: 'pl', countryName: 'Poland' },\n"
            "  };",
            "    danzig: { countryCode: 'pl', countryName: 'Poland' },\n"
            "    gdansk: { countryCode: 'pl', countryName: 'Poland' },\n"
            "    roenne: { countryCode: 'dk', countryName: 'Denmark' },\n"
            "    ronne: { countryCode: 'dk', countryName: 'Denmark' },\n"
            "    bornholm: { countryCode: 'dk', countryName: 'Denmark' },\n"
            "  };",
        ),
        (
            "  amsterdam: 'Amsterdam',\n  berlin_zentral: 'Berlin',",
            "  amsterdam: 'Amsterdam',\n  roenne: 'Rønne',\n  ronne: 'Rønne',\n  berlin_zentral: 'Berlin',",
        ),
        (
            "  if (lat >= 47.2 && lat <= 55.15 && lng >= 5.8 && lng <= 15.1) {\n"
            "    return {\n"
            "      countryCode: 'de',\n"
            "      displayName: alreadyQualified(rawName) ? rawName : `${rawName}, Germany`,\n"
            "    };\n"
            "  }",
            "  // Bornholm / Ost-DK vor DE (sonst falsche DE-Grenze)\n"
            "  if (lat >= 54.85 && lat <= 55.4 && lng >= 14.55 && lng <= 15.3) {\n"
            "    return {\n"
            "      countryCode: 'dk',\n"
            "      displayName: alreadyQualified(rawName)\n"
            "        ? rawName\n"
            "        : `${rawName}, Denmark`,\n"
            "    };\n"
            "  }\n"
            "  if (lat >= 47.2 && lat <= 55.15 && lng >= 5.8 && lng <= 15.1) {\n"
            "    return {\n"
            "      countryCode: 'de',\n"
            "      displayName: alreadyQualified(rawName) ? rawName : `${rawName}, Germany`,\n"
            "    };\n"
            "  }",
        ),
    ],
)

patch(
    Path(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\buildCityOfflineMap.mjs"),
    [
        (
            "  if (id === 'danzig' || id === 'gdansk') {\n"
            "    return {\n"
            "      countrycodes: 'pl',\n"
            "      query: `${pack.name || 'Gdańsk'}, Poland`,\n"
            "    };\n"
            "  }\n"
            "  if (id === 'lissabon' || id === 'lisbon') {",
            "  if (id === 'danzig' || id === 'gdansk') {\n"
            "    return {\n"
            "      countrycodes: 'pl',\n"
            "      query: `${pack.name || 'Gdańsk'}, Poland`,\n"
            "    };\n"
            "  }\n"
            "  if (id === 'roenne' || id === 'ronne' || id === 'bornholm') {\n"
            "    return {\n"
            "      countrycodes: 'dk',\n"
            "      query: `${pack.name || 'Rønne'}, Denmark`,\n"
            "    };\n"
            "  }\n"
            "  if (id === 'lissabon' || id === 'lisbon') {",
        ),
        (
            "    // Poland (Danzig/Gdańsk sonst fälschlich als DE)\n"
            "    if (lat >= 49.0 && lat <= 54.9 && lng >= 14.0 && lng <= 24.2) {\n"
            "      return {\n"
            "        countrycodes: 'pl',\n"
            "        query: `${pack.name || id}, Poland`,\n"
            "      };\n"
            "    }\n"
            "  }\n"
            "  return { countrycodes: 'de', query: `${pack.name || id}, Germany` };",
            "    // Poland (Danzig/Gdańsk sonst fälschlich als DE)\n"
            "    if (lat >= 49.0 && lat <= 54.9 && lng >= 14.0 && lng <= 24.2) {\n"
            "      return {\n"
            "        countrycodes: 'pl',\n"
            "        query: `${pack.name || id}, Poland`,\n"
            "      };\n"
            "    }\n"
            "    // Bornholm / Rønne (sonst DE wegen lng~14.7)\n"
            "    if (lat >= 54.85 && lat <= 55.4 && lng >= 14.55 && lng <= 15.3) {\n"
            "      return {\n"
            "        countrycodes: 'dk',\n"
            "        query: `${pack.name || id}, Denmark`,\n"
            "      };\n"
            "    }\n"
            "  }\n"
            "  return { countrycodes: 'de', query: `${pack.name || id}, Germany` };",
        ),
    ],
)

patch(
    Path(r"c:\Users\larsf\Findus 2.0\scripts\cityPack\snapOsmStoryFootprints.mjs"),
    [
        (
            "function countrycodesForPack(pack) {\n"
            "  const id = String(pack.city_id || '').toLowerCase();\n"
            "  const lat = Number(pack.lat);\n"
            "  const lng = Number(pack.lng);\n"
            "  if (id === 'london') return 'gb';\n"
            "  if (Number.isFinite(lat) && Number.isFinite(lng)) {\n"
            "    if (lat >= 51.2 && lat <= 55.5 && lng >= -10.7 && lng <= -5.9) return 'ie';\n"
            "    if (lat >= 49.8 && lat <= 60.9 && lng >= -8.7 && lng <= 1.85) return 'gb';\n"
            "  }\n"
            "  return 'de';\n"
            "}",
            "function countrycodesForPack(pack) {\n"
            "  const id = String(pack.city_id || '').toLowerCase();\n"
            "  const lat = Number(pack.lat);\n"
            "  const lng = Number(pack.lng);\n"
            "  if (id === 'london') return 'gb';\n"
            "  if (id === 'amsterdam') return 'nl';\n"
            "  if (id === 'danzig' || id === 'gdansk') return 'pl';\n"
            "  if (id === 'roenne' || id === 'ronne' || id === 'bornholm') return 'dk';\n"
            "  if (Number.isFinite(lat) && Number.isFinite(lng)) {\n"
            "    if (lat >= 51.2 && lat <= 55.5 && lng >= -10.7 && lng <= -5.9) return 'ie';\n"
            "    if (lat >= 49.8 && lat <= 60.9 && lng >= -8.7 && lng <= 1.85) return 'gb';\n"
            "    if (lat >= 54.85 && lat <= 55.4 && lng >= 14.55 && lng <= 15.3) return 'dk';\n"
            "    if (lat >= 50.5 && lat <= 53.7 && lng >= 3.2 && lng <= 7.4) return 'nl';\n"
            "    if (lat >= 49.0 && lat <= 54.9 && lng >= 14.0 && lng <= 24.2) return 'pl';\n"
            "  }\n"
            "  return 'de';\n"
            "}",
        ),
    ],
)
