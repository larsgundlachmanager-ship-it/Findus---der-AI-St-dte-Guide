export type NetworkFlags = {
  type?: string | null;
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
};

function typeKey(type: string | null | undefined): string {
  return String(type || '').toUpperCase();
}

/** Funk/Kabel liegt — OEM darf Reachable belügen, Empfang ist da. */
export function hasTransportLink(flags: NetworkFlags): boolean {
  if (flags.isConnected === true) return true;
  const t = typeKey(flags.type);
  return (
    t === 'WIFI' ||
    t === 'CELLULAR' ||
    t === 'VPN' ||
    t === 'ETHERNET' ||
    t === 'OTHER' ||
    t === 'WIMAX' ||
    t === 'BLUETOOTH'
  );
}

/**
 * Nur Flugmodus / wirklich kein Interface.
 * `isConnected: false` + UNKNOWN/leer ist auf Android der Normalfall MIT Empfang —
 * das darf nie „offline“ sein, sonst sterben alle Fragen.
 */
export function isDefinitelyOffline(flags: NetworkFlags): boolean {
  if (hasTransportLink(flags)) return false;
  return typeKey(flags.type) === 'NONE';
}

/** System sagt erreichbar. UNKNOWN zählt hier nicht. */
export function isDefinitelyOnline(flags: NetworkFlags): boolean {
  if (isDefinitelyOffline(flags)) return false;
  return flags.isInternetReachable === true;
}

/**
 * Android setzt oft UNKNOWN oder isInternetReachable=false, obwohl Daten gehen.
 * Probe nur zum Bestätigen von Online — nie zum Ausrufen von Offline.
 */
export function shouldProbeInternet(flags: NetworkFlags): boolean {
  if (isDefinitelyOffline(flags) || isDefinitelyOnline(flags)) return false;
  return true;
}

/**
 * Fail-open: nur Flugmodus / wirklich kein Interface = Offline.
 * Probe tot + UNKNOWN + reachable=false ist auf Android der Normalfall mit Empfang.
 */
export function isOfflineAfterProbe(
  flags: NetworkFlags,
  probeOnline: boolean,
): boolean {
  if (probeOnline) return false;
  if (isDefinitelyOnline(flags)) return false;
  if (hasTransportLink(flags)) return false;
  return isDefinitelyOffline(flags);
}
