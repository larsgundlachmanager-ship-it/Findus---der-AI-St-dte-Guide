# Map-Perfect Nacht-Report

**Lauf:** `mapPerfectNightBatch.mjs --from danzig`  
**Zeit:** 2026-09-20 23:01 UTC → 2026-09-21 01:33 UTC (~2,5 h Batch; Kiel vorher separat)  
**Exit:** 0 · **Batch-failed-Liste:** leer (Soft-Gate-FAIL trotzdem Upload + done)

## Gesamt

| | |
|---|---|
| Städte Map-Perfect + Upload | **39** (Kiel vorab + 38 im Batch) |
| Soft-Gate FAIL (trotzdem upload) | **bornholm**, **hochheim_am_main** |
| Hard Batch-Fail | keine |
| Basemap-Gap | übersprungen (Overpass unhealthy; `--with-gap` später) |
| Device-QA Kiel | übersprungen (kein `adb` / QA-Gerät) |

## Gate-Status (letzte Messung pro Stadt)

| Stadt | Gate | spots | story | footFail | bulletFail |
|---|---|---:|---:|---:|---:|
| kiel | OK (vorab) | 832 | — | — | — |
| danzig | OK | 1086 | 36 | 74 | 0 |
| bornholm | **FAIL** | 29 | 13 | 3 | 0 |
| pinneberg | OK | 683 | 17 | 7 | 0 |
| tornesch | OK | 436 | 17 | 2 | 0 |
| hamburg | OK | 1014 | 101 | 4 | 0 |
| laboe | OK | 509 | 26 | 1 | 1 |
| prisdorf | OK | 350 | 26 | 5 | 0 |
| flensburg | OK | 766 | 72 | 8 | 0 |
| luebeck | OK | 1084 | 49 | 3 | 1 |
| wangerooge | OK | 177 | 16 | 2 | 0 |
| chorin | OK | 121 | 30 | 5 | 1 |
| rheinsberg | OK | 203 | 80 | 2 | 1 |
| finsterwalde | OK | 261 | 23 | 9 | 0 |
| wandlitz | OK | 308 | 76 | 3 | 6 |
| beelitz | OK | 340 | 85 | 5 | 6 |
| spreewald | OK | 352 | 101 | 0 | 4 |
| bad_saarow | OK | 356 | 97 | 2 | 6 |
| hechingen | OK | 459 | 48 | 11 | 0 |
| korbach | OK | 524 | 16 | 8 | 0 |
| tettnang | OK | 577 | 15 | 11 | 2 |
| oranienburg | OK | 606 | 131 | 4 | 2 |
| brandenburg_havel | OK | 691 | 170 | 5 | 14 |
| werder | OK | 746 | 150 | 3 | 15 |
| bremen | OK | 855 | 34 | 47 | 0 |
| halle_saale | OK | 1006 | 48 | 1 | 0 |
| hochheim_am_main | **FAIL** | 944 | 136 | 34 | 6 |
| dresden | OK | 898 | 268 | 1 | 0 |
| amsterdam | OK | 966 | 98 | 47 | 0 |
| lissabon | OK | 855 | 92 | 6 | 0 |
| stuttgart | OK | 1504 | 257 | 5 | 0 |
| duesseldorf | OK | 1647 | 267 | 1 | 0 |
| frankfurt_am_main | OK | 1718 | 236 | 2 | 0 |
| koeln | OK | 1007 | 284 | 5 | 1 |
| london | OK | 1167 | 70 | 2 | 0 |
| potsdam | OK | 1140 | 250 | 4 | 2 |
| muenchen | OK | 1904 | 250 | 9 | 3 |
| berlin-zentral | OK | 1038 | 133 | 8 | 0 |
| berlin-umland | OK | 10697 | 28 | 3 | 0 |

## Fail-Notizen

1. **bornholm** — Pack neu via `city:auto`, aber Stories größtenteils dünn/Haltestellen (thin=13). Gate soft FAIL; Upload trotzdem. Follow-up: Deep Research + echte Landmarken (Hammershus, Rønne, Gudhjem…).
2. **hochheim_am_main** — footFail=34 / bulletFail=6 → Soft FAIL; Pack hochgeladen. Optional: Footprints-Retry wenn Overpass gesund.
3. **danzig** footFail=74, **bremen**/amsterdam footFail=47 — Gate soft OK (Schwelle), aber Footprints nachziehbar.

## Plattform (Block A, vor Stadt-Welle)

- Idle-Fill nur Story; Fokus-Blau Popup/Nav/Plan
- Basemap-Tap + Dup-Icon-Suppress + ephemeral unmatched
- Bullet-Cleanup (kein Adress-/Mehr-Infos-Fallback; Fotospot)
- Live Öffnung/Speisekarte/Programm fail-closed
- Scripts: `osm-footprints --all-spots`, `popup-bullets`/`forceFill`, `basemap-gap`, `map-perfect-gate`, `mapPerfectCity`, Night-Batch
- `city:auto` → Map-Perfect Pflicht verdrahtet
- Smokes grün

## Rohdaten

- State: `data/staedte/_map_perfect_night_state.json`
- Gate-Zeilen: `data/staedte/_map_perfect_night_gates.txt`
