from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\router\m2IdealRefresh.smoke.test.ts")
text = p.read_text(encoding="utf-8")
marker = "console.log('m2IdealRefresh.smoke.test.ts OK');"
if "package_quick" in text and "follow-up keeps AYCE" in text:
    print("already extended")
    raise SystemExit(0)

addon = """
// —— remaining Ideal pieces ——
{
  const { noteLastLiveInventory, clearLastLiveInventory } = require('../context/shortTermContext') as {
    noteLastLiveInventory: (o: { kind: 'pitch_choice'; query: string }) => void;
    clearLastLiveInventory: () => void;
  };
  clearLastLiveInventory();
  noteLastLiveInventory({
    kind: 'pitch_choice',
    query: 'all you can eat kein Asiatisch Hamburg',
  });
  const follow = buildOpenWorldContract({
    userText: 'kein Asiatisch bitte',
  });
  assert.ok(
    follow.must.some((m) => /ayce|all_you_can_eat/i.test(m)),
    'follow-up keeps AYCE must from live inventory',
  );
  assert.equal(follow.answerSlot, 'venue_pitch', 'follow-up stays dining slot');
  clearLastLiveInventory();
}

{
  const { finalizeCall1Execution } = require('./call1Dispatch') as {
    finalizeCall1Execution: (a: unknown, t: string) => string;
  };
  const base = {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: 'Ok.',
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    chatLane: 'chat',
  };
  assert.equal(
    finalizeCall1Execution(base, 'Pauschalreise Check24 schnell Links'),
    'pitch_module',
    'package_quick -> pitch not reisebuero',
  );
}

{
  const { formatBriefForCall2 } = require('./call1WorkOrchestrator') as {
    formatBriefForCall2: (b: any) => string;
  };
  const { buildCall1TaskBrief } = require('./call1TaskBrief') as {
    buildCall1TaskBrief: (o: any) => any;
  };
  const brief = buildCall1TaskBrief({
    analysis: {
      bridge: 'Wetter check.',
      session: 'new',
      authorIntent: 'Wetter',
      intentSummary: 'Wetter',
      frame: {
        tasks: [{ id: 'w1', worker: 'weather', brief: 'Regen heute' }],
        mustHaves: [],
        referents: [],
        thinkAhead: [],
      },
    },
    userText: 'Regnet es heute Nachmittag?',
  });
  const block = formatBriefForCall2(brief);
  assert.ok(/temp_c|rain_timing|Wetter/i.test(block), 'weather tip in Call2 brief');
}

{
  const { resolveLocalAnchor } = require('../context/shortTermContext') as {
    resolveLocalAnchor: (t: string) => unknown;
  };
  assert.equal(
    resolveLocalAnchor('Ken Eat heute Abend kein Asiatisch'),
    null,
    'AYCE does not soft-fill Goldschaetzchen',
  );
  assert.ok(
    resolveLocalAnchor('Fahr mich zum Goldschaetzchen'),
    'named Goldschaetzchen still resolves',
  );
}

"""

if marker not in text:
    raise SystemExit("marker missing")
text = text.replace(marker, addon + "\n" + marker)
tmp = p.with_suffix(".ts.tmp")
tmp.write_text(text, encoding="utf-8")
tmp.replace(p)
print("m2IdealRefresh extended OK")
