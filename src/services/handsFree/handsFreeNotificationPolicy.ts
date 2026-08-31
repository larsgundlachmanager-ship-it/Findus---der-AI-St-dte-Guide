/**
 * Eine persistente Karte reicht: Standort-FGS schluckt die extra „Sprechen“-Notification.
 */

export function shouldShowHandsFreeSticky(opts: {
  prefOn: boolean;
  locationFgsActive: boolean;
  os: string;
}): boolean {
  if (!opts.prefOn) return false;
  if (opts.os === 'android' && opts.locationFgsActive) return false;
  return true;
}
