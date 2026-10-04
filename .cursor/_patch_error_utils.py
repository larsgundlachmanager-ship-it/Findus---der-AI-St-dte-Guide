from pathlib import Path

p = Path(r"C:\Users\larsf\Findus 2.0\App.tsx")
t = p.read_text(encoding="utf-8")
old = """      EU?.setGlobalHandler?.((error, isFatal) => {
        console.warn(
          '[app] js global error',
          !!isFatal,
          String(error?.message || error).slice(0, 200),
        );
        prev?.(error, isFatal);
      });"""
new = """      EU?.setGlobalHandler?.((error, isFatal) => {
        const msg = String(error?.message || error);
        const stack = String((error as Error)?.stack || '').slice(0, 800);
        console.warn(
          '[app] js global error',
          !!isFatal,
          msg.slice(0, 200),
          stack,
        );
        // Metro/Hermes: kaputter dependencyMap-Eintrag — fatal Destroy = Blackscreen.
        // Nicht den ReactHost killen; Fehler loggen und UI am Leben lassen.
        if (/Requiring unknown module [\"']undefined[\"']/i.test(msg)) {
          console.warn('[app] swallowed unknown-module undefined (keep UI alive)');
          prev?.(error, false);
          return;
        }
        prev?.(error, isFatal);
      });"""
if old not in t:
    raise SystemExit("pattern not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("App.tsx patched")
