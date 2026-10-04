from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# LiveStage
p = ROOT / "src/components/liveStage/LiveStage.tsx"
t = p.read_text(encoding="utf-8")
t = t.replace("import type { FindusMood } from '../AudioWave';\n", "")
t = t.replace("  mood: FindusMood;\n", "")
t = t.replace("  isPlayingAudio: boolean;\n", "")
t = t.replace("  mood: _mood,\n", "")
t = t.replace("  isPlayingAudio: _isPlayingAudio,\n", "")
p.write_text(t, encoding="utf-8")
print("LiveStage OK", "FindusMood" in t)

# Settings import + effect
p = ROOT / "src/screens/SettingsScreen.tsx"
t = p.read_text(encoding="utf-8")
if "unstable_batchedUpdates" not in t[:5000]:
    t = t.replace(
        "} from 'react-native';",
        "  unstable_batchedUpdates,\n} from 'react-native';",
        1,
    )
old = """      noteUiVisible('settings');
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
      recordLastAction('settings_open');
      void hydrateMuteSession().then((s) =>
        setMuteStatusLine(describeMuteSession(s)),
      );
      const paint = requestAnimationFrame(() => {
        if (initialFocus === 'voice') {
          prioritizeSettingsSection('character');
        } else if (initialFocus === 'mic') {
          prioritizeSettingsSection('general');
        } else {
          startDefaultSettingsPrefetch();
        }
      });"""
new = """      noteUiVisible('settings');
      // Ein Batch — sonst 10+ Sync-Renders vor dem ersten Paint.
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
      // Mute/Prefetch nach Paint — Shell zuerst.
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
      });"""
if old not in t:
    raise SystemExit("settings block missing")
t = t.replace(old, new)
p.write_text(t, encoding="utf-8")
print("Settings OK")

# Timeline
p = ROOT / "src/components/PlanCalendarModal.tsx"
t = p.read_text(encoding="utf-8")
old = """  // Duplikate (Visit/Hist/Plan) bei Öffnen und Tagwechsel
  useEffect(() => {
    if (!visible || !dateKey) return;
    try {
      cleanupTimelineDuplicates(dateKey);
      setVisitTick((n) => n + 1);
    } catch {
      /* soft */
    }
  }, [visible, dateKey]);"""
new = """  // Duplikate nach erstem Paint — sonst blockiert Sync-Arbeit den Open.
  useEffect(() => {
    if (!visible || !timelineBodyReady || !dateKey) return;
    try {
      cleanupTimelineDuplicates(dateKey);
      setVisitTick((n) => n + 1);
    } catch {
      /* soft */
    }
  }, [visible, timelineBodyReady, dateKey]);"""
if old not in t:
    raise SystemExit("timeline cleanup missing")
t = t.replace(old, new)
old = """    setDateKey(dk);
    try {
      cleanupTimelineDuplicates(dk);
    } catch {
      /* soft */
    }
  }, [visible, planDayKey]);"""
new = """    setDateKey(dk);
    // Schwere Dedup erst nach Body-Ready
  }, [visible, planDayKey]);"""
if old not in t:
    raise SystemExit("timeline day cleanup missing")
t = t.replace(old, new)
old = """  // Tages-Timeline und Plan-Store = derselbe Tag
  useEffect(() => {
    if (!visible) return;
    ensureDay(dateKey);
  }, [visible, dateKey, ensureDay]);"""
new = """  // Tages-Timeline und Plan-Store = derselbe Tag (nach Paint)
  useEffect(() => {
    if (!visible || !timelineBodyReady) return;
    ensureDay(dateKey);
  }, [visible, timelineBodyReady, dateKey, ensureDay]);"""
if old not in t:
    raise SystemExit("ensureDay block missing")
t = t.replace(old, new)
p.write_text(t, encoding="utf-8")
print("Timeline OK")
print("DONE")
