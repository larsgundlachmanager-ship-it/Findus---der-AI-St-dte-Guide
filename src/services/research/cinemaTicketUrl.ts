/**
 * Show-spezifische Kino-Ticket-URLs (Cinetixx showId) vor Programmseiten.
 * Keine RN-/Gemini-Deps — smoke-tauglich.
 */

export function cinemaTicketDeepLinkScore(url: string): number {
  const u = String(url || '').trim();
  if (!u) return -100;
  let s = 0;
  const low = u.toLowerCase();
  if (/cinetixx|booking\.cinetixx/i.test(low)) s += 55;
  if (/[?&]showid=/i.test(low) || /showid%3d/i.test(low)) s += 45;
  if (/\/ticket\b/i.test(low) || /[?&]l=https/i.test(low)) s += 25;
  if (/reservix|adticket|eventim/i.test(low)) s += 20;
  if (/ticket|buchung|booking|kasse|kaufen/i.test(low)) s += 10;
  if (/\/programm\/?($|\?)/i.test(low) || /\/program\/?($|\?)/i.test(low)) {
    s -= 35;
  }
  return s;
}

export function preferCinemaTicketUrl(
  ...urls: Array<string | null | undefined>
): string | null {
  const list = urls
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u));
  if (!list.length) return null;
  return [...list].sort(
    (a, b) => cinemaTicketDeepLinkScore(b) - cinemaTicketDeepLinkScore(a),
  )[0]!;
}
