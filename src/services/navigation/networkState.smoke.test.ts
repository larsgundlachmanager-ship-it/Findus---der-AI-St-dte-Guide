/**
 * Network flags: UNKNOWN / reachable=false is not instantly offline.
 * Run: npx --yes tsx src/services/navigation/networkState.smoke.test.ts
 */
import {
  hasTransportLink,
  isDefinitelyOffline,
  isDefinitelyOnline,
  isOfflineAfterProbe,
  shouldProbeInternet,
} from './networkFlags';

let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  }
}

assert(isDefinitelyOffline({ type: 'NONE' }) === true, 'NONE is offline');
assert(
  isDefinitelyOffline({ type: 'UNKNOWN' }) === false,
  'UNKNOWN is not definite offline',
);
assert(
  isDefinitelyOffline({ isConnected: false, type: 'UNKNOWN' }) === false,
  'UNKNOWN + isConnected false is OEM lie, not airplane',
);
assert(
  isDefinitelyOffline({ isConnected: false }) === false,
  'disconnected without NONE type is not definite offline',
);
assert(
  isDefinitelyOffline({ isConnected: false, type: 'WIFI' }) === false,
  'wifi type still present is not definite offline',
);
assert(
  isDefinitelyOffline({ isConnected: false, type: 'CELLULAR' }) === false,
  'cellular type still present is not definite offline',
);
assert(
  isDefinitelyOffline({ isConnected: false, type: 'NONE' }) === true,
  'disconnected + NONE is offline',
);
assert(
  isDefinitelyOnline({ type: 'WIFI', isInternetReachable: true }) === true,
  'reachable wifi is online',
);
assert(
  isDefinitelyOnline({ type: 'UNKNOWN', isInternetReachable: false }) === false,
  'unknown+false is not definite online',
);
assert(
  shouldProbeInternet({ type: 'UNKNOWN', isConnected: true }) === true,
  'unknown connected needs probe',
);
assert(
  shouldProbeInternet({
    type: 'WIFI',
    isConnected: true,
    isInternetReachable: false,
  }) === true,
  'reachable=false needs probe',
);
assert(
  isOfflineAfterProbe(
    { type: 'WIFI', isConnected: true, isInternetReachable: false },
    true,
  ) === false,
  'probe ok → online despite reachable=false',
);
assert(
  isOfflineAfterProbe(
    { type: 'WIFI', isConnected: true, isInternetReachable: false },
    false,
  ) === false,
  'connected+probe fail stays online (OEM lie)',
);
assert(
  isOfflineAfterProbe({ type: 'UNKNOWN', isConnected: null }, false) === false,
  'unknown + probe fail stays online (fail open)',
);
assert(
  isOfflineAfterProbe(
    { type: 'UNKNOWN', isConnected: false, isInternetReachable: false },
    false,
  ) === false,
  'UNKNOWN + disconnected + probe fail stays online',
);
assert(
  isOfflineAfterProbe(
    { type: 'CELLULAR', isConnected: null, isInternetReachable: false },
    false,
  ) === false,
  'cellular bars + OEM reachable=false is not offline',
);
assert(hasTransportLink({ type: 'CELLULAR' }) === true, 'cellular is transport');
assert(
  isOfflineAfterProbe({ type: 'NONE', isConnected: false }, false) === true,
  'airplane / NONE is offline',
);

if (failed) {
  console.error(`networkState smoke: ${failed} failed`);
  process.exit(1);
}
console.log('networkState smoke: ok');
