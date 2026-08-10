import * as Network from 'expo-network';

export async function isDeviceOffline(): Promise<boolean> {
  try {
    const net = await Network.getNetworkStateAsync();
    return (
      net.type === Network.NetworkStateType.NONE ||
      net.type === Network.NetworkStateType.UNKNOWN ||
      net.isInternetReachable === false
    );
  } catch {
    return false;
  }
}
