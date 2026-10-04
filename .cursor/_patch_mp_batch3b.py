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
    bak = path.with_suffix(path.suffix + ".bak_mp")
    tmp.write_text(content, encoding="utf-8")
    for i in range(10):
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
            time.sleep(0.35)
    raise SystemExit(f"FAILED {path}")


def patch(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    t = path.read_text(encoding="utf-8")
    if old not in t:
        print(f"MISS {rel}")
        return
    force_write(path, t.replace(old, new, 1))


# Speech gap: don't await full nav commit before Call-2
OLD_SPEECH = """    try {
      const { commitHandsFreeNavStart } = await import(
        '../../services/navigation/handsFreeNav'
      );
      const started = await commitHandsFreeNavStart(
        {
          poiId: -1,
          name:
            typeof fact.meta.destName === 'string' && fact.meta.destName.trim()
              ? fact.meta.destName
              : 'Ziel',
          lat: fact.meta.destLat,
          lng: fact.meta.destLng,
          userQuery: rewritten,
        },
        { skipClosingGate: true },
      );
      navPreStarted = started.ok === true;
      if (__DEV__) {
        console.log(
          '[runConciergeTurn] pre-start nav',
          started.ok,
          'via=' + (started as { via?: string }).via,
          'name=' + started.name,
        );
      }
      if (started.needsConfirm && started.message) {
        fact = {
          ...fact,
          draftText: started.message,
          meta: {
            ...fact.meta,
            autoStartNav: false,
            forceAutoNav: false,
            needsNavConfirm: true,
          },
        };
      } else if (navPreStarted) {
        useFinnusStore.getState().patchNavigation({
          navActive: true,
          navVisible: true,
        });
        // Explizite Nav: nur Call1+Call2 — kein Pack-/Meta-/Gastro-Gelaber
        try {
          const {
            buildExplicitNavCommitSpeech,
            arriveHmFromEtaMin,
          } = require('../../services/navigation/navStartSpeech') as {
            buildExplicitNavCommitSpeech: (o: {
              destName: string;
              etaMin: number | null;
              mode?: 'foot' | 'bike' | 'drive' | null;
              arriveHm?: string | null;
              bridgeAlreadySpoken?: boolean;
            }) => string;
            arriveHmFromEtaMin: (m: number | null) => string | null;
          };
          const { getCommittedRoutePhrase } = require('../../services/navigation/navSpeechDistance') as {
            getCommittedRoutePhrase: () => { etaMin: number | null } | null;
          };
          const dest =
            typeof fact.meta.destName === 'string' && fact.meta.destName.trim()
              ? fact.meta.destName.trim()
              : 'Ziel';
          const phrase = getCommittedRoutePhrase();
          let etaMin =
            phrase?.etaMin ??
            (typeof fact.meta.etaMin === 'number' && Number.isFinite(fact.meta.etaMin)
              ? Math.max(1, Math.round(fact.meta.etaMin))
              : useFinnusStore.getState().navEtaMin);
          if (etaMin != null && Number.isFinite(etaMin)) {
            etaMin = Math.max(1, Math.round(etaMin));
          } else {
            etaMin = null;
          }
          let mode: 'foot' | 'bike' | 'drive' | null = null;
          try {
            const {
              resolveActiveTravelMode,
            } = require('../../services/navigation/travelModeContext') as {
              resolveActiveTravelMode: () => { mode: string };
            };
            const m = resolveActiveTravelMode().mode;
            mode =
              m === 'bike' || m === 'drive' || m === 'foot'
                ? m
                : fact.meta?.bike === true
                  ? 'bike'
                  : 'foot';
          } catch {
            mode = fact.meta?.bike === true ? 'bike' : 'foot';
          }
          const arriveHm =
            etaMin != null && etaMin > 60 ? arriveHmFromEtaMin(etaMin) : null;
          fact = {
            ...fact,
            draftText: buildExplicitNavCommitSpeech({
              destName: dest,
              etaMin,
              mode,
              arriveHm,
              // Call-1 Nav-Zusage schon gesprochen → Call-2 nur Dauer
              bridgeAlreadySpoken: Boolean(
                bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly,
              ),
            }),
            bullets: [],
            buttons: [],
          };
          try {
            const { markNavOpeningSpoken } = require('../../services/navigation/landmarkNavCoach') as {
              markNavOpeningSpoken: () => void;
            };
            markNavOpeningSpoken();
          } catch {
            /* soft */
          }
        } catch {
          const dest =
            typeof fact.meta.destName === 'string' && fact.meta.destName.trim()
              ? fact.meta.destName
              : 'Ziel';
          fact = {
            ...fact,
            draftText: `Alles klar, ich starte die Navigation zum ${dest}.`,
            bullets: [],
            buttons: [],
          };
        }
      } else if (typeof fact.draftText === 'string' && fact.draftText.trim()) {
        const { stripFakeReservationClaims } = await import(
          '../../services/concierge/zeroFakeActions'
        );
        fact = {
          ...fact,
          draftText: stripFakeReservationClaims(fact.draftText, [], {
            navActuallyStarted: false,
          }),
          meta: { ...fact.meta, autoStartNav: false },
        };
      }
    } catch (err) {
      console.warn('[runConciergeTurn] pre-start nav failed', err);
    }"""

NEW_SPEECH = """    try {
      const { commitHandsFreeNavStart } = await import(
        '../../services/navigation/handsFreeNav'
      );
      const destLabel =
        typeof fact.meta.destName === 'string' && fact.meta.destName.trim()
          ? fact.meta.destName.trim()
          : 'Ziel';
      // Call-2 SOFORT — nicht auf FOSSGIS/Enrich warten (Live: Lücke nach „alles klar“).
      useFinnusStore.getState().patchNavigation({
        navActive: true,
        navVisible: true,
      });
      navPreStarted = true;
      try {
        const {
          buildExplicitNavCommitSpeech,
          arriveHmFromEtaMin,
        } = require('../../services/navigation/navStartSpeech') as {
          buildExplicitNavCommitSpeech: (o: {
            destName: string;
            etaMin: number | null;
            mode?: 'foot' | 'bike' | 'drive' | null;
            arriveHm?: string | null;
            bridgeAlreadySpoken?: boolean;
          }) => string;
          arriveHmFromEtaMin: (m: number | null) => string | null;
        };
        const { getCommittedRoutePhrase } = require('../../services/navigation/navSpeechDistance') as {
          getCommittedRoutePhrase: () => { etaMin: number | null } | null;
        };
        const phrase = getCommittedRoutePhrase();
        let etaMin =
          phrase?.etaMin ??
          (typeof fact.meta.etaMin === 'number' && Number.isFinite(fact.meta.etaMin)
            ? Math.max(1, Math.round(fact.meta.etaMin))
            : useFinnusStore.getState().navEtaMin);
        if (etaMin != null && Number.isFinite(etaMin)) {
          etaMin = Math.max(1, Math.round(etaMin));
        } else {
          etaMin = null;
        }
        let mode: 'foot' | 'bike' | 'drive' | null = null;
        try {
          const {
            resolveActiveTravelMode,
          } = require('../../services/navigation/travelModeContext') as {
            resolveActiveTravelMode: () => { mode: string };
          };
          const m = resolveActiveTravelMode().mode;
          mode =
            m === 'bike' || m === 'drive' || m === 'foot'
              ? m
              : fact.meta?.bike === true
                ? 'bike'
                : 'foot';
        } catch {
          mode = fact.meta?.bike === true ? 'bike' : 'foot';
        }
        const arriveHm =
          etaMin != null && etaMin > 60 ? arriveHmFromEtaMin(etaMin) : null;
        fact = {
          ...fact,
          draftText: buildExplicitNavCommitSpeech({
            destName: destLabel,
            etaMin,
            mode,
            arriveHm,
            bridgeAlreadySpoken: Boolean(
              bridgeSpokenDuringAnalyze || analysis.bridgeSpokenEarly,
            ),
          }),
          bullets: [],
          buttons: [],
        };
        try {
          const { markNavOpeningSpoken } = require('../../services/navigation/landmarkNavCoach') as {
            markNavOpeningSpoken: () => void;
          };
          markNavOpeningSpoken();
        } catch {
          /* soft */
        }
      } catch {
        fact = {
          ...fact,
          draftText: `Alles klar, ich starte die Navigation zum ${destLabel}.`,
          bullets: [],
          buttons: [],
        };
      }
      void commitHandsFreeNavStart(
        {
          poiId: -1,
          name: destLabel,
          lat: fact.meta.destLat,
          lng: fact.meta.destLng,
          userQuery: rewritten,
        },
        { skipClosingGate: true },
      ).then((started) => {
        if (__DEV__) {
          console.log(
            '[runConciergeTurn] pre-start nav',
            started.ok,
            'via=' + (started as { via?: string }).via,
            'name=' + started.name,
          );
        }
      }).catch((err) => {
        console.warn('[runConciergeTurn] pre-start nav failed', err);
      });
    } catch (err) {
      console.warn('[runConciergeTurn] pre-start nav failed', err);
    }"""

patch("src/module2/router/runConciergeTurn.ts", OLD_SPEECH, NEW_SPEECH)

# offline phrase bank — no Schau nach
patch(
    "src/services/tts/offlinePhraseBank.ts",
    """    'Schau nach rechts. Gleich rechts abbiegen.',""",
    """    'Gleich rechts abbiegen.',""",
)
patch(
    "src/services/tts/offlinePhraseBank.ts",
    """    'Schau nach links. Gleich links abbiegen.',""",
    """    'Gleich links abbiegen.',""",
)
patch(
    "src/services/tts/offlinePhraseBank.ts",
    """    'Schau nach vorne. Weiter geradeaus — du bist richtig.',""",
    """    'Weiter geradeaus — du bist richtig.',""",
)
patch(
    "src/services/tts/offlinePhraseBank.ts",
    """  'Schau nach links. Gleich abbiegen.',""",
    """  'Gleich links abbiegen.',""",
)
patch(
    "src/services/tts/offlinePhraseBank.ts",
    """  'Schau nach rechts. Gleich abbiegen.',""",
    """  'Gleich rechts abbiegen.',""",
)

# Clean unused glow imports
patch(
    "src/components/homeMap/NativeHomeMapView.tsx",
    """  HOME_MAP_FOG_TRAIL_GLOW_OPACITY,
  HOME_MAP_FOG_TRAIL_GLOW_WIDTH,
""",
    "",
)

print("batch3b done")
