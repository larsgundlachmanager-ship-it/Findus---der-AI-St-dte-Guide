from pathlib import Path

# --- butlerOfferBus ---
p = Path("src/module2/chat/butlerOfferBus.ts")
t = p.read_text(encoding="utf-8")
if "scrubMetaPraiseBridge" not in t:
    t = t.replace(
        "scrubTriviaClarifyBridge,\n} from './bridgeGlue';",
        "scrubTriviaClarifyBridge,\n  scrubMetaPraiseBridge,\n} from './bridgeGlue';",
    )
    t = t.replace(
        "scrubTriviaClarifyBridge,\n};",
        "scrubTriviaClarifyBridge,\n  scrubMetaPraiseBridge,\n};",
    )
    tmp = Path("src/module2/chat/_bus.tmp.ts")
    tmp.write_text(t, encoding="utf-8")
    p.unlink(missing_ok=True)
    tmp.rename(p)
print("bus", "scrubMetaPraiseBridge" in p.read_text(encoding="utf-8"))

# --- speakModuleWaitBridge ---
p2 = Path("src/module2/router/runConciergeTurn.ts")
t2 = p2.read_text(encoding="utf-8")
old = """      scrubTriviaClarifyBridge,
      scrubPrematureTriviaFacts,
      scrubAffiliateMonetizationSpeech,
    } = require('../chat/butlerOfferBus') as {
      sanitizeBridgeText: (s: string | null) => string | null;
      scrubBridgeCityLeak: (o: {
        bridge: string;
        userText: string;
        gpsCities?: Array<string | null | undefined> | null;
      }) => string;
      scrubTriviaClarifyBridge: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubPrematureTriviaFacts: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubAffiliateMonetizationSpeech: (s: string | null | undefined) => string;
    };
    // Call-1 Bridge 1:1 — keine Floskel-Notbremse / kein Ersatz-Text
    t = sanitizeBridgeText(t) || '';
    if (t && opts?.userText) {
      t = scrubTriviaClarifyBridge({ bridge: t, userText: opts.userText }) || '';
    }"""
new = """      scrubTriviaClarifyBridge,
      scrubPrematureTriviaFacts,
      scrubAffiliateMonetizationSpeech,
      scrubMetaPraiseBridge,
    } = require('../chat/butlerOfferBus') as {
      sanitizeBridgeText: (s: string | null) => string | null;
      scrubBridgeCityLeak: (o: {
        bridge: string;
        userText: string;
        gpsCities?: Array<string | null | undefined> | null;
      }) => string;
      scrubTriviaClarifyBridge: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubPrematureTriviaFacts: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubAffiliateMonetizationSpeech: (s: string | null | undefined) => string;
      scrubMetaPraiseBridge: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
    };
    // Call-1 Bridge 1:1 — keine Floskel-Notbremse / kein Ersatz-Text
    t = sanitizeBridgeText(t) || '';
    if (t && opts?.userText) {
      t = scrubMetaPraiseBridge({ bridge: t, userText: opts.userText }) || '';
    }
    if (t && opts?.userText) {
      t = scrubTriviaClarifyBridge({ bridge: t, userText: opts.userText }) || '';
    }"""
if old not in t2:
    raise SystemExit("speakModule block missing")
tmp2 = Path("src/module2/router/_turn.tmp.ts")
tmp2.write_text(t2.replace(old, new, 1), encoding="utf-8")
p2.unlink(missing_ok=True)
tmp2.rename(p2)
print("turn scrub ok")

# --- onBridge: skip if instant peek owns Beat-1 ---
t2 = p2.read_text(encoding="utf-8")
old_ob = """        onBridge: (bridge) => {
          if (!bridge?.trim() || bridgeSpokenDuringAnalyze || beat1Locked) return;
          // Mode-Switch-Bridge hat Zusagen+ETA schon — kein zweites Stream-Bridge
          if (earlyNavModeSwitchBridge) return;
          if (!(streamBridgeMaxWords > 0)) return;
          beat1Locked = true;"""
new_ob = """        onBridge: (bridge) => {
          if (!bridge?.trim() || bridgeSpokenDuringAnalyze || beat1Locked) return;
          // Mode-Switch-Bridge hat Zusagen+ETA schon — kein zweites Stream-Bridge
          if (earlyNavModeSwitchBridge) return;
          if (!(streamBridgeMaxWords > 0)) return;
          // Instant-Lead gehört Peek — Stream-Bridge nicht drüberlabern
          try {
            const { peekAnswerLeadBridge } = require('../../services/speech/answerLeadBridge') as {
              peekAnswerLeadBridge: (s: string) => string | null;
            };
            if (peekAnswerLeadBridge(rawUserTextForCall1)) return;
          } catch {
            /* soft */
          }
          beat1Locked = true;"""
if old_ob not in t2:
    raise SystemExit("onBridge block missing")
tmp2.write_text(t2.replace(old_ob, new_ob, 1), encoding="utf-8")
p2.unlink(missing_ok=True)
tmp2.rename(p2)
print("onBridge skip ok")

# --- local arith short-circuit before chat lane ---
t2 = p2.read_text(encoding="utf-8")
marker = "  // --- Call-2 Chat-Lane: nur wenn Call-1 execution=chat_lane ---"
if "tryLocalArithmeticAnswer" not in t2:
    insert = """  // --- Instant-Rechnung lokal: Call-1 Lead + Call-2 nur Zahl ---
  try {
    const { tryLocalArithmeticAnswer } = require('../../services/speech/localInstantAnswer') as {
      tryLocalArithmeticAnswer: (s: string) => {
        lead: string;
        speech: string;
        bullets: string[];
      } | null;
    };
    const localArith = tryLocalArithmeticAnswer(rawUserTextForCall1);
    if (localArith) {
      if (!bridgeSpokenDuringAnalyze && !analysis.bridgeSpokenEarly) {
        const spoken = await speakModuleWaitBridge(localArith.lead, turnId, {
          userText: rawUserTextForCall1,
        });
        if (spoken) {
          bridgeSpokenDuringAnalyze = true;
          analysis = {
            ...analysis,
            bridge: localArith.lead,
            bridgeSpokenEarly: true,
          };
        }
      } else {
        analysis = {
          ...analysis,
          bridge: analysis.bridge || localArith.lead,
        };
      }
      const presented = await presentChatLaneResult({
        turnId,
        result: {
          speech: localArith.speech,
          bullets: localArith.bullets,
          buttons: [],
        },
        bridgeFromRouter: analysis.bridge || localArith.lead,
        userText: rewritten,
      });
      return presented;
    }
  } catch {
    /* soft */
  }

"""
    if marker not in t2:
        raise SystemExit("chat lane marker missing")
    tmp2.write_text(t2.replace(marker, insert + marker, 1), encoding="utf-8")
    p2.unlink(missing_ok=True)
    tmp2.rename(p2)
    print("local arith wired")
else:
    print("local arith already wired")
