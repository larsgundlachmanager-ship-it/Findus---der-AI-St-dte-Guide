from pathlib import Path
ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# --- finalizeCall1Execution soft section + shouldSpeakManagerBridge ---
p = ROOT / "src/module2/router/call1Dispatch.ts"
t = p.read_text(encoding="utf-8")

# Replace soft section from "if (explicit)" through "return baseline;" before shouldSpeakManagerBridge
marker_start = "  // ——— SOFT: nur wenn Call-1 kein execution gesetzt hat ———\n  if (explicit) {"
marker_end = "export function shouldSpeakManagerBridge(analysis: ManagerAnalysis): boolean {"
i0 = t.find(marker_start)
i1 = t.find(marker_end)
if i0 < 0 or i1 < 0:
    raise SystemExit(f"dispatch markers not found {i0} {i1}")

new_soft = r'''  // ——— SOFT: nur wenn Call-1 kein execution gesetzt hat ———
  // Explicit execution = Call-1 SSOT — nur Frame anreichern, nie umbiegen.
  if (explicit) {
    if (isLocalHotelAmenityQuery(userText)) {
      enrichFrameForSoft(analysis, userText, 'local hotel amenities → Stay22 pitch preferred');
    }
    try {
      const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
        looksLikeAyceQuery: (s: string) => boolean;
      };
      if (looksLikeAyceQuery(userText)) {
        enrichFrameForSoft(analysis, userText, 'AYCE dining — pitch form preferred');
      }
    } catch {
      /* soft */
    }
    return baseline;
  }

  // Mini-Airbags nur bei fehlendem Call-1-execution
  if (isLocalHotelAmenityQuery(userText)) {
    return apply('pitch_module', 'local_hotel_soft', false);
  }

  try {
    const { wantsTaxiRide } = require('../../services/mobility/taxiRideIntent') as {
      wantsTaxiRide: (s: string) => boolean;
    };
    const { detectTaxiAirportBlocker } = require('./call1TaskBrief') as {
      detectTaxiAirportBlocker: (s: string) => { blocked: boolean };
    };
    const compound = detectMobilityCompoundKind(userText);
    if (
      wantsTaxiRide(userText) &&
      compound === 'taxi_only' &&
      !detectTaxiAirportBlocker(userText).blocked &&
      !/\b(flieg(?:e|st|t)?|fliegen|flugnummer|boarding)\b/iu.test(userText)
    ) {
      return apply('task_fanout', 'taxi_soft', false);
    }
  } catch {
    /* soft */
  }

  try {
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    const { detectPitchKind } = require('../pitch/parentBrief') as {
      detectPitchKind: (s: string) => string;
    };
    if (looksLikeAyceQuery(userText) || detectPitchKind(userText) === 'food') {
      return apply('pitch_module', 'ayce_food_soft', false);
    }
  } catch {
    /* soft */
  }

  try {
    const { looksLikeDateWindowWhatsOnAsk } = require('../../services/concierge/eventDateWindow') as {
      looksLikeDateWindowWhatsOnAsk: (s: string) => boolean;
    };
    if (looksLikeDateWindowWhatsOnAsk(userText)) {
      return apply('events_research', 'date_window_events_soft', false);
    }
  } catch {
    /* soft */
  }

  return baseline;
}

'''
t = t[:i0] + new_soft + t[i1:]

# Fix shouldSpeakManagerBridge — Call-1 bridge wins also on continue
old_bridge = '''export function shouldSpeakManagerBridge(analysis: ManagerAnalysis): boolean {
  if (analysis.bridgeSpokenEarly) return false;
  if (!analysis.bridge?.trim()) return false;
  if (analysis.session === 'continue' || analysis.session === 'resume') {
    return false;
  }
  return true;
}'''
new_bridge = '''export function shouldSpeakManagerBridge(analysis: ManagerAnalysis): boolean {
  if (analysis.bridgeSpokenEarly) return false;
  // Call-1 Bridge ist SSOT — auch bei continue/resume (SUP/Rad/Filter…).
  return Boolean(analysis.bridge?.trim());
}'''
if old_bridge not in t:
    raise SystemExit("shouldSpeakManagerBridge block not found")
t = t.replace(old_bridge, new_bridge, 1)
p.write_text(t, encoding="utf-8")
print("call1Dispatch.ts OK")
