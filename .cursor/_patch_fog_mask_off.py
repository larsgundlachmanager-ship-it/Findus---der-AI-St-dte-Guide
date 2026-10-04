from pathlib import Path
import os
import tempfile
import time


def force_write(path: str, content: str) -> None:
    p = Path(path)
    tmp = Path(tempfile.gettempdir()) / (p.name + ".patched")
    tmp.write_text(content, encoding="utf-8")
    for i in range(10):
        try:
            if p.exists():
                os.chmod(p, 0o666)
                p.unlink()
            break
        except Exception as e:
            print("unlink", i, e)
            time.sleep(0.3)
    else:
        dead = p.with_suffix(p.suffix + ".locked")
        try:
            if dead.exists():
                dead.unlink()
        except Exception:
            pass
        p.rename(dead)
    p.write_bytes(tmp.read_bytes())
    print("wrote", p)


p = Path("src/services/homeMap/homeMapStyle.ts")
t = p.read_text(encoding="utf-8")
old = "export const HOME_MAP_FOG_MASK_ENABLED = true;"
new = "export const HOME_MAP_FOG_MASK_ENABLED = false;"
if old not in t:
    raise SystemExit("flag not found")
t2 = t.replace(old, new, 1)
t2 = t2.replace(
    "Viewport-Schleier über Unerkundetem (Fog of War).\n * Reveal (Eis-Cyan-Pfad) bleibt zusätzlich an.",
    "Viewport-Schleier über Unerkundetem — AUS.\n"
    " * Eingefrorene Boot-Bounds wirkten als dunkles, mitgedrehtes Viereck.\n"
    " * Reveal (Eis-Cyan-Pfad) bleibt an.",
)
t2 = t2.replace(
    "kein Viewport-Schleier / kein dunkler Kasten beim Rauszoomen",
    "kein Viewport-Schleier / kein dunkler Kasten beim Drehen/Rauszoomen",
)
force_write(str(p), t2)
print("mask off")
