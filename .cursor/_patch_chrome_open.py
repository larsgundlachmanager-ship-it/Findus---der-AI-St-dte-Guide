from pathlib import Path
import re

# --- useDeferredReady: rAF + timeout only (Map darf Chrome nicht über IM blocken) ---
deferred = Path(r"C:\Users\larsf\Findus 2.0\src\hooks\useDeferredReady.ts")
deferred.write_text(
    '''/**
 * Nach `visible` → true: ein Frame Luft, dann `ready`.
 * NIEMALS auf InteractionManager warten (WebView/Map hält das oft fest) —
 * nur rAF + harte maxWaitMs-Obergrenze.
 */

import { useEffect, useState } from 'react';

export function useDeferredReady(
  visible: boolean,
  opts?: { maxWaitMs?: number; sticky?: boolean },
): boolean {
  const [ready, setReady] = useState(false);
  const maxWaitMs = opts?.maxWaitMs ?? 48;
  const sticky = opts?.sticky === true;

  useEffect(() => {
    if (!visible) {
      if (!sticky) setReady(false);
      return;
    }
    let cancelled = false;
    const mark = () => {
      if (!cancelled) setReady(true);
    };

    // Ein Frame → Chrome sichtbar, dann Inhalt
    const raf = requestAnimationFrame(mark);
    // Harte Obergrenze — Map/TTS dürfen Settings/Timeline nicht blockieren
    const timeout = setTimeout(mark, Math.max(16, maxWaitMs));

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [visible, maxWaitMs, sticky]);

  return ready;
}
''',
    encoding="utf-8",
    newline="\n",
)
print("useDeferredReady ok")

# --- SettingsScreen: draft/accordion nach erstem Frame; keepBodyMounted nur wenn visible ---
settings = Path(r"C:\Users\larsf\Findus 2.0\src\screens\SettingsScreen.tsx")
st = settings.read_text(encoding="utf-8")

old_effect = """  useEffect(() => {
    if (visible) {
      noteUiVisible('settings');
      // Ein Batch: Accordion-Reset ohne Zwischen-Renders vor dem ersten Paint.
      unstable_batchedUpdates(() => {
        setDraft({ ...profile, speechRate: 1 });
        if (initialFocus === 'voice') {
          setOpenSection('character');
          setOpenCharacter('voice');
          setOpenPersonal(null);
          setOpenSetup('voice');
          setOpenGeneral(null);
        } else if (initialFocus === 'mic') {
          setOpenSection('general');
          setOpenGeneral('audio');
          setOpenSetup('audio');
          setOpenPersonal(null);
          setOpenCharacter(null);
        } else {
          setOpenSection(null);
          setOpenSetup(null);
          setOpenPersonal(null);
          setOpenCharacter(null);
          setOpenGeneral(null);
        }
        setOpenDev(null);
        setOpenInternal(null);
        setShowLegal(false);
      });
      recordLastAction('settings_open');
      // Mute/Prefetch nach Paint — nicht im Open-Hot-Path.
      const paint = requestAnimationFrame(() => {
        void hydrateMuteSession().then((s) =>
          setMuteStatusLine(describeMuteSession(s)),
        );
        if (initialFocus === 'voice') {
          prioritizeSettingsSection('character');
        } else if (initialFocus === 'mic') {
          prioritizeSettingsSection('general');
        } else {
          startDefaultSettingsPrefetch();
        }
      });
      return () => {
        cancelAnimationFrame(paint);
        cancelSettingsPrefetch();
      };
    }
    cancelSettingsPrefetch();
    recordLastAction('settings_close');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur visible/focus
  }, [visible, initialFocus]);"""

new_effect = """  useEffect(() => {
    if (visible) {
      noteUiVisible('settings');
      recordLastAction('settings_open');
      // Frame 0 = nur Visibility (Chrome). Draft/Accordion/Mute erst danach.
      let cancelled = false;
      let heavyRaf = 0;
      const paint = requestAnimationFrame(() => {
        if (cancelled) return;
        // Ein Batch nach erstem Chrome-Paint — keine Hydrate-Jank auf Tap.
        unstable_batchedUpdates(() => {
          setDraft({ ...profile, speechRate: 1 });
          if (initialFocus === 'voice') {
            setOpenSection('character');
            setOpenCharacter('voice');
            setOpenPersonal(null);
            setOpenSetup('voice');
            setOpenGeneral(null);
          } else if (initialFocus === 'mic') {
            setOpenSection('general');
            setOpenGeneral('audio');
            setOpenSetup('audio');
            setOpenPersonal(null);
            setOpenCharacter(null);
          } else {
            setOpenSection(null);
            setOpenSetup(null);
            setOpenPersonal(null);
            setOpenCharacter(null);
            setOpenGeneral(null);
          }
          setOpenDev(null);
          setOpenInternal(null);
          setShowLegal(false);
        });
        heavyRaf = requestAnimationFrame(() => {
          if (cancelled) return;
          void hydrateMuteSession().then((s) =>
            setMuteStatusLine(describeMuteSession(s)),
          );
          if (initialFocus === 'voice') {
            prioritizeSettingsSection('character');
          } else if (initialFocus === 'mic') {
            prioritizeSettingsSection('general');
          } else {
            startDefaultSettingsPrefetch();
          }
        });
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(paint);
        if (heavyRaf) cancelAnimationFrame(heavyRaf);
        cancelSettingsPrefetch();
      };
    }
    cancelSettingsPrefetch();
    recordLastAction('settings_close');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur visible/focus
  }, [visible, initialFocus]);"""

if old_effect not in st:
    raise SystemExit("settings visible effect not found")
st = st.replace(old_effect, new_effect, 1)

# keepBodyMounted only while settings visible — closed = nur Accordion-Köpfe im Tree
st2, n = re.subn(
    r"keepBodyMounted=\{!!warmedSections\.(\w+)\}",
    r"keepBodyMounted={visible && !!warmedSections.\1}",
    st,
)
if n < 3:
    raise SystemExit(f"keepBodyMounted replacements expected >=3 got {n}")
st = st2
print(f"keepBodyMounted patched {n}")

tmp = settings.with_suffix(".tsx.new")
tmp.write_text(st, encoding="utf-8", newline="\n")
tmp.replace(settings)
print("SettingsScreen ok")

# --- PlanCalendarModal: hud prefs + cleanup nach Body-Ready / rAF ---
cal = Path(r"C:\Users\larsf\Findus 2.0\src\components\PlanCalendarModal.tsx")
ct = cal.read_text(encoding="utf-8")

old_hud = """  useEffect(() => {
    if (!visible) return;
    void loadHudHintPrefs().then(() => {
      setShowTlChoiceHint(shouldShowTimelineChoiceHint());
      setShowTlGestureHint(shouldShowTimelineGestureHint());
    });
  }, [visible]);"""

new_hud = """  useEffect(() => {
    if (!visible || !timelineBodyReady) return;
    void loadHudHintPrefs().then(() => {
      setShowTlChoiceHint(shouldShowTimelineChoiceHint());
      setShowTlGestureHint(shouldShowTimelineGestureHint());
    });
  }, [visible, timelineBodyReady]);"""

if old_hud not in ct:
    raise SystemExit("hud effect not found")
ct = ct.replace(old_hud, new_hud, 1)

old_cleanup = """  // Duplikate (Visit/Hist/Plan) bei Öffnen und Tagwechsel — erst nach Body-Ready
  useEffect(() => {
    if (!visible || !timelineBodyReady || !dateKey) return;
    try {
      cleanupTimelineDuplicates(dateKey);
      setVisitTick((n) => n + 1);
    } catch {
      /* soft */
    }
  }, [visible, timelineBodyReady, dateKey]);"""

new_cleanup = """  // Duplikate nach Body-Ready — ein Frame später (Chrome zuerst).
  useEffect(() => {
    if (!visible || !timelineBodyReady || !dateKey) return;
    const raf = requestAnimationFrame(() => {
      try {
        cleanupTimelineDuplicates(dateKey);
        setVisitTick((n) => n + 1);
      } catch {
        /* soft */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, timelineBodyReady, dateKey]);"""

if old_cleanup not in ct:
    raise SystemExit("cleanup effect not found")
ct = ct.replace(old_cleanup, new_cleanup, 1)

tmpc = cal.with_suffix(".tsx.new")
tmpc.write_text(ct, encoding="utf-8", newline="\n")
tmpc.replace(cal)
print("PlanCalendarModal ok")

# --- idlePrefetch: etwas früher premounten (100ms) ---
idle = Path(r"C:\Users\larsf\Findus 2.0\src\services\ui\idlePrefetch.ts")
it = idle.read_text(encoding="utf-8")
it2 = it.replace(
    "export const CHROME_PREMOUNT_AFTER_SPLASH_MS = 150;",
    "export const CHROME_PREMOUNT_AFTER_SPLASH_MS = 100;",
    1,
)
if it2 == it:
    print("idle prefetch ms unchanged or already 100")
else:
    tmpi = idle.with_suffix(".ts.new")
    tmpi.write_text(it2, encoding="utf-8", newline="\n")
    tmpi.replace(idle)
    print("idle prefetch 100ms")

# --- uiInstant smoke: update asserts ---
smoke = Path(r"C:\Users\larsf\Findus 2.0\src\services\ui\uiInstant.smoke.test.ts")
sm = smoke.read_text(encoding="utf-8")
# Add asserts for chrome-first hydrate
marker = "  'settings includes unstable_batchedUpdates and \"Ein Batch\"',\n);"
extra = """  'settings includes unstable_batchedUpdates and "Ein Batch"',
);
assert(
  settings.includes('Frame 0 = nur Visibility') ||
    settings.includes('Draft/Accordion/Mute erst danach'),
  'settings defers draft hydrate after first chrome frame',
);
assert(
  settings.includes('keepBodyMounted={visible && !!warmedSections'),
  'settings keepBodyMounted only while visible',
);
assert(
  !deferredReady.includes('InteractionManager') ||
    !readFileSync(join(root, 'src/hooks/useDeferredReady.ts'), 'utf8').includes(
      'InteractionManager',
    ),
  'useDeferredReady does not wait on InteractionManager',
);
"""
# Fix the assert - simpler without deferredReady var
extra = """  'settings includes unstable_batchedUpdates and "Ein Batch"',
);
assert(
  settings.includes('Frame 0 = nur Visibility') ||
    settings.includes('Draft/Accordion/Mute erst danach'),
  'settings defers draft hydrate after first chrome frame',
);
assert(
  settings.includes('keepBodyMounted={visible && !!warmedSections'),
  'settings keepBodyMounted only while visible',
);
{
  const deferredReady = readFileSync(
    join(root, 'src/hooks/useDeferredReady.ts'),
    'utf8',
  );
  assert(
    !deferredReady.includes('InteractionManager'),
    'useDeferredReady does not wait on InteractionManager',
  );
  assert(
    /maxWaitMs\\s*\\?\\?\\s*48/.test(deferredReady) ||
      deferredReady.includes('maxWaitMs ?? 48'),
    'useDeferredReady default ≤48ms',
  );
}
"""

if "settings defers draft hydrate" not in sm:
    if marker not in sm:
        # try alternate quote style
        marker = "  'settings includes unstable_batchedUpdates and \"Ein Batch\"',\n);"
    if "settings includes unstable_batchedUpdates" not in sm:
        raise SystemExit("smoke marker missing")
    sm = sm.replace(
        """assert(
  settings.includes('unstable_batchedUpdates') &&
    settings.includes('Ein Batch'),
  'settings includes unstable_batchedUpdates and "Ein Batch"',
);""",
        """assert(
  settings.includes('unstable_batchedUpdates') &&
    settings.includes('Ein Batch'),
  'settings includes unstable_batchedUpdates and "Ein Batch"',
);
assert(
  settings.includes('Frame 0 = nur Visibility') ||
    settings.includes('Draft/Accordion/Mute erst danach'),
  'settings defers draft hydrate after first chrome frame',
);
assert(
  settings.includes('keepBodyMounted={visible && !!warmedSections'),
  'settings keepBodyMounted only while visible',
);
{
  const deferredReady = readFileSync(
    join(root, 'src/hooks/useDeferredReady.ts'),
    'utf8',
  );
  assert(
    !deferredReady.includes('InteractionManager'),
    'useDeferredReady does not wait on InteractionManager',
  );
}""",
        1,
    )
    tmps = smoke.with_suffix(".ts.new")
    tmps.write_text(sm, encoding="utf-8", newline="\n")
    tmps.replace(smoke)
    print("uiInstant smoke updated")
else:
    print("uiInstant smoke already")

print("done")
