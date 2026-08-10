---
name: findus-city-cover
description: >-
  Stadt-Cover Soft-Photo: stylizen, zur Stadt einbinden, JPEG auf Supabase
  hochladen. App lädt Cover on-demand per cover_url (nicht in der APK). Trigger
  bei Cover-Bild, Stadt-Cover, pending-covers, city:cover:*.
---

# Findus City Cover Agent

## Auslieferung (wichtig)

- **Keine** Stadt-Cover per `require()` in die App bündeln
- Upload = komprimiertes JPEG (~1280px) → Supabase `staedte/covers/`
- App zeigt Cover erst bei Stadt-Vorschlag/Katalog (`cover_url` + Prefetch naher Städte)
- Lokale `city-*-soft.png` nur für Scripts/Re-Upload

## SSOT Stil

`scripts/cityPack/coverStyle.mjs` → `findus_soft_photo_v1`

- Soft-Foto, nicht stark gemalt
- Gebäude/Bäume/Geografie fix; Menschen/Autos ändern
- Keine Fantasie-Flüsse/Seen; keine Persona-Figuren

## Flow

```bash
npm run city:cover:queue -- --id <slug> --city "<Name>" --image "<path>"
# GenerateImage …
npm run city:cover:apply -- --id <slug> --from <stylized.png> --upload
```

Inseln: ganze Insel sichtbar.
