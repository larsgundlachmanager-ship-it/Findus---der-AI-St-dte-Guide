/**
 * Kontextsichere Angebots-Buttons (Speisekarte / Getränke / Tickets / Website).
 * Keine Google-Account-/Login-URLs, keine Doppel-Buttons.
 */

export type OfferKind = 'menu' | 'drinks' | 'ticket' | 'web';

/** Domain-Root / index — nie als Speisekarte verkaufen. */
export function isBareSiteUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    const p = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return p === '/' || /^\/(index|home|start)(\.(html?|php))?$/i.test(p);
  } catch {
    return false;
  }
}

/** Echte Menü-/PDF-URL (Wix `/_files/ugd/`, /karte, Speisekarte) — nicht Homepage. */
export function isMenuAssetUrl(url: string): boolean {
  const raw = url.trim();
  if (!/^https?:\/\//i.test(raw) || isBareSiteUrl(raw)) return false;
  const blob = raw.toLowerCase();
  return (
    /\.pdf(\?|#|$)/i.test(blob) ||
    /\/_files\/ugd\//i.test(blob) ||
    /\/ugd\/[a-z0-9_]+/i.test(blob) ||
    /speisekarte|speise-?karte|menuekarte|menükarte|food[\-_]?menu/i.test(blob) ||
    /tageskarte|mittagskarte|dessertkarte|specialkarte|wochenkarte/i.test(blob) ||
    /\/(menu|menue|speisen|karte|tageskarte|mittagskarte)(\/|\.pdf|$|\?)/i.test(blob)
  );
}

export function isSafeOfferUrl(url: string): boolean {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  if (
    /accounts\.google|myaccount\.google|signin|oauth|login\.|passwort|password|accounts\.youtube/i.test(
      u,
    )
  ) {
    return false;
  }
  // Reine Google-Suche oft → Login/Account — nur echte Venue-URLs
  if (/google\.[^/]+\/search\?/i.test(u)) return false;
  return true;
}

export function detectOfferKind(blob: string): OfferKind {
  const t = blob.toLowerCase();
  if (/\b(bar|kneipe|pub|cocktail|weinbar|getränk|drinks?)\b/i.test(t)) {
    return 'drinks';
  }
  if (
    /\b(museum|galerie|ausstellung|konzert|event|ticket|theater|oper|kino|show|kirche|dom|turm|michel|aussicht|plattform|sehenswürdigkeit|sehenswuerdigkeit)\b/i.test(
      t,
    )
  ) {
    return 'ticket';
  }
  if (
    /\b(restaurant|essen|mittag|abendessen|café|cafe|bistro|pizza|burger|sushi|food|imbiss|trattoria|osteria|pizzeria|gastro)\b/i.test(
      t,
    )
  ) {
    return 'menu';
  }
  return 'web';
}

export function offerLabel(kind: OfferKind): {
  label: string;
  shortLabel: string;
} {
  if (kind === 'menu') return { label: '🍽 Speisekarte', shortLabel: 'Speisekarte' };
  if (kind === 'drinks')
    return { label: '🍸 Getränkekarte', shortLabel: 'Getränke' };
  if (kind === 'ticket') return { label: '🎟 Tickets', shortLabel: 'Tickets' };
  return { label: '🌐 Website', shortLabel: 'Website' };
}

/** URL-Inhalt muss zum Button-Typ passen — sonst null. */
export function urlMatchesOfferKind(url: string, kind: OfferKind): boolean {
  const blob = url.toLowerCase();
  if (kind === 'menu') {
    if (!isMenuAssetUrl(url)) return false;
    if (
      /getränk|getraenk|drinks?|beverage/i.test(blob) &&
      !/speise|food|menu|karte/i.test(blob)
    ) {
      return false;
    }
    if (
      /ticket|eintritt|eventbrite/i.test(blob) &&
      !/speise|menu|karte|food/i.test(blob)
    ) {
      return false;
    }
    return true;
  }
  if (kind === 'drinks') {
    if (
      /speise|food-menu|mittagskarte/i.test(blob) &&
      !/getränk|getraenk|drink|beverage|wein|bier/i.test(blob)
    ) {
      return false;
    }
    return true;
  }
  if (kind === 'ticket') {
    if (
      /speise|getränk|menu\.pdf/i.test(blob) &&
      !/ticket|eintritt|event|museum|book/i.test(blob)
    ) {
      return false;
    }
    return true;
  }
  return true;
}

export function resolveContextualOffer(
  contextBlob: string,
  url: string | null | undefined,
): { kind: OfferKind; label: string; shortLabel: string; url: string } | null {
  if (!url || !isSafeOfferUrl(url)) return null;
  const kind = detectOfferKind(contextBlob);
  if (!urlMatchesOfferKind(url, kind)) {
    // Fallback: wenn URL ok aber Typ mismatch → Website statt falschem Label
    if (kind !== 'web' && isSafeOfferUrl(url)) {
      const web = offerLabel('web');
      return { kind: 'web', ...web, url: url.trim() };
    }
    return null;
  }
  const labels = offerLabel(kind);
  return { kind, ...labels, url: url.trim() };
}
