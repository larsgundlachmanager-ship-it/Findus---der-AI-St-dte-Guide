from pathlib import Path

p = Path("src/services/navigation/hardNavOverride.ts")
text = p.read_text(encoding="utf-8")
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
if old not in text:
    raise SystemExit("CLEAR_ROUTE_RE block not found")
Path(".cursor/_hardnav_new.ts").write_text(text.replace(old, new, 1), encoding="utf-8")
print("hardnav patched to temp")
