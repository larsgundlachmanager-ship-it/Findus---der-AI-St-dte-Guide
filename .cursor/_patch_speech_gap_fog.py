# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_gap")
    tmp.write_text(content, encoding="utf-8")
    for i in range(12):
        try:
            if path.exists():
                try:
                    if bak.exists():
                        bak.unlink()
                except OSError:
                    pass
                try:
                    path.replace(bak)
                except OSError:
                    shutil.copy2(path, bak)
                    path.unlink(missing_ok=True)
            os.replace(tmp, path)
            try:
                if bak.exists():
                    bak.unlink()
            except OSError:
                pass
            print(f"OK {path.relative_to(ROOT)}")
            return
        except OSError as e:
            print(f"  retry {i+1} {path.name}: {e}")
            time.sleep(0.4)
    raise SystemExit(f"FAILED {path}")


def patch(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    t = path.read_text(encoding="utf-8")
    if old not in t:
        if new[:50] in t:
            print(f"SKIP already {rel}")
            return
        raise SystemExit(f"MISS {rel}\n---\n{old[:200]}")
    force_write(path, t.replace(old, new, 1))


patch(
    "src/services/homeMap/fogTrackEngine.ts",
    """function navFogActive(): boolean {
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { navActive?: boolean } };
    };
    return useFinnusStore.getState().navActive === true;
  } catch {
    return false;
  }
}""",
    """function navFogActive(): boolean {
  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: {
        getState: () => { navActive?: boolean; navRouteLoading?: boolean };
      };
    };
    const s = useFinnusStore.getState();
    // Auch während Geocode/FOSSGIS — sonst Full-Merge auf dem JS-Thread neben Nav-Start.
    return s.navActive === true || s.navRouteLoading === true;
  } catch {
    return false;
  }
}""",
)

patch(
    "src/module2/router/runConciergeTurn.ts",
    """      // Call-2 SOFORT — nicht auf FOSSGIS/Enrich warten (Live: Lücke nach „alles klar“).
      useFinnusStore.getState().patchNavigation({
        navActive: true,
        navVisible: true,
      });
      navPreStarted = true;""",
    """      // Call-2 SOFORT — nicht auf FOSSGIS/Enrich warten (Live: Lücke nach „alles klar“).
      // Target-Name setzen: sonst denkt presentToUi „neues Ziel“ und awaitet commit nochmal (~30s).
      useFinnusStore.getState().patchNavigation({
        navActive: true,
        navVisible: true,
        navTargetName: destLabel,
      });
      try {
        useFinnusStore.getState().setNavRouteLoading(true);
      } catch {
        /* soft */
      }
      try {
        useFinnusStore.getState().setPendingNavOffer({
          poiId: -1,
          name: destLabel,
          lat: fact.meta.destLat,
          lng: fact.meta.destLng,
          source: 'concierge',
        });
      } catch {
        /* soft */
      }
      navPreStarted = true;""",
)

patch(
    "src/module2/router/runConciergeTurn.ts",
    """  const earlySpeech =
    !forceAutoNav &&
    !navPreStarted &&
    streamedSentenceCount === 0 &&
    (synthesis.spokenChunks[0] || synthesis.fullDraftForUi || '').trim();
  if (earlySpeech) {
    await speakStreamedSentence(
      synthesis.spokenChunks[0]?.trim() ||
        synthesis.fullDraftForUi.split(/(?<=[.!?])\\s+/)[0] ||
        synthesis.fullDraftForUi,
      0,
    );
  }

  const presented = await presentToUi(
    synthesis.fullDraftForUi,
    synthesis.bullets,
    buttons,
    {
      userText: rewritten,
      // Schon gestartet → nicht nochmal; sonst force wie bisher
      forceAutoNav: navPreStarted ? false : forceAutoNav,
      boardEntities: board.entities,
      boardModule1: board.module1,
      startActionDeep,
    },
  );""",
    """  const earlySpeech =
    !forceAutoNav &&
    !navPreStarted &&
    streamedSentenceCount === 0 &&
    (synthesis.spokenChunks[0] || synthesis.fullDraftForUi || '').trim();
  if (earlySpeech) {
    await speakStreamedSentence(
      synthesis.spokenChunks[0]?.trim() ||
        synthesis.fullDraftForUi.split(/(?<=[.!?])\\s+/)[0] ||
        synthesis.fullDraftForUi,
      0,
    );
  }

  // Explizite Nav: Call-2 JETZT — nie hinter presentToUi/Geocode/FOSSGIS (Live: 30s Stille).
  if (
    navPreStarted &&
    streamedSentenceCount === 0 &&
    (synthesis.fullDraftForUi || fact.draftText || '').trim()
  ) {
    const call2 =
      (typeof fact.draftText === 'string' && fact.draftText.trim()) ||
      synthesis.fullDraftForUi.trim();
    await speakStreamedSentence(call2, 0);
  }

  const presented = await presentToUi(
    synthesis.fullDraftForUi,
    synthesis.bullets,
    buttons,
    {
      userText: rewritten,
      // Schon gestartet → nicht nochmal; sonst force wie bisher
      forceAutoNav: navPreStarted ? false : forceAutoNav,
      boardEntities: board.entities,
      boardModule1: board.module1,
      startActionDeep,
      skipConciergeCard: navPreStarted === true,
    },
  );""",
)

patch(
    "src/services/concierge/presentConcierge.ts",
    """  // Laufende Nav: bei neuem expliziten Ziel / Force → Retarget (nicht Fake-Success)
  if (store.navActive) {
    const navActionPeek = navActions[0];
    const offerPeek = useFinnusStore.getState().pendingNavOffer;
    const nextName = (
      navActionPeek?.payload.destName ||
      navActionPeek?.label ||
      offerPeek?.name ||
      ''
    )
      .trim()
      .toLowerCase();
    const curName = (store.navTargetName || '').trim().toLowerCase();
    const sameDest =
      nextName.length >= 2 &&
      curName.length >= 2 &&
      (nextName === curName ||
        nextName.includes(curName) ||
        curName.includes(nextName));
    if (sameDest && (commits || userExplicit || force || uniqueAmenityGo)) {
      return YES;
    }
    if (!commits && !userExplicit && !uniqueAmenityGo && !force) {
      return NO;
    }
    // sonst unten commitHandsFreeNavStart (Retarget)
  }

  const navAction = navActions[0];
  const offer = useFinnusStore.getState().pendingNavOffer;
  const { commitHandsFreeNavStart } = await import(
    '../navigation/handsFreeNav'
  );""",
    """  // Laufende Nav / gerade gestartet: gleiches Ziel → nicht nochmal awaiten
  // (sonst Call-2 hängt an FOSSGIS — Live: ~30s Stille nach „Alles klar“).
  if (store.navActive || store.navRouteLoading) {
    const navActionPeek = navActions[0];
    const offerPeek = useFinnusStore.getState().pendingNavOffer;
    const nextName = (
      navActionPeek?.payload.destName ||
      navActionPeek?.label ||
      offerPeek?.name ||
      store.navTargetName ||
      ''
    )
      .trim()
      .toLowerCase();
    const curName = (store.navTargetName || offerPeek?.name || '')
      .trim()
      .toLowerCase();
    const sameDest =
      !nextName ||
      !curName ||
      nextName === curName ||
      nextName.includes(curName) ||
      curName.includes(nextName);
    if (sameDest && (commits || userExplicit || force || uniqueAmenityGo || store.navRouteLoading)) {
      return YES;
    }
    if (store.navActive && !commits && !userExplicit && !uniqueAmenityGo && !force) {
      return NO;
    }
    // sonst unten Retarget
  }

  const navAction = navActions[0];
  const offer = useFinnusStore.getState().pendingNavOffer;
  const { commitHandsFreeNavStart } = await import(
    '../navigation/handsFreeNav'
  );""",
)

print("all gap patches applied")
