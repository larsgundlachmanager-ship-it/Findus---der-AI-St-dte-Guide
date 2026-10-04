from pathlib import Path
import os

src = Path(r"src/module2/timeline/planLiveEdits.ts")
tmp = Path(r"src/module2/timeline/planLiveEdits.ts.tmp")
text = src.read_text(encoding="utf-8")

needle = 'speech: `„${clean}“ ist im Plan.`'
if needle not in text:
    raise SystemExit(f"needle missing: {needle!r}")

text = text.replace(
    """    const clock = parseClockToMs(lower, dayBase);
    addPlanStop({
      title: clean,
      plannedStartMs: clock,
      transport: t ?? undefined,
      kind: clock != null ? 'stop' : 'wish',
    });
    return {
      handled: true,
      speech: `„${clean}“ ist im Plan.`,
    };
  }

  return { handled: false, speech: '' };
}""",
    """    const clock = parseClockToMs(lower, dayBase);
    // Nur anhängen — kein Full-Rebuild / keine Neu-Sortierung.
    addPlanStop({
      title: clean,
      plannedStartMs: clock,
      transport: t ?? undefined,
      kind: clock != null ? 'stop' : 'wish',
    });
    void syncPlanAddToTourMap(clean);
    return {
      handled: true,
      speech: `„${clean}“ kommt dazu — ohne den Rest neu zu rechnen.`,
    };
  }

  return { handled: false, speech: '' };
}""",
    1,
)

helper = r'''
/** Timeline-Add → Multi-Stop-Tour (gleiche Koordinaten, Append hinten). */
async function syncPlanAddToTourMap(title: string): Promise<void> {
  const name = title.trim();
  if (!name) return;
  try {
    const { getAllPois } = require('../../db/database') as {
      getAllPois: () => Array<{
        id: number;
        name: string;
        lat: number;
        lng: number;
      }>;
    };
    const lower = name.toLowerCase();
    const pois = getAllPois();
    const hit =
      pois.find((p) => p.name.trim().toLowerCase() === lower) ??
      pois.find((p) => {
        const n = p.name.trim().toLowerCase();
        return n.includes(lower) || lower.includes(n);
      });
    let lat = hit?.lat;
    let lng = hit?.lng;
    const poiId = hit?.id ?? -1;
    if (
      !(
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        Number.isFinite(lat)
      )
    ) {
      try {
        const { geocodePlaceNameOsmFirst } = require('../../services/navigation/googleMapsNav') as {
          geocodePlaceNameOsmFirst: (
            q: string,
          ) => Promise<{ lat: number; lng: number; name?: string } | null>;
        };
        const geo = await geocodePlaceNameOsmFirst(name);
        if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
          lat = geo.lat;
          lng = geo.lng;
        }
      } catch {
        /* soft */
      }
    }
    if (
      !(
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        Number.isFinite(lat)
      )
    ) {
      return;
    }
    try {
      const store = useFuturePlanStore.getState();
      const stop = [...store.plan.stops]
        .reverse()
        .find((s) => s.title.trim().toLowerCase() === lower);
      if (stop && (stop.lat == null || stop.lng == null)) {
        store.upsertStopOnDay(store.plan.dayKey, {
          ...stop,
          lat,
          lng,
          kind: stop.kind === 'wish' ? 'stop' : stop.kind,
        });
      }
    } catch {
      /* soft */
    }
    const { appendTourStop } = require('../../services/navigation/multiStopTour') as {
      appendTourStop: (
        s: {
          poiId: number;
          name: string;
          lat: number;
          lng: number;
          done: boolean;
          priority: 'soft' | 'high';
        },
        o?: { startNow?: boolean },
      ) => Promise<unknown>;
    };
    await appendTourStop(
      {
        poiId,
        name,
        lat,
        lng,
        done: false,
        priority: 'soft',
      },
      { startNow: false },
    );
  } catch {
    /* soft */
  }
}

'''

marker = "export function acknowledgeExistingPlanReference("
if "async function syncPlanAddToTourMap" not in text:
    if marker not in text:
        raise SystemExit("marker missing")
    text = text.replace(marker, helper + marker, 1)

tmp.write_text(text, encoding="utf-8")
os.replace(tmp, src)
print("patched", src, "bytes", src.stat().st_size)
