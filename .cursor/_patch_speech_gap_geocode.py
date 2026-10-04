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


path = ROOT / "src/services/concierge/presentConcierge.ts"
t = path.read_text(encoding="utf-8")
old = """      } else if (named || userExplicit) {
        // Name ohne lokale Coords → commitHandsFreeNavStart resolvt Pack/Geocode
        const { commitHandsFreeNavStart } = await import(
          '../navigation/handsFreeNav'
        );
        const started = await commitHandsFreeNavStart(
          {
            poiId: null,
            name: named || userText,
            lat: null,
            lng: null,
          },
          { skipClosingGate: true },
        );
        if (started.ok) {
          const speechHasEta =
            /\\b\\d{1,3}\\s*(?:min(?:ute)?n?)\\b/iu.test(response.speechText || '');
          if (speechHasEta) {
            try {
              const { markNavOpeningSpoken } = require('../navigation/landmarkNavCoach') as {
                markNavOpeningSpoken: () => void;
              };
              markNavOpeningSpoken();
            } catch {
              /* soft */
            }
          }
          if (__DEV__) {
            console.log(
              `[concierge] auto-start nav (explicit resolve) via=${started.via} name=${started.name}`,
            );
          }
          return YES;
        }
        if (started.needsConfirm) {
          return { started: false, confirmSpeech: started.message };
        }
        return NO;"""

new = """      } else if (named || userExplicit) {
        // Name ohne Coords: Geocode/FOSSGIS parallel — Speech nicht blockieren (Live: 30s).
        const { commitHandsFreeNavStart } = await import(
          '../navigation/handsFreeNav'
        );
        try {
          useFinnusStore.getState().setNavRouteLoading(true);
          useFinnusStore.getState().patchNavigation({
            navVisible: true,
            navTargetName: named || userText,
          });
        } catch {
          /* soft */
        }
        void commitHandsFreeNavStart(
          {
            poiId: null,
            name: named || userText,
            lat: null,
            lng: null,
          },
          { skipClosingGate: true },
        ).then((started) => {
          if (__DEV__) {
            console.log(
              `[concierge] auto-start nav (explicit resolve) ok=${started.ok} via=${(started as { via?: string }).via}`,
            );
          }
        }).catch(() => {});
        return YES;"""

if old not in t:
    raise SystemExit("MISS name-without-coords block")
force_write(path, t.replace(old, new, 1))
print("done")
