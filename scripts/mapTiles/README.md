# Yorro Vector-Basiskarte (Protomaps + Cloudflare R2)

Basiskarte = weltweite Straßen/Gebäude als **Vector-Tiles**.  
Yorro-Orte/Icons/Nav = nur mit **heruntergeladenem Stadt-Pack** (Supabase).

## Env (App)

Eine der drei Quellen reicht (Priorität 1 → 3):

```env
EXPO_PUBLIC_MAP_VECTOR_TILES=1
EXPO_PUBLIC_PROTOMAPS_API_KEY=your-key
EXPO_PUBLIC_PROTOMAPS_THEME=dark
EXPO_PUBLIC_PROTOMAPS_LANG=de
# optional eigene Tiles:
# EXPO_PUBLIC_MAP_TILES_URL=https://tiles.yorro.de/{z}/{x}/{y}.mvt
```

Basiskarte = Protomaps **Style-JSON v5** (`styles/v5/{theme}/{lang}.json`).  
Darüber: Orte, Städte, Route, GPS, Fog als ShapeSources (wie Google Maps).

Legacy GeoJSON-Extract: `EXPO_PUBLIC_MAP_VECTOR_TILES=0`

**Default:** Vector **an**, sobald eine der drei Quellen gesetzt ist.

## R2 Setup (empfohlen, ~2–5 €/Monat)

1. **Cloudflare R2** Bucket anlegen (z. B. `yorro-map-tiles`)
2. **Protomaps Basemap** laden: https://docs.protomaps.com/basemaps/downloads  
   → `world.pmtiles` (oder EU-Extract kleiner) in R2 hochladen
3. **Cloudflare Worker** mit [pmtiles CDN recipe](https://docs.protomaps.com/deploy/cloudflare)  
   → öffentliche URL: `https://tiles.yorro.de/{z}/{x}/{y}.mvt`
4. In `.env`: `EXPO_PUBLIC_MAP_TILES_URL=...`

Check lokal: `npm run map:tiles:check`

Worker-Vorlage: `scripts/mapTiles/cloudflare-worker.mjs` (Wrangler + R2 Binding)

## Kosten

- R2 Storage ~111 GB ≈ **1–2 $/Monat**
- Requests: 10 Mio/Monat free tier
- Kein MapTiler-Abo nötig

## Pack-Regel

| Situation | Basiskarte | Yorro-Orte/Nav |
|-----------|------------|----------------|
| Lissabon ohne Pack | ✓ wischen/zoomen | ✗ |
| 3 Städte auf dem Handy | ✓ | ✓ in diesen Städten |

SSOT: `src/services/homeMap/mapPackGate.ts`
