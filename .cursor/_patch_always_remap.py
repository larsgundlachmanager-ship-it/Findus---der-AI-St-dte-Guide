from pathlib import Path

p = Path("src/services/cityCatalogService.ts")
s = p.read_text(encoding="utf-8")
old = """        let pois = storePois;
        if (pois.length === 0 || !storeMatches) {
          // Disk → Store (ohne Remote), damit der Zähler nicht fremde Städte mischt.
          try {
            const local = await loadCityPackLocalOnly(id);
            if (local) {
              const mapped = mapCityPackToRemote(local);
              const firstWave = mapped.pois.filter((p) => {
                const kind = p.kind ?? 'legacy';
                if (kind === 'approach' || kind === 'sub') return false;
                return !(p.tags_json ?? '').toLowerCase().includes('directory');
              });
              pois = firstWave.length > 0 ? firstWave : mapped.pois;
              useFinnusStore.getState().setPois(pois);
              await replacePoisAndFacts(mapped.pois, mapped.facts);
            } else {
              pois = await getAllPois();
              useFinnusStore.getState().setPois(pois);
            }
          } catch {
            pois = await getAllPois();
            useFinnusStore.getState().setPois(pois);
          }
        }"""

new = """        // Immer Disk → Store im Fast-Path — sonst bleiben fremde Stories im Zähler
        // obwohl active.json schon die richtige Stadt zeigt.
        let pois = storePois;
        try {
          const local = await loadCityPackLocalOnly(id);
          if (local) {
            const mapped = mapCityPackToRemote(local);
            const firstWave = mapped.pois.filter((p) => {
              const kind = p.kind ?? 'legacy';
              if (kind === 'approach' || kind === 'sub') return false;
              return !(p.tags_json ?? '').toLowerCase().includes('directory');
            });
            pois = firstWave.length > 0 ? firstWave : mapped.pois;
            useFinnusStore.getState().setPois(pois);
            await replacePoisAndFacts(mapped.pois, mapped.facts);
          } else if (pois.length === 0 || !storeMatches) {
            pois = await getAllPois();
            useFinnusStore.getState().setPois(pois);
          }
        } catch {
          if (pois.length === 0 || !storeMatches) {
            pois = await getAllPois();
            useFinnusStore.getState().setPois(pois);
          }
        }"""

if old not in s:
    raise SystemExit("block not found")
tmp = Path(".cursor/_cityCatalog_remap.ts")
tmp.write_text(s.replace(old, new), encoding="utf-8")
tmp.replace(p)
print("always remap ok")
