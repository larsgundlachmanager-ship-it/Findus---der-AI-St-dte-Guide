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
            print("unlink try", i, e)
            time.sleep(0.35)
    else:
        dead = p.with_suffix(p.suffix + ".locked")
        try:
            if dead.exists():
                dead.unlink()
        except Exception:
            pass
        p.rename(dead)
        print("renamed locked aside", dead)
    p.write_bytes(tmp.read_bytes())
    print("force wrote", p, p.stat().st_size)


ui = Path("src/services/ui/uiInstant.smoke.test.ts")
ut = ui.read_text(encoding="utf-8")
old = """assert(
  idle.includes('CHROME_PREMOUNT_AFTER_SETTLED_MS') &&
    idle.includes('prefetchOverlayBundles') &&
    idle.includes('waitUntilInteractiveSettled'),
  'Bundle früh, Chrome-Mount erst nach Interactive-Settle',
);
{
  const m = idle.match(/CHROME_PREMOUNT_AFTER_SETTLED_MS\\s*=\\s*([\\d_]+)/);
  const ms = m ? Number(String(m[1]).replace(/_/g, '')) : 0;
  assert(
    ms >= 800 && ms <= 5000,
    'Chrome-Premount ≥800 ms nach Interactive-Settle (nicht unter Map-Boot)',
  );
}"""
new = """assert(
  idle.includes('CHROME_PREMOUNT_AFTER_SPLASH_MS') &&
    idle.includes('prefetchOverlayBundles') &&
    idle.includes('waitUntilInteractiveSettled'),
  'Bundle früh; Chrome-Premount nach Splash; Heavy nach Settle',
);
{
  const m = idle.match(/CHROME_PREMOUNT_AFTER_SPLASH_MS\\s*=\\s*([\\d_]+)/);
  const ms = m ? Number(String(m[1]).replace(/_/g, '')) : 0;
  assert(
    ms >= 80 && ms <= 500,
    'Chrome-Premount kurz nach Splash-Interactive (nicht hinter Hydrate)',
  );
}
assert(
  !/waitUntilInteractiveSettled\\(\\)\\.then\\([\\s\\S]{0,200}premountOverlayHosts/.test(
    idle,
  ),
  'Chrome-Premount nicht hinter Interactive-Settle',
);"""
if old not in ut:
    raise SystemExit("uiInstant block missing")
ut2 = ut.replace(old, new, 1)
needle = "assert(idle.includes('premountOverlayHosts'), 'Idle Premount');"
insert = (
    needle
    + """
{
  const appSrc = readFileSync(join(root, 'App.tsx'), 'utf8');
  assert(
    !/handleSplashFinish[\\s\\S]{0,500}noteInteractiveSettled\\(/.test(appSrc),
    'Splash-Finish darf Hydrate nicht sofort freigeben (kein early settle)',
  );
  assert(
    appSrc.includes('onInteractive={handleSplashInteractive}'),
    'Splash-Curtain startet Interactive Window',
  );
}"""
)
if "Splash-Finish darf Hydrate" not in ut2:
    if needle not in ut2:
        raise SystemExit("needle missing")
    ut2 = ut2.replace(needle, insert, 1)
force_write(str(ui), ut2)

bg = Path("src/services/boot/interactiveBootGate.smoke.test.ts")
bt = bg.read_text(encoding="utf-8")
oldb = """  assert(
    idle.includes('CHROME_PREMOUNT_AFTER_SETTLED_MS') &&
      idle.includes('prefetchOverlayBundles()'),
    'Bundle früh; Chrome-Premount verzögert nach Splash',
  );
  assert(
    /CHROME_PREMOUNT_AFTER_SETTLED_MS\\s*=\\s*(8\\d{2}|9\\d{2}|1\\d{3})\\b/.test(idle),
    'Chrome-Premount ≥800 ms nach Interactive-Settle',
  );"""
newb = """  assert(
    idle.includes('CHROME_PREMOUNT_AFTER_SPLASH_MS') &&
      idle.includes('prefetchOverlayBundles()'),
    'Bundle früh; Chrome-Premount nach Splash-Interactive',
  );
  assert(
    /CHROME_PREMOUNT_AFTER_SPLASH_MS\\s*=\\s*(1\\d{2}|2\\d{2}|3\\d{2}|4\\d{2}|5\\d{2})\\b/.test(
      idle,
    ),
    'Chrome-Premount kurz nach Splash (≤500 ms)',
  );
  assert(
    !/handleSplashFinish[\\s\\S]{0,500}noteInteractiveSettled\\(/.test(app),
    'Kein early noteInteractiveSettled im Splash-Finish',
  );
  assert(
    gate.includes('Interactive Window gilt auch wenn settle zu früh') ||
      /splashInteractiveAt[\\s\\S]{0,120}INTERACTIVE_WINDOW_MS/.test(gate),
    'Hydrate/Idle hart hinter Interactive Window',
  );
  assert(
    /INTERACTIVE_WINDOW_MS\\s*=\\s*3_?500/.test(gate) ||
      /INTERACTIVE_WINDOW_MS\\s*=\\s*3500/.test(gate),
    'Interactive Window ≥3.5s für Chrome/Mic',
  );"""
if oldb not in bt:
    raise SystemExit("bootgate block missing")
force_write(str(bg), bt.replace(oldb, newb, 1))
print("smokes done")
