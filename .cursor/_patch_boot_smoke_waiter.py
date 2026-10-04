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
    p.write_bytes(tmp.read_bytes())
    print("force wrote", p)


p = Path("src/services/boot/interactiveBootGate.smoke.test.ts")
t = p.read_text(encoding="utf-8")
old = """  let ran = false;
  runWhenLaneFree('hydrate', () => {
    ran = true;
  });
  assert(!ran, 'hydrate waiter wartet noch');
  noteInteractiveSettled();
  // Drain ist async (Gap) — nicht synchron flushen
  await sleep(DEFERRED_JOB_GAP_MS + 80);
  assert(ran, 'nach settle + drain läuft hydrate waiter');
  assert(isLaneFree('hydrate'), 'hydrate frei nach settle');
"""
new = """  noteInteractiveSettled();
  assert(
    !isLaneFree('hydrate'),
    'settle allein öffnet hydrate nicht während Interactive Window',
  );

  // Window abgelaufen → Hydrate/Idle dürfen drainen
  resetInteractiveBootGate();
  markSplashInteractive(Date.now() - INTERACTIVE_WINDOW_MS - 10);
  noteInteractiveSettled();
  let ran = false;
  runWhenLaneFree('hydrate', () => {
    ran = true;
  });
  await sleep(DEFERRED_JOB_GAP_MS + 80);
  assert(ran, 'nach Window + settle + drain läuft hydrate waiter');
  assert(isLaneFree('hydrate'), 'hydrate frei nach Window');
"""
if old not in t:
    raise SystemExit("waiter block missing")
force_write(str(p), t.replace(old, new, 1))
print("ok")
