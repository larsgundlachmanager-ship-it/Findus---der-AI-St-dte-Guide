from pathlib import Path
import re

settings = Path(r"C:\Users\larsf\Findus 2.0\src\screens\SettingsScreen.tsx")
st = settings.read_text(encoding="utf-8")

if "chromeReady" not in st:
    st = st.replace(
        """  const [muteStatusLine, setMuteStatusLine] = useState(() =>
    describeMuteSession(),
  );
  const lang = draft.language;""",
        """  const [muteStatusLine, setMuteStatusLine] = useState(() =>
    describeMuteSession(),
  );
  /** false im Open-Frame 0 — Accordion-Bodies erst nach Chrome-Paint. */
  const [chromeReady, setChromeReady] = useState(false);
  const lang = draft.language;""",
        1,
    )
    print("chromeReady state added")
else:
    print("chromeReady state already present")

if "setChromeReady(true)" not in st:
    st = st.replace(
        """    if (visible) {
      noteUiVisible('settings');
      recordLastAction('settings_open');
      // Frame 0 = nur Visibility (Chrome). Draft/Accordion/Mute erst danach.
      let cancelled = false;
      let heavyRaf = 0;
      const paint = requestAnimationFrame(() => {
        if (cancelled) return;
        // Ein Batch nach erstem Chrome-Paint — keine Hydrate-Jank auf Tap.
        unstable_batchedUpdates(() => {""",
        """    if (visible) {
      noteUiVisible('settings');
      recordLastAction('settings_open');
      setChromeReady(false);
      // Frame 0 = nur Visibility (Chrome). Draft/Accordion/Mute erst danach.
      let cancelled = false;
      let heavyRaf = 0;
      const paint = requestAnimationFrame(() => {
        if (cancelled) return;
        setChromeReady(true);
        // Ein Batch nach erstem Chrome-Paint — keine Hydrate-Jank auf Tap.
        unstable_batchedUpdates(() => {""",
        1,
    )
    st = st.replace(
        """    cancelSettingsPrefetch();
    recordLastAction('settings_close');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur visible/focus
  }, [visible, initialFocus]);""",
        """    setChromeReady(false);
    cancelSettingsPrefetch();
    recordLastAction('settings_close');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur visible/focus
  }, [visible, initialFocus]);""",
        1,
    )
    print("chromeReady in effect")
else:
    print("chromeReady effect already present")

st2, n = re.subn(
    r"keepBodyMounted=\{visible && !!warmedSections\.(\w+)\}",
    r"keepBodyMounted={chromeReady && !!warmedSections.\1}",
    st,
)
if n == 0:
    st2, n = re.subn(
        r"keepBodyMounted=\{!!warmedSections\.(\w+)\}",
        r"keepBodyMounted={chromeReady && !!warmedSections.\1}",
        st,
    )
print("keepBodyMounted patched:", n)
st = st2

tmp = settings.with_suffix(".tsx.new")
tmp.write_text(st, encoding="utf-8", newline="\n")
tmp.replace(settings)

smoke = Path(r"C:\Users\larsf\Findus 2.0\src\services\ui\uiInstant.smoke.test.ts")
sm = smoke.read_text(encoding="utf-8")
sm = sm.replace(
    "settings.includes('keepBodyMounted={visible && !!warmedSections')",
    "settings.includes('keepBodyMounted={chromeReady && !!warmedSections')",
)
sm = sm.replace(
    "'settings keepBodyMounted only while visible'",
    "'settings keepBodyMounted only after chromeReady frame'",
)
if "setChromeReady(true)" not in sm:
    marker = "'settings keepBodyMounted only after chromeReady frame',"
    if marker not in sm:
        marker = "'settings keepBodyMounted only while visible',"
    insert = (
        marker
        + """
);
assert(
  settings.includes('setChromeReady(true)') &&
    settings.includes('setChromeReady(false)'),
  'settings chromeReady flips after first paint',"""
    )
    if marker in sm and "settings chromeReady flips after first paint" not in sm:
        sm = sm.replace(marker, insert, 1)
        print("smoke assert added")
    else:
        print("smoke assert skip")

tmps = smoke.with_suffix(".ts.new")
tmps.write_text(sm, encoding="utf-8", newline="\n")
tmps.replace(smoke)
print("done")
