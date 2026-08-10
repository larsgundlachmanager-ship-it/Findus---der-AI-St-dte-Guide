package de.findus.app

import android.app.KeyguardManager
import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.PowerManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

/**
 * Device lock + external audio route (BT / wired headset) + flashlight.
 * Used by speech delivery policy: no pocket-speaker when locked.
 */
class FindusDeviceAudioModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  @Volatile
  private var torchOn: Boolean = false

  @Volatile
  private var torchCameraId: String? = null

  override fun getName(): String = "FindusDeviceAudio"

  private fun audioManager(): AudioManager =
    reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun isKeyguardLocked(): Boolean {
    val kg = reactContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    return kg.isKeyguardLocked
  }

  private fun isScreenInteractive(): Boolean {
    val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    return pm.isInteractive
  }

  private fun hasExternalAudioRoute(): Boolean {
    val am = audioManager()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      for (d in devices) {
        when (d.type) {
          AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
          AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
          AudioDeviceInfo.TYPE_BLE_HEADSET,
          AudioDeviceInfo.TYPE_BLE_SPEAKER,
          AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
          AudioDeviceInfo.TYPE_WIRED_HEADSET,
          AudioDeviceInfo.TYPE_USB_HEADSET,
          AudioDeviceInfo.TYPE_USB_DEVICE,
          AudioDeviceInfo.TYPE_HEARING_AID -> return true
        }
      }
      return false
    }
    @Suppress("DEPRECATION")
    return am.isBluetoothA2dpOn || am.isBluetoothScoOn || am.isWiredHeadsetOn
  }

  private fun flashCameraId(): String? {
    torchCameraId?.let { return it }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
    val cm = reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    for (id in cm.cameraIdList) {
      val chars = cm.getCameraCharacteristics(id)
      val flash = chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
      if (flash) {
        torchCameraId = id
        return id
      }
    }
    return null
  }

  @ReactMethod
  fun getSpeechRouteState(promise: Promise) {
    try {
      val locked = isKeyguardLocked() || !isScreenInteractive()
      val external = hasExternalAudioRoute()
      val map = WritableNativeMap()
      map.putBoolean("deviceLocked", locked)
      map.putBoolean("hasExternalAudio", external)
      map.putBoolean("keyguardLocked", isKeyguardLocked())
      map.putBoolean("screenInteractive", isScreenInteractive())
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("SPEECH_ROUTE", e.message, e)
    }
  }

  @ReactMethod
  fun getTorchState(promise: Promise) {
    promise.resolve(torchOn)
  }

  @ReactMethod
  fun setTorch(enabled: Boolean, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.reject("TORCH", "Torch requires Android M+")
      return
    }
    try {
      val id = flashCameraId()
      if (id == null) {
        promise.reject("NO_FLASH", "No flash unit on this device")
        return
      }
      val cm = reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      cm.setTorchMode(id, enabled)
      torchOn = enabled
      promise.resolve(enabled)
    } catch (e: Exception) {
      promise.reject("TORCH", e.message, e)
    }
  }
}
