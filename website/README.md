# Yorro Landing

Statische Seite — **Hosting 0 €** (GitHub Pages / Cloudflare Pages Free).

Domain-Ziel: **https://yorro.de/** (Custom Domain anbinden, sobald gekauft).

## Lokal

```bash
npx --yes serve website -p 4173
```

## Kostenlos live (GitHub Pages)

1. Im GitHub-Repo: **Settings → Pages → Source: GitHub Actions**
2. Workflow `.github/workflows/deploy-website.yml` einmal manuell starten (**Actions → Deploy website → Run workflow**) oder nach Merge auf `main` pushen (nur wenn `website/` geändert wurde).
3. Vorläufige URL (Repo-Name noch alt): `https://larsgundlachmanager-ship-it.github.io/Findus---der-AI-St-dte-Guide/`
4. Custom Domain **yorro.de**: Pages → Custom domain (DNS CNAME/A auf GitHub Pages).

## Vercel

Vercel-Projekt heißt intern noch `findus-landing`. Ordner `website/` als Root neu ausrollen — sonst bleibt die alte Coming-Soon-Seite live und `partner.html` gibt 404.

```bash
npx vercel --cwd website --prod
```

Prüfen: `/`, `/impressum.html`, `/datenschutz.html`, `/agb.html`, `/partner.html`, `/konto-loeschen.html`.

## AWIN

Publisher-URL: Live-Domain + `partner.html`. Erst deployen, dann bewerben.
