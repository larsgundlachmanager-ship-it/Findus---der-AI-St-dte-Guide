from pathlib import Path

# --- App.tsx: defer plan timeline hydrate ---
app = Path("App.tsx")
t = app.read_text(encoding="utf-8")
old = """      // Pin-Index erst nach Interactive Window (idlePrefetch hydrate) —
      // unter Splash friert JSON-Parse Pan/Chrome/Mic.
      // Timeline-Persist früh (Leeren/Close brauchen State) — leicht, mit Yield.
      void import('./src/module2/timeline/planPersistence')
        .then(async (m) => {
          await m.hydratePlanTimeline();
          m.startPlanTimelinePersistWatchers();
        })
        .catch(() => undefined);
"""
new = """      // Pin-Index / Timeline-Hydrate erst nach Interactive Window —
      // sonst friert JSON-Parse Mic/Timeline direkt nach Splash.
      void (async () => {
        try {
          await waitUntilInteractiveSettled();
          const m = await import('./src/module2/timeline/planPersistence');
          await m.hydratePlanTimeline();
          m.startPlanTimelinePersistWatchers();
        } catch {
          /* soft */
        }
      })();
"""
if old not in t:
    raise SystemExit("App plan hydrate block not found")
app.write_text(t.replace(old, new, 1), encoding="utf-8")
print("App.tsx plan hydrate deferred")

# --- uiInstant smoke ---
ui = Path("src/services/ui/uiInstant.smoke.test.ts")
ut = ui.read_text(encoding="utf-8")
ut2 = ut.replace(
    """assert(
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
}""",
    """assert(
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
);""",
)
# also assert App does not early-settle
if "noteInteractiveSettled on splash" not in ut2:
    needle = "assert(idle.includes('premountOverlayHosts'), 'Idle Premount');"
    insert = """assert(idle.includes('premountOverlayHosts'), 'Idle Premount');
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
}
"""
    if needle not in ut2:
        raise SystemExit("uiInstant needle missing")
    ut2 = ut2.replace(needle, insert, 1)

if ut2 == ut:
    print("WARN uiInstant unchanged structurally - checking replacements")
ui.write_text(ut2, encoding="utf-8")
print("uiInstant smoke updated")

# --- interactiveBootGate smoke ---
bg = Path("src/services/boot/interactiveBootGate.smoke.test.ts")
bt = bg.read_text(encoding="utf-8")
bt2 = bt.replace(
    """  assert(
    idle.includes('CHROME_PREMOUNT_AFTER_SETTLED_MS') &&
      idle.includes('prefetchOverlayBundles()'),
    'Bundle früh; Chrome-Premount verzögert nach Splash',
  );
  assert(
    /CHROME_PREMOUNT_AFTER_SETTLED_MS\\s*=\\s*(8\\d{2}|9\\d{2}|1\\d{3})\\b/.test(idle),
    'Chrome-Premount ≥800 ms nach Interactive-Settle',
  );""",
    """  assert(
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
  );""",
)
bg.write_text(bt2, encoding="utf-8")
print("boot-gate smoke updated")
