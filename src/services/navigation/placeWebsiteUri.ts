/**
 * Nur echte Orts-Websites — nie Google-Account/Maps/Search/Auth.
 * Places liefert manchmal myaccount.google.com o.ä. als websiteUri.
 */
export function sanitizePlaceWebsiteUri(
  raw: string | null | undefined,
): string | null {
  const url = (raw || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;

  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    path = parsed.pathname.toLowerCase();
  } catch {
    return null;
  }

  // Google Account / Auth / Admin
  if (
    /^(myaccount|accounts|ogs|oauth|support|policies|admin|customers|workspace)\.google\./i.test(
      host,
    ) ||
    host === 'myaccount.google.com' ||
    host.endsWith('.myaccount.google.com')
  ) {
    return null;
  }

  // Google Maps / Search / generische Google-Hosts — keine Ortsseite
  if (
    /^(maps\.google\.|maps\.app\.goo\.gl|goo\.gl)$/i.test(host) ||
    /^google\.[a-z.]+$/i.test(host) ||
    host.endsWith('.google.com') ||
    host.endsWith('.google.de')
  ) {
    // Ausnahme: echte Business-Sites auf Google-Infrastruktur
    if (
      host === 'business.site' ||
      host.endsWith('.business.site') ||
      host === 'sites.google.com'
    ) {
      return url;
    }
    return null;
  }

  if (/google\./i.test(host) && /^\/(maps|search|account|signin|login|url)(\/|$)/i.test(path)) {
    return null;
  }

  // Social ≠ Orts-Website für „Website“-Button
  if (
    /^(facebook\.com|m\.facebook\.com|instagram\.com|fb\.me|linktr\.ee|tiktok\.com)$/i.test(
      host,
    )
  ) {
    return null;
  }

  return url;
}
