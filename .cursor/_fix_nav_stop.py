from pathlib import Path

# --- hardNav ---
hn = Path("src/services/navigation/hardNavOverride.ts")
ht = hn.read_text(encoding="utf-8")
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
if old not in ht:
    raise SystemExit("hardnav old not found")
Path(".cursor/_hardnav_new.ts").write_text(ht.replace(old, new, 1), encoding="utf-8")

# --- runConciergeTurn stop block ---
rt = Path("src/module2/router/runConciergeTurn.ts")
t = rt.read_text(encoding="utf-8")
start = t.find("    if (stopAsk) {")
end = t.find("      return {\n        turnId,\n        tasks: [],\n        bridgingText: analysis.bridge || text,", start)
if start < 0 or end < 0:
    raise SystemExit(f"stop block markers {start} {end}")
# find end of return block
end2 = t.find("      };\n    }\n  } catch (err) {\n    console.warn('[runConciergeTurn] call1 nav-stop failed'", start)
if end2 < 0:
    raise SystemExit("end2 not found")
replacement = r'''    if (stopAsk) {
      await clearNavigationHard({ silent: true });
      // Immer feste Stop-Ansagen — nie LLM „behalte im Blick“ als Bridge
      const text = 'Alles klar — Navigation ist aus.';
      try {
        const spoken = await speakModuleWaitBridge(text, turnId, {
          force: true,
          userText: rawUserTextForCall1,
        });
        analysis = {
          ...analysis,
          bridge: text,
          bridgeSpokenEarly: Boolean(spoken),
          bridgeComplete: true,
          execution: 'nav_execute',
        };
        if (spoken) bridgeSpokenDuringAnalyze = true;
      } catch {
        analysis = {
          ...analysis,
          bridge: text,
          bridgeComplete: true,
          execution: 'nav_execute',
        };
      }
      try {
        const { presentConciergeResponse } = await import(
          '../../services/concierge/presentConcierge'
        );
        await presentConciergeResponse(
          {
            speechText: '',
            visualBullets: [],
            quickActions: [],
            cardTitle: 'Navigation',
          },
          { userText: rawUserTextForCall1, skipAutoNav: true },
        );
      } catch {
        /* soft */
      }
      const logic: LogicNodeOutput = {
        spokenDraft: '',
        bullets: [],
        buttons: [],
        moneyEur: [],
        warnings: [],
      };
      return {
        turnId,
        tasks: [],
        bridgingText: text,
'''
# keep rest from original return's synthesis onward
rest = t[end2:]
# rest starts at `      };\n    }\n  } catch...` - we need synthesis lines
# Find synthesis after bridgingText in original
synth_idx = t.find("        synthesis: synthesizeOutput(logic),", start)
if synth_idx < 0 or synth_idx > end2:
    raise SystemExit("synth not found in stop block")
tail = t[synth_idx:end2]  # from synthesis to before };
new_block = replacement + tail + "      };\n    }\n"
out = t[:start] + new_block + t[end2 + len("      };\n    }\n") :]
Path(".cursor/_turn_new.ts").write_text(out, encoding="utf-8")
print("turn patched to temp", len(out))
