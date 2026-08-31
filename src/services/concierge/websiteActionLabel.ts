/**
 * Labels für OPEN_URL-Actions — konkret statt „Weiter auf der Seite“.
 */

/** „Webseite: Hotel Hanken“ aus Titel/Hostname. */
export function websiteActionLabel(
  title: string | null | undefined,
  url: string,
): string {
  let name = (title ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^https?:\/\//i, '')
    .split(/[|/·•–—]/)[0]
    ?.trim() ?? '';
  if (!name || name.length < 2 || /^www\./i.test(name)) {
    try {
      name = new URL(url).hostname.replace(/^www\./i, '');
    } catch {
      name = 'Link';
    }
  }
  name = name.replace(/\.(html?|php|aspx?)$/i, '').trim();
  if (name.length > 28) name = `${name.slice(0, 25).trim()}…`;
  return `Webseite: ${name}`;
}

/**
 * OPEN_URL nur, wenn Speech einen aktiven Grund nennt
 * (nachschauen / Speisekarte / PDF / Website) oder den Ort beim Namen.
 */
export function speechJustifiesOpenUrl(
  speech: string,
  label: string,
  namesAlignFn: (a: string, b: string) => boolean,
): boolean {
  const s = speech.replace(/\s+/g, ' ');
  const lookUp =
    /\b(webseite|website|seite|speisekarte|menü|menu|pdf|flyer|programm|tickets?|buchung|buchen|link|nachschauen|nachsehen|öffnen|öffne|hier\s+der\s+link|route)\b/iu.test(
      s,
    );
  const bareLabel = label
    .replace(/^🔗\s*/u, '')
    .replace(/^Webseite:\s*/iu, '')
    .replace(/^📄\s*/u, '')
    .replace(/^🎫\s*/u, '')
    .replace(/^📋\s*/u, '')
    .trim();
  if (lookUp) return true;
  if (bareLabel.length >= 3 && namesAlignFn(s, bareLabel)) return true;
  if (
    /pdf|programm|flyer|tickets?|buchung|speisekarte/i.test(label) &&
    /\b(pdf|programm|flyer|tickets?|buchung|buchen|speisekarte|karte)\b/iu.test(s)
  ) {
    return true;
  }
  return false;
}
