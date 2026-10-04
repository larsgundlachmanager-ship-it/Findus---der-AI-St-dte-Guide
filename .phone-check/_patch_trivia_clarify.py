from pathlib import Path

p = Path("src/services/concierge/celestialSkyQuery.ts")
t = p.read_text(encoding="utf-8")
t2 = t.replace(
    r"|kalt|heiß?t|heisst|nennt)",
    r"|kalt|heißt|heisst|nennt)",
    1,
)
if t2 == t:
    # already fixed or different
    if "|kalt|heißt|heisst|nennt)" in t:
        print("quick already ok")
    else:
        raise SystemExit("quick pattern missing")
else:
    p.write_text(t2, encoding="utf-8")
    print("quick ok")

p2 = Path("src/module2/kernel/turnKernel.ts")
t = p2.read_text(encoding="utf-8")
a = r"/\b(?:wie\s+(?:alt|groß|gross|hoch|breit)|wer|wann)\b/iu.test(t) &&"
b = r"/\b(?:wie\s+(?:alt|groß|gross|hoch|breit|heißt|heisst|nennt)|wer|wann)\b/iu.test(t) &&"
if a not in t:
    raise SystemExit("kernel a missing")
t = t.replace(a, b, 1)
a2 = r"/\b(?:ist|war|sind)\s+(?:(?:der|die|das)\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß\-']/u.test(t)"
b2 = r"/\b(?:ist|war|sind|heißt|heisst|nennt\s+man)\s+(?:(?:der|die|das)\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß\-']/u.test(t)"
if a2 not in t:
    raise SystemExit("kernel a2 missing")
t = t.replace(a2, b2, 1)
a3 = r"/\b(?:ist|war|sind)\s+(?:(?:der|die|das)\s+)?[A-ZÄÖÜ]/u.test(t)"
b3 = r"/\b(?:ist|war|sind|heißt|heisst)\s+(?:(?:der|die|das)\s+)?[A-ZÄÖÜ]/u.test(t)"
if a3 not in t:
    raise SystemExit("kernel a3 missing")
t = t.replace(a3, b3, 1)
p2.write_text(t, encoding="utf-8")
print("kernel ok")

# bridgeGlue scrub
glue = Path("src/module2/chat/bridgeGlue.ts")
gt = glue.read_text(encoding="utf-8")
if "scrubTriviaClarifyBridge" not in gt:
    gt += '''
/** Trivia-Klärfrage („wen meinst du?“) — nie sprechen; Call-2 sucht selbst. */
export function scrubTriviaClarifyBridge(opts: {
  bridge: string;
  userText: string;
}): string | null {
  const bridge = (opts.bridge || '').replace(/\\s+/g, ' ').trim();
  if (!bridge) return null;
  const user = (opts.userText || '').replace(/\\s+/g, ' ').trim();
  let trivia = false;
  try {
    const { isQuickLookupQuery } = require('../../services/concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    trivia = isQuickLookupQuery(user);
  } catch {
    trivia = /\\b(wie\\s+alt|wer\\s+(?:ist|war)|wie\\s+(?:heißt|heisst)|papst|königin|koenigin)\\b/iu.test(
      user,
    );
  }
  if (!trivia) return bridge;
  if (
    /\\b(wen|was|welche[rn]?)\\s+(genau\\s+)?meinst\\b/iu.test(bridge) ||
    /\\bwen\\s+genau\\b/iu.test(bridge) ||
    /\\bwie\\s+alt\\s+ist\\s+wer\\b/iu.test(bridge) ||
    /\\b(finde\\s+(gerne\\s+)?heraus|schau\\s+mal\\s+wer)\\b/iu.test(bridge)
  ) {
    return null;
  }
  return bridge;
}
'''
    glue.write_text(gt, encoding="utf-8")
    print("glue ok")
else:
    print("glue exists")

bus = Path("src/module2/chat/butlerOfferBus.ts")
bt = bus.read_text(encoding="utf-8")
if "scrubTriviaClarifyBridge" not in bt:
    bt = bt.replace(
        "import { looksLikeSlotGluedBridge, sanitizeBridgeText, scrubBridgeCityLeak } from './bridgeGlue';",
        "import { looksLikeSlotGluedBridge, sanitizeBridgeText, scrubBridgeCityLeak, scrubTriviaClarifyBridge } from './bridgeGlue';",
    )
    bt = bt.replace(
        "export { looksLikeSlotGluedBridge, sanitizeBridgeText, scrubBridgeCityLeak };",
        "export { looksLikeSlotGluedBridge, sanitizeBridgeText, scrubBridgeCityLeak, scrubTriviaClarifyBridge };",
    )
    bus.write_text(bt, encoding="utf-8")
    print("bus ok")
else:
    print("bus exists")
print("done")
