from pathlib import Path

turn = Path(r"C:\Users\larsf\Findus 2.0\src\module2\router\runConciergeTurn.ts")
text = turn.read_text(encoding="utf-8")

old_pace = """  // Pace: Bridge gestartet → geschätztes Ende für Gap-Cap
  try {
    const {
      notePaceBridgeStarted,
    } = require('../reboot/pipeline/paceTurnSession') as {
      notePaceBridgeStarted: (at?: number) => void;
    };
    notePaceBridgeStarted();
  } catch {
    /* soft */
  }"""

new_pace = """  // Pace: Bridge gestartet → Sprechdauer aus Wörtern (nicht Research-Budget)
  try {
    const {
      notePaceBridgeStarted,
    } = require('../reboot/pipeline/paceTurnSession') as {
      notePaceBridgeStarted: (at?: number, speechMs?: number) => void;
    };
    const words = t.split(/\\s+/).filter(Boolean).length;
    const speechMs = Math.max(1400, Math.min(6000, Math.round(words * 380)));
    notePaceBridgeStarted(Date.now(), speechMs);
  } catch {
    /* soft */
  }"""

if old_pace not in text:
    raise SystemExit("pace block not found")
text = text.replace(old_pace, new_pace, 1)

# Early fanout kick after liveKind
old_bridge = """  const liveKind = detectLiveInventoryKind(rewritten);

  // Manager-Bridge = Beat 1 — sofort in die Queue, Lane läuft parallel.
  // Safety: Early-Flag ohne laufende Session → nochmal Bridge (sonst Stille bis Call 2).
  if (analysis.bridgeSpokenEarly) {
    try {
      const { fusedBridgeCommitted } = require('../speech/fusedTurnSpeech') as {
        fusedBridgeCommitted: () => boolean;
      };
      // Nie clearen nur weil Pump nach Bridge-Satz ended — sonst 2. Bridge + 2. Antwort.
      if (!fusedBridgeCommitted()) {
        analysis = { ...analysis, bridgeSpokenEarly: false };
      }
    } catch {
      /* soft */
    }
  }
  if (!analysis.bridgeSpokenEarly) {
    await speakBridgeFromAnalysis(
      analysis,
      turnId,
      rewritten,
      topicDecision.mode,
    );
  }"""

new_bridge = """  const liveKind = detectLiveInventoryKind(rewritten);

  // Research/Fanout parallel zur Bridge — nicht erst nach Chat/Events-Fallthrough.
  let earlyFanoutPromise: ReturnType<typeof runManagerTaskFanout> | null = null;
  const prefetchFanout =
    !choiceFast &&
    (call1Execution === 'task_fanout' ||
      call1Execution === 'nav_execute' ||
      ((analysis.tasks?.length ?? 0) > 0 &&
        call1Execution !== 'chat_lane' &&
        call1Execution !== 'events_research' &&
        call1Execution !== 'pitch_module' &&
        call1Execution !== 'reisebuero'));
  if (prefetchFanout) {
    earlyFanoutPromise = runManagerTaskFanout({
      analysis,
      userText: rewritten,
      rucksack,
      subject,
      city: short.lastMentionedCity,
      signal,
    });
  }

  // Manager-Bridge = Beat 1 — sofort in die Queue, Lane läuft parallel.
  // Safety: Early-Flag ohne laufende Session → nochmal Bridge (sonst Stille bis Call 2).
  if (analysis.bridgeSpokenEarly) {
    try {
      const { fusedBridgeCommitted } = require('../speech/fusedTurnSpeech') as {
        fusedBridgeCommitted: () => boolean;
      };
      // Nie clearen nur weil Pump nach Bridge-Satz ended — sonst 2. Bridge + 2. Antwort.
      if (!fusedBridgeCommitted()) {
        analysis = { ...analysis, bridgeSpokenEarly: false };
      }
    } catch {
      /* soft */
    }
  }
  if (!analysis.bridgeSpokenEarly) {
    const br = await speakBridgeFromAnalysis(
      analysis,
      turnId,
      rewritten,
      topicDecision.mode,
    );
    if (br.alreadySpoken || br.text) {
      analysis = { ...analysis, bridgeSpokenEarly: true };
      bridgeSpokenDuringAnalyze = true;
    }
  }"""

if old_bridge not in text:
    raise SystemExit("bridge block not found")
text = text.replace(old_bridge, new_bridge, 1)

old_fanout = """  const fanoutPromise = amenityFact
    ? null
    : runManagerTaskFanout({
        analysis,
        userText: rewritten,
        rucksack,
        subject,
        city: short.lastMentionedCity,
        signal,
      });"""

new_fanout = """  const fanoutPromise = amenityFact
    ? null
    : earlyFanoutPromise ??
      runManagerTaskFanout({
        analysis,
        userText: rewritten,
        rucksack,
        subject,
        city: short.lastMentionedCity,
        signal,
      });"""

if old_fanout not in text:
    raise SystemExit("fanout block not found")
text = text.replace(old_fanout, new_fanout, 1)

# Events: research parallel to handoff intro
old_events = """      if (__DEV__) console.log('[events] handoff → researchTodaysEvents', rewritten.slice(0, 80));
      rememberLiveInventoryQuery(rewritten, 'events');
      const eventWait = await speakHandoffIntro({
        analysis,
        userText: rewritten,
        turnId,
      });
      const eventCity =
        analysis.frame?.destCity ||
        analysis.cityScope?.researchCity ||
        resolveEventResearchCity(rewritten);
      const research =
        (await researchTodaysEvents(rewritten, {
          cityHint: eventCity,
          force: true,
          call2Brief: analysis.call2Brief ?? null,
          authorIntent: analysis.authorIntent ?? analysis.call2Brief ?? null,
        })) ||
        buildEmptyEventResearch(eventCity, 'research_unavailable');"""

new_events = """      if (__DEV__) console.log('[events] handoff → researchTodaysEvents', rewritten.slice(0, 80));
      rememberLiveInventoryQuery(rewritten, 'events');
      const eventCity =
        analysis.frame?.destCity ||
        analysis.cityScope?.researchCity ||
        resolveEventResearchCity(rewritten);
      // Bridge + Event-Research parallel — kein Warten auf Intro vor dem Fetch.
      const eventWaitP = speakHandoffIntro({
        analysis,
        userText: rewritten,
        turnId,
      });
      const researchP = researchTodaysEvents(rewritten, {
        cityHint: eventCity,
        force: true,
        call2Brief: analysis.call2Brief ?? null,
        authorIntent: analysis.authorIntent ?? analysis.call2Brief ?? null,
      });
      const [eventWait, researchRaw] = await Promise.all([eventWaitP, researchP]);
      const research =
        researchRaw ||
        buildEmptyEventResearch(eventCity, 'research_unavailable');"""

if old_events not in text:
    raise SystemExit("events block not found")
text = text.replace(old_events, new_events, 1)

tmp = turn.with_suffix(".ts.new")
tmp.write_text(text, encoding="utf-8", newline="\n")
tmp.replace(turn)
print("patched runConciergeTurn", turn.stat().st_size)
for needle in (
    "earlyFanoutPromise",
    "speechMs",
    "researchP",
    "prefetchFanout",
):
    assert needle in text, needle
print("needles ok")
