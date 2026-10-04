from pathlib import Path

p = Path(r"c:/Users/larsf/Findus 2.0/src/module2/router/call1Dispatch.ts")
t = p.read_text(encoding="utf-8")

old = """  // Wetter-Opener (ohne Deixis auf Ort): immer chat_lane — nie Pitch/Nav/Pack-Sticky.
  try {
    const {
      looksLikeOutfitOrWeatherUtterance,
      weatherAskWantsConversationPlace,
    } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
      weatherAskWantsConversationPlace: (s: string) => boolean;
    };
    const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (
      looksLikeOutfitOrWeatherUtterance(userText) &&
      !weatherAskWantsConversationPlace(userText) &&
      !looksLikePicnicQuery(userText)
    ) {
      return 'chat_lane';
    }
  } catch {
    /* soft */
  }
  // Klarer Gastro-Wunsch (essen gehen / AYCE / Food): Soft-Backup Pitch —
  // Autonomy lässt Call-1 frei wählen; chat_lane ohne Orte = Stille + Meta.
  try {
    const { detectPitchKind } = require('../pitch/parentBrief') as {
      detectPitchKind: (s: string) => string;
    };
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    const { shouldHandoffToPitchModule } = require('../pitch/shouldHandoffPitch') as {
      shouldHandoffToPitchModule: (s: string) => boolean;
    };
    const resolved = resolveCall1Execution(analysis);
    const foodish =
      detectPitchKind(userText) === 'food' || looksLikeAyceQuery(userText);
    if (
      foodish &&
      shouldHandoffToPitchModule(userText) &&
      (resolved === 'chat_lane' || resolved === 'task_fanout')
    ) {
      return 'pitch_module';
    }
  } catch {
    /* soft */
  }
  return resolveCall1Execution(analysis);
}"""

new = """  // Klarer Gastro-Wunsch (essen gehen / AYCE / Food): Soft-Backup Pitch —
  // Autonomy lässt Call-1 frei wählen; chat_lane ohne Orte = Stille + Meta.
  // VOR Wetter-Force — sonst klaut „heute Abend“ den AYCE-Turn.
  try {
    const { detectPitchKind } = require('../pitch/parentBrief') as {
      detectPitchKind: (s: string) => string;
    };
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    const { shouldHandoffToPitchModule } = require('../pitch/shouldHandoffPitch') as {
      shouldHandoffToPitchModule: (s: string) => boolean;
    };
    const resolved = resolveCall1Execution(analysis);
    const foodish =
      detectPitchKind(userText) === 'food' || looksLikeAyceQuery(userText);
    if (
      foodish &&
      shouldHandoffToPitchModule(userText) &&
      (resolved === 'chat_lane' ||
        resolved === 'task_fanout' ||
        analysis.blueprintId === 'weather')
    ) {
      return 'pitch_module';
    }
  } catch {
    /* soft */
  }
  // Wetter-Opener (ohne Deixis auf Ort): immer chat_lane — nie Pitch/Nav/Pack-Sticky.
  try {
    const {
      looksLikeOutfitOrWeatherUtterance,
      weatherAskWantsConversationPlace,
    } = require('../planning/planUtteranceGate') as {
      looksLikeOutfitOrWeatherUtterance: (s: string) => boolean;
      weatherAskWantsConversationPlace: (s: string) => boolean;
    };
    const { looksLikePicnicQuery } = require('../pitch/picnicIntent') as {
      looksLikePicnicQuery: (s: string) => boolean;
    };
    if (
      looksLikeOutfitOrWeatherUtterance(userText) &&
      !weatherAskWantsConversationPlace(userText) &&
      !looksLikePicnicQuery(userText)
    ) {
      return 'chat_lane';
    }
  } catch {
    /* soft */
  }
  return resolveCall1Execution(analysis);
}"""

if old not in t:
    raise SystemExit("block not found")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("call1Dispatch ok")
