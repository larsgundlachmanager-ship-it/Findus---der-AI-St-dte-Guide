/**
 * Device flashlight / torch — Android + iOS via FindusDeviceAudio native module.
 */

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

type NativeTorch = {
  setTorch?: (enabled: boolean) => Promise<boolean>;
  getTorchState?: () => Promise<boolean>;
};

const Native = NativeModules.FindusDeviceAudio as NativeTorch | undefined;

async function ensureCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Taschenlampe',
        message: 'Yorro braucht kurz die Kamera-Berechtigung für die Taschenlampe.',
        buttonPositive: 'Erlauben',
        buttonNegative: 'Nicht jetzt',
      },
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function setFlashlight(enabled: boolean): Promise<{
  ok: boolean;
  on: boolean;
  message?: string;
}> {
  if (!Native?.setTorch) {
    return {
      ok: false,
      on: false,
      message: 'Taschenlampe steuere ich auf diesem Gerät noch nicht.',
    };
  }
  const allowed = await ensureCameraPermission();
  if (!allowed) {
    return {
      ok: false,
      on: false,
      message: 'Ohne Kamera-Berechtigung kann ich die Taschenlampe nicht schalten.',
    };
  }
  try {
    const on = await Native.setTorch(enabled);
    return { ok: true, on: Boolean(on) };
  } catch (err) {
    return {
      ok: false,
      on: false,
      message:
        err instanceof Error
          ? err.message
          : 'Taschenlampe ließ sich nicht schalten — Kamera-Berechtigung prüfen.',
    };
  }
}

export async function toggleFlashlight(): Promise<{
  ok: boolean;
  on: boolean;
  message?: string;
}> {
  if (Platform.OS !== 'android' || !Native?.getTorchState || !Native.setTorch) {
    return setFlashlight(true);
  }
  try {
    const cur = await Native.getTorchState();
    return setFlashlight(!cur);
  } catch {
    return setFlashlight(true);
  }
}
