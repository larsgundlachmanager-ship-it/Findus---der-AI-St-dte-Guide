from pathlib import Path

p = Path("src/services/navigation/pureStopNav.smoke.test.ts")
t = p.read_text(encoding="utf-8")
old = (
    "const CLEAR_ROUTE_RE =\n"
    "  /\\b((?:beende?|beenden|stopp(?:e|en)?|stop|abbrechen)\\s+(?:bitte\\s+)?(?:die\\s+)?"
    "(?:navigation|navi|route)|(?:navigation|navi|route)\\s+(?:bitte\\s+)?"
    "(?:löschen|loeschen|abbrechen|beenden|aus|stopp|stoppen)|stopp\\s+(?:die\\s+)?"
    "(?:route|navigation)|navi\\s+(?:aus|stopp|stop|beenden)|ziel\\s+(?:löschen|loeschen|vergessen)|clear\\s+route)\\b/iu;"
)
new = (
    "const CLEAR_ROUTE_RE =\n"
    "  /\\b((?:beende?|beenden|stopp(?:e|en)?|stop|abbrechen)\\s+(?:bitte\\s+)?(?:die\\s+)?"
    "(?:navigation|navi|route)|(?:navigation|navi|route)\\s+(?:bitte\\s+)?"
    "(?:löschen|loeschen|abbrechen|beenden|aus|stopp|stoppen)|stopp\\s+(?:die\\s+)?"
    "(?:route|navigation)|navi\\s+(?:aus|stopp|stop|beenden)|ziel\\s+(?:löschen|loeschen|vergessen)|clear\\s+route|"
    "(?:nein[,\\s]+)?stopp(?:e|en)?\\s+(?:die|das|es))\\b/iu;"
)
if old not in t:
    raise SystemExit("CLEAR_ROUTE old not found in pureStop smoke")
# insert asserts before hard includes check
if "assert(isPure('Stoppe die Navigation')" not in t:
    needle = "assert(hard.includes('isPureStopNavigationIntent'), 'hardNav exports pure stop');"
    insert = (
        "assert(isPure('Stoppe die Navigation'), 'stoppe die navigation');\n"
        "assert(isPure('Stoppe die'), 'stoppe die kurz');\n"
        "assert(isPure('Nein, stoppe die'), 'nein stoppe die');\n"
        "assert(hard.includes('stopp(?:e|en)?\\\\s+(?:die|das|es)'), 'hardNav short stoppe die');\n"
        + needle
    )
    if needle not in t:
        raise SystemExit("needle not found")
    t = t.replace(needle, insert, 1)
t = t.replace(old, new, 1)
Path(".cursor/_pureStop_new.ts").write_text(t, encoding="utf-8")
print("pureStop patched")

# onRoute Zwischenstopp mailbox always
z = Path("src/services/navigation/onRouteZwischenstopp.ts")
zt = z.read_text(encoding="utf-8")
if "if (isMailboxAmenityIntent(t)) return true;" not in zt:
    zt = zt.replace(
        "  if (!t) return false;\n  if (ON_ROUTE_HINT_RE.test(t)) return true;",
        "  if (!t) return false;\n  // Briefkasten/Packstation unter aktiver Nav → immer Zwischenstopp-Top-2\n  if (isMailboxAmenityIntent(t)) return true;\n  if (ON_ROUTE_HINT_RE.test(t)) return true;",
        1,
    )
    zt = zt.replace(
        "/\\b(geh(?:en)?|fahr(?:en)?|stopp|halt|vorbeifahren|vorbei)\\b/iu.test(t)",
        "/\\b(geh(?:en)?|fahr(?:en)?|stopp|halt(?:en)?|vorbeifahren|vorbei)\\b/iu.test(t)",
        1,
    )
    Path(".cursor/_onRoute_new.ts").write_text(zt, encoding="utf-8")
    print("onRoute patched")
else:
    print("onRoute already ok")

# celestial altälteste
c = Path("src/services/concierge/celestialSkyQuery.test.ts")
ct = c.read_text(encoding="utf-8")
if "altälteste" not in ct:
    ct = ct.replace(
        "assert(\n  isQuickLookupQuery('Wie alt ist die älteste aktuelle Person?'),\n  'aelteste person quick',\n);",
        "assert(\n  isQuickLookupQuery('Wie alt ist die älteste aktuelle Person?'),\n  'aelteste person quick',\n);\nassert(\n  isQuickLookupQuery('Und wie alt ist die altälteste Person?'),\n  'altälteste person quick',\n);",
        1,
    )
    Path(".cursor/_celestial_test_new.ts").write_text(ct, encoding="utf-8")
    print("celestial test patched")
