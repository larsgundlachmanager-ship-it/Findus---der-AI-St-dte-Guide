from pathlib import Path

p = Path("src/module2/router/runConciergeTurn.ts")
t = p.read_text(encoding="utf-8")
start = t.find("  if (handoff === 'm1_poi_offer') {")
if start < 0:
    raise SystemExit("m1 start missing")
end = t.find("\n  // Say–Do: Amenity-Nav", start)
if end < 0:
    end = t.find("\n  // Say-Do: Amenity-Nav", start)
if end < 0:
    end = t.find("\n  // Say", start)
if end < 0:
    raise SystemExit("m1 end missing: " + repr(t[start:start+200]))

new_block = """  if (handoff === 'm1_poi_offer') {
    const coords = anchorCoords(rucksack);
    const offer = await buildM1PoiOffer({
      userText: rewritten,
      lat: coords.lat,
      lng: coords.lng,
      headingDeg: null,
    });
    if (!(offer.speech || '').trim() && !offer.poiId) {
      const chatResult = await runChatLane({
        userText: rewritten,
        turnId,
        bridgeFromRouter: analysis.bridge,
        blueprintId: analysis.blueprintId,
        nearestBlueprint: analysis.nearestBlueprint,
        blueprintStage: analysis.blueprintStage,
        needsResearch: 'deep',
        personaVariant: analysis.personaVariant,
        cityHint: turnCityHint,
        cityKey: turnCityKey,
        openIntentsSummary: summarizeOpenIntents(),
        signal,
        fromPlanContext: false,
        topicScope: analysis.topicScope ?? {
          mode: 'new',
          turnsForCall2: 0,
          inheritLiveInventory: false,
        },
        execution: 'chat_lane',
        chatLane: 'chat',
      });
      return await presentChatLaneResult({
        turnId,
        result: chatResult,
        bridgeFromRouter: analysis.bridgeSpokenEarly ? null : analysis.bridge,
        userText: rewritten,
      });
    }
    const { text: bridge } = await speakBridgeFromAnalysis(
      analysis,
      turnId,
      rewritten,
      topicDecision.mode,
    );
    presentToUi(offer.speech, offer.placeName ? [offer.placeName] : [], [], {
      userText: rewritten,
    });
    enqueueSpeech({ kind: 'main', text: offer.speech, turnId });
    if (!offer.poiId) {
      void import('../packEnrich/queuePackEnrich')
        .then((m) =>
          m.queuePackEnrichFromMiss({
            userText: rewritten,
            lat: coords.lat,
            lng: coords.lng,
          }),
        )
        .catch(() => undefined);
    }
    const logic: LogicNodeOutput = {
      spokenDraft: offer.speech,
      bullets: offer.placeName ? [offer.placeName] : [],
      buttons: [],
      moneyEur: [],
      warnings: [],
    };
    return {
      turnId,
      tasks: [],
      bridgingText: bridge,
      logic,
      synthesis: synthesizeOutput(logic),
      deepResearchQueued: false,
      jobId: 'poi_identify',
    };
  }
"""

t = t[:start] + new_block + t[end:]
tmp = Path("src/module2/router/_m1c.tmp.ts")
tmp.write_text(t, encoding="utf-8")
p.unlink(missing_ok=True)
tmp.rename(p)
print("m1 ok")
