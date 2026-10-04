from pathlib import Path

p = Path("src/module2/kernel/turnKernel.ts")
t = p.read_text(encoding="utf-8")
# Show exact bytes around the regex
idx = t.find("ist|war|sind")
print(repr(t[idx : idx + 80]))

t2 = t.replace(
    r"/\b(?:wie\s+(?:alt|groß|gross|hoch|breit)|wer|wann)\b/iu.test(t)",
    r"/\b(?:wie\s+(?:alt|groß|gross|hoch|breit|heißt|heisst|nennt)|wer|wann)\b/iu.test(t)",
    1,
)
# replace both ist|war|sind occurrences in this function carefully
old_verb = r"(?:ist|war|sind)"
# Only in looksLikeNamedTriviaSubject — replace first two after function start
start = t2.find("export function looksLikeNamedTriviaSubject")
end = t2.find("export function looksLikeFollowUpLite")
chunk = t2[start:end]
chunk2 = chunk.replace(r"(?:ist|war|sind)", r"(?:ist|war|sind|heißt|heisst)", 2)
# first occurrence also needs nennt man for the longer form — do separately
chunk2 = chunk2.replace(
    r"(?:ist|war|sind|heißt|heisst)\s+(?:(?:der|die|das)\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß\-']",
    r"(?:ist|war|sind|heißt|heisst|nennt\s+man)\s+(?:(?:der|die|das)\s+)?[A-ZÄÖÜ][\wÄÖÜäöüß\-']",
    1,
)
if chunk2 == chunk:
    raise SystemExit("no change in chunk")
t2 = t2[:start] + chunk2 + t2[end:]
p.write_text(t2, encoding="utf-8")
print("kernel ok")

# glue + bus
glue = Path("src/module2/chat/bridgeGlue.ts")
gt = glue.read_text(encoding="utf-8")
if "scrubTriviaClarifyBridge" not in gt:
    gt += """
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
    trivia =
      /\\b(wie\\s+alt|wer\\s+(?:ist|war)|wie\\s+(?:heißt|heisst)|papst|königin|koenigin)\\b/iu.test(
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
"""
    glue.write_text(gt, encoding="utf-8")
    print("glue ok")

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
