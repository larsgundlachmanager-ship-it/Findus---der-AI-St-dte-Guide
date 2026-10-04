# -*- coding: utf-8 -*-
"""Nav card / HUD mode / timeline conflict patches."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def write_text(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmpwrite")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def patch_once(rel: str, old: str, new: str, label: str, already: str | None = None) -> None:
    p = ROOT / rel
    t = p.read_text(encoding="utf-8")
    if already and already in t and old not in t:
        print(f"{label}: already")
        return
    if old not in t:
        raise SystemExit(f"{label}: old block not found ({rel})")
    write_text(p, t.replace(old, new, 1))
    print(f"{label}: OK")


# --- presentToUi: skipConciergeCard ---
patch_once(
    "src/module2/pipeline/presentToUi.ts",
    """  /** Keine Auto-Stichpunkte aus Speech (Chat-Lane: Card erst nach hörbarem Audio) */
  skipBulletDerive?: boolean;
};
""",
    """  /** Keine Auto-Stichpunkte aus Speech (Chat-Lane: Card erst nach hörbarem Audio) */
  skipBulletDerive?: boolean;
  /** Nur Speech — kein Spickzettel (Hard-Nav ETA: HUD zeigt Minuten schon) */
  skipConciergeCard?: boolean;
};
""",
    "present_opts_skip_card",
    already="skipConciergeCard?: boolean",
)

patch_once(
    "src/module2/pipeline/presentToUi.ts",
    """      store.setActiveConciergeCard({
        id: cardId,
        createdAtMs: Date.now(),
        speechText: outSpeech,
        visualBullets,
        quickActions: safe,
        cardTitle,
      });
""",
    """      if (opts.skipConciergeCard) {
        try {
          store.setActiveConciergeCard(null);
        } catch {
          /* soft */
        }
      } else {
        store.setActiveConciergeCard({
          id: cardId,
          createdAtMs: Date.now(),
          speechText: outSpeech,
          visualBullets,
          quickActions: safe,
          cardTitle,
        });
      }
""",
    "present_skip_card_body",
    already="if (opts.skipConciergeCard)",
)

# --- hard nav: no card, skip bullet derive, clear card ---
patch_once(
    "src/module2/router/runConciergeTurn.ts",
    """          speechName = resolveNavDestSpeechName({ query: dest, geoLabel: dest });
          if (!earlyBridgeSpoken) {
            const bridgeLine = buildExplicitNavBridgeSpeech(speechName);
            presentToUi(bridgeLine, [], []);
            enqueueSpeech({ kind: 'main', text: bridgeLine, turnId });
            earlyBridgeSpoken = true;
          }
""",
    """          speechName = resolveNavDestSpeechName({ query: dest, geoLabel: dest });
          if (!earlyBridgeSpoken) {
            const bridgeLine = buildExplicitNavBridgeSpeech(speechName);
            presentToUi(bridgeLine, [], [], {
              skipBulletDerive: true,
              skipConciergeCard: true,
              userText: rewritten || input.userText,
            });
            enqueueSpeech({ kind: 'main', text: bridgeLine, turnId });
            earlyBridgeSpoken = true;
          }
""",
    "hardnav_bridge_no_card",
    already="skipConciergeCard: true,\n              userText: rewritten || input.userText,\n            });\n            enqueueSpeech({ kind: 'main', text: bridgeLine",
)

patch_once(
    "src/module2/router/runConciergeTurn.ts",
        """        if (text) {
          presentToUi(text, [], []);
          enqueueSpeech({ kind: 'main', text, turnId });
        } else {
          presentToUi(result.reply, [], []);
        }
        const logic: LogicNodeOutput = {
          spokenDraft: text || result.reply,
          bullets: [],
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: analysis.bridge || null,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'nav_route',
        };
      }
      // Explizite Nav ohne Ziel: trotzdem kein Pitch/M1 — Mobility später.
""",
    """        if (text) {
          presentToUi(text, [], [], {
            skipBulletDerive: true,
            skipConciergeCard: true,
            userText: rewritten || input.userText,
          });
          enqueueSpeech({ kind: 'main', text, turnId });
        }
        // Kein Spickzettel / „5 Minuten“-Card — ETA steht im Nav-HUD.
        try {
          useFinnusStore.getState().setActiveConciergeCard(null);
        } catch {
          /* soft */
        }
        const logic: LogicNodeOutput = {
          spokenDraft: text || result.reply,
          bullets: [],
          buttons: [],
          moneyEur: [],
          warnings: [],
        };
        return {
          turnId,
          tasks: [],
          bridgingText: analysis.bridge || null,
          logic,
          synthesis: synthesizeOutput(logic),
          deepResearchQueued: false,
          jobId: 'nav_route',
        };
      }
      // Explizite Nav ohne Ziel: trotzdem kein Pitch/M1 — Mobility später.
""",
    "hardnav_eta_no_card",
    already="Kein Spickzettel / „5 Minuten“-Card",
)

# --- Timeline: purge stale journeys on hard nav mirror ---
patch_once(
    "src/module2/router/runConciergeTurn.ts",
    """          try {
            const {
              allowLiveNavMirror,
              upsertLiveNavFromStore,
            } = require('../../module2/timeline/syncLiveNavToPlan') as {
              allowLiveNavMirror: () => void;
              upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
            };
            allowLiveNavMirror();
            upsertLiveNavFromStore({ force: true });
          } catch {
            /* soft */
          }
""",
    """          try {
            const {
              allowLiveNavMirror,
              upsertLiveNavFromStore,
              purgeStaleJourneysForHardNav,
            } = require('../../module2/timeline/syncLiveNavToPlan') as {
              allowLiveNavMirror: () => void;
              upsertLiveNavFromStore: (o?: { force?: boolean }) => void;
              purgeStaleJourneysForHardNav: (dest?: string | null) => void;
            };
            allowLiveNavMirror();
            purgeStaleJourneysForHardNav(result.name || dest);
            upsertLiveNavFromStore({ force: true });
          } catch {
            /* soft */
          }
""",
    "hardnav_purge_timeline",
    already="purgeStaleJourneysForHardNav",
)

# --- Header: mode label in ETA meta ---
patch_once(
    "src/components/Header.tsx",
    """    const parts = [
      stopProg,
      landmarkBit,
      distEta,
      arriveClock ? `Ankunft ${arriveClock}` : null,
      s.navPhase === 'in_transit'
        ? 'ÖPNV'
        : s.navPhase === 'walk_to_stop'
          ? 'Zur Haltestelle'
          : null,
      s.navPhase === 'in_transit' && s.remainingStations != null
        ? formatRemainingStations(s.remainingStations)
        : null,
      showRouteHint ? ROUTE_HINT : null,
    ].filter(Boolean);
""",
    """    const modeLabel =
      s.navPhase === 'in_transit' ||
      s.transportMode === 'transit_bus' ||
      s.transportMode === 'transit_train'
        ? 'ÖPNV'
        : s.navPhase === 'walk_to_stop'
          ? 'Zur Haltestelle'
          : s.transportMode === 'bicycle'
            ? 'Fahrrad'
            : s.transportMode === 'jog'
              ? 'Joggen'
              : 'zu Fuß';
    const parts = [
      stopProg,
      landmarkBit,
      distEta,
      modeLabel,
      arriveClock ? `Ankunft ${arriveClock}` : null,
      s.navPhase === 'in_transit' && s.remainingStations != null
        ? formatRemainingStations(s.remainingStations)
        : null,
      showRouteHint ? ROUTE_HINT : null,
    ].filter(Boolean);
""",
    "hud_mode_label",
    already="modeLabel =\n      s.navPhase === 'in_transit'",
)

print("batch2a done")
