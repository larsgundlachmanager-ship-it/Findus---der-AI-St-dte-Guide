import * as Network from 'expo-network';
import {
  hasTransportLink,
  isDefinitelyOffline,
  isDefinitelyOnline,
  isOfflineAfterProbe,
  shouldProbeInternet,
  type NetworkFlags,
} from './networkFlags';

export {
  hasTransportLink,
  isDefinitelyOffline,
  isDefinitelyOnline,
  isOfflineAfterProbe,
  shouldProbeInternet,
};
export type { NetworkFlags };

const PROBE_TIMEOUT_MS = 2500;
const PROBE_COOLDOWN_MS = 8_000;
const PROBE_URLS = [
  'https://connectivitycheck.gstatic.com/generate_204',
  'https://cloudflare.com/cdn-cgi/trace',
];

let lastProbeAtMs = 0;
let lastProbeOnline = true;

async function probeOne(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    return res.status === 204 || (res.status >= 200 && res.status < 500);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probeInternet(): Promise<boolean> {
  const now = Date.now();
  if (now - lastProbeAtMs < PROBE_COOLDOWN_MS) return lastProbeOnline;
  lastProbeAtMs = now;
  for (const url of PROBE_URLS) {
    if (await probeOne(url)) {
      lastProbeOnline = true;
      return true;
    }
  }
  lastProbeOnline = false;
  return false;
}

/**
 * True nur bei klarem Funk-Tot (Flugmodus / NONE) und toter Probe.
 * UNKNOWN / isConnected=false / OEM-reachable=false = online — sonst stirbt der Chat.
 */
export async function isDeviceOffline(): Promise<boolean> {
  try {
    const net = await Network.getNetworkStateAsync();
    const flags: NetworkFlags = {
      type: String(net.type ?? ''),
      isConnected: net.isConnected,
      isInternetReachable: net.isInternetReachable,
    };
    if (hasTransportLink(flags) || isDefinitelyOnline(flags)) return false;
    if (!isDefinitelyOffline(flags)) return false;
    const probeOnline = await probeInternet();
    return !probeOnline;
  } catch {
    return false;
  }
}
